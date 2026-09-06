import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  changePassword,
  createAdminAccount,
  deleteAdminAccount,
  downloadBackup,
  getAdminProfile,
  getSettings,
  listAdmins,
  restoreBackup,
  testTelegram,
  updateSettings,
  type AdminListItem,
  type AdminProfile,
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

  const [admins, setAdmins] = useState<AdminListItem[] | null>(null)
  const [newAdminUsername, setNewAdminUsername] = useState('')
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [adminSubmitting, setAdminSubmitting] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)

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
  }, [])

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

  async function handleCreateAdmin(e: FormEvent) {
    e.preventDefault()
    setAdminSubmitting(true)
    setAdminError(null)
    try {
      await createAdminAccount({ username: newAdminUsername, password: newAdminPassword })
      setNewAdminUsername('')
      setNewAdminPassword('')
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
              <button type="submit" disabled={adminSubmitting} className={buttonClass} style={{ backgroundColor: ACCENT }}>
                {adminSubmitting ? t.settingsPage.creating : t.settingsPage.newAdminBtn}
              </button>
            </form>
            {adminError && <div className="mb-3 text-xs text-red-400">{adminError}</div>}

            <div className="flex flex-col gap-2">
              {admins?.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-100">{a.username}</span>
                    {a.is_owner && (
                      <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-slate-400">
                        owner
                      </span>
                    )}
                  </div>
                  {!a.is_owner && (
                    <button onClick={() => handleDeleteAdmin(a)} className="text-xs text-red-400 hover:underline">
                      {t.common.delete}
                    </button>
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
