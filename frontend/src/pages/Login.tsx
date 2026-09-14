import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { TifusiMark } from '../components/Logo'
import { useLang } from '../i18n/LangContext'
import { ApiError, createAdmin, getSetupStatus, login as loginApi } from '../lib/api'
import { copyToClipboard } from '../lib/clipboard'

const COMMAND = 'docker exec -it tifusi-panel tifusi-cli generate-admin-key'

function UserIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="rtl:-scale-x-100"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M4.5 15.5H4a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4 2.5h10A1.5 1.5 0 0 1 15.5 4v.5" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

type Screen = 'setup' | 'login'

// The studio sign-in look: #0e0e0e fields on a #141414 card, an orange
// focus ring and an orange primary button with near-black text.
const fieldClass =
  'w-full rounded-[10px] border border-[#262626] bg-field py-[11px] text-sm text-primary outline-none transition-[border-color,box-shadow] duration-150 focus:border-accent/60 focus:shadow-[0_0_0_3px_rgba(249,115,22,0.12)]'
const labelClass = 'mb-1.5 block text-xs text-muted'
const linkClass = 'text-xs font-medium text-accent hover:underline'
const primaryClass =
  'mt-1 flex w-full items-center justify-center gap-2 rounded-[10px] bg-accent px-4 py-3 text-sm font-semibold text-app transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60'

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-well-edge bg-field p-3">
      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-accent/[0.14] font-en text-[11px] text-accent">
          {n}
        </span>
        <span>{title}</span>
      </div>
      {children}
    </div>
  )
}

