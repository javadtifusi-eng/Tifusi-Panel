import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import ShieldPanel, { type ShieldSummary } from '../components/ShieldPanel'
import { StrengthBars, highlightJsonLines, passwordScore, toggleInSet, useToast } from '../components/ui'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  changePassword,
  createAdminAccount,
  createApiKey,
  deleteAdminAccount,
  deleteApiKey,
  downloadBackup,
  getAdminProfile,
  getSettings,
  getTlsStatus,
  listAdmins,
  listApiKeys,
  PERMISSION_SCOPES,
  removeTls,
  requestSsl,
  restoreBackup,
  testDiscord,
  testTelegram,
  testWebhook,
  updateAdminPermissions,
  updateSettings,
  uploadTls,
  type AdminListItem,
  type AdminProfile,
  type ApiKeyCreateResponse,
  type ApiKeyListItem,
  type PanelSettings,
  type PermissionScope,
  type TlsStatus,
} from '../lib/api'
import { copyToClipboard } from '../lib/clipboard'
import { initials, parseServerDate } from '../lib/format'

type SectionId = 'url' | 'lock' | 'pass' | 'notify' | 'api' | 'tls' | 'shield' | 'admins' | 'backup' | 'danger'
type NotifyTab = 'telegram' | 'webhook' | 'discord'

// The exact text the panel sends when a node drops (app/nodes/sync.py), so the
// preview shows a real message rather than an invented one.
const SAMPLE_NODE = 'node-1'
const SAMPLE_TEXT = `🔴 نود «${SAMPLE_NODE}» از دسترس خارج شد.`

function Section({
  id,
  mark,
  title,
  sub,
  pill,
  children,
  footer,
  hidden,
  flash,
  className = '',
}: {
  id: SectionId
  mark: string
  title: string
  sub: string
  pill?: ReactNode
  children: ReactNode
  footer?: ReactNode
  hidden: boolean
  flash: boolean
  className?: string
}) {
  if (hidden) return null
  return (
    <section id={`set-${id}`} className={`sec ${flash ? 'flash' : ''} ${className}`}>
      <div className="sec-head">
        <span className="mk">{mark}</span>
        <span className="t">
          <b>{title}</b>
          <small>{sub}</small>
        </span>
        {pill}
      </div>
      <div className="sec-body">{children}</div>
      {footer && <div className="sec-foot">{footer}</div>}
    </section>
  )
}

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'idle' | 'info' | 'bad'; children: ReactNode }) {
  return (
    <span className={`pill ${tone}`}>
      <i />
      {children}
    </span>
  )
}

