import { useId, type CSSProperties, type ReactNode } from 'react'
import { useLang } from '../i18n/LangContext'
import { FINGERPRINTS } from '../lib/api'

export type InboundProtocol = 'vless' | 'vmess' | 'trojan' | 'shadowsocks'
export type InboundNetwork = 'tcp' | 'ws' | 'grpc'
export type InboundSecurity = 'none' | 'tls' | 'reality'

export interface InboundWizard {
  protocol: InboundProtocol | ''
  network: InboundNetwork | ''
  security: InboundSecurity | ''
  tag: string
  port: string
  sni: string
  fingerprint: string
  alpn: string
  path: string
  hostHeader: string
  method: string
  realityPrivateKey: string
  realityShortId: string
}

// One hue per layer of the connection; the live diagram and the selected tiles share them, so a
// colour on screen always means the same layer. Orange stays reserved for the primary action.
const IDLE = '#5c5c5c'
const HUE = { protocol: '#60a5fa', network: '#2dd4bf', none: '#94a3b8', tls: '#4ade80', reality: '#f43f5e' }

const PROTOCOLS: InboundProtocol[] = ['vless', 'vmess', 'trojan', 'shadowsocks']
const NETWORKS: InboundNetwork[] = ['tcp', 'ws', 'grpc']
const SECURITIES: InboundSecurity[] = ['none', 'tls', 'reality']
const NETWORK_NAMES: Record<InboundNetwork, string> = { tcp: 'TCP', ws: 'WebSocket', grpc: 'gRPC' }
const SS_METHODS = ['2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305']

// REALITY can't carry WebSocket; everything else combines.
const allowedSecurity = (w: InboundWizard, s: InboundSecurity) => !(s === 'reality' && w.network === 'ws')
const allowedNetwork = (w: InboundWizard, n: InboundNetwork) => !(n === 'ws' && w.security === 'reality')

// Presets never fill in a REALITY target: that has to come from the live scanner, not a fixed name.
const PRESETS: { key: 'reality' | 'wsCdn' | 'trojanTls'; hue: string; tag: string; set: Partial<InboundWizard> }[] = [
  { key: 'reality', hue: HUE.reality, tag: 'vless-reality', set: { protocol: 'vless', network: 'tcp', security: 'reality', port: '443', fingerprint: 'chrome' } },
  { key: 'wsCdn', hue: HUE.network, tag: 'vless-ws', set: { protocol: 'vless', network: 'ws', security: 'none', port: '8080', path: '/ws' } },
  { key: 'trojanTls', hue: HUE.tls, tag: 'trojan-tls', set: { protocol: 'trojan', network: 'tcp', security: 'tls', port: '2053', fingerprint: 'chrome', alpn: 'h2,http/1.1' } },
]

const hueVar = (c: string) => ({ '--c': c }) as CSSProperties

function portValid(p: string) {
  const n = Number(p)
  return /^\d+$/.test(p.trim()) && n >= 1 && n <= 65535
}

function freeTag(base: string, taken: string[]) {
  if (!taken.includes(base)) return base
  let i = 2
  while (taken.includes(`${base}-${i}`)) i++
  return `${base}-${i}`
}