export default function Login({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const { lang, setLang, t, dir, align } = useLang()
  const iconSideClass = dir === 'rtl' ? 'right-3' : 'left-3'
  const iconPadClass = dir === 'rtl' ? 'pr-[38px] pl-3.5' : 'pl-[38px] pr-3.5'
  const [screen, setScreen] = useState<Screen>('setup')
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [key, setKey] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getSetupStatus()
      .then((res) => setScreen(res.has_admin ? 'login' : 'setup'))
      .catch(() => setScreen('login'))
      .finally(() => setLoadingStatus(false))
  }, [])

  function switchScreen(next: Screen) {
    setScreen(next)
    setError(null)
    setCopied(false)
  }

  async function handleCopy() {
    const ok = await copyToClipboard(COMMAND)

    if (ok) {
      setCopied(true)
      setCopyFailed(false)
      window.setTimeout(() => setCopied(false), 2000)
    } else {
      // Both copy methods failed — tell the admin to select the command
      // (it is always shown in step 1) instead of leaving an icon that
      // silently does nothing.
      setCopyFailed(true)
    }
  }

  async function handleCreateAdmin(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await createAdmin({ key, username, password })
      onAuthenticated(res.access_token)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await loginApi({ username, password })
      onAuthenticated(res.access_token)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingStatus) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-app font-body text-sm text-faint">
        {t.loading}
      </div>
    )
  }

  const usernameField = (
    <div className="relative">
      <span className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-faint ${iconSideClass}`}>
        <UserIcon />
      </span>
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
        autoComplete="username"
        placeholder={t.userPlaceholder}
        aria-label={t.userLabel}
        className={`${fieldClass} ${iconPadClass} ${align}`}
      />
    </div>
  )

  const passwordField = (
    <div className="relative">
      <span className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-faint ${iconSideClass}`}>
        <LockIcon />
      </span>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={screen === 'setup' ? 8 : undefined}
        autoComplete={screen === 'setup' ? 'new-password' : 'current-password'}
        placeholder={t.passPlaceholder}
        aria-label={t.passLabel}
        className={`${fieldClass} ${iconPadClass} ${align}`}
      />
    </div>
  )

  const errorBox = error && (
    <div role="alert" className="rounded-lg border border-danger/25 bg-danger/[0.08] px-2.5 py-2 text-xs text-danger">
      {error}
    </div>
  )

  return (
    <div
      dir={dir}
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-app px-4 py-12 font-body text-primary"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[8%] h-[420px] w-[620px] max-w-full -translate-x-1/2"
        style={{ background: 'radial-gradient(closest-side, rgba(249,115,22,0.10), rgba(249,115,22,0))' }}
      />

      <section className="relative w-full max-w-[400px] rounded-2xl border border-subtle bg-surface px-[26px] pb-6 pt-7">
        <div className="mb-[22px] flex flex-col items-center gap-2.5 text-center">
          <TifusiMark size={56} />
          {screen === 'setup' && (
            <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/[0.14] px-2.5 py-0.5 text-[11px] text-accent">
              {t.badgeSetup}
            </span>
          )}
          <h1 className="text-xl font-semibold text-heading [text-wrap:balance]">
            {screen === 'setup' ? t.headingSetup : t.headingLogin}
          </h1>
          <p className="text-[12.5px] text-muted">{t.welcome}</p>
        </div>

        {screen === 'setup' ? (
          <form onSubmit={handleCreateAdmin} className="flex flex-col gap-3.5">
            <Step n={1} title={t.step1}>
              <div dir="ltr" className="flex items-center gap-2 rounded-lg border border-[#222] bg-app px-2.5 py-2">
                <code
                  onClick={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)}
                  className="flex-1 cursor-text select-all overflow-x-auto whitespace-nowrap font-mono text-[11.5px] text-[#d4d4d4]"
                >
                  {COMMAND}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  title={COMMAND}
                  aria-label={copied ? t.copied : t.copy}
                  className={`grid flex-shrink-0 place-items-center rounded-md border border-edge bg-[#1a1a1a] p-[5px] transition-colors ${
                    copied ? 'text-success' : 'text-muted hover:text-primary'
                  }`}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
              {copyFailed && <div className={`text-[11px] text-warning ${align}`}>{t.copyFailedHint}</div>}
            </Step>

            <Step n={2} title={t.step2Label}>
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
                placeholder={t.step2Placeholder}
                aria-label={t.step2Label}
                className={`${fieldClass} px-3.5 ${align}`}
              />
            </Step>

            <Step n={3} title={t.step3}>
              {usernameField}
              {passwordField}
            </Step>

            {errorBox}

            <button type="submit" disabled={submitting} className={primaryClass}>
              {t.createBtn}
              <ArrowIcon />
            </button>

            <div className="text-center">
              <button type="button" onClick={() => switchScreen('login')} className={linkClass}>
                {t.switchToLogin}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="flex flex-col gap-3.5">
            <div>
              <label className={`${labelClass} ${align}`}>{t.userLabel}</label>
              {usernameField}
            </div>

            <div>
              <label className={`${labelClass} ${align}`}>{t.passLabel}</label>
              {passwordField}
            </div>

            <div className={align}>
              <a href="#" className={linkClass}>
                {t.forgot}
              </a>
            </div>

            {errorBox}

            <button type="submit" disabled={submitting} className={primaryClass}>
              {t.signInBtn}
              <ArrowIcon />
            </button>

            <div className="text-center">
              <button type="button" onClick={() => switchScreen('setup')} className={linkClass}>
                {t.switchToSetup}
              </button>
            </div>
          </form>
        )}

        <div className="mt-[18px] flex items-center justify-between gap-2.5 border-t border-hair pt-3.5 text-[11.5px] text-faint">
          <span dir="ltr" className="truncate font-en">
            {window.location.host}
          </span>
          <div className="flex flex-shrink-0 gap-1">
            {(['fa', 'en'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                aria-pressed={lang === code}
                className={`rounded-md border px-2 py-0.5 font-en text-[11px] transition-colors ${
                  lang === code ? 'border-[#333] bg-raised text-primary' : 'border-subtle text-muted hover:text-primary'
                }`}
              >
                {code === 'fa' ? 'فا' : 'EN'}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
