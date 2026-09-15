import { useEffect, useRef, useState, type FormEvent } from 'react'
import { IconArrow, IconBolt, IconCopy, IconEye, IconEyeOff, IconLock, IconPulse, IconShield, IconUser } from '../components/icons'
import { StrengthBars, passwordScore, useReducedMotion } from '../components/ui'
import { useLang } from '../i18n/LangContext'
import { ApiError, createAdmin, getSetupStatus, login as loginApi } from '../lib/api'
import { copyToClipboard } from '../lib/clipboard'

const COMMAND = 'docker exec -it tifusi-panel tifusi-cli generate-admin-key'

type Screen = 'setup' | 'login'

// The brand side: a warm aurora breathes behind the griffin and one bright dot
// orbits it, large and bright in front, small and faint behind. Calling the
// returned function speeds it up for a moment after a successful sign-in.
function useBrandCanvas(canvas: React.RefObject<HTMLCanvasElement>, stage: React.RefObject<HTMLDivElement>, reduce: boolean) {
  const boost = useRef(0)
  useEffect(() => {
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    let W = 0
    let H = 0
    let frame = 0
    let angle = 0
    let last = performance.now()
    const t0 = performance.now()
    const trail: [number, number, number][] = []

    function blob(x: number, y: number, r: number, rgb: string, a: number) {
      const g = ctx!.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `rgba(${rgb},${a})`)
      g.addColorStop(1, `rgba(${rgb},0)`)
      ctx!.fillStyle = g
      ctx!.fillRect(x - r, y - r, r * 2, r * 2)
    }
    function draw(now: number) {
      const c = ctx!
      const el = (now - t0) / 1000
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      c.clearRect(0, 0, W, H)
      const box = cv!.getBoundingClientRect()
      const st = stage.current?.getBoundingClientRect()
      const cx = st ? st.left - box.left + st.width / 2 : W / 2
      const cy = st ? st.top - box.top + st.height / 2 : H / 2
      const base = Math.max(90, Math.min(W, 420) * 0.32)
      const b = boost.current
      const breath = reduce ? 1 : 1 + 0.06 * Math.sin(el * 0.9) + b * 0.15
      c.globalCompositeOperation = 'lighter'
      blob(cx, cy, base * 1.25 * breath, '249,115,22', 0.3 + b * 0.15)
      blob(cx + Math.cos(el * 0.35) * base * 0.35, cy - base * 0.25 + Math.sin(el * 0.5) * base * 0.12, base * 0.9, '251,191,36', 0.16)
      blob(cx - Math.cos(el * 0.3) * base * 0.4, cy + base * 0.3 + Math.cos(el * 0.45) * base * 0.1, base * 0.95, '219,39,119', 0.16)
      c.globalCompositeOperation = 'source-over'
      angle = reduce ? Math.PI / 2 : angle + dt * (0.9 + b * 4)
      boost.current = Math.max(0, b - dt * 0.8)
      const rx = base * 0.95
      const ry = base * 0.38
      const tilt = -0.18
      const x0 = Math.cos(angle) * rx
      const y0 = Math.sin(angle) * ry
      const dx = cx + x0 * Math.cos(tilt) - y0 * Math.sin(tilt)
      const dy = cy + x0 * Math.sin(tilt) + y0 * Math.cos(tilt)
      const depth = (Math.sin(angle) + 1) / 2
      trail.unshift([dx, dy, depth])
      if (trail.length > 26) trail.pop()
      trail.forEach(([x, y, d], i) => {
        const f = 1 - i / trail.length
        c.beginPath()
        c.arc(x, y, (1 + d * 2) * f, 0, Math.PI * 2)
        c.fillStyle = `rgba(253,186,116,${0.35 * f * (0.25 + 0.75 * d)})`
        c.fill()
      })
      const glow = 0.25 + 0.75 * depth
      blob(dx, dy, 10 + depth * 16, '253,186,116', 0.55 * glow)
      c.beginPath()
      c.arc(dx, dy, 1.8 + depth * 2.4, 0, Math.PI * 2)
      c.fillStyle = `rgba(255,247,237,${glow})`
      c.fill()
      if (!reduce) frame = requestAnimationFrame(draw)
    }
    function resize() {
      const r = cv!.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      W = r.width
      H = r.height
      cv!.width = W * dpr
      cv!.height = H * dpr
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (reduce) draw(performance.now())
    }
    const ro = new ResizeObserver(resize)
    ro.observe(cv)
    resize()
    if (!reduce) frame = requestAnimationFrame(draw)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [canvas, stage, reduce])
  return () => {
    boost.current = 1
  }
}