export default function InboundBuilder({
  wizard: w,
  onChange,
  existingTags,
  canAdd,
  added,
  onAdd,
  generatingKeys,
  onGenerateKeys,
  onScan,
}: {
  wizard: InboundWizard
  onChange: (patch: Partial<InboundWizard>) => void
  existingTags: string[]
  canAdd: boolean
  added: boolean
  onAdd: () => void
  generatingKeys: boolean
  onGenerateKeys: () => void
  onScan: () => void
}) {
  const { t } = useLang()
  const b = t.coresPage.builder
  const protocolLabels = t.coresPage.protocolLabels
  const transport = w.protocol !== '' && w.protocol !== 'shadowsocks'
  const secHue = w.security ? HUE[w.security] : IDLE

  function pickNetwork(n: InboundNetwork) {
    onChange({ network: n, ...(allowedSecurity({ ...w, network: n }, w.security || 'none') ? {} : { security: '' }) })
  }
  function pickSecurity(s: InboundSecurity) {
    onChange({ security: s, ...(w.network && !allowedNetwork({ ...w, security: s }, w.network) ? { network: '' } : {}) })
  }
  function applyPreset(p: (typeof PRESETS)[number]) {
    onChange({ ...p.set, tag: freeTag(p.tag, existingTags) })
    if (p.set.security === 'reality' && !w.realityPrivateKey) onGenerateKeys()
  }

  const secName = (s: InboundSecurity) => (s === 'none' ? b.securityNone : s === 'tls' ? 'TLS' : 'REALITY')

  return (
    <div className="ib">
      <div className="ib-head">
        <h4>{b.heading}</h4>
        <p>{b.sub}</p>
      </div>

      <InboundFlow w={w} />

      <div className="ib-group">
        <div className="ib-label">
          <b>{b.quickStart}</b>
          <span>{b.quickStartHint}</span>
        </div>
        <div className="ib-presets">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" className="ib-preset" onClick={() => applyPreset(p)}>
              <i style={{ background: p.hue }} />
              {b.presets[p.key]}
            </button>
          ))}
        </div>
      </div>

      <div className="ib-group" style={hueVar(HUE.protocol)}>
        <div className="ib-label">
          <b>
            <i />
            {b.protocol}
          </b>
        </div>
        <div className="ib-tiles ib-c4">
          {PROTOCOLS.map((p) => (
            <button key={p} type="button" className="ib-tile" aria-pressed={w.protocol === p} onClick={() => onChange({ protocol: p })}>
              {p === 'vless' && <span className="ib-tag">{b.recommended}</span>}
              <b className="en">{protocolLabels[p]}</b>
              <small>{b.protocolDesc[p]}</small>
            </button>
          ))}
        </div>
      </div>

      {transport && (
        <>
          <div className="ib-group" style={hueVar(HUE.network)}>
            <div className="ib-label">
              <b>
                <i />
                {b.transport}
              </b>
              <span>{w.security === 'reality' ? b.realityNoWs : w.network ? b.netHint[w.network] : ''}</span>
            </div>
            <div className="ib-seg">
              {NETWORKS.map((n) => (
                <button key={n} type="button" className="en" aria-pressed={w.network === n} disabled={!allowedNetwork(w, n)} onClick={() => pickNetwork(n)}>
                  {NETWORK_NAMES[n]}
                </button>
              ))}
            </div>
          </div>

          <div className="ib-group" style={hueVar(secHue)}>
            <div className="ib-label">
              <b>
                <i />
                {b.security}
              </b>
            </div>
            <div className="ib-tiles ib-c3">
              {SECURITIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="ib-tile"
                  style={hueVar(HUE[s])}
                  aria-pressed={w.security === s}
                  disabled={!allowedSecurity(w, s)}
                  onClick={() => pickSecurity(s)}
                >
                  {s === 'reality' && <span className="ib-tag">{b.recommendedIran}</span>}
                  <b className={s === 'none' ? '' : 'en'}>{secName(s)}</b>
                  <small>{b.securityDesc[s]}</small>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {w.protocol && (
        <div className="ib-group">
          <div className="ib-label">
            <b>{b.details}</b>
          </div>
          <div className="ib-row">
            <Field label={b.tag} hint={b.tagHint}>
              <input className="input ltr" value={w.tag} onChange={(e) => onChange({ tag: e.target.value })} placeholder="vless-reality" />
            </Field>
            <Field label={b.port} hint={w.port && !portValid(w.port) ? <span className="ib-bad">{b.portInvalid}</span> : undefined}>
              <span className="ib-with-btn">
                <input className="input ltr" inputMode="numeric" value={w.port} onChange={(e) => onChange({ port: e.target.value })} />
                <button type="button" className="btn" onClick={() => onChange({ port: String(10000 + Math.floor(Math.random() * 50000)) })}>
                  {b.randomPort}
                </button>
              </span>
            </Field>
          </div>

          {w.protocol === 'shadowsocks' && (
            <div className="ib-row">
              <Field label={b.method}>
                <select className="input ltr" value={w.method} onChange={(e) => onChange({ method: e.target.value })}>
                  <option value="" disabled>
                    {t.coresPage.selectPlaceholder}
                  </option>
                  {SS_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {transport && (w.security === 'tls' || w.security === 'reality') && (
            <div className="ib-row">
              <Field label={w.security === 'reality' ? b.sniReality : b.sniTls} hint={w.security === 'reality' ? b.sniRealityHint : undefined}>
                <input className="input ltr" value={w.sni} onChange={(e) => onChange({ sni: e.target.value })} placeholder="www.example.com" />
              </Field>
              <Field label={b.fingerprint} hint={b.fingerprintHint}>
                <select className="input ltr" value={w.fingerprint} onChange={(e) => onChange({ fingerprint: e.target.value })}>
                  <option value="">{t.coresPage.selectPlaceholder}</option>
                  {FINGERPRINTS.map((fp) => (
                    <option key={fp} value={fp}>
                      {fp}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {transport && w.security === 'tls' && (
            <div className="ib-row">
              <Field label="ALPN" hint={b.alpnHint}>
                <input className="input ltr" value={w.alpn} onChange={(e) => onChange({ alpn: e.target.value })} placeholder="h2,http/1.1" />
              </Field>
            </div>
          )}

          {transport && (w.network === 'ws' || w.network === 'grpc') && (
            <div className="ib-row">
              <Field label={w.network === 'ws' ? b.wsPath : b.grpcService}>
                <input className="input ltr" value={w.path} onChange={(e) => onChange({ path: e.target.value })} placeholder={w.network === 'ws' ? '/ws' : 'grpc'} />
              </Field>
              {w.network === 'ws' && (
                <Field label={b.hostHeader} hint={b.hostHeaderHint}>
                  <input className="input ltr" value={w.hostHeader} onChange={(e) => onChange({ hostHeader: e.target.value })} placeholder="cdn.example.com" />
                </Field>
              )}
            </div>
          )}

          {transport && w.security === 'reality' && (
            <div className="ib-reality">
              <div className="ib-reality-top">
                <b>{b.realityBox}</b>
                <span className="ib-actions">
                  <button type="button" className="btn" onClick={onGenerateKeys} disabled={generatingKeys}>
                    {generatingKeys ? b.makingKey : w.realityPrivateKey ? b.remakeKey : b.makeKey}
                  </button>
                  <button type="button" className="btn" onClick={onScan}>
                    {b.findSite}
                  </button>
                </span>
              </div>
              <div className="ib-keyline">
                <span>
                  {b.privateKey}: <b className="en">{w.realityPrivateKey ? '••••••••••••' : '—'}</b>
                </span>
                <span>
                  shortId: <b className="en">{w.realityShortId || '—'}</b>
                </span>
                <span className={w.realityPrivateKey ? 'ib-good' : ''}>{w.realityPrivateKey ? b.keyReady : b.keyMissing}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="ib-foot">
        <span className="ib-summary">
          {w.protocol && <Chip hue={HUE.protocol}>{protocolLabels[w.protocol]}</Chip>}
          {transport && w.network && <Chip hue={HUE.network}>{NETWORK_NAMES[w.network]}</Chip>}
          {transport && w.security && <Chip hue={HUE[w.security]}>{secName(w.security)}</Chip>}
          {w.port && (
            <span>
              {b.port} <b className="en">{w.port}</b>
            </span>
          )}
        </span>
        <button type="button" className="btn solid ib-add" onClick={onAdd} disabled={!canAdd}>
          {added ? b.added : b.add}
        </button>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="ib-field">
      <span className="ib-field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

function Chip({ hue, children }: { hue: string; children: ReactNode }) {
  return (
    <span className="ib-chip en" style={{ color: hue, borderColor: `${hue}55`, background: `${hue}14` }}>
      {children}
    </span>
  )
}

// The connection as live traffic: it streams in from the reading edge, passes one chip per layer
// (and a CDN hop for WebSocket) and lands on the server. Each packet takes the colour of the layer it
// has just passed through, the wire itself keeps flowing, and the band above says what a censor
// actually sees. Unencrypted traffic is drawn grey and dashed.
function InboundFlow({ w }: { w: InboundWizard }) {
  const { t, dir } = useLang()
  const f = t.coresPage.builder.flow
  const uid = useId().replace(/:/g, '')
  const transport = w.protocol !== '' && w.protocol !== 'shadowsocks'
  const secHue = transport && w.security ? HUE[w.security] : w.protocol === 'shadowsocks' ? HUE.protocol : IDLE
  const plain = transport && w.security === 'none'
  const cdn = transport && w.network === 'ws'

  const W = 720
  const y = 88
  const rtl = dir === 'rtl'
  const toward = rtl ? -1 : 1
  const edgeX = rtl ? W - 8 : 8
  const serverX = rtl ? 64 : W - 64

  const chips: { label: string; hue: string; cap: string }[] = [
    { label: w.protocol ? t.coresPage.protocolLabels[w.protocol] : f.pick, hue: w.protocol ? HUE.protocol : IDLE, cap: f.layerProtocol },
  ]
  if (transport) {
    chips.push({ label: w.network ? NETWORK_NAMES[w.network] : f.pick, hue: w.network ? HUE.network : IDLE, cap: f.layerTransport })
    chips.push({
      label: w.security ? (w.security === 'none' ? f.noCipher : w.security === 'tls' ? 'TLS' : 'REALITY') : f.pick,
      hue: secHue,
      cap: f.layerSecurity,
    })
  }

  // Chips are spread by their real widths with equal gaps, so a long label (WebSocket) plus the CDN
  // hop never makes neighbours touch.
  const widths = chips.map((c) => Math.max(64, c.label.length * 7.4 + 26))
  const cdnX = serverX - toward * 96
  const from = edgeX + toward * 40
  const to = cdn ? cdnX - toward * 40 : serverX - toward * 46
  const gap = (Math.abs(to - from) - widths.reduce((a, b) => a + b, 0)) / (chips.length + 1)
  const xs: number[] = []
  let cursor = from
  widths.forEach((wd) => {
    xs.push(cursor + toward * (gap + wd / 2))
    cursor += toward * (gap + wd)
  })

  let seen: string
  let seenHue: string
  if (!w.protocol) {
    seen = f.seesNothing
    seenHue = IDLE
  } else if (!transport) {
    seen = f.seesSs
    seenHue = HUE.protocol
  } else if (w.security === 'reality') {
    seen = w.sni ? f.seesReality(w.sni) : f.seesRealityNoSite
    seenHue = HUE.reality
  } else if (w.security === 'tls') {
    seen = w.sni ? f.seesTls(w.sni) : f.seesTlsNoSni
    seenHue = HUE.tls
  } else if (w.security === 'none') {
    seen = f.seesPlain
    seenHue = HUE.none
  } else {
    seen = f.seesNothing
    seenHue = IDLE
  }

  const wireFrom = edgeX
  const wireTo = serverX - toward * 30
  const length = Math.abs(wireTo - wireFrom)
  // Where along the wire each packet changes colour: right after the chip of that layer.
  const hues = chips.map((c) => c.hue)
  const keyTimes = ['0', ...xs.slice(1).map((x) => (Math.abs(x - wireFrom) / length).toFixed(3))].join(';')
  const bandA = 40
  const bandB = W - 40
  const live = !!w.protocol

  return (
    <div className="ib-flow">
      <svg viewBox={`0 0 ${W} 150`} role="img" aria-label={f.aria}>
        <defs>
          {/* userSpaceOnUse: a perfectly horizontal line has a zero-height bounding box, and a gradient in
              bounding-box units then isn't painted at all. */}
          <linearGradient id={`w${uid}`} gradientUnits="userSpaceOnUse" x1={wireFrom} x2={wireTo} y1={y} y2={y}>
            <stop offset="0" stopColor={hues[0]} stopOpacity="0" />
            <stop offset=".12" stopColor={hues[0]} />
            {transport && <stop offset=".5" stopColor={hues[1]} />}
            <stop offset="1" stopColor={secHue} />
          </linearGradient>
          <filter id={`g${uid}`} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <path id={`r${uid}`} d={`M${wireFrom} ${y} L${wireTo} ${y}`} />
        </defs>

        <rect x={bandA} y="14" width={bandB - bandA} height="26" rx="13" fill={seenHue} fillOpacity=".08" stroke={seenHue} strokeOpacity=".4" className={live ? 'ib-breathe-soft' : undefined} />
        <text x={W / 2} y="31.5" textAnchor="middle" fontSize="12" fill={seenHue}>
          <tspan fill="#8b8b8b">{f.filterSees}</tspan>
          {seen}
        </text>

        <line x1={wireFrom} y1={y} x2={wireTo} y2={y} stroke={`url(#w${uid})`} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={plain ? '6 7' : undefined} opacity=".55" />
        {live && (
          <line x1={wireFrom} y1={y} x2={wireTo} y2={y} stroke={`url(#w${uid})`} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="2 16" className="ib-stream" />
        )}

        {live &&
          [0, 1, 2, 3, 4, 5].map((i) => (
            <circle key={`${i}${hues.join()}${plain}`} className="ib-pkt" r={i % 2 ? 3.4 : 4.4} fill={hues[0]} filter={`url(#g${uid})`} opacity="0">
              <animateMotion dur="2.4s" repeatCount="indefinite" begin={`${i * 0.4}s`}>
                <mpath href={`#r${uid}`} />
              </animateMotion>
              {hues.length > 1 && (
                <animate attributeName="fill" values={hues.join(';')} keyTimes={keyTimes} calcMode="discrete" dur="2.4s" repeatCount="indefinite" begin={`${i * 0.4}s`} />
              )}
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.06;.92;1" dur="2.4s" repeatCount="indefinite" begin={`${i * 0.4}s`} />
            </circle>
          ))}

        {chips.map((c, i) => {
          const wdt = widths[i]
          return (
            <g key={i}>
              {c.hue !== IDLE && (
                <rect x={xs[i] - wdt / 2 - 4} y={y - 19} width={wdt + 8} height="38" rx="12" fill={c.hue} className="ib-breathe" style={{ animationDelay: `${i * 0.5}s` }} />
              )}
              <rect x={xs[i] - wdt / 2} y={y - 15} width={wdt} height="30" rx="9" fill="#0e0e0e" stroke={c.hue} strokeOpacity=".8" />
              <rect x={xs[i] - wdt / 2} y={y - 15} width={wdt} height="30" rx="9" fill={c.hue} fillOpacity=".12" />
              <text x={xs[i]} y={y + 4.5} textAnchor="middle" fontSize="12.5" fontWeight="600" fill={c.hue} className="ib-lat">
                {c.label}
              </text>
              <text x={xs[i]} y={y + 34} textAnchor="middle" fontSize="10.5" fill="#5c5c5c">
                {c.cap}
              </text>
            </g>
          )
        })}

        {cdn && (
          <g>
            <rect x={cdnX - 26} y={y - 14} width="52" height="28" rx="14" fill="#0e0e0e" stroke={HUE.network} strokeOpacity=".75" />
            <text x={cdnX} y={y + 4} textAnchor="middle" fontSize="10.5" fontWeight="600" fill={HUE.network} className="ib-lat">
              CDN
            </text>
            <text x={cdnX} y={y + 34} textAnchor="middle" fontSize="10.5" fill="#5c5c5c">
              {f.optional}
            </text>
          </g>
        )}

        <g>
          <rect x={serverX - 24} y={y - 24} width="48" height="48" rx="9" fill="#141414" stroke={live ? secHue : '#404040'} strokeOpacity={live ? 0.6 : 1} />
          {[-12, 0, 12].map((d, i) => (
            <g key={d}>
              <rect x={serverX - 16} y={y + d - 4} width="32" height="8" rx="2" fill="#1c1c1c" />
              <circle cx={serverX + toward * -10} cy={y + d} r="1.9" fill={live ? secHue : '#404040'}>
                {live && <animate attributeName="opacity" values="1;.25;1" dur={`${0.9 + i * 0.35}s`} repeatCount="indefinite" />}
              </circle>
            </g>
          ))}
          <text x={serverX} y={y + 46} textAnchor="middle" fontSize="11.5" fill="#bebebe">
            {f.server}
            <tspan fill="#8b8b8b" className="ib-lat">
              {' '}
              :{portValid(w.port) ? w.port : '—'}
            </tspan>
          </text>
        </g>
      </svg>
      <div className="ib-legend">
        <span>
          <i style={{ background: HUE.protocol }} />
          {f.layerProtocol}
        </span>
        {transport && (
          <>
            <span>
              <i style={{ background: HUE.network }} />
              {f.layerTransport}
            </span>
            <span>
              <i style={{ background: secHue }} />
              {f.layerSecurity}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
