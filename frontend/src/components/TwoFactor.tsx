import { useEffect, useState, type FormEvent } from 'react'
import { QRCodeSVG } from 'qrcode.react'

import {
  ApiError,
  disableTwoFactor,
  enableTwoFactor,
  getTwoFactor,
  setupTwoFactor,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from '../lib/api'
import { useLang } from '../i18n/LangContext'
import { useToast } from './ui'

/** Settings > Two-factor login: turn on the authenticator-app code at login (backend/app/totp.py). */
export default function TwoFactor() {
  const { t } = useLang()
  const f = t.ui.set.tfa
  const say = useToast()
  const [status, setStatus] = useState<TwoFactorStatus | null>(null)
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [recovery, setRecovery] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getTwoFactor().then(setStatus).catch(() => undefined)
  }, [])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? f.wrong : t.common.genericError)
    } finally {
      setBusy(false)
    }
  }

  const start = () => run(async () => setSetup(await setupTwoFactor()))

  const confirm = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      const res = await enableTwoFactor(code)
      setRecovery(res.recovery_codes)
      setSetup(null)
      setCode('')
      setStatus({ enabled: true, recovery_codes_left: res.recovery_codes.length })
      say(f.enabled)
    })
  }

  const turnOff = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      await disableTwoFactor(password, code)
      setPassword('')
      setCode('')
      setStatus({ enabled: false, recovery_codes_left: 0 })
      say(f.disabled)
    })
  }

  async function copyCodes() {
    if (!recovery) return
    try {
      await navigator.clipboard.writeText(recovery.join('\n'))
      say(f.copied)
    } catch {
      say(t.common.genericError)
    }
  }

  if (!status) return <div className="hint">…</div>

  const codeInput = (
    <input
      id="tfa-code"
      className="input ltr mono"
      inputMode="numeric"
      autoComplete="one-time-code"
      value={code}
      onChange={(e) => setCode(e.target.value)}
      placeholder="123456"
      maxLength={32}
      required
    />
  )

  if (recovery) {
    return (
      <div className="flex flex-col gap-3">
        <div className="tf-alert">{f.recoveryWarn}</div>
        <div className="mono ltr" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
          {recovery.map((c) => (
            <span key={c} className="chip en" style={{ justifyContent: 'center' }}>
              {c}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={copyCodes}>
            {f.copyCodes}
          </button>
          <button type="button" className="btn solid" onClick={() => setRecovery(null)}>
            {f.savedThem}
          </button>
        </div>
      </div>
    )
  }

  if (status.enabled) {
    return (
      <form onSubmit={turnOff} className="flex flex-col gap-3">
        <div className="hint" style={{ margin: 0 }}>
          {f.onHint(status.recovery_codes_left)}
        </div>
        <div className="row2">
          <div>
            <label className="lbl" htmlFor="tfa-pass">
              {f.passwordLabel}
            </label>
            <input id="tfa-pass" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          <div>
            <label className="lbl" htmlFor="tfa-code">
              {f.codeLabel}
            </label>
            {codeInput}
          </div>
        </div>
        {error && <div className="tf-alert">{error}</div>}
        <div>
          <button type="submit" className="btn bad-solid" disabled={busy}>
            {f.turnOff}
          </button>
        </div>
      </form>
    )
  }

  if (setup) {
    return (
      <form onSubmit={confirm} className="flex flex-col gap-3">
        <ol className="hint" style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 4 }}>
          <li>{f.step1}</li>
          <li>{f.step2}</li>
          <li>{f.step3}</li>
        </ol>
        <div className="flex flex-wrap items-center gap-4">
          <div style={{ background: '#fff', padding: 10, borderRadius: 12, lineHeight: 0 }}>
            <QRCodeSVG value={setup.otpauth_uri} size={168} />
          </div>
          <div className="flex flex-col gap-2" style={{ minWidth: 0, flex: '1 1 220px' }}>
            <span className="lbl" style={{ margin: 0 }}>
              {f.manualKey}
            </span>
            <code className="mono ltr" style={{ wordBreak: 'break-all', fontSize: '0.8rem' }}>
              {setup.secret}
            </code>
          </div>
        </div>
        <div>
          <label className="lbl" htmlFor="tfa-code">
            {f.codeLabel}
          </label>
          {codeInput}
        </div>
        {error && <div className="tf-alert">{error}</div>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn solid" disabled={busy}>
            {f.confirm}
          </button>
          <button type="button" className="btn" onClick={() => setSetup(null)}>
            {f.cancel}
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="hint" style={{ margin: 0 }}>
        {f.offHint}
      </div>
      {error && <div className="tf-alert">{error}</div>}
      <div>
        <button type="button" className="btn solid" onClick={start} disabled={busy}>
          {f.turnOn}
        </button>
      </div>
    </div>
  )
}