export default function Login({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const { lang, setLang, t, dir } = useLang()
  const u = t.ui.login
  const reduce = useReducedMotion()
  const [screen, setScreen] = useState<Screen>('setup')
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [key, setKey] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [caps, setCaps] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [shake, setShake] = useState(0)
  const [done, setDone] = useState<string | null>(null)
  const [burstOn, setBurstOn] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const burst = useBrandCanvas(canvasRef, stageRef, reduce)

  useEffect(() => {
    getSetupStatus()
      .then((res) => setScreen(res.has_admin ? 'login' : 'setup'))
      .catch(() => setScreen('login'))
      .finally(() => setLoadingStatus(false))
  }, [])

  // Restart the shake animation on every failed attempt.
  useEffect(() => {
    if (!shake || reduce) return
    const el = cardRef.current
    if (!el) return
    el.classList.remove('shake')
    void el.offsetWidth
    el.classList.add('shake')
  }, [shake, reduce])

  function switchScreen(next: Screen) {
    setScreen(next)
    setError(null)
    setCopied(false)
    setForgotOpen(false)
  }

  async function handleCopy() {
    if (await copyToClipboard(COMMAND)) {
      setCopied(true)
      setCopyFailed(false)
      window.setTimeout(() => setCopied(false), 2000)
    } else {
      // Both copy methods failed: the command is on screen to select by hand.
      setCopyFailed(true)
    }
  }

  function succeed(token: string) {
    setDone(username)
    burst()
    setBurstOn(true)
    window.setTimeout(() => onAuthenticated(token), reduce ? 200 : 900)
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!username.trim() || !password) {
      setError(u.errEmpty)
      setShake((n) => n + 1)
      return
    }
    setSubmitting(true)
    try {
      const res = await loginApi({ username, password })
      succeed(res.access_token)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric)
      setShake((n) => n + 1)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCreateAdmin(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await createAdmin({ key: key.trim(), username, password })
      succeed(res.access_token)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric)
      setShake((n) => n + 1)
    } finally {
      setSubmitting(false)
    }
  }

  const keyIn = key.trim().length > 0
  const step1Done = copied || keyIn
  const step3Done = username.trim().length > 0 && password.length >= 8
  const strengthLevel = Math.max(0, passwordScore(password) - 1)

  const eyeButton = (
    <button type="button" className="eye" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? u.hidePass : u.showPass}>
      {showPass ? <IconEyeOff size={17} /> : <IconEye size={17} />}
    </button>
  )
  const onCapsKey = (e: React.KeyboardEvent) => setCaps(e.getModifierState?.('CapsLock') ?? false)

  return (
    <div dir={dir} className="pg-login">
      <section className={`brand ${burstOn ? 'burst' : ''}`} aria-label="Tifusi">
        <canvas ref={canvasRef} aria-hidden="true" />
        <div className="wordmark">
          <i />
          TIFUSI
        </div>
        <div className="mark-stage" ref={stageRef}>
          <div className="mark" role="img" aria-label="Tifusi" />
        </div>
        <ul className="features">
          <li>
            <IconShield />
            {t.features.secure}
          </li>
          <li>
            <IconPulse />
            {t.features.monitor}
          </li>
          <li>
            <IconBolt />
            {t.features.perf}
          </li>
          <li>
            <IconLock />
            {t.features.crypto}
          </li>
        </ul>
      </section>

      <section className="form-side">
        <div className="lcard" ref={cardRef} onAnimationEnd={() => cardRef.current?.classList.remove('shake')}>
          {loadingStatus ? (
            <div className="done-view" style={{ color: 'var(--faint)', fontSize: '.84rem' }}>
              {t.loading}
            </div>
          ) : done !== null ? (
            <div className="done-view" aria-live="polite">
              <svg className="tick" viewBox="0 0 64 64" aria-hidden="true">
                <circle cx="32" cy="32" r="29" />
                <path d="M20 33l8 8 16-17" />
              </svg>
              <h2 style={{ margin: '6px 0 0', fontSize: '1.1rem' }}>{screen === 'setup' ? u.doneSetup(done) : u.doneLogin(done)}</h2>
              <p style={{ margin: 0, fontSize: '.82rem', color: 'var(--muted)' }}>{u.opening}</p>
            </div>
          ) : screen === 'login' ? (
            <>
              <div className="head">
                <h1>{t.headingLogin}</h1>
                <p>{t.welcome}</p>
              </div>
              <form onSubmit={handleLogin} noValidate>
                <div>
                  <label className="lbl" htmlFor="login-user">
                    {t.userLabel}
                  </label>
                  <div className="fld">
                    <span className="ico">
                      <IconUser size={16} />
                    </span>
                    <input
                      id="login-user"
                      className="input"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      placeholder={t.userPlaceholder}
                      aria-invalid={!!error && !username.trim()}
                    />
                  </div>
                </div>
                <div>
                  <label className="lbl" htmlFor="login-pass">
                    {t.passLabel}
                  </label>
                  <div className="fld">
                    <span className="ico">
                      <IconLock size={16} />
                    </span>
                    <input
                      id="login-pass"
                      className="input has-eye"
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={onCapsKey}
                      onKeyUp={onCapsKey}
                      onBlur={() => setCaps(false)}
                      autoComplete="current-password"
                      placeholder={t.passPlaceholder}
                      aria-invalid={!!error && !!username.trim()}
                    />
                    {eyeButton}
                  </div>
                  {caps && <div className="caps">⇪ {u.caps}</div>}
                </div>
                {error && (
                  <div className="tf-alert" role="alert">
                    <span>✕</span>
                    <span>{error}</span>
                  </div>
                )}
                <button type="submit" className={`primary ${submitting ? 'loading' : ''}`} disabled={submitting}>
                  <span>{submitting ? u.signingIn : t.signInBtn}</span>
                  <IconArrow size={16} strokeWidth={2.2} className="arrow" />
                </button>
                <div style={{ textAlign: 'center' }}>
                  <button type="button" className="link" onClick={() => setForgotOpen((v) => !v)}>
                    {t.forgot}
                  </button>
                  {forgotOpen && <div className="hint">{u.forgotHint}</div>}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <button type="button" className="ghost" onClick={() => switchScreen('setup')}>
                    {t.switchToSetup}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div className="head">
                <span className="badge">{t.badgeSetup}</span>
                <h1>{t.headingSetup}</h1>
                <p>{u.setupLead}</p>
              </div>
              <form onSubmit={handleCreateAdmin} noValidate>
                <ol className="steps">
                  <li className={`step ${step1Done ? 'done' : 'now'}`}>
                    <span className="num">1</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="title">{t.step1}</div>
                      <div className="term">
                        <div className="term-bar">
                          <i />
                          <i />
                          <i />
                          <span>root@server</span>
                        </div>
                        <div className="term-line">
                          <code>
                            <span className="p">$ </span>
                            {COMMAND}
                          </code>
                          <button type="button" className={`copy ${copied ? 'ok' : ''}`} onClick={handleCopy}>
                            <IconCopy size={13} />
                            {copied ? t.copied : t.copy}
                          </button>
                        </div>
                      </div>
                      {copyFailed && (
                        <div className="hint" style={{ color: 'var(--warn)' }}>
                          {t.copyFailedHint}
                        </div>
                      )}
                    </div>
                  </li>
                  <li className={`step ${keyIn ? 'done' : step1Done ? 'now' : ''}`}>
                    <span className="num">2</span>
                    <div style={{ minWidth: 0 }}>
                      <label className="title" htmlFor="setup-key" style={{ display: 'block' }}>
                        {t.step2Label}
                      </label>
                      <input
                        id="setup-key"
                        className="input ltr mono"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        autoComplete="off"
                        placeholder={t.step2Placeholder}
                      />
                      {keyIn && (
                        <div className="hint" style={{ color: 'var(--ok)' }}>
                          ✓ {u.keyIn}
                        </div>
                      )}
                    </div>
                  </li>
                  <li className={`step ${step3Done ? 'done' : keyIn ? 'now' : ''}`}>
                    <span className="num">3</span>
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div className="title" style={{ margin: '3px 0 0' }}>
                        {t.step3}
                      </div>
                      <div className="fld">
                        <span className="ico">
                          <IconUser size={16} />
                        </span>
                        <input
                          className="input"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          autoComplete="username"
                          placeholder={t.userLabel}
                          aria-label={t.userLabel}
                        />
                      </div>
                      <div className="fld">
                        <span className="ico">
                          <IconLock size={16} />
                        </span>
                        <input
                          className="input has-eye"
                          type={showPass ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          autoComplete="new-password"
                          placeholder={u.passMin}
                          aria-label={t.passLabel}
                        />
                        {eyeButton}
                      </div>
                      {password && (
                        <div>
                          <StrengthBars password={password} />
                          <div className="hint">
                            {u.strengthPrefix}
                            {u.strength[strengthLevel]}
                          </div>
                        </div>
                      )}
                    </div>
                  </li>
                </ol>
                {error && (
                  <div className="tf-alert" role="alert">
                    <span>✕</span>
                    <span>{error}</span>
                  </div>
                )}
                <button type="submit" className={`primary ${submitting ? 'loading' : ''}`} disabled={submitting || !keyIn || !step3Done}>
                  <span>{submitting ? u.creating : t.createBtn}</span>
                  <IconArrow size={16} strokeWidth={2.2} className="arrow" />
                </button>
                <div style={{ textAlign: 'center' }}>
                  <button type="button" className="ghost" onClick={() => switchScreen('login')}>
                    {t.switchToLogin}
                  </button>
                </div>
              </form>
            </>
          )}

          <div className="foot">
            <span className="host">
              <IconLock size={12} strokeWidth={2} />
              {window.location.host}
            </span>
            <span className="lang">
              {(['fa', 'en'] as const).map((code) => (
                <button key={code} type="button" aria-pressed={lang === code} onClick={() => setLang(code)}>
                  {code === 'fa' ? 'فا' : 'EN'}
                </button>
              ))}
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
