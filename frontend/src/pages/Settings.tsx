import { useEffect, useRef, useState, type FormEvent } from 'react'
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
  restoreBackup,
  testTelegram,
  updateAdminPermissions,
  updateSettings,
  uploadTls,
  type AdminListItem,
  type AdminProfile,
  type ApiKeyCreateResponse,
  type ApiKeyListItem,
  type PermissionScope,
} from '../lib/api'

const ACCENT = '#22D3EE'

const inputClass =
  'rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60'
const labelClass = 'mb-1.5 block text-xs text-slate-400'
const cardClass = 'rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4'
const buttonClass = 'rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60'

export default function SettingsPage() {
  const { t, align } = useLang()
  const [profile, setProfile] = useState<AdminProfile | null>(null)
  const canSettings = !profile || profile.is_owner || profile.permissions === null || profile.permissions.includes('settings')

  const [publicUrl, setPublicUrl] = useState('')
  const [urlSaving, setUrlSaving] = useState(false)
  const [urlSaved, setUrlSaved] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSubmitting, setPwSubmitting] = useState(false)
  const [pwSaved, setPwSaved] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  const [backupDownloading, setBackupDownloading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreDone, setRestoreDone] = useState(false)
  const [backupError, setBackupError] = useState<string | null>(null)
  const restoreInputRef = useRef<HTMLInputElement>(null)

  const [tlsEnabled, setTlsEnabled] = useState<boolean | null>(null)
  const [tlsCertFile, setTlsCertFile] = useState<File | null>(null)
  const [tlsKeyFile, setTlsKeyFile] = useState<File | null>(null)
  const [tlsUploading, setTlsUploading] = useState(false)
  const [tlsUploaded, setTlsUploaded] = useState(false)
  const [tlsError, setTlsError] = useState<string | null>(null)

  const [admins, setAdmins] = useState<AdminListItem[] | null>(null)
  const [newAdminUsername, setNewAdminUsername] = useState('')
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [newAdminPermissions, setNewAdminPermissions] = useState<Set<PermissionScope>>(
    new Set(PERMISSION_SCOPES),
  )
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
  const [keyCopied, setKeyCopied] = useState(false)

  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [telegramSaving, setTelegramSaving] = useState(false)
  const [telegramSaved, setTelegramSaved] = useState(false)
  const [telegramTesting, setTelegramTesting] = useState(false)
  const [telegramTestOk, setTelegramTestOk] = useState(false)
  const [telegramError, setTelegramError] = useState<string | null>(null)

  async function refreshAdmins() {
    try {
      const res = await listAdmins()
      setAdmins(res.admins)
    } catch {
      // Non-owner admins get a 403 here — that's expected, just leave the list unset.
    }
  }

  useEffect(() => {
    getAdminProfile().then((p) => {
      setProfile(p)
      if (p.is_owner) refreshAdmins()
    }).catch(() => undefined)
    getSettings()
      .then((s) => {
        setPublicUrl(s.public_url ?? '')
        setBotToken(s.telegram_bot_token ?? '')
        setChatId(s.telegram_chat_id ?? '')
      })
      .catch(() => undefined)
    getTlsStatus()
      .then((s) => setTlsEnabled(s.enabled))
      .catch(() => undefined)
    refreshApiKeys()
  }, [])

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
    setUrlSaved(false)
    try {
      const res = await updateSettings({ public_url: publicUrl.trim() || null })
      setPublicUrl(res.public_url ?? '')
      setUrlSaved(true)
      window.setTimeout(() => setUrlSaved(false), 2000)
    } catch (err) {
      setUrlError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setUrlSaving(false)
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault()
    setPwError(null)
    setPwSaved(false)
    if (newPassword !== confirmPassword) {
      setPwError(t.settingsPage.passwordMismatch)
      return
    }
    setPwSubmitting(true)
    try {
      await changePassword({ current_password: currentPassword, new_password: newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPwSaved(true)
      window.setTimeout(() => setPwSaved(false), 2000)
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
      setBackupError(err instanceof ApiError ? err.message : t.settingsPage.downloadFailed)
    } finally {
      setBackupDownloading(false)
    }
  }

  async function handleRestoreFile(file: File) {
    if (!window.confirm(t.settingsPage.restoreConfirm)) {
      if (restoreInputRef.current) restoreInputRef.current.value = ''
      return
    }
    setRestoring(true)
    setBackupError(null)
    setRestoreDone(false)
    try {
      await restoreBackup(file)
      setRestoreDone(true)
    } catch (err) {
      setBackupError(err instanceof ApiError ? err.message : t.settingsPage.restoreFailed)
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
    setTlsUploaded(false)
    try {
      await uploadTls(tlsCertFile, tlsKeyFile)
      setTlsCertFile(null)
      setTlsKeyFile(null)
      setTlsEnabled(true)
      setTlsUploaded(true)
      window.setTimeout(() => setTlsUploaded(false), 3000)
    } catch (err) {
      setTlsError(err instanceof ApiError ? err.message : t.settingsPage.tlsUploadFailed)
    } finally {
      setTlsUploading(false)
    }
  }

  async function handleRemoveTls() {
    if (!window.confirm(t.settingsPage.tlsRemoveConfirm)) return
    setTlsError(null)
    try {
      await removeTls()
      setTlsEnabled(false)
    } catch (err) {
      setTlsError(err instanceof ApiError ? err.message : t.settingsPage.tlsRemoveFailed)
    }
  }

  function toggleNewAdminPermission(scope: PermissionScope) {
    setNewAdminPermissions((prev) => {
      const next = new Set(prev)
      if (next.has(scope)) next.delete(scope)
      else next.add(scope)
      return next
    })
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
      await refreshAdmins()
    } catch (err) {
      setAdminError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setAdminSubmitting(false)
    }
  }

  async function handleDeleteAdmin(a: AdminListItem) {
    if (!window.confirm(t.settingsPage.confirmDeleteAdmin(a.username))) return
    try {
      await deleteAdminAccount(a.id)
      await refreshAdmins()
    } catch (err) {
      setAdminError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  function startEditPerms(a: AdminListItem) {
    setEditingPermsId(a.id)
    setEditingPermsSet(new Set(a.permissions ?? PERMISSION_SCOPES))
  }

  function toggleEditingPermission(scope: PermissionScope) {
    setEditingPermsSet((prev) => {
      const next = new Set(prev)
      if (next.has(scope)) next.delete(scope)
      else next.add(scope)
      return next
    })
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
    if (!window.confirm(t.settingsPage.confirmDeleteApiKey(key.name))) return
    try {
      await deleteApiKey(key.id)
      if (justCreatedKey?.id === key.id) setJustCreatedKey(null)
      await refreshApiKeys()
    } catch (err) {
      setKeyError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  async function handleSaveTelegram(e: FormEvent) {
    e.preventDefault()
    setTelegramSaving(true)
    setTelegramError(null)
    setTelegramSaved(false)
    setTelegramTestOk(false)
    try {
      const res = await updateSettings({
        telegram_bot_token: botToken.trim() || null,
        telegram_chat_id: chatId.trim() || null,
      })
      setBotToken(res.telegram_bot_token ?? '')
      setChatId(res.telegram_chat_id ?? '')
      setTelegramSaved(true)
      window.setTimeout(() => setTelegramSaved(false), 2000)
    } catch (err) {
      setTelegramError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setTelegramSaving(false)
    }
  }

  async function handleTestTelegram() {
    setTelegramTesting(true)
    setTelegramError(null)
    setTelegramTestOk(false)
    try {
      await testTelegram()
      setTelegramTestOk(true)
      window.setTimeout(() => setTelegramTestOk(false), 3000)
    } catch (err) {
      setTelegramError(err instanceof ApiError ? err.message : t.settingsPage.testTelegramFailed)
    } finally {
      setTelegramTesting(false)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-50">{t.settingsPage.title}</h1>
        {profile && (
          <span className="text-xs text-slate-400">
            {t.settingsPage.signedInAs} <span className="text-slate-200">{profile.username}</span>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-6">
        {canSettings && (
        <form onSubmit={handleSaveUrl} className={cardClass}>
          <h2 className={`mb-1 text-sm font-bold text-slate-100 ${align}`}>{t.settingsPage.publicUrlTitle}</h2>
          <p className={`mb-3 text-xs text-slate-500 ${align}`}>{t.settingsPage.publicUrlDesc}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1" style={{ minWidth: 240 }}>
              <label className={labelClass}>{t.settingsPage.publicUrlLabel}</label>
              <input
                dir="ltr"
                value={publicUrl}
                onChange={(e) => setPublicUrl(e.target.value)}
                placeholder="https://panel.example.com"
                className={`${inputClass} w-full text-left`}
              />
            </div>
            <button type="submit" disabled={urlSaving} className={buttonClass} style={{ backgroundColor: ACCENT }}>
              {urlSaving ? t.common.saving : urlSaved ? t.common.saved : t.common.save}
            </button>
          </div>
          {urlError && <div className="mt-3 text-xs text-red-400">{urlError}</div>}
        </form>
        )}

        <form onSubmit={handleChangePassword} className={cardClass}>
          <h2 className={`mb-1 text-sm font-bold text-slate-100 ${align}`}>{t.settingsPage.changePasswordTitle}</h2>
          <p className={`mb-3 text-xs text-slate-500 ${align}`}>{t.settingsPage.changePasswordDesc}</p>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={labelClass}>{t.settingsPage.currentPassword}</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t.settingsPage.newPassword}</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t.settingsPage.confirmPassword}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className={inputClass}
              />
            </div>
          </div>
          {pwError && <div className="mt-3 text-xs text-red-400">{pwError}</div>}
          <button
            type="submit"
            disabled={pwSubmitting}
            className={`${buttonClass} mt-4`}
            style={{ backgroundColor: ACCENT }}
          >
            {pwSubmitting ? t.common.saving : pwSaved ? t.settingsPage.passwordChanged : t.settingsPage.changePasswordBtn}
          </button>
        </form>

        <div className={cardClass}>
          <h2 className={`mb-1 text-sm font-bold text-slate-100 ${align}`}>{t.settingsPage.apiKeysTitle}</h2>
          <p className={`mb-3 text-xs text-slate-500 ${align}`}>{t.settingsPage.apiKeysDesc}</p>

          <form onSubmit={handleCreateApiKey} className="mb-3 flex flex-wrap items-end gap-3">
            <div>
              <label className={labelClass}>{t.settingsPage.apiKeyNameLabel}</label>
              <input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                required
                placeholder={t.settingsPage.apiKeyNamePlaceholder}
                className={inputClass}
              />
            </div>
            <button type="submit" disabled={keyCreating} className={buttonClass} style={{ backgroundColor: ACCENT }}>
              {keyCreating ? t.settingsPage.creating : t.settingsPage.newApiKeyBtn}
            </button>
          </form>
          {keyError && <div className="mb-3 text-xs text-red-400">{keyError}</div>}

          {justCreatedKey && (
            <div className="mb-3 rounded-lg border border-cyan-400/30 bg-cyan-400/5 p-3">
              <div className={`mb-1.5 text-xs text-slate-300 ${align}`}>{t.settingsPage.apiKeyShowOnceWarning}</div>
              <div className="flex items-center gap-2">
                <code dir="ltr" className="flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-2.5 py-1.5 text-left text-xs text-cyan-200">
                  {justCreatedKey.key}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(justCreatedKey.key)
                    setKeyCopied(true)
                    window.setTimeout(() => setKeyCopied(false), 1500)
                  }}
                  className="flex-shrink-0 text-xs font-bold"
                  style={{ color: ACCENT }}
                >
                  {keyCopied ? t.common.copiedCheck : t.settingsPage.copyKey}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {apiKeys?.length === 0 && <div className="text-xs text-slate-500">{t.settingsPage.noApiKeysYet}</div>}
            {apiKeys?.map((k) => (
              <div key={k.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <div>
                  <div className="text-sm text-slate-100">{k.name}</div>
                  <div dir="ltr" className="text-left font-mono text-[11px] text-slate-500">
                    {k.key_prefix}…{' '}
                    {k.last_used_at ? t.settingsPage.lastUsed(new Date(k.last_used_at).toLocaleDateString()) : t.settingsPage.neverUsed}
                  </div>
                </div>
                <button onClick={() => handleDeleteApiKey(k)} className="text-xs text-red-400 hover:underline">
                  {t.common.delete}
                </button>
              </div>
            ))}
          </div>
        </div>

        {canSettings && (
        <>
        <form onSubmit={handleSaveTelegram} className={cardClass}>
          <h2 className={`mb-1 text-sm font-bold text-slate-100 ${align}`}>{t.settingsPage.telegramTitle}</h2>
          <p className={`mb-3 text-xs text-slate-500 ${align}`}>
            {t.settingsPage.telegramDesc1}{' '}
            <span dir="ltr" className="font-mono">
              @BotFather
            </span>{' '}
            {t.settingsPage.telegramDesc2}{' '}
            <span dir="ltr" className="font-mono">
              @userinfobot
            </span>
            .
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={labelClass}>{t.settingsPage.botToken}</label>
              <input
                dir="ltr"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456:ABC-def..."
                className={`${inputClass} w-64 text-left font-mono text-xs`}
              />
            </div>
            <div>
              <label className={labelClass}>{t.settingsPage.chatId}</label>
              <input
                dir="ltr"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="123456789"
                className={`${inputClass} w-40 text-left font-mono text-xs`}
              />
            </div>
            <button type="submit" disabled={telegramSaving} className={buttonClass} style={{ backgroundColor: ACCENT }}>
              {telegramSaving ? t.common.saving : telegramSaved ? t.common.saved : t.common.save}
            </button>
            <button
              type="button"
              onClick={handleTestTelegram}
              disabled={telegramTesting}
              className="rounded-lg border px-4 py-2 text-sm font-bold disabled:opacity-60"
              style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
            >
              {telegramTesting ? t.settingsPage.sending : telegramTestOk ? t.settingsPage.sent : t.settingsPage.sendTestMsg}
            </button>
          </div>
          {telegramError && <div className="mt-3 text-xs text-red-400">{telegramError}</div>}
        </form>

        <div className={cardClass}>
          <h2 className={`mb-1 text-sm font-bold text-slate-100 ${align}`}>{t.settingsPage.backupTitle}</h2>
          <p className={`mb-3 text-xs text-slate-500 ${align}`}>{t.settingsPage.backupDesc}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleDownloadBackup}
              disabled={backupDownloading}
              className={buttonClass}
              style={{ backgroundColor: ACCENT }}
            >
              {backupDownloading ? t.settingsPage.downloading : t.settingsPage.downloadBackup}
            </button>

            <button
              type="button"
              onClick={() => restoreInputRef.current?.click()}
              disabled={restoring}
              className="rounded-lg border px-4 py-2 text-sm font-bold disabled:opacity-60"
              style={{ borderColor: 'rgba(248,113,113,0.4)', color: '#f87171' }}
            >
              {restoring ? t.settingsPage.restoring : restoreDone ? t.settingsPage.restored : t.settingsPage.restoreFromFile}
            </button>
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
          {backupError && <div className="mt-3 text-xs text-red-400">{backupError}</div>}
          {restoreDone && <div className="mt-3 text-xs text-slate-400">{t.settingsPage.restoreDoneNote}</div>}
        </div>

        <form onSubmit={handleUploadTls} className={cardClass}>
          <div className={`mb-1 flex items-center justify-between ${align}`}>
            <h2 className="text-sm font-bold text-slate-100">{t.settingsPage.tlsTitle}</h2>
            {tlsEnabled !== null && (
              <span
                className="rounded-full border px-2.5 py-1 text-[11px]"
                style={
                  tlsEnabled
                    ? { borderColor: 'rgba(52,211,153,0.35)', color: '#34d399', backgroundColor: 'rgba(52,211,153,0.1)' }
                    : { borderColor: 'rgba(148,163,184,0.3)', color: '#94a3b8', backgroundColor: 'rgba(148,163,184,0.08)' }
                }
              >
                {tlsEnabled ? t.settingsPage.tlsEnabled : t.settingsPage.tlsDisabled}
              </span>
            )}
          </div>
          <p className={`mb-3 text-xs text-slate-500 ${align}`}>{t.settingsPage.tlsDesc}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={labelClass}>{t.settingsPage.tlsCertLabel}</label>
              <input
                type="file"
                accept=".pem,.crt,.cer"
                onChange={(e) => setTlsCertFile(e.target.files?.[0] ?? null)}
                required
                className="block text-xs text-slate-300 file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-slate-200"
              />
            </div>
            <div>
              <label className={labelClass}>{t.settingsPage.tlsKeyLabel}</label>
              <input
                type="file"
                accept=".pem,.key"
                onChange={(e) => setTlsKeyFile(e.target.files?.[0] ?? null)}
                required
                className="block text-xs text-slate-300 file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-slate-200"
              />
            </div>
            <button
              type="submit"
              disabled={tlsUploading || !tlsCertFile || !tlsKeyFile}
              className={buttonClass}
              style={{ backgroundColor: ACCENT }}
            >
              {tlsUploading ? t.settingsPage.tlsUploading : tlsUploaded ? t.settingsPage.tlsUploaded : t.settingsPage.tlsUploadBtn}
            </button>
            {tlsEnabled && (
              <button
                type="button"
                onClick={handleRemoveTls}
                className="rounded-lg border px-4 py-2 text-sm font-bold"
                style={{ borderColor: 'rgba(248,113,113,0.4)', color: '#f87171' }}
              >
                {t.settingsPage.tlsRemoveBtn}
              </button>
            )}
          </div>
          {tlsError && <div className="mt-3 text-xs text-red-400">{tlsError}</div>}
        </form>
        </>
        )}

        {profile?.is_owner && (
          <div className={cardClass}>
            <h2 className={`mb-1 text-sm font-bold text-slate-100 ${align}`}>{t.settingsPage.adminsTitle}</h2>
            <p className={`mb-3 text-xs text-slate-500 ${align}`}>{t.settingsPage.adminsDesc}</p>

            <form onSubmit={handleCreateAdmin} className="mb-4 flex flex-wrap items-end gap-3">
              <div>
                <label className={labelClass}>{t.usersPage.username}</label>
                <input
                  value={newAdminUsername}
                  onChange={(e) => setNewAdminUsername(e.target.value)}
                  required
                  pattern="[a-zA-Z0-9_-]+"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{t.passLabel}</label>
                <input
                  type="password"
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                  required
                  minLength={8}
                  className={inputClass}
                />
              </div>
              <div className="w-full">
                <label className={labelClass}>{t.settingsPage.permissionsLabel}</label>
                <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-white/10 bg-black/20 p-2">
                  {PERMISSION_SCOPES.map((scope) => (
                    <label key={scope} className="flex cursor-pointer items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={newAdminPermissions.has(scope)}
                        onChange={() => toggleNewAdminPermission(scope)}
                      />
                      <span className="text-slate-200">{t.settingsPage.permissionScopes[scope]}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">{t.settingsPage.permissionsHint}</div>
              </div>
              <button type="submit" disabled={adminSubmitting} className={buttonClass} style={{ backgroundColor: ACCENT }}>
                {adminSubmitting ? t.settingsPage.creating : t.settingsPage.newAdminBtn}
              </button>
            </form>
            {adminError && <div className="mb-3 text-xs text-red-400">{adminError}</div>}

            <div className="flex flex-col gap-2">
              {admins?.map((a) => (
                <div key={a.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-100">{a.username}</span>
                      {a.is_owner ? (
                        <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-slate-400">
                          owner
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          {a.permissions === null
                            ? t.settingsPage.fullAccess
                            : a.permissions.map((s) => t.settingsPage.permissionScopes[s]).join(', ') ||
                              t.settingsPage.noAccess}
                        </span>
                      )}
                    </div>
                    {!a.is_owner && (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => (editingPermsId === a.id ? setEditingPermsId(null) : startEditPerms(a))}
                          className="text-xs hover:underline"
                          style={{ color: ACCENT }}
                        >
                          {t.settingsPage.editPermissions}
                        </button>
                        <button onClick={() => handleDeleteAdmin(a)} className="text-xs text-red-400 hover:underline">
                          {t.common.delete}
                        </button>
                      </div>
                    )}
                  </div>
                  {editingPermsId === a.id && (
                    <div className="mt-2 border-t border-white/10 pt-2">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {PERMISSION_SCOPES.map((scope) => (
                          <label key={scope} className="flex cursor-pointer items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              checked={editingPermsSet.has(scope)}
                              onChange={() => toggleEditingPermission(scope)}
                            />
                            <span className="text-slate-200">{t.settingsPage.permissionScopes[scope]}</span>
                          </label>
                        ))}
                      </div>
                      <button
                        onClick={saveEditingPerms}
                        disabled={permsSaving}
                        className="mt-2 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-950 disabled:opacity-60"
                        style={{ backgroundColor: ACCENT }}
                      >
                        {t.common.save}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
