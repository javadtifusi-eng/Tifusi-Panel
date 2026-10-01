import { useMemo, useState } from 'react'
import { ApiError, FINGERPRINTS, getRealityKeypair, updateCore, type Core } from '../lib/api'
import { buildInboundJson, emptyWizard, type Wizard, type WizardProtocol } from '../lib/inboundWizard'
import { highlightJsonLines, useToast } from './ui'
import { useLang } from '../i18n/LangContext'

// The inline "new inbound" builder under an Xray core: one step at a time, each
// choice opening the next, with the JSON it will add built live beside it. It
// writes into the core's own config through the normal update endpoint, so the
// panel validates and pushes it exactly as an edit in the full editor would.

const PROTOCOLS: WizardProtocol[] = ['vless', 'vmess', 'trojan', 'shadowsocks']
const NETWORKS = ['tcp', 'ws', 'grpc'] as const
const SECURITIES = ['none', 'tls', 'reality'] as const
const SS_METHODS = ['2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305']

const randomPort = () => String(10000 + Math.floor(Math.random() * 50000))

export default function QuickInbound({ core, onSaved }: { core: Core; onSaved: () => void }) {
  const { t } = useLang()
  const q = t.ui.cores.qb
  const say = useToast()
  const [w, setW] = useState<Wizard>(() => ({ ...emptyWizard(), port: randomPort() }))
  const [tagTouched, setTagTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [keyBusy, setKeyBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const existing = useMemo(() => {
    const list = ((core.config ?? {}) as { inbounds?: { tag?: string; port?: number }[] }).inbounds ?? []
    return { tags: new Set(list.map((i) => i.tag ?? '')), ports: new Set(list.map((i) => Number(i.port))) }
  }, [core.config])

  const isSS = w.protocol === 'shadowsocks'
  const autoTag = w.protocol ? `${isSS ? 'ss' : w.protocol}-${isSS ? 'tcp' : w.network || '…'}${w.security === 'reality' ? '-reality' : ''}-${w.port || 0}` : ''
  const tag = tagTouched ? w.tag : autoTag
  const step = !w.protocol ? 0 : isSS ? 3 : !w.network ? 1 : !w.security ? 2 : 3
  const set = (patch: Partial<Wizard>) => setW((prev) => ({ ...prev, ...patch }))

  function pickProtocol(p: WizardProtocol) {
    if (p === 'shadowsocks') set({ protocol: p, network: 'tcp', security: 'none', method: w.method || SS_METHODS[0] })
    else set({ protocol: p, ...(p !== 'vless' && w.security === 'reality' ? { security: '' } : {}), ...(w.protocol === 'shadowsocks' ? { network: '', security: '' } : {}) })
  }
  function pickNetwork(n: (typeof NETWORKS)[number]) {
    // REALITY has no WebSocket transport; changing to ws drops it.
    set({ network: n, path: n === 'ws' ? w.path || '/ws' : n === 'grpc' ? w.path || 'tifusi-grpc' : '', ...(n === 'ws' && w.security === 'reality' ? { security: '' } : {}) })
  }
  async function pickSecurity(s: (typeof SECURITIES)[number]) {
    set({ security: s, fingerprint: s === 'none' ? '' : w.fingerprint || 'chrome' })
    if (s === 'reality' && !w.realityPrivateKey) await makeKeys()
  }
  async function makeKeys() {
    setKeyBusy(true)
    try {
      const k = await getRealityKeypair()
      set({ realityPrivateKey: k.private_key, realityShortId: k.short_id })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : q.keyFailed)
    } finally {
      setKeyBusy(false)
    }
  }
  function reset() {
    setW({ ...emptyWizard(), port: randomPort() })
    setTagTouched(false)
    setError(null)
  }

  const inbound = w.protocol ? buildInboundJson({ ...w, tag }) : null
  const port = Number(w.port)

  async function save() {
    setError(null)
    if (!(port >= 1 && port <= 65535)) return setError(q.badPort)
    if (existing.ports.has(port)) return setError(q.portTaken(port))
    if (!tag.trim()) return setError(q.needTag)
    if (existing.tags.has(tag)) return setError(q.tagTaken)
    if ((w.security === 'tls' || w.security === 'reality') && !w.sni.trim()) return setError(q.needSni)
    if (w.security === 'reality' && !w.realityPrivateKey) return setError(q.needKey)
    const config = JSON.parse(JSON.stringify(core.config ?? {})) as { inbounds?: unknown[] }
    config.inbounds = [...(config.inbounds ?? []), inbound]
    setBusy(true)
    try {
      const res = await updateCore(core.id, { config })
      say(res.warnings?.length ? q.savedWarn(tag, res.warnings.length) : q.saved(tag))
      reset()
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setBusy(false)
    }
  }

  const secName = (s: string) => (s === 'none' ? q.secNone : s === 'tls' ? 'TLS' : 'REALITY')

  return (
    <section className="qb" aria-label={q.title}>
      <div className="qb-head">
        <div>
          <span className="cx-eyebrow">NEW INBOUND</span>
          <h3>{q.title}</h3>
          <p>{q.sub}</p>
        </div>
        {w.protocol && (
          <button type="button" className="btn" onClick={reset}>
            {q.restart}
          </button>
        )}
      </div>

      <div className="qb-grid">
        <div className="qb-form">
          <div className={`qb-step ${w.protocol ? 'done' : ''}`}>
            <span className="qb-lb"><em>۱</em> {q.protocol}</span>
            <div className="qb-cards">
              {PROTOCOLS.map((p) => (
                <button key={p} type="button" aria-pressed={w.protocol === p} onClick={() => pickProtocol(p)}>
                  <b>{p === 'vless' ? 'VLESS' : p === 'vmess' ? 'VMess' : p === 'trojan' ? 'Trojan' : 'Shadowsocks'}</b>
                </button>
              ))}
            </div>
          </div>

          {step >= 1 && !isSS && (
            <div className={`qb-step ${w.network ? 'done' : ''}`}>
              <span className="qb-lb"><em>۲</em> {q.network}</span>
              <div className="qb-cards three">
                {NETWORKS.map((n) => (
                  <button key={n} type="button" aria-pressed={w.network === n} onClick={() => pickNetwork(n)}>
                    <b>{n === 'tcp' ? 'TCP' : n === 'ws' ? 'WebSocket' : 'gRPC'}</b>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step >= 2 && !isSS && (
            <div className={`qb-step ${w.security ? 'done' : ''}`}>
              <span className="qb-lb"><em>۳</em> {q.security}</span>
              <div className="qb-cards three">
                {SECURITIES.map((s) => {
                  const off = s === 'reality' && (w.protocol !== 'vless' || w.network === 'ws')
                  return (
                    <button key={s} type="button" aria-pressed={w.security === s} hidden={off} onClick={() => pickSecurity(s)}>
                      <b>{secName(s)}</b>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {step >= 3 && (
            <div className="qb-step">
              <span className="qb-lb"><em>{isSS ? '۲' : '۴'}</em> {q.settings}</span>
              <div className="qb-two">
                <label className="qb-field">
                  <span>{q.port}</span>
                  <span className="qb-with">
                    <input className="qb-inp" inputMode="numeric" value={w.port} onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} />
                    <button type="button" className="btn" onClick={() => set({ port: randomPort() })} title={q.randomPort}>🎲</button>
                  </span>
                </label>
                {(w.network === 'ws' || w.network === 'grpc') && !isSS && (
                  <label className="qb-field">
                    <span>{w.network === 'grpc' ? 'serviceName' : q.path}</span>
                    <input className="qb-inp" value={w.path} onChange={(e) => set({ path: e.target.value })} />
                  </label>
                )}
                {isSS && (
                  <label className="qb-field">
                    <span>{q.method}</span>
                    <select className="qb-inp" value={w.method} onChange={(e) => set({ method: e.target.value })}>
                      {SS_METHODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {w.network === 'ws' && (
                <label className="qb-field">
                  <span>{q.host}</span>
                  <input className="qb-inp" value={w.hostHeader} placeholder="cdn.example.com" onChange={(e) => set({ hostHeader: e.target.value })} />
                </label>
              )}
              {(w.security === 'tls' || w.security === 'reality') && (
                <div className="qb-two">
                  <label className="qb-field">
                    <span>{w.security === 'reality' ? q.cover : q.sni}</span>
                    <input className="qb-inp" value={w.sni} placeholder="www.example.com" onChange={(e) => set({ sni: e.target.value.trim() })} />
                  </label>
                  <label className="qb-field">
                    <span>Fingerprint</span>
                    <select className="qb-inp" value={w.fingerprint} onChange={(e) => set({ fingerprint: e.target.value })}>
                      {FINGERPRINTS.map((fp) => (
                        <option key={fp} value={fp}>{fp}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {w.security === 'tls' && (
                <label className="qb-field">
                  <span>ALPN</span>
                  <input className="qb-inp" value={w.alpn} placeholder="h2,http/1.1" onChange={(e) => set({ alpn: e.target.value })} />
                </label>
              )}
              {w.security === 'reality' && (
                <div className="qb-key">
                  <span>{w.realityPrivateKey ? `✓ ${q.keyReady} · shortId ${w.realityShortId}` : q.keyMissing}</span>
                  <button type="button" className="btn" disabled={keyBusy} onClick={makeKeys}>
                    {keyBusy ? '…' : w.realityPrivateKey ? q.remakeKey : q.makeKey}
                  </button>
                </div>
              )}
              <label className="qb-field">
                <span>{q.tag}</span>
                <input
                  className="qb-inp"
                  value={tag}
                  onChange={(e) => {
                    setTagTouched(true)
                    set({ tag: e.target.value.replace(/\s/g, '') })
                  }}
                />
                <small>{q.tagHint}</small>
              </label>
              {error && <div className="tf-alert">{error}</div>}
              <div>
                <button type="button" className="btn solid lg qb-add" disabled={busy} onClick={save}>
                  {busy ? t.common.saving : q.addTo(core.name)}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="qb-preview">
          {inbound ? (
            <>
              <div className="qb-tag">
                tag → <b>{tag}</b>
              </div>
              <pre className="cx-json qb-json">
                {highlightJsonLines(JSON.stringify(inbound, null, 2)).map((html, i) => (
                  <span key={i} className="ln" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
                ))}
              </pre>
            </>
          ) : (
            <div className="qb-empty">{q.previewEmpty}</div>
          )}
        </div>
      </div>
    </section>
  )
}
