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

// Fixed white-on-blue, not theme tokens — this page keeps one deliberate
// brand look regardless of the light/dark toggle (see the wrapper's own
// comment), so `text-primary`/`bg-field` etc. (which flip to near-black
// on the light theme) would go invisible against it.
const fieldClass =
  'w-full rounded-lg border border-white/15 bg-white/10 px-3.5 py-3 text-sm text-white placeholder-white/40 outline-none backdrop-blur-sm transition-colors focus:border-cyan-300/70 focus:bg-white/15'
const labelClass = 'block text-xs text-white/70 mb-1'
const linkClass = 'text-xs text-cyan-300 hover:underline'

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
    <div className="flex justify-center gap-2 lg:justify-start">
      <button
        onClick={() => setLang('en')}
        className={`rounded-md border px-3 py-1 text-[11px] ${lang === 'en' ? 'border-cyan-300/60 text-cyan-200' : 'border-white/20 text-white/60'}`}
      >
        EN
      </button>
      <button
        onClick={() => setLang('fa')}
        className={`rounded-md border px-3 py-1 text-[11px] ${lang === 'fa' ? 'border-cyan-300/60 text-cyan-200' : 'border-white/20 text-white/60'}`}
      >
        فارسی
      </button>
      <button
        onClick={toggleTheme}
        aria-label={t.nav.toggleTheme}
        title={t.nav.toggleTheme}
        className="flex items-center justify-center rounded-md border border-white/20 px-3 py-1 text-white/60 hover:border-cyan-300/60 hover:text-cyan-200"
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
    // h-screen + overflow-hidden, not min-h-screen: the page's real content
    // height came out a bit taller than 100vh (measured — not a viewport
    // quirk), which every earlier attempt at a full-viewport background
    // missed, since a background painted on (or fixed to) the viewport can
    // never cover content the *document* pushes past it. Nothing on this
    // screen needs to scroll, so capping it at exactly 100vh and clipping
    // the small overflow is correct, not lossy.
    <div
      dir={dir}
      className="flex h-screen w-full overflow-hidden font-body text-white"
      style={{
        // One continuous brand gradient across the whole screen — this
        // page keeps one deliberate look regardless of the light/dark
        // toggle (which still applies to the rest of the app after
        // login), same as most products treat their login/marketing
        // surface as brand-fixed. The glow sits off-center toward where
        // the griffin mark actually is, not dead-center.
        background:
          'radial-gradient(130% 110% at 80% 55%, #3f8ee0 0%, #1f4fb3 32%, #12306e 62%, #081735 100%)',
      }}
    >
      {/* Brand panel — hidden on narrow viewports, where the compact header below stands in for it. */}
      <div className="relative hidden flex-col justify-between overflow-hidden px-14 py-12 lg:flex lg:w-[42%] xl:w-[38%]">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <div
            style={{
              width: '26rem',
              height: '26rem',
              opacity: 0.9,
              backgroundColor: '#ffffff',
              WebkitMaskImage: 'url(/logo-tifusi.png)',
              maskImage: 'url(/logo-tifusi.png)',
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              maskPosition: 'center',
            }}
          />
        </div>

        <div className="relative flex items-center gap-2.5">
          <Logo color="#ffffff" size={40} glow={false} />
          <div>
            <div className="font-display text-sm font-bold tracking-[2px] text-white">TIFUSI</div>
            <div className="font-display text-[9px] font-semibold tracking-[3px]" style={{ color: ACCENT }}>
              PANEL
            </div>
          </div>
        </div>

        <div className="relative">
          <h1 className={`max-w-sm font-display text-2xl font-bold leading-snug text-white ${align}`}>{t.welcome}</h1>
          <p className={`mt-3 max-w-xs text-sm leading-relaxed text-white/70 ${align}`}>{t.tagline}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {PROTOCOLS.map((p) => (
              <span key={p} className="rounded-md border border-white/20 px-2.5 py-1 text-[11px] text-white/80">
                {p}
              </span>
            ))}
          </div>
        </div>

        <div className="relative text-[10px] tracking-widest text-white/50">POWERED BY TIFUSI SYSTEMS</div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="mb-6 flex flex-col items-center gap-3 lg:hidden">
          <Logo color="#ffffff" size={52} glow={false} />
          <div className="text-center">
            <div className="font-display text-sm font-bold tracking-[2px] text-white">TIFUSI PANEL</div>
            <div className="mt-1 max-w-[220px] text-xs text-white/70">{t.tagline}</div>
          </div>
        </div>

        <div className="w-full max-w-sm">
          {screen === 'setup' ? (
            <form onSubmit={handleCreateAdmin}>
              <div className="mb-2.5 inline-block rounded-md border border-cyan-300/40 px-2.5 py-1 text-[10.5px] font-bold tracking-wider text-cyan-200">
                {t.badgeSetup}
              </div>
              <div className={`mb-4 text-xl font-bold text-white ${align}`}>{t.headingSetup}</div>

              <div className="mb-4 rounded-lg border border-white/15 bg-white/10 px-3.5 py-3 backdrop-blur-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className={`text-xs text-white/70 ${align}`}>{t.step1}</span>
                  <button
                    type="button"
                    onClick={handleCopy}
                    title={COMMAND}
                    aria-label={copied ? t.copied : t.copy}
                    className={`flex-shrink-0 rounded-md p-1.5 transition-colors ${
                      copied ? 'bg-emerald-400/20 text-emerald-300' : 'bg-cyan-400/20 text-cyan-200'
                    }`}
                  >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </div>
                {copyFailed && (
                  <>
                    <div className={`mt-2.5 text-[11px] text-amber-300 ${align}`}>{t.copyFailedHint}</div>
                    <code
                      dir="ltr"
                      onClick={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)}
                      className="mt-1.5 block cursor-text select-all break-all rounded-md bg-black/30 p-2 text-left font-mono text-[11px] text-cyan-200"
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

              {error && <div className="mt-2 text-xs text-red-300">{error}</div>}

              <button
                type="submit"
                disabled={submitting}
                className="mt-4 w-full rounded-lg bg-cyan-400 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300 disabled:opacity-60"
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
              <div className={`mb-4 text-xl font-bold text-white ${align}`}>{t.headingLogin}</div>

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

              {error && <div className="mb-3 text-xs text-red-300">{error}</div>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-cyan-400 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300 disabled:opacity-60"
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
      </div>
    </div>
  )
}
