import { useEffect, useState, type FormEvent } from 'react'
import { FeatureIcon, Logo } from '../components/Logo'
import { dict, type Lang } from '../i18n/dict'
import { ApiError, createAdmin, getSetupStatus, login as loginApi } from '../lib/api'

const ACCENT = '#22D3EE'
const COMMAND = 'docker exec -it tifusi-panel tifusi-cli generate-admin-key'

type Screen = 'setup' | 'login'

const fieldClass =
  'w-full rounded-lg border border-white/15 bg-white/5 px-3.5 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-cyan-400/60'
const labelClass = 'block text-xs text-slate-400 mb-1.5'
const linkClass = 'text-xs text-cyan-300 hover:underline'

export default function Login() {
  const [lang, setLang] = useState<Lang>('fa')
  const [screen, setScreen] = useState<Screen>('setup')
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [copied, setCopied] = useState(false)
  const [key, setKey] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const t = dict[lang]
  const dir = lang === 'fa' ? 'rtl' : 'ltr'
  const align = lang === 'fa' ? 'text-right' : 'text-left'

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
    try {
      await navigator.clipboard.writeText(COMMAND)
    } catch {
      // Clipboard API unavailable in this context; the command stays visible to select by hand.
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  async function handleCreateAdmin(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await createAdmin({ key, username, password })
      localStorage.setItem('tifusi_token', res.access_token)
      window.location.reload()
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
      localStorage.setItem('tifusi_token', res.access_token)
      window.location.reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingStatus) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-panel-950 font-body text-sm text-slate-500">
        {t.loading}
      </div>
    )
  }

  return (
    <div
      dir={dir}
      className="relative flex min-h-screen w-full flex-col items-center overflow-hidden px-9 pb-9 pt-14 font-body text-slate-100"
      style={{
        background:
          'radial-gradient(ellipse 70% 50% at 50% 0%, #0e1e30 0%, #060b13 55%, #030507 100%)',
      }}
    >
      <div className="pointer-events-none absolute -top-36 left-1/2 h-[620px] w-[620px] -translate-x-1/2 rounded-full border border-cyan-400/10" />
      <div className="pointer-events-none absolute -top-16 left-1/2 h-[440px] w-[440px] -translate-x-1/2 rounded-full border border-cyan-400/15" />

      <div className="relative z-10">
        <Logo accent={ACCENT} size={116} />
      </div>
      <div className="relative z-10 mt-1.5 font-display text-3xl font-bold tracking-[4px] text-slate-50">
        TIFUSI
      </div>
      <div className="relative z-10 mt-0.5 font-display text-xs font-semibold tracking-[9px]" style={{ color: ACCENT }}>
        PANEL
      </div>
      <div className="relative z-10 my-3.5 h-0.5 w-14 opacity-55" style={{ backgroundColor: ACCENT }} />
      <div className="relative z-10 mb-6 max-w-xs text-center text-xs text-slate-400">{t.tagline}</div>

      <div
        className="relative z-10 w-full max-w-sm rounded-[20px] border border-cyan-400/20 bg-slate-950/70 px-6 py-7 backdrop-blur-xl"
        style={{ boxShadow: '0 0 44px rgba(34,211,238,0.07), 0 20px 40px rgba(0,0,0,0.35)' }}
      >
        {screen === 'setup' ? (
          <form onSubmit={handleCreateAdmin}>
            <div
              className="mb-3.5 inline-block rounded-full border px-2.5 py-1 text-[10.5px] font-bold tracking-wider"
              style={{ color: ACCENT, borderColor: 'rgba(34,211,238,0.3)', backgroundColor: 'rgba(34,211,238,0.12)' }}
            >
              {t.badgeSetup}
            </div>
            <div className={`mb-4 text-lg font-bold text-slate-50 ${align}`}>{t.headingSetup}</div>

            <div className={`mb-2 text-xs text-slate-400 ${align}`}>{t.step1}</div>
            <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-cyan-400/25 bg-black/35 p-3">
              <code dir="ltr" className="flex-1 break-all text-left font-mono text-[11px] text-cyan-200">
                {COMMAND}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className="flex-shrink-0 rounded-md px-3 py-1.5 text-[11.5px] font-bold text-slate-950"
                style={{ backgroundColor: ACCENT }}
              >
                {copied ? `${t.copied} ✓` : t.copy}
              </button>
            </div>

            <label className={`${labelClass} ${align}`}>{t.step2Label}</label>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              placeholder={t.step2Placeholder}
              className={`${fieldClass} mb-3.5 ${align}`}
            />

            <label className={`${labelClass} ${align}`}>{t.userLabel}</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder={t.userPlaceholder}
              className={`${fieldClass} mb-3.5 ${align}`}
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

            {error && <div className="mt-2 text-xs text-red-400">{error}</div>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-4 w-full rounded-lg py-3 text-sm font-bold text-slate-950 disabled:opacity-60"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
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
            <div className={`mb-5 text-lg font-bold text-slate-50 ${align}`}>{t.headingLogin}</div>

            <label className={`${labelClass} ${align}`}>{t.userLabel}</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder={t.userPlaceholder}
              className={`${fieldClass} mb-3.5 ${align}`}
            />

            <label className={`${labelClass} ${align}`}>{t.passLabel}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder={t.passPlaceholder}
              className={`${fieldClass} mb-2 ${align}`}
            />

            <div className={`mb-4 ${align}`}>
              <a href="#" className={linkClass}>
                {t.forgot}
              </a>
            </div>

            {error && <div className="mb-2 text-xs text-red-400">{error}</div>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg py-3 text-sm font-bold text-slate-950 disabled:opacity-60"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
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

        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={() => setLang('en')}
            className="rounded-md border border-white/20 px-3 py-1 text-[11px] text-slate-300"
          >
            EN
          </button>
          <button
            onClick={() => setLang('fa')}
            className="rounded-md border border-white/20 px-3 py-1 text-[11px] text-slate-300"
          >
            فارسی
          </button>
        </div>
      </div>

      <div className="relative z-10 mt-8 flex flex-wrap justify-center gap-6">
        {(['secure', 'monitor', 'perf', 'crypto'] as const).map((f) => (
          <div key={f} className="flex w-[70px] flex-col items-center gap-1.5">
            <FeatureIcon type={f} accent={ACCENT} />
            <div className="text-center text-[10px] text-slate-400">{t.features[f]}</div>
          </div>
        ))}
      </div>

      <div className="relative z-10 mt-5 text-[10px] tracking-widest text-slate-600">
        POWERED BY TIFUSI SYSTEMS
      </div>
    </div>
  )
}
