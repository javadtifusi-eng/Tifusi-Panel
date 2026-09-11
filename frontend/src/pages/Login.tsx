import { useEffect, useState, type FormEvent } from 'react'
import { Logo } from '../components/Logo'
import { useLang } from '../i18n/LangContext'
import { ApiError, createAdmin, getSetupStatus, login as loginApi } from '../lib/api'
import { copyToClipboard } from '../lib/clipboard'

const ACCENT = '#22D3EE'
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
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M4.5 15.5H4a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4 2.5h10A1.5 1.5 0 0 1 15.5 4v.5" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

type Screen = 'setup' | 'login'

// Semantic theme tokens, same as the rest of the app — dark is the only
// theme (see frontend/src/index.css), so this stays one fixed palette
// instead of a toggle-able one.
const fieldClass =
  'w-full rounded-lg border border-edge bg-field px-3.5 py-3 text-sm text-primary placeholder-faint outline-none transition-colors focus:border-cyan-400/60'
const labelClass = 'block text-xs text-muted mb-1'
const linkClass = 'text-sm font-bold text-accent hover:underline'

export default function Login({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const { lang, setLang, t, dir, align } = useLang()
  const iconSideClass = dir === 'rtl' ? 'right-3.5' : 'left-3.5'
  const iconPadClass = dir === 'rtl' ? 'pr-10' : 'pl-10'
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
      // Both copy methods failed — reveal the command itself instead of
      // leaving the admin with an icon that does nothing and no way to
      // get the text any other way.
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

  const langToggle = (
    <div className="flex justify-center gap-2">
      <button
        onClick={() => setLang('en')}
        className={`rounded-full border px-3.5 py-1.5 text-[11px] ${lang === 'en' ? 'border-cyan-400/50 bg-accent-tint text-accent' : 'border-edge text-muted'}`}
      >
        EN
      </button>
      <button
        onClick={() => setLang('fa')}
        className={`rounded-full border px-3.5 py-1.5 text-[11px] ${lang === 'fa' ? 'border-cyan-400/50 bg-accent-tint text-accent' : 'border-edge text-muted'}`}
      >
        فارسی
      </button>
    </div>
  )

  if (loadingStatus) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-app font-body text-sm text-faint">
        {t.loading}
      </div>
    )
  }

  return (
    <div dir={dir} className="flex min-h-screen w-full flex-col items-center justify-center bg-app px-6 py-12 font-body text-primary">
      <div className="w-full max-w-md lg:max-w-xl">
        <div className="mb-8 flex flex-col items-center gap-1 text-center">
          <div className="lg:hidden">
            <Logo accent={ACCENT} size={64} />
          </div>
          <div className="hidden lg:block">
            <Logo accent={ACCENT} size={104} />
          </div>
          <div className="mt-1">
            <div className="font-display text-2xl font-bold tracking-[3px] text-heading">TIFUSI</div>
            <div className="font-display text-[10px] font-semibold tracking-[4px]" style={{ color: ACCENT }}>
              PANEL
            </div>
          </div>
          <h1 className="mt-3 font-display text-xl font-bold text-heading">{t.welcome}</h1>
        </div>

        <div className="rounded-2xl border border-subtle bg-surface p-8 shadow-2xl lg:p-12">
          {screen === 'setup' ? (
            <form onSubmit={handleCreateAdmin}>
              <div className="mb-2.5 inline-block rounded-md border border-cyan-400/40 bg-accent-tint px-2.5 py-1 text-[10.5px] font-bold tracking-wider text-accent">
                {t.badgeSetup}
              </div>
              <div className={`mb-4 text-xl font-bold text-heading ${align}`}>{t.headingSetup}</div>

              <div className="mb-4 rounded-lg border border-subtle bg-field px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className={`text-xs text-secondary ${align}`}>{t.step1}</span>
                  <button
                    type="button"
                    onClick={handleCopy}
                    title={COMMAND}
                    aria-label={copied ? t.copied : t.copy}
                    className={`flex-shrink-0 rounded-md p-1.5 transition-colors ${
                      copied ? 'bg-success-tint text-success' : 'bg-accent-tint text-accent'
                    }`}
                  >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </div>
                {copyFailed && (
                  <>
                    <div className={`mt-2.5 text-[11px] text-warning ${align}`}>{t.copyFailedHint}</div>
                    <code
                      dir="ltr"
                      onClick={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)}
                      className="mt-1.5 block cursor-text select-all break-all rounded-md bg-well p-2 text-left font-mono text-[11px] text-accent"
                    >
                      {COMMAND}
                    </code>
                  </>
                )}
              </div>

              <label className={`${labelClass} ${align}`}>{t.step2Label}</label>
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
                placeholder={t.step2Placeholder}
                className={`${fieldClass} mb-3 ${align}`}
              />

              <label className={`${labelClass} ${align}`}>{t.userLabel}</label>
              <div className="relative mb-3">
                <span className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-faint ${iconSideClass}`}>
                  <UserIcon />
                </span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  placeholder={t.userPlaceholder}
                  className={`${fieldClass} ${iconPadClass} ${align}`}
                />
              </div>

              <label className={`${labelClass} ${align}`}>{t.passLabel}</label>
              <div className="relative mb-1">
                <span className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-faint ${iconSideClass}`}>
                  <LockIcon />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder={t.passPlaceholder}
                  className={`${fieldClass} ${iconPadClass} ${align}`}
                />
              </div>

              {error && <div className="mt-2 text-xs text-danger">{error}</div>}

              <button
                type="submit"
                disabled={submitting}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 py-3 text-sm font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {t.createBtn}
                <ArrowIcon />
              </button>

              <div className="mt-4 text-center">
                <button type="button" onClick={() => switchScreen('login')} className={linkClass}>
                  {t.switchToLogin}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleLogin}>
              <div className={`mb-4 text-xl font-bold text-heading ${align}`}>{t.headingLogin}</div>

              <label className={`${labelClass} ${align}`}>{t.userLabel}</label>
              <div className="relative mb-3">
                <span className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-faint ${iconSideClass}`}>
                  <UserIcon />
                </span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  placeholder={t.userPlaceholder}
                  className={`${fieldClass} ${iconPadClass} ${align}`}
                />
              </div>

              <label className={`${labelClass} ${align}`}>{t.passLabel}</label>
              <div className="relative mb-3">
                <span className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-faint ${iconSideClass}`}>
                  <LockIcon />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder={t.passPlaceholder}
                  className={`${fieldClass} ${iconPadClass} ${align}`}
                />
              </div>

              <div className={`mb-4 ${align}`}>
                <a href="#" className={linkClass}>
                  {t.forgot}
                </a>
              </div>

              {error && <div className="mb-3 text-xs text-danger">{error}</div>}

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 py-3 text-sm font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {t.signInBtn}
                <ArrowIcon />
              </button>

              <div className="mt-4 text-center">
                <button type="button" onClick={() => switchScreen('setup')} className={linkClass}>
                  {t.switchToSetup}
                </button>
              </div>
            </form>
          )}

          <div className="mt-6 flex justify-center">{langToggle}</div>
        </div>
      </div>
    </div>
  )
}
