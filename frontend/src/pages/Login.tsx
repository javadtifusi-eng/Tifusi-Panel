import { useEffect, useState, type FormEvent } from 'react'
import { Logo } from '../components/Logo'
import { useLang } from '../i18n/LangContext'
import { useTheme } from '../theme/ThemeContext'
import { ApiError, createAdmin, getSetupStatus, login as loginApi } from '../lib/api'
import { copyToClipboard } from '../lib/clipboard'

const ACCENT = '#22D3EE'
const COMMAND = 'docker exec -it tifusi-panel tifusi-cli generate-admin-key'
const PROTOCOLS = ['VLESS', 'Trojan', 'Hysteria2', 'IKEv2']

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

function SunIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  )
}

type Screen = 'setup' | 'login'

// Semantic theme tokens, same as the rest of the app — this page now
// follows the light/dark toggle instead of a fixed brand color, so it
// looks like one product with the panel behind it rather than a separate
// marketing surface bolted onto the front of it.
const fieldClass =
  'w-full rounded-lg border border-edge bg-field px-3.5 py-3 text-sm text-primary placeholder-faint outline-none transition-colors focus:border-cyan-400/60'
const labelClass = 'block text-xs text-muted mb-1'
const linkClass = 'text-xs text-accent hover:underline'

export default function Login({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const { lang, setLang, t, dir, align } = useLang()
  const { theme, toggleTheme } = useTheme()
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
        className={`rounded-md border px-3 py-1 text-[11px] ${lang === 'en' ? 'border-cyan-400/50 text-accent' : 'border-edge text-muted'}`}
      >
        EN
      </button>
      <button
        onClick={() => setLang('fa')}
        className={`rounded-md border px-3 py-1 text-[11px] ${lang === 'fa' ? 'border-cyan-400/50 text-accent' : 'border-edge text-muted'}`}
      >
        فارسی
      </button>
      <button
        onClick={toggleTheme}
        aria-label={t.nav.toggleTheme}
        title={t.nav.toggleTheme}
        className="flex items-center justify-center rounded-md border border-edge px-3 py-1 text-muted hover:border-cyan-400/50 hover:text-accent"
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
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
      <div className="w-full max-w-md">
        {/* Brand header — logo, welcome heading and tagline sit above the
            card on every viewport, instead of a separate side panel that
            only showed on wide screens. */}
        <div className="mb-8 flex flex-col items-center gap-1 text-center">
          <Logo accent={ACCENT} size={56} />
          <div className="mb-2">
            <div className="font-display text-sm font-bold tracking-[2px] text-heading">TIFUSI</div>
            <div className="font-display text-[9px] font-semibold tracking-[3px]" style={{ color: ACCENT }}>
              PANEL
            </div>
          </div>
          <h1 className="font-display text-xl font-bold text-heading">{t.welcome}</h1>
          <p className="max-w-xs text-sm leading-relaxed text-muted">{t.tagline}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {PROTOCOLS.map((p) => (
              <span key={p} className="rounded-md border border-edge bg-field px-2.5 py-1 text-[11px] text-secondary">
                {p}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-subtle bg-surface p-8 shadow-2xl">
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
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder={t.userPlaceholder}
                className={`${fieldClass} mb-3 ${align}`}
              />

              <label className={`${labelClass} ${align}`}>{t.passLabel}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder={t.passPlaceholder}
                className={`${fieldClass} mb-1 ${align}`}
              />

              {error && <div className="mt-2 text-xs text-danger">{error}</div>}

              <button
                type="submit"
                disabled={submitting}
                style={{ backgroundColor: ACCENT }}
                className="mt-4 w-full rounded-lg py-3 text-sm font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {t.createBtn}
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
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder={t.userPlaceholder}
                className={`${fieldClass} mb-3 ${align}`}
              />

              <label className={`${labelClass} ${align}`}>{t.passLabel}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder={t.passPlaceholder}
                className={`${fieldClass} mb-3 ${align}`}
              />

              <div className={`mb-4 ${align}`}>
                <a href="#" className={linkClass}>
                  {t.forgot}
                </a>
              </div>

              {error && <div className="mb-3 text-xs text-danger">{error}</div>}

              <button
                type="submit"
                disabled={submitting}
                style={{ backgroundColor: ACCENT }}
                className="w-full rounded-lg py-3 text-sm font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {t.signInBtn}
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

        <div className="mt-8 text-center text-[10px] tracking-widest text-faint">POWERED BY TIFUSI SYSTEMS</div>
      </div>
    </div>
  )
}