export default function SettingsPage() {
  const { t, lang } = useLang()
  const s = t.ui.set
  const sp = t.settingsPage
  const say = useToast()
  const [profile, setProfile] = useState<AdminProfile | null>(null)
  const canSettings = !profile || profile.is_owner || profile.permissions === null || profile.permissions.includes('settings')
  const canTunnels = !!profile && !profile.is_reseller && (profile.is_owner || profile.permissions === null || profile.permissions.includes('tunnels'))
  const [shieldSummary, setShieldSummary] = useState<ShieldSummary | null>(null)

  const [saved, setSaved] = useState<PanelSettings | null>(null)
  const [publicUrl, setPublicUrl] = useState('')
  const [urlSaving, setUrlSaving] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [lockSaving, setLockSaving] = useState(false)

  async function toggleLock(on: boolean) {
    setLockSaving(true)
    try {
      setSaved(await updateSettings({ config_lock: on }))
      say(on ? t.ui.lock.onToast : t.ui.lock.offToast)
    } catch (err) {
      say(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setLockSaving(false)
    }
  }

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSubmitting, setPwSubmitting] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  const [backupDownloading, setBackupDownloading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreDone, setRestoreDone] = useState(false)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreWord, setRestoreWord] = useState('')
  const restoreInputRef = useRef<HTMLInputElement>(null)

  const [tls, setTls] = useState<TlsStatus | null>(null)
  const [tlsMode, setTlsMode] = useState<'free' | 'upload'>('free')
  const [tlsCertFile, setTlsCertFile] = useState<File | null>(null)
  const [tlsKeyFile, setTlsKeyFile] = useState<File | null>(null)
  const [tlsUploading, setTlsUploading] = useState(false)
  const [tlsError, setTlsError] = useState<string | null>(null)
  const [sslDomain, setSslDomain] = useState('')
  const [sslRequesting, setSslRequesting] = useState(false)

  const [admins, setAdmins] = useState<AdminListItem[] | null>(null)
  const [showNewAdmin, setShowNewAdmin] = useState(false)
  const [newAdminUsername, setNewAdminUsername] = useState('')
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [newAdminPermissions, setNewAdminPermissions] = useState<Set<PermissionScope>>(new Set(PERMISSION_SCOPES))
  const [adminSubmitting, setAdminSubmitting] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [editingPermsId, setEditingPermsId] = useState<number | null>(null)
  const [editingPermsSet, setEditingPermsSet] = useState<Set<PermissionScope>>(new Set())
  const [permsSaving, setPermsSaving] = useState(false)

  const [apiKeys, setApiKeys] = useState<ApiKeyListItem[] | null>(null)
  const [newKeyName, setNewKeyName] = useState('')
  const [keyCreating, setKeyCreating] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [justCreatedKey, setJustCreatedKey] = useState<ApiKeyCreateResponse | null>(null)

  const [notifyTab, setNotifyTab] = useState<NotifyTab>('telegram')
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [discordUrl, setDiscordUrl] = useState('')
  const [notifySaving, setNotifySaving] = useState(false)
  const [notifyTesting, setNotifyTesting] = useState(false)
  const [notifyError, setNotifyError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [flash, setFlash] = useState<SectionId | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  async function refreshAdmins() {
    try {
      const res = await listAdmins()
      setAdmins(res.admins)
    } catch {
      // Non-owner admins get a 403 here — that's expected, just leave the list unset.
    }
  }

  function applySettings(res: PanelSettings) {
    setSaved(res)
    setPublicUrl(res.public_url ?? '')
    setBotToken(res.telegram_bot_token ?? '')
    setChatId(res.telegram_chat_id ?? '')
    setWebhookUrl(res.webhook_url ?? '')
    setWebhookSecret(res.webhook_secret ?? '')
    setDiscordUrl(res.discord_webhook_url ?? '')
  }

  useEffect(() => {
    getAdminProfile()
      .then((p) => {
        setProfile(p)
        if (p.is_owner) refreshAdmins()
      })
      .catch(() => undefined)
    getSettings().then(applySettings).catch(() => undefined)
    refreshTls()
    refreshApiKeys()
  }, [])

  // "/" jumps to the settings search, like most dashboards.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function refreshTls() {
    try {
      setTls(await getTlsStatus())
    } catch {
      // ignored — the SSL card just shows its "disabled" state
    }
  }

  async function refreshApiKeys() {
    try {
      const res = await listApiKeys()
      setApiKeys(res.keys)
    } catch {
      // never expected to fail (every admin owns their own keys), but
      // don't let it take the rest of the page down if it somehow does
    }
  }

  async function handleSaveUrl(e: FormEvent) {
    e.preventDefault()
    setUrlSaving(true)
    setUrlError(null)
    try {
      applySettings(await updateSettings({ public_url: publicUrl.trim() || null }))
      say(s.urlSaved)
    } catch (err) {
      setUrlError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setUrlSaving(false)
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault()
    setPwError(null)
    if (newPassword !== confirmPassword) {
      setPwError(sp.passwordMismatch)
      return
    }
    setPwSubmitting(true)
    try {
      await changePassword({ current_password: currentPassword, new_password: newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      say(sp.passwordChanged)
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setPwSubmitting(false)
    }
  }

  async function handleDownloadBackup() {
    setBackupDownloading(true)
    setBackupError(null)
    try {
      await downloadBackup()
    } catch (err) {
      setBackupError(err instanceof ApiError ? err.message : sp.downloadFailed)
    } finally {
      setBackupDownloading(false)
    }
  }

  // The typed RESTORE word is the confirmation; picking the file starts it.
  async function handleRestoreFile(file: File) {
    setRestoring(true)
    setBackupError(null)
    setRestoreDone(false)
    try {
      await restoreBackup(file)
      setRestoreDone(true)
      setRestoreOpen(false)
      setRestoreWord('')
    } catch (err) {
      setBackupError(err instanceof ApiError ? err.message : sp.restoreFailed)
    } finally {
      setRestoring(false)
      if (restoreInputRef.current) restoreInputRef.current.value = ''
    }
  }

  async function handleUploadTls(e: FormEvent) {
    e.preventDefault()
    if (!tlsCertFile || !tlsKeyFile) return
    setTlsUploading(true)
    setTlsError(null)
    try {
      await uploadTls(tlsCertFile, tlsKeyFile)
      setTlsCertFile(null)
      setTlsKeyFile(null)
      await refreshTls()
      say(sp.tlsUploaded)
    } catch (err) {
      setTlsError(err instanceof ApiError ? err.message : sp.tlsUploadFailed)
    } finally {
      setTlsUploading(false)
    }
  }

  async function handleRequestSsl(e: FormEvent) {
    e.preventDefault()
    if (!sslDomain.trim()) return
    setSslRequesting(true)
    setTlsError(null)
    try {
      await requestSsl(sslDomain.trim())
      setSslDomain('')
      await refreshTls()
      say(sp.tlsEnabled)
    } catch (err) {
      setTlsError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSslRequesting(false)
    }
  }

  async function handleRemoveTls() {
    if (!window.confirm(sp.tlsRemoveConfirm)) return
    setTlsError(null)
    try {
      await removeTls()
      await refreshTls()
    } catch (err) {
      setTlsError(err instanceof ApiError ? err.message : sp.tlsRemoveFailed)
    }
  }

  async function handleCreateAdmin(e: FormEvent) {
    e.preventDefault()
    setAdminSubmitting(true)
    setAdminError(null)
    const allChecked = newAdminPermissions.size === PERMISSION_SCOPES.length
    try {
      await createAdminAccount({
        username: newAdminUsername,
        password: newAdminPassword,
        permissions: allChecked ? null : Array.from(newAdminPermissions),
      })
      setNewAdminUsername('')
      setNewAdminPassword('')
      setNewAdminPermissions(new Set(PERMISSION_SCOPES))
      setShowNewAdmin(false)
      await refreshAdmins()
    } catch (err) {
      setAdminError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setAdminSubmitting(false)
    }
  }

  async function handleDeleteAdmin(a: AdminListItem) {
    if (!window.confirm(sp.confirmDeleteAdmin(a.username))) return
    try {
      await deleteAdminAccount(a.id)
      await refreshAdmins()
    } catch (err) {
      setAdminError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  function toggleScope(a: AdminListItem, scope: PermissionScope) {
    const base = editingPermsId === a.id ? editingPermsSet : new Set(a.permissions ?? PERMISSION_SCOPES)
    setEditingPermsId(a.id)
    setEditingPermsSet(toggleInSet(base, scope))
  }

  async function saveEditingPerms() {
    if (editingPermsId == null) return
    setPermsSaving(true)
    setAdminError(null)
    const allChecked = editingPermsSet.size === PERMISSION_SCOPES.length
    try {
      await updateAdminPermissions(editingPermsId, allChecked ? null : Array.from(editingPermsSet))
      setEditingPermsId(null)
      await refreshAdmins()
      say(s.permsSaved)
    } catch (err) {
      setAdminError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setPermsSaving(false)
    }
  }

  async function handleCreateApiKey(e: FormEvent) {
    e.preventDefault()
    setKeyCreating(true)
    setKeyError(null)
    try {
      const res = await createApiKey(newKeyName)
      setJustCreatedKey(res)
      setNewKeyName('')
      await refreshApiKeys()
    } catch (err) {
      setKeyError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setKeyCreating(false)
    }
  }

  async function handleDeleteApiKey(key: ApiKeyListItem) {
    if (!window.confirm(sp.confirmDeleteApiKey(key.name))) return
    try {
      await deleteApiKey(key.id)
      if (justCreatedKey?.id === key.id) setJustCreatedKey(null)
      await refreshApiKeys()
    } catch (err) {
      setKeyError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  async function handleSaveNotify(e: FormEvent) {
    e.preventDefault()
    setNotifySaving(true)
    setNotifyError(null)
    try {
      const payload: Partial<PanelSettings> =
        notifyTab === 'telegram'
          ? { telegram_bot_token: botToken.trim() || null, telegram_chat_id: chatId.trim() || null }
          : notifyTab === 'webhook'
            ? { webhook_url: webhookUrl.trim() || null, webhook_secret: webhookSecret.trim() || null }
            : { discord_webhook_url: discordUrl.trim() || null }
      applySettings(await updateSettings(payload))
      say(t.common.saved)
    } catch (err) {
      setNotifyError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setNotifySaving(false)
    }
  }

  async function handleTestNotify() {
    setNotifyTesting(true)
    setNotifyError(null)
    try {
      if (notifyTab === 'telegram') await testTelegram()
      else if (notifyTab === 'webhook') await testWebhook()
      else await testDiscord()
      say(sp.sent)
    } catch (err) {
      const fallback = notifyTab === 'telegram' ? sp.testTelegramFailed : notifyTab === 'webhook' ? sp.testWebhookFailed : sp.testDiscordFailed
      setNotifyError(err instanceof ApiError ? err.message : fallback)
    } finally {
      setNotifyTesting(false)
    }
  }

  async function copyKey(text: string) {
    if (await copyToClipboard(text)) say(t.common.copiedCheck)
  }

  // ── Health checklist (only what this admin can change here).
  const telegramOn = !!(saved?.telegram_bot_token && saved?.telegram_chat_id)
  const webhookOn = !!saved?.webhook_url
  const discordOn = !!saved?.discord_webhook_url
  const notifyOn = telegramOn || webhookOn || discordOn
  const checks: { id: SectionId; label: string; done: boolean }[] = canSettings
    ? [
        { id: 'url', label: s.checkUrl, done: !!saved?.public_url },
        { id: 'notify', label: s.checkNotify, done: notifyOn },
        { id: 'tls', label: s.checkTls, done: !!tls?.enabled },
        { id: 'api', label: s.checkKey, done: (apiKeys?.length ?? 0) > 0 },
      ]
    : []
  const doneCount = checks.filter((c) => c.done).length
  const circ = 2 * Math.PI * 52

  function jump(id: SectionId) {
    setQuery('')
    window.setTimeout(() => {
      document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setFlash(id)
      window.setTimeout(() => setFlash(null), 1400)
    }, 30)
  }

  const q = query.trim().toLowerCase()
  const matches = (id: SectionId, ...texts: string[]) => !q || [s.kw[id], ...texts].join(' ').toLowerCase().includes(q)
  const visible: Record<SectionId, boolean> = {
    url: canSettings && matches('url', sp.publicUrlTitle),
    lock: canSettings && matches('lock', t.ui.lock.title),
    pass: matches('pass', sp.changePasswordTitle),
    notify: canSettings && matches('notify', s.notifyTitle),
    api: matches('api', sp.apiKeysTitle),
    tls: canSettings && matches('tls', sp.tlsTitle),
    shield: canTunnels && matches('shield', t.ui.shield.title),
    admins: !!profile?.is_owner && matches('admins', sp.adminsTitle),
    backup: canSettings && matches('backup', sp.backupTitle),
    danger: canSettings && matches('danger', s.dangerTitle),
  }
  const anyVisible = Object.values(visible).some(Boolean)

  const urlBase = publicUrl.trim().replace(/\/+$/, '')
  const webhookBody = JSON.stringify(
    { event: 'node_disconnected', timestamp: new Date().toISOString(), data: { node_id: 1, name: SAMPLE_NODE } },
    null,
    2,
  )
  const pwLevel = Math.max(0, passwordScore(newPassword) - 1)
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' }).format(parseServerDate(iso))

  return (
    <div className="pg-set">
      <h1 className="sr-only">{sp.title}</h1>

      {canSettings && (
        <section className="health" aria-labelledby="set-health-title">
          <div className="score" role="img" aria-label={s.ofN(doneCount, checks.length)}>
            <svg viewBox="0 0 120 120">
              <circle className="track" cx="60" cy="60" r="52" />
              <circle
                className="val"
                cx="60"
                cy="60"
                r="52"
                strokeDasharray={circ}
                strokeDashoffset={saved ? circ * (1 - doneCount / Math.max(1, checks.length)) : circ}
              />
            </svg>
            <span className="sl">
              <span>
                <b>{doneCount}</b>
                <small>{s.ofTotal(checks.length)}</small>
              </span>
            </span>
          </div>
          <div className="h-body">
            <h2 id="set-health-title">{s.healthTitle}</h2>
            <p>{doneCount === checks.length ? s.healthDone : s.healthLeft(checks.length - doneCount)}</p>
            <div className="checks">
              {checks.map((c) => (
                <button key={c.id} type="button" className={`check ${c.done ? 'done' : 'todo'}`} onClick={() => jump(c.id)}>
                  <span className="ic">{c.done ? '✓' : '!'}</span>
                  <span className="t">{c.label}</span>
                  <span className="go">{c.done ? s.stateDone : s.stateTodo}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="search">
        <input
          ref={searchRef}
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={s.search}
          aria-label={s.search}
          autoComplete="off"
        />
        <kbd>/</kbd>
      </div>
      {!anyVisible && <div className="no-match">{s.noMatch}</div>}

      <div className="secgrid">
        <Section
          id="url"
          mark="URL"
          title={sp.publicUrlTitle}
          sub={s.urlSub}
          hidden={!visible.url}
          flash={flash === 'url'}
          pill={saved?.public_url ? <Pill tone="ok">{s.pillSet}</Pill> : <Pill tone="idle">{s.pillEmpty}</Pill>}
          footer={
            <>
              {urlError && <span className="msg err-text">{urlError}</span>}
              <button type="submit" form="set-url-form" disabled={urlSaving} className="btn solid">
                {urlSaving ? t.common.saving : t.common.save}
              </button>
            </>
          }
        >
          <form id="set-url-form" onSubmit={handleSaveUrl}>
            <label className="lbl" htmlFor="set-url">
              {sp.publicUrlLabel}
            </label>
            <input id="set-url" className="input ltr" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://panel.example.com" />
            <div className="hint">{sp.publicUrlDesc}</div>
          </form>
          <div className="preview">
            <div className="cap">{s.previewCap}</div>
            <div className="url">
              {urlBase ? (
                <>
                  {urlBase}/sub/<span className="dim">…</span>
                </>
              ) : (
                <span className="dim" dir="auto">
                  {s.previewFallback(window.location.origin)}
                </span>
              )}
            </div>
          </div>
        </Section>

        <Section
          id="lock"
          mark="🔒"
          title={t.ui.lock.title}
          sub={t.ui.lock.sub}
          hidden={!visible.lock}
          flash={flash === 'lock'}
          pill={saved?.config_lock ? <Pill tone="ok">{t.ui.lock.pillOn}</Pill> : <Pill tone="idle">{t.ui.lock.pillOff}</Pill>}
        >
          <label className="tf-switch">
            <input id="set-lock-on" type="checkbox" checked={!!saved?.config_lock} disabled={!saved || lockSaving} onChange={(e) => toggleLock(e.target.checked)} />
            {t.ui.lock.toggle}
          </label>
          <ul className="lock-what">
            <li>
              <b>📱 {t.ui.lock.appT}</b>
              <span>{t.ui.lock.appD}</span>
            </li>
            <li>
              <b>🧩 {t.ui.lock.otherT}</b>
              <span>{t.ui.lock.otherD}</span>
            </li>
            <li>
              <b>🌐 {t.ui.lock.pageT}</b>
              <span>{t.ui.lock.pageD}</span>
            </li>
          </ul>
          <div className="hint" style={{ margin: 0 }}>{t.ui.lock.note}</div>
        </Section>

        <Section
          id="pass"
          mark="•••"
          title={sp.changePasswordTitle}
          sub={sp.changePasswordDesc}
          hidden={!visible.pass}
          flash={flash === 'pass'}
          pill={profile ? <span className="chip en">{profile.username}</span> : undefined}
          footer={
            <>
              {pwError && <span className="msg err-text">{pwError}</span>}
              <button type="submit" form="set-pass-form" disabled={pwSubmitting} className="btn solid">
                {pwSubmitting ? t.common.saving : sp.changePasswordBtn}
              </button>
            </>
          }
        >
          <form id="set-pass-form" onSubmit={handleChangePassword} className="flex flex-col gap-3">
            <div>
              <label className="lbl" htmlFor="set-pw-cur">
                {sp.currentPassword}
              </label>
              <input id="set-pw-cur" className="input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            <div className="row2">
              <div>
                <label className="lbl" htmlFor="set-pw-new">
                  {sp.newPassword}
                </label>
                <input id="set-pw-new" className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
              </div>
              <div>
                <label className="lbl" htmlFor="set-pw-rep">
                  {sp.confirmPassword}
                </label>
                <input id="set-pw-rep" className="input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
              </div>
            </div>
            <StrengthBars password={newPassword} />
            <div className="hint" style={{ margin: 0 }}>
              {newPassword ? `${s.strengthPrefix}${s.strength[pwLevel]}` : s.strengthPrefix + '—'}
              {confirmPassword && newPassword !== confirmPassword && <span style={{ color: 'var(--bad)' }}> · {sp.passwordMismatch}</span>}
            </div>
          </form>
        </Section>

        <Section
          id="notify"
          mark="MSG"
          title={s.notifyTitle}
          sub={s.notifySub}
          hidden={!visible.notify}
          flash={flash === 'notify'}
          pill={notifyOn ? <Pill tone="info">{s.notifyOn([telegramOn, webhookOn, discordOn].filter(Boolean).length)}</Pill> : <Pill tone="idle">{s.pillOff}</Pill>}
          footer={
            <>
              {notifyError && <span className="msg err-text">{notifyError}</span>}
              <button type="button" className="btn" onClick={handleTestNotify} disabled={notifyTesting}>
                {notifyTesting ? sp.sending : sp.sendTestMsg}
              </button>
              <button type="submit" form="set-notify-form" className="btn solid" disabled={notifySaving}>
                {notifySaving ? t.common.saving : t.common.save}
              </button>
            </>
          }
        >
          <div className="ntabs" role="tablist">
            {(
              [
                ['telegram', s.tabTelegram, telegramOn],
                ['webhook', s.tabWebhook, webhookOn],
                ['discord', s.tabDiscord, discordOn],
              ] as [NotifyTab, string, boolean][]
            ).map(([id, label, on]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={notifyTab === id}
                onClick={() => {
                  setNotifyTab(id)
                  setNotifyError(null)
                }}
              >
                {label}
                {on && <span className="on-dot" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <form id="set-notify-form" onSubmit={handleSaveNotify} className="flex flex-col gap-3">
            {notifyTab === 'telegram' && (
              <>
                <div className="row2">
                  <div>
                    <label className="lbl" htmlFor="set-tg-token">
                      {sp.botToken}
                    </label>
                    <input id="set-tg-token" className="input ltr mono" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456:ABC-def..." />
                  </div>
                  <div>
                    <label className="lbl" htmlFor="set-tg-chat">
                      {sp.chatId}
                    </label>
                    <input id="set-tg-chat" className="input ltr mono" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="123456789" />
                  </div>
                </div>
                <div className="hint" style={{ margin: 0 }}>
                  {sp.telegramDesc1} <span className="en">@BotFather</span> {sp.telegramDesc2} <span className="en">@userinfobot</span>.
                </div>
                <div>
                  <div className="lbl">{s.sampleCap}</div>
                  <div className="tg">
                    <div className="tg-bubble" dir="rtl">
                      {SAMPLE_TEXT}
                    </div>
                  </div>
                </div>
              </>
            )}
            {notifyTab === 'webhook' && (
              <>
                <div className="row2">
                  <div>
                    <label className="lbl" htmlFor="set-hook-url">
                      {sp.webhookUrlLabel}
                    </label>
                    <input id="set-hook-url" className="input ltr" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://example.com/hook" />
                  </div>
                  <div>
                    <label className="lbl" htmlFor="set-hook-secret">
                      {sp.webhookSecretLabel}
                    </label>
                    <input id="set-hook-secret" className="input ltr mono" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
                  </div>
                </div>
                <div className="hint" style={{ margin: 0 }}>
                  {sp.webhookDesc}
                </div>
                <div>
                  <div className="lbl">{s.requestCap}</div>
                  <div className="preview">
                    <pre className="json" style={{ color: 'var(--muted)', marginBottom: 6 }}>
                      {`POST ${webhookUrl.trim() || 'https://example.com/hook'}${webhookSecret.trim() ? '\nX-Webhook-Secret: ••••••' : ''}`}
                    </pre>
                    <pre
                      className="json"
                      dangerouslySetInnerHTML={{ __html: highlightJsonLines(webhookBody).join('\n') }}
                    />
                  </div>
                </div>
              </>
            )}
            {notifyTab === 'discord' && (
              <>
                <div>
                  <label className="lbl" htmlFor="set-dc-url">
                    {sp.discordUrlLabel}
                  </label>
                  <input id="set-dc-url" className="input ltr" value={discordUrl} onChange={(e) => setDiscordUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/..." />
                </div>
                <div className="hint" style={{ margin: 0 }}>
                  {sp.discordDesc}
                </div>
                <div>
                  <div className="lbl">{s.sampleCap}</div>
                  <div className="dc">
                    <span className="bar" />
                    <div>
                      <b className="en">Tifusi Panel</b>
                      <p dir="rtl">{SAMPLE_TEXT}</p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </form>
        </Section>

        <Section
          id="api"
          mark="API"
          title={sp.apiKeysTitle}
          sub={s.apiSub}
          hidden={!visible.api}
          flash={flash === 'api'}
          pill={apiKeys && apiKeys.length > 0 ? <Pill tone="ok">{s.keysCount(apiKeys.length)}</Pill> : <Pill tone="idle">{s.noKeys}</Pill>}
        >
          <form onSubmit={handleCreateApiKey} className="row2" style={{ alignItems: 'end' }}>
            <div>
              <label className="lbl" htmlFor="set-key-name">
                {sp.apiKeyNameLabel}
              </label>
              <input id="set-key-name" className="input" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} required placeholder={sp.apiKeyNamePlaceholder} />
            </div>
            <button type="submit" disabled={keyCreating} className="btn solid lg block">
              {keyCreating ? sp.creating : sp.newApiKeyBtn}
            </button>
          </form>
          {keyError && <div className="err-text">{keyError}</div>}
          {justCreatedKey && (
            <div className="keybox">
              <span className="warnline">⚠ {sp.apiKeyShowOnceWarning}</span>
              <div className="keyline">
                <code>{justCreatedKey.key}</code>
                <button type="button" className="btn" onClick={() => copyKey(justCreatedKey.key)}>
                  {sp.copyKey}
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {apiKeys?.length === 0 && <div className="hint">{sp.noApiKeysYet}</div>}
            {apiKeys?.map((k) => (
              <div key={k.id} className="keyrow">
                <span className="t">
                  <b>{k.name}</b>
                  <small>
                    <span className="mono">{k.key_prefix}…</span> · {k.last_used_at ? sp.lastUsed(formatDate(k.last_used_at)) : sp.neverUsed}
                  </small>
                </span>
                <button onClick={() => handleDeleteApiKey(k)} className="btn danger">
                  {t.common.delete}
                </button>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="tls"
          mark="TLS"
          title={sp.tlsTitle}
          sub={s.tlsSub}
          hidden={!visible.tls}
          flash={flash === 'tls'}
          pill={tls?.enabled ? <Pill tone="ok">{s.tlsOn}</Pill> : <Pill tone="warn">{s.tlsOff}</Pill>}
          footer={
            <>
              {tlsError && <span className="msg err-text" style={{ whiteSpace: 'pre-wrap' }}>{tlsError}</span>}
              {tlsMode === 'free' ? (
                <button type="submit" form="set-ssl-form" className="btn solid" disabled={sslRequesting || !sslDomain.trim()}>
                  {sslRequesting ? sp.sslRequesting : sp.sslRequestBtn}
                </button>
              ) : (
                <button type="submit" form="set-tls-form" className="btn solid" disabled={tlsUploading || !tlsCertFile || !tlsKeyFile}>
                  {tlsUploading ? sp.tlsUploading : sp.tlsUploadBtn}
                </button>
              )}
            </>
          }
        >
          {tls?.enabled && tls.domain && (
            <div className="tls-card">
              <b className="en">{tls.domain}</b>
              <span>
                {tls.self_signed ? sp.tlsInfoSelfSigned(tls.domain) : sp.tlsInfoCa(tls.domain, tls.issuer ?? '?')}
                {tls.expires_at && ` · ${sp.tlsExpiresAt(formatDate(tls.expires_at))}`}
              </span>
            </div>
          )}
          <div className="tf-seg" role="group" aria-label={sp.tlsTitle} style={{ alignSelf: 'flex-start' }}>
            <button type="button" aria-pressed={tlsMode === 'free'} onClick={() => setTlsMode('free')}>
              {s.tlsFree}
            </button>
            <button type="button" aria-pressed={tlsMode === 'upload'} onClick={() => setTlsMode('upload')}>
              {s.tlsUpload}
            </button>
          </div>
          {tlsMode === 'free' ? (
            <form id="set-ssl-form" onSubmit={handleRequestSsl}>
              <label className="lbl" htmlFor="set-ssl-domain">
                {sp.sslDomainLabel}
              </label>
              <input id="set-ssl-domain" className="input ltr" value={sslDomain} onChange={(e) => setSslDomain(e.target.value)} placeholder="panel.example.com" />
              <div className="hint">{sp.sslAutoDesc}</div>
            </form>
          ) : (
            <form id="set-tls-form" onSubmit={handleUploadTls} className="flex flex-col gap-2">
              <div className="drops">
                {(
                  [
                    [sp.tlsCertLabel, tlsCertFile, setTlsCertFile, '.pem,.crt,.cer'],
                    [sp.tlsKeyLabel, tlsKeyFile, setTlsKeyFile, '.pem,.key'],
                  ] as [string, File | null, (f: File | null) => void, string][]
                ).map(([label, file, setFile, accept]) => (
                  <label
                    key={label}
                    className={`drop ${file ? 'has' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.currentTarget.classList.add('over')
                    }}
                    onDragLeave={(e) => e.currentTarget.classList.remove('over')}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.currentTarget.classList.remove('over')
                      const f = e.dataTransfer.files?.[0]
                      if (f) setFile(f)
                    }}
                  >
                    <span>{label}</span>
                    <b>{file ? file.name : s.dropPick}</b>
                    <input type="file" hidden accept={accept} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </label>
                ))}
              </div>
              <div className="hint" style={{ margin: 0 }}>
                {sp.tlsDesc}
              </div>
            </form>
          )}
        </Section>

        <Section
          id="admins"
          mark="ADM"
          title={sp.adminsTitle}
          sub={s.adminsSub}
          hidden={!visible.admins}
          flash={flash === 'admins'}
          pill={admins ? <Pill tone="ok">{s.adminsCount(admins.length)}</Pill> : undefined}
          footer={
            <>
              {adminError && <span className="msg err-text">{adminError}</span>}
              <button type="button" className="btn solid" onClick={() => setShowNewAdmin((v) => !v)}>
                {sp.newAdminBtn}
              </button>
            </>
          }
        >
          {admins?.map((a) => {
            const editing = editingPermsId === a.id
            const scopes = editing ? editingPermsSet : new Set(a.permissions ?? PERMISSION_SCOPES)
            return (
              <div key={a.id} className="admin">
                <div className="atop">
                  <span className="av">{initials(a.username)}</span>
                  <b className="en">{a.username}</b>
                  <span className="chip">
                    {a.is_owner ? s.ownerChip : a.permissions === null ? sp.fullAccess : a.permissions.length ? s.limitedChip : sp.noAccess}
                  </span>
                  {!a.is_owner && (
                    <span className="flex gap-1.5" style={{ marginInlineStart: 'auto' }}>
                      {editing && (
                        <>
                          <button type="button" className="btn solid" onClick={saveEditingPerms} disabled={permsSaving}>
                            {t.common.save}
                          </button>
                          <button type="button" className="btn" onClick={() => setEditingPermsId(null)}>
                            {t.usersPage.cancelAction}
                          </button>
                        </>
                      )}
                      <button type="button" className="btn danger" onClick={() => handleDeleteAdmin(a)}>
                        {t.common.delete}
                      </button>
                    </span>
                  )}
                </div>
                <div className="scopes">
                  {PERMISSION_SCOPES.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      className="scope"
                      aria-pressed={a.is_owner || scopes.has(scope)}
                      disabled={a.is_owner}
                      onClick={() => toggleScope(a, scope)}
                    >
                      {sp.permissionScopes[scope]}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          {showNewAdmin && (
            <form onSubmit={handleCreateAdmin} className="form-section">
              <div className="row2">
                <div>
                  <label className="lbl" htmlFor="set-adm-user">
                    {t.usersPage.username}
                  </label>
                  <input id="set-adm-user" className="input ltr" value={newAdminUsername} onChange={(e) => setNewAdminUsername(e.target.value)} required pattern="[a-zA-Z0-9_-]+" />
                </div>
                <div>
                  <label className="lbl" htmlFor="set-adm-pass">
                    {t.passLabel}
                  </label>
                  <input id="set-adm-pass" className="input" type="password" value={newAdminPassword} onChange={(e) => setNewAdminPassword(e.target.value)} required minLength={8} />
                </div>
              </div>
              <div>
                <div className="lbl">{sp.permissionsLabel}</div>
                <div className="scopes">
                  {PERMISSION_SCOPES.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      className="scope"
                      aria-pressed={newAdminPermissions.has(scope)}
                      onClick={() => setNewAdminPermissions((p) => toggleInSet(p, scope))}
                    >
                      {sp.permissionScopes[scope]}
                    </button>
                  ))}
                </div>
                <div className="hint">{sp.permissionsHint}</div>
              </div>
              <div>
                <button type="submit" disabled={adminSubmitting} className="btn solid">
                  {adminSubmitting ? sp.creating : sp.newAdminBtn}
                </button>
              </div>
            </form>
          )}
        </Section>

        <Section
          id="shield"
          mark="SH"
          title={t.ui.shield.title}
          sub={t.ui.shield.sub}
          hidden={!visible.shield}
          flash={flash === 'shield'}
          className="sec-wide"
          pill={shieldSummary ? <Pill tone={shieldSummary.tone}>{shieldSummary.text}</Pill> : undefined}
        >
          <ShieldPanel onSummary={setShieldSummary} />
        </Section>

        <Section
          id="backup"
          mark="DB"
          title={sp.backupTitle}
          sub={s.backupSub}
          hidden={!visible.backup}
          flash={flash === 'backup'}
          footer={
            <button type="button" onClick={handleDownloadBackup} disabled={backupDownloading} className="btn solid">
              {backupDownloading ? sp.downloading : sp.downloadBackup}
            </button>
          }
        >
          <div className="tf-note">{s.backupNote}</div>
          {backupError && <div className="err-text">{backupError}</div>}
          {restoreDone && <div className="ok-text">{sp.restoreDoneNote}</div>}
        </Section>

        <Section
          id="danger"
          mark="!"
          title={s.dangerTitle}
          sub={s.dangerSub}
          hidden={!visible.danger}
          flash={flash === 'danger'}
          className="danger-zone"
        >
          <div className="dz-row">
            <div>
              <b>{sp.restoreFromFile}</b>
              <p>{sp.restoreConfirm}</p>
              {restoreOpen && (
                <div className="confirm">
                  <span className="hint" style={{ margin: 0 }}>
                    {s.typeToConfirm} <b className="en">RESTORE</b>
                  </span>
                  <input className="input en" value={restoreWord} onChange={(e) => setRestoreWord(e.target.value)} aria-label="RESTORE" autoFocus />
                  <button
                    type="button"
                    className="btn danger"
                    disabled={restoreWord.trim() !== 'RESTORE' || restoring}
                    onClick={() => restoreInputRef.current?.click()}
                  >
                    {restoring ? sp.restoring : s.chooseFile}
                  </button>
                </div>
              )}
              <input
                ref={restoreInputRef}
                type="file"
                accept=".db"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleRestoreFile(file)
                }}
              />
            </div>
            <button type="button" className="btn danger" onClick={() => setRestoreOpen((v) => !v)}>
              {s.restoreBtn}
            </button>
          </div>
          {tls?.enabled && (
            <div className="dz-row">
              <div>
                <b>{sp.tlsRemoveBtn}</b>
                <p>{sp.tlsRemoveConfirm}</p>
              </div>
              <button type="button" className="btn danger" onClick={handleRemoveTls}>
                {sp.tlsRemoveBtn}
              </button>
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}
