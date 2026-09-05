import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ApiError,
  changePassword,
  downloadBackup,
  getAdminProfile,
  getSettings,
  restoreBackup,
  updateSettings,
  type AdminProfile,
} from '../lib/api'

const ACCENT = '#22D3EE'

const inputClass =
  'rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60'
const labelClass = 'mb-1.5 block text-xs text-slate-400'
const cardClass = 'rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4'
const buttonClass = 'rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60'

export default function SettingsPage() {
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

  useEffect(() => {
    getAdminProfile().then(setProfile).catch(() => undefined)
    getSettings()
      .then((s) => setPublicUrl(s.public_url ?? ''))
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
      setUrlError(err instanceof ApiError ? err.message : 'مشکلی پیش اومد')
    } finally {
      setUrlSaving(false)
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault()
    setPwError(null)
    setPwSaved(false)
    if (newPassword !== confirmPassword) {
      setPwError('رمز جدید و تکرارش یکی نیستن')
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
      setPwError(err instanceof ApiError ? err.message : 'مشکلی پیش اومد')
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
      setBackupError(err instanceof ApiError ? err.message : 'دانلود بک‌آپ با خطا مواجه شد')
    } finally {
      setBackupDownloading(false)
    }
  }

  async function handleRestoreFile(file: File) {
    if (
      !window.confirm(
        'با بازیابی این بک‌آپ، تمام کاربرها، هاست‌ها، نودها و تنظیمات فعلی پاک و با محتوای فایل جایگزین می‌شن. مطمئنی؟',
      )
    ) {
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
      setBackupError(err instanceof ApiError ? err.message : 'بازیابی با خطا مواجه شد')
    } finally {
      setRestoring(false)
      if (restoreInputRef.current) restoreInputRef.current.value = ''
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-50">تنظیمات</h1>
        {profile && (
          <span className="text-xs text-slate-400">
            وارد شده به عنوان <span className="text-slate-200">{profile.username}</span>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-6">
        <form onSubmit={handleSaveUrl} className={cardClass}>
          <h2 className="mb-1 text-sm font-bold text-slate-100">آدرس عمومی پنل</h2>
          <p className="mb-3 text-xs text-slate-500">
            وقتی پنل پشت یه دامنه یا ریورس‌پروکسی باشه، لینک‌های اشتراک باید از روی این آدرس ساخته بشن، نه هدر
            داخلی درخواست — مثلاً <span dir="ltr" className="font-mono">https://panel.example.com</span>. خالی
            بذاری، همون آدرسی که باهاش به پنل وصل شدی استفاده می‌شه.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1" style={{ minWidth: 240 }}>
              <label className={labelClass}>آدرس عمومی</label>
              <input
                dir="ltr"
                value={publicUrl}
                onChange={(e) => setPublicUrl(e.target.value)}
                placeholder="https://panel.example.com"
                className={`${inputClass} w-full text-left`}
              />
            </div>
            <button type="submit" disabled={urlSaving} className={buttonClass} style={{ backgroundColor: ACCENT }}>
              {urlSaving ? 'در حال ذخیره…' : urlSaved ? 'ذخیره شد ✓' : 'ذخیره'}
            </button>
          </div>
          {urlError && <div className="mt-3 text-xs text-red-400">{urlError}</div>}
        </form>

        <form onSubmit={handleChangePassword} className={cardClass}>
          <h2 className="mb-1 text-sm font-bold text-slate-100">تغییر رمز عبور</h2>
          <p className="mb-3 text-xs text-slate-500">برای تغییر رمز، اول رمز فعلی‌ت رو وارد کن.</p>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={labelClass}>رمز فعلی</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>رمز جدید</label>
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
              <label className={labelClass}>تکرار رمز جدید</label>
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
            {pwSubmitting ? 'در حال ذخیره…' : pwSaved ? 'رمز عوض شد ✓' : 'تغییر رمز'}
          </button>
        </form>

        <div className={cardClass}>
          <h2 className="mb-1 text-sm font-bold text-slate-100">بک‌آپ و بازیابی</h2>
          <p className="mb-3 text-xs text-slate-500">
            یه نسخه از کل دیتابیس پنل (کاربرها، هاست‌ها، نودها، تنظیمات) دانلود کن، یا از یه بک‌آپ قبلی بازیابی
            کن. بازیابی همه‌چیزِ فعلی رو با محتوای فایل جایگزین می‌کنه — برگشت‌ناپذیره.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleDownloadBackup}
              disabled={backupDownloading}
              className={buttonClass}
              style={{ backgroundColor: ACCENT }}
            >
              {backupDownloading ? 'در حال دانلود…' : 'دانلود بک‌آپ'}
            </button>

            <button
              type="button"
              onClick={() => restoreInputRef.current?.click()}
              disabled={restoring}
              className="rounded-lg border px-4 py-2 text-sm font-bold disabled:opacity-60"
              style={{ borderColor: 'rgba(248,113,113,0.4)', color: '#f87171' }}
            >
              {restoring ? 'در حال بازیابی…' : restoreDone ? 'بازیابی شد ✓' : 'بازیابی از فایل بک‌آپ'}
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
          {restoreDone && (
            <div className="mt-3 text-xs text-slate-400">
              بازیابی انجام شد. اگه رمز یا نام‌کاربری ادمین تو بک‌آپ فرق داشت، ممکنه لازم بشه دوباره وارد بشی.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
