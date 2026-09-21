import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  getFieldTest,
  getNodeRealityScan,
  getRealityWhoami,
  startFieldTest,
  stopFieldTest,
  type FieldTest,
  type FieldTestItem,
  type FieldTarget,
  listNodes,
  startNodeRealityScan,
  type IranCheck,
  type Node,
  type RealityCandidate,
  type RealityNodeScan,
  type RealityStress,
} from '../lib/api'
import { copyToClipboard } from '../lib/clipboard'
import { Sheet } from './ui'

const POLL_MS = 1500
const UNKNOWN = 1e6

/** Fingerprints ordered the way the targets are: the ones that really
 *  carried a page, fastest first. Untested and failed ones trail. */
function rankedFps(r: RealityCandidate) {
  return Object.entries(r.fingerprints ?? {}).sort(([, a], [, b]) => {
    if (!!a.ok !== !!b.ok) return a.ok ? -1 : 1
    return (a.ms ?? UNKNOWN) - (b.ms ?? UNKNOWN)
  })
}

// Fastest/slowest are only called out when the gap is real; measured from
// the node, working fingerprints are usually within a few ms of each other.
function fpStats(r: RealityCandidate) {
  const ok = rankedFps(r).filter(([, v]) => v.ok && v.ms != null) as [string, { ok: boolean; ms: number }][]
  if (!ok.length) return { fastest: null as string | null, slowest: null as string | null, even: false }
  const lo = ok[0], hi = ok[ok.length - 1]
  const real = ok.length > 1 && hi[1].ms - lo[1].ms >= 15 && hi[1].ms >= lo[1].ms * 1.25
  return { fastest: real ? lo[0] : null, slowest: real ? hi[0] : null, even: ok.length > 1 && !real }
}

function IranPill({ check }: { check: IranCheck | null }) {
  const { t } = useLang()
  const rs = t.ui.realityScan
  if (!check) return <span className="pill idle">🇮🇷 —</span>
  const tone = { open: 'ok', blocked: 'bad', partial: 'warn', unknown: 'idle', checking: 'info live' }[check.verdict]
  const cities = check.checked ? ` · ${rs.cities(check.ok ?? 0, check.checked)}` : ''
  const why = check.reason && check.verdict !== 'open' ? ` · ${rs.reason[check.reason] ?? check.reason}` : ''
  return (
    <span
      className={`pill ${tone}`}
      title={[
        rs.probesTitle,
        ...(check.cities ?? []).map(
          (c) =>
            `${c.node}: ${c.ok ? '✓' : '✕'}${c.ms ? ` ${c.ms}ms` : ''}` +
            `${c.reason && !c.ok ? ` — ${rs.reason[c.reason] ?? c.reason}` : ''}${c.ip ? ` (${c.ip})` : ''}`,
        ),
      ].join('\n')}
    >
      <i />
      🇮🇷 {rs.iran[check.verdict]}
      {cities}
      {why}
    </span>
  )
}

/** Same buckets as node_agent reality_scan.reliability(): 0 held up
 *  completely, 1 dropped a few, 2 dropped many, 3 shut the node out
 *  afterwards, 4 not tested. A bucket, so one lost handshake in eighty
 *  doesn't outrank a real speed difference. */
function reliability(s?: RealityStress | null) {
  if (!s) return 4
  if (s.after_ok === 0) return 3
  const total = s.burst_total + s.steady_total + s.after_total
  const rate = total ? (s.burst_ok + s.steady_ok + s.after_ok) / total : 0
  return rate >= 0.99 ? 0 : rate >= 0.95 ? 1 : 2
}

function StressPill({ s }: { s?: RealityStress | null }) {
  const { t } = useLang()
  const rs = t.ui.realityScan
  if (!s) return null
  const grade = reliability(s)
  const total = s.burst_total + s.steady_total + s.after_total
  const pct = Math.round(((s.burst_ok + s.steady_ok + s.after_ok) / Math.max(1, total)) * 100)
  const tone = ['ok', 'warn', 'bad', 'bad'][grade]
  return (
    <span className={`pill ${tone}`} title={rs.stressTitle(s.burst_ok, s.burst_total, s.steady_ok, s.steady_total, s.after_ok, s.after_total)}>
      <i />
      {grade === 3 ? rs.stressBanned : rs.stress(pct)}
    </span>
  )
}

// --- test from this device -------------------------------------------------
//
// check-host's Iranian probes all sit in datacenters, so a name they find open
// can still be filtered on a mobile operator. The admin's browser, on whatever
// network the laptop is on, is the vantage point that closes that gap. A
// browser can only reach the site itself — it can't send a chosen SNI to the
// node's IP — so this answers "does my operator let this name through, and
// how quickly", not "how fast is the tunnel"; the field test below does that.
//
// no-cors: the response is opaque, but the fetch resolves on any HTTP answer
// (even a 404) and rejects on a reset, a failed handshake or a timeout —
// exactly the ways SNI filtering shows. no-referrer, so the sites tested never
// learn the panel's address.

type DeviceResult = { ok: boolean; ms: number | null }

async function probeOnce(host: string, timeoutMs: number): Promise<number | null> {
  const ctl = new AbortController()
  const timer = window.setTimeout(() => ctl.abort(), timeoutMs)
  const t0 = performance.now()
  try {
    await fetch(`https://${host}/favicon.ico?tifusi=${Math.random().toString(36).slice(2)}`, {
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: ctl.signal,
    })
    return Math.round(performance.now() - t0)
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

/** The first request carries the TLS handshake with the SNI — where filtering
 *  acts — so it is the one timed. A second try before calling a name blocked,
 *  so one lost packet on a mobile link doesn't read as filtering. */
async function probeHost(host: string): Promise<DeviceResult> {
  const first = (await probeOnce(host, 8000)) ?? (await probeOnce(host, 8000))
  return { ok: first != null, ms: first }
}

function speed(bps: number) {
  const mbit = (bps * 8) / 1e6
  return mbit >= 1 ? `${mbit.toFixed(1)} Mbps` : `${Math.round((bps * 8) / 1000)} Kbps`
}

function kb(n: number) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

// --- operator pattern -------------------------------------------------------
//
// "Fine on TCI, poor on MCI" while the device test shows MCI leaving most of
// the SNIs open says the SNI is not what MCI is judging. The two things every
// earlier test held fixed are the suspects: the port — always a random high
// one, where no real HTTPS server lives — and whether the throttling is on
// the upload rather than the download, which is what MCI is documented to do
// (a download that looks fine next to an upload stuck under 1 Mbps).
//
// So: one borrowed SNI across several standard HTTPS ports and a random one,
// a second borrowed SNI to tell a bad name from a bad port, and upload read
// separately from download. Each config differs from another in one thing
// only, so comparing them on the phone names the pattern.
//
// The admin's own domain was tried here as a "no IP/SNI mismatch" control and
// the answer came back clear: it never connected from MCI at all, while
// borrowed names did. Under a whitelist a fresh unknown domain is the worst
// name to carry, and announcing your own is also the opposite of what REALITY
// is for — so borrowed SNIs only.

type Finding = 'port' | 'xhttp' | 'upload' | 'route' | 'none' | 'unclear'

const upRate = (i: FieldTestItem) => i.up_avg_bps || i.up_bps

// The sustained rate where there is one, since an operator's opening burst
// makes the peak flatter every config alike; the peak only stands in when the
// transfer was too short to average. 1 means it connected but carried nothing.
const rate = (i: FieldTestItem) => i.down_avg_bps || i.down_bps
const worth = (i: FieldTestItem) => (rate(i) > 0 ? rate(i) : i.ok ? 1 : 0)

function patternVerdict(items: FieldTestItem[]): Finding[] | null {
  if (!items.some((i) => i.clients > 0)) return null
  const best = (label: string) => Math.max(-1, ...items.filter((i) => i.label === label).map(worth))
  // x clearly better than y: works where y doesn't, or at least twice as fast.
  // -1 means that config wasn't in the test, so there is nothing to compare.
  const beats = (x: number, y: number) => y >= 0 && x > 0 && (y === 0 || (x > 1 && y > 1 && x >= 2 * y))
  const nr = best('a:random:tcp'), ns = best('a:std:tcp')
  const xr = best('a:random:xhttp'), xs = best('a:std:xhttp')
  if (Math.max(...items.map(worth)) === 0) return ['none']
  const found: Finding[] = []
  if (beats(ns, nr) || beats(xs, xr)) found.push('port')
  // Same name, same kind of port, different transport: anything left is the
  // transport itself — which is the one lever nobody has pulled here yet.
  if (beats(xs, ns) || beats(xr, nr)) found.push('xhttp')
  // A download worth having beside an upload stuck under 1 Mbps is the shape
  // MCI's documented throttle leaves. Only judged where both were measured.
  const measured = items.filter((i) => rate(i) >= 250000 && upRate(i) > 0)
  if (measured.length && measured.every((i) => upRate(i) < 125000)) found.push('upload')
  const speeds = items.filter((i) => rate(i) > 0).map(rate)
  // Everything connects, nothing is faster than about 1 Mbps: neither lever
  // mattered, the address or the route to it did.
  if (!found.length && speeds.length >= 2 && Math.max(...speeds) < 125000) found.push('route')
  return found.length ? found : ['unclear']
}

// Throwaway inbounds on the node, one per SNI. Iranian DPI throttles names
// it doesn't block, so this is the only place a target's real speed is
// measured rather than inferred.
function FieldTestPanel({ nodeId, candidates, onPick, picked }: { nodeId: number; candidates: RealityCandidate[]; onPick: (c: RealityCandidate) => void; picked?: string }) {
  const { t } = useLang()
  const ft = t.ui.realityScan.field
  const [test, setTest] = useState<FieldTest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const next = await getFieldTest(nodeId)
        if (alive) setTest(next.items.length ? next : null)
      } catch {
        /* the node may run an older agent; the start button reports it */
      }
      if (alive) timer.current = window.setTimeout(tick, 3000)
    }
    tick()
    return () => {
      alive = false
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [nodeId])

  const top = candidates.slice(0, 10)
  const topKey = top.map((c) => c.host).join(',')
  const autoFor = useRef<string | null>(null)

  // No button: as soon as a scan has finished, its best sites get test
  // configs — unless the running test already covers exactly those sites.
  useEffect(() => {
    if (!topKey || autoFor.current === topKey) return
    autoFor.current = topKey
    getFieldTest(nodeId)
      .then((cur) => {
        // Never replace a running operator-pattern test: the phone is using it.
        if (cur.active && cur.items.some((i) => i.label)) return
        const same = cur.active && cur.items.map((i) => i.host).sort().join(',') === topKey.split(',').sort().join(',')
        if (!same) return run(() => startFieldTest(nodeId, top.map((c) => ({ host: c.host, dest: c.dest }))))
      })
      .catch(() => run(() => startFieldTest(nodeId, top.map((c) => ({ host: c.host, dest: c.dest })))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, topKey])

  async function run(fn: () => Promise<FieldTest>) {
    setBusy(true)
    setError(null)
    try {
      setTest(await fn())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setBusy(false)
    }
  }

  async function copy(key: string, text: string) {
    if (await copyToClipboard(text)) setCopied(key)
  }

  // What the QR shows. Sending the link to the phone over Telegram means
  // turning a VPN on, which spoils a test that must run without one — so
  // the phone scans it off this screen instead. 'all' packs every config
  // into one code, which also imports without the phone reaching the panel.
  const [qr, setQr] = useState<'all' | 'sub' | string>('all')

  async function startPattern() {
    const [a, b] = candidates
    if (!a) return
    // One name across the ports, so a difference can only be the port; then a
    // second name on one standard port and one random one, so a difference
    // there is the name. A port already in use (the live inbound, say) falls
    // back to another standard one on the node.
    const targets: FieldTarget[] = [
      { host: a.host, dest: a.dest, port: null, label: 'a:random:tcp' },
      { host: a.host, dest: a.dest, port: 2083, label: 'a:std:tcp' },
      { host: a.host, dest: a.dest, port: 8443, label: 'a:std:tcp' },
      // The same name and the same kinds of port again, carried by XHTTP
      // instead of raw TCP, so the transport can be read on its own.
      { host: a.host, dest: a.dest, port: null, label: 'a:random:xhttp', transport: 'xhttp' },
      { host: a.host, dest: a.dest, port: 2087, label: 'a:std:xhttp', transport: 'xhttp' },
    ]
    if (b) targets.push({ host: b.host, dest: b.dest, port: 2096, label: 'b:std:tcp' }, { host: b.host, dest: b.dest, port: null, label: 'b:random:tcp' })
    await run(() => startFieldTest(nodeId, targets))
  }

  // A QR code tops out near 2.9 KB and grows too dense to scan off a screen
  // well before that; ten configs in one code can pass it, so past this the
  // "all" option is withdrawn and the subscription link is offered instead.
  const allValue = (test?.items ?? []).map((i) => i.link).join('\n')
  const allFits = new TextEncoder().encode(allValue).length <= 2000
  const qrShown = qr === 'all' && !allFits ? (test?.sub_url ? 'sub' : test?.items[0]?.link ?? '') : qr

  const pattern = !!test?.items.some((i) => i.label)
  const findings = pattern && test ? patternVerdict(test.items) : null
  const operatorsSeen = [...new Set((test?.items ?? []).flatMap((i) => i.operators ?? []))]
  const opName = (op: string) => t.ui.realityScan.device.ops[op] ?? op

  const left = test?.active && test.expires_at ? Math.max(0, Math.round((test.expires_at * 1000 - Date.now()) / 60000)) : null
  // Upload first once the test measured any: on MCI the download is fine through
  // nearly every SNI and the upload is what separates them, so ranking by
  // download put a name that cannot send at the top.
  const byUp = !!test?.items.some((i) => upRate(i) > 0)
  const items = test
    ? [...test.items].sort((a, b) => (byUp ? upRate(b) - upRate(a) : 0) || rate(b) - rate(a) || Number(b.ok) - Number(a.ok) || b.down - a.down)
    : []
  const fastest = rate(items[0] ?? ({} as FieldTestItem)) ? items[0].host : null

  return (
    <div className="form-section">
      <b style={{ fontSize: '0.9rem' }}>🇮🇷 {ft.title}</b>
      <div className="hint" style={{ margin: 0 }}>{ft.intro}</div>
      {top.length === 0 && !test && <div className="hint" style={{ margin: 0 }}>{ft.none}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {candidates.length > 0 && (
          <button type="button" className="btn solid" disabled={busy} onClick={startPattern}>
            🧪 {ft.pattern.start}
          </button>
        )}
        {test?.active && (
          <button type="button" className="btn" disabled={busy} onClick={() => run(() => stopFieldTest(nodeId))}>
            {ft.stop}
          </button>
        )}
      </div>
      {pattern && <div className="hint" style={{ margin: 0 }}>{ft.pattern.howto}</div>}
      {error && <div className="tf-alert">{error}</div>}
      {test?.active && test.items.length > 0 && (
        <div className="form-section" style={{ alignItems: 'center' }}>
          <b style={{ fontSize: '0.88rem' }}>{ft.qr.title}</b>
          <div className="tf-seg" role="group" aria-label={ft.qr.title}>
            {allFits && (
              <button type="button" aria-pressed={qrShown === 'all'} onClick={() => setQr('all')}>
                {ft.qr.all(test.items.length)}
              </button>
            )}
            {test.sub_url && (
              <button type="button" aria-pressed={qrShown === 'sub'} onClick={() => setQr('sub')}>
                {ft.qr.sub}
              </button>
            )}
          </div>
          <div className="tf-qr">
            <QRCodeSVG
              value={qrShown === 'all' ? allValue : qrShown === 'sub' ? test.sub_url ?? '' : qrShown}
              size={qrShown === 'all' ? 340 : 240}
              level="L"
            />
          </div>
          <div className="hint" style={{ margin: 0, textAlign: 'center' }}>
            {qrShown === 'all' ? ft.qr.allHint : qrShown === 'sub' ? ft.qr.subHint : ft.qr.oneHint(test.items.find((i) => i.link === qrShown)?.host ?? '', test.items.find((i) => i.link === qrShown)?.port ?? 0)}
          </div>
        </div>
      )}
      {test?.active && test.sub_url && (
        <>
          <span className="hint" style={{ margin: 0 }}>
            {ft.sub} {left != null && `(${ft.left(left)})`}
          </span>
          <code className="cdt-cmd" dir="ltr">{test.sub_url}</code>
          <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => copy('sub', test.sub_url!)}>
            {copied === 'sub' ? t.common.copiedCheck : ft.copy}
          </button>
        </>
      )}
      {test && !test.active && <div className="hint" style={{ margin: 0 }}>{ft.ended}</div>}
      {pattern && (
        <>
          <ul className="rsc-list">
            {[...(test?.items ?? [])].sort((a, b) => worth(b) - worth(a)).map((it) => {
              const [, port] = (it.label ?? '::').split(':')
              return (
                <li key={`${it.host}:${it.port}`} className={`rsc-row ${it.ok ? 'best' : ''}`}>
                  <div className="rsc-head">
                    <div className="rsc-name">
                      <b className="mono">{it.host}</b>
                      <small>
                        <span className="chip">{port === 'std' ? ft.pattern.std(it.port) : ft.pattern.random(it.port)}</span>
                        <span className="chip">{it.transport === 'xhttp' ? 'XHTTP' : 'TCP + Vision'}</span>
                        {!!it.operators?.length && <span>{it.operators.map(opName).join('، ')}</span>}
                      </small>
                    </div>
                    <div className="rsc-side">
                      {rate(it) > 0 ? (
                        <span className={`pill en ${upRate(it) > 0 && upRate(it) < 125000 ? 'warn' : 'ok'}`} dir="ltr" title={ft.avgTitle}>
                          <i />↓ {speed(rate(it))} · ↑ {upRate(it) > 0 ? speed(upRate(it)) : '—'}
                        </span>
                      ) : it.ok ? (
                        <span className="pill warn"><i />{ft.pattern.connected}</span>
                      ) : (
                        <span className={`pill ${test?.active ? 'info live' : 'bad'}`}><i />{test?.active ? ft.waiting : '✕'}</span>
                      )}
                      {test?.active && (
                        <>
                          <button type="button" className={`btn ${qrShown === it.link ? 'on' : ''}`} onClick={() => setQr(it.link)}>
                            {ft.qr.one}
                          </button>
                          <button type="button" className="btn" onClick={() => copy(`${it.host}:${it.port}`, it.link)}>
                            {copied === `${it.host}:${it.port}` ? t.common.copiedCheck : ft.copyOne}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="form-section">
            <b style={{ fontSize: '0.88rem' }}>
              {ft.pattern.verdictTitle}
              {operatorsSeen.length > 0 && ` — ${operatorsSeen.map(opName).join('، ')}`}
            </b>
            {!findings ? (
              <div className="hint" style={{ margin: 0 }}>{ft.pattern.waitingVerdict}</div>
            ) : (
              findings.map((f) => (
                <div key={f} className={f === 'unclear' ? 'hint' : 'tf-note'} style={{ margin: 0 }}>
                  {ft.pattern.finding[f]}
                </div>
              ))
            )}
          </div>
        </>
      )}
      {!pattern && items.length > 0 && (
        <ul className="rsc-list">
          {items.map((it) => {
            const cand = candidates.find((c) => c.host === it.host)
            return (
              <li key={it.host} className={`rsc-row ${it.ok ? 'best' : ''}`}>
                <div className="rsc-head">
                  <div className="rsc-name">
                    <b className="mono">{it.host}</b>
                    <small>
                      <span className="mono">:{it.port}</span>
                      {!!it.operators?.length && <span>{it.operators.map(opName).join('، ')}</span>}
                    </small>
                  </div>
                  <div className="rsc-side">
                    {it.host === fastest && <span className="pill accent">★ {ft.fastest}</span>}
                    {rate(it) > 0 ? (
                      <span className="pill ok en" dir="ltr" title={ft.avgTitle}>
                        <i />↓ {speed(rate(it))}
                        {it.down_avg_bps ? ` · ${ft.peak} ${speed(it.down_bps)}` : ''}
                      </span>
                    ) : it.ok ? (
                      <span className="pill warn"><i />{ft.ok(kb(it.down + it.up), it.clients)}</span>
                    ) : (
                      <span className={`pill ${test?.active ? 'info live' : 'bad'}`}><i />{test?.active ? ft.waiting : '✕'}</span>
                    )}
                    {test?.active && (
                      <>
                        <button type="button" className={`btn ${qrShown === it.link ? 'on' : ''}`} onClick={() => setQr(it.link)}>
                          {ft.qr.one}
                        </button>
                        <button type="button" className="btn" onClick={() => copy(it.host, it.link)}>
                          {copied === it.host ? t.common.copiedCheck : ft.copyOne}
                        </button>
                      </>
                    )}
                    {it.ok && cand && (
                      <button type="button" className={`btn ${picked === it.host ? 'on' : 'solid'}`} onClick={() => onPick(cand)}>
                        {picked === it.host ? t.ui.realityScan.used : t.ui.realityScan.use}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function RealityScanner({ onPick, onClose, picked }: { onPick: (c: RealityCandidate) => void; onClose: () => void; picked?: string }) {
  const { t } = useLang()
  const rs = t.ui.realityScan
  const [nodes, setNodes] = useState<Node[] | null>(null)
  const [nodeId, setNodeId] = useState<number | null>(null)
  const [scan, setScan] = useState<RealityNodeScan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const timer = useRef<number | null>(null)
  // operator -> host -> result: kept per operator, so testing on MCI and then
  // on Irancell shows both side by side instead of the second replacing the first.
  const [device, setDevice] = useState<Record<string, Record<string, DeviceResult>>>({})
  const [deviceNet, setDeviceNet] = useState<{ ip: string; operator: string | null } | null>(null)
  const [deviceBusy, setDeviceBusy] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    listNodes()
      .then((r) => {
        setNodes(r.nodes)
        if (r.nodes.length) setNodeId(r.nodes[0].id)
      })
      .catch(() => setNodes([]))
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  // Pick up where the node is: a refresh, a closed tab or another device used
  // to lose a finished (or half-finished) scan and cost fifteen minutes to
  // redo. Only when this page hasn't started one of its own.
  const restored = useRef<number | null>(null)
  const scanRef = useRef<RealityNodeScan | null>(null)
  scanRef.current = scan
  useEffect(() => {
    if (nodeId == null || restored.current === nodeId) return
    restored.current = nodeId
    getNodeRealityScan(nodeId)
      .then((s) => {
        if (s.state === 'idle' || !s.results.length || scanRef.current) return
        setScan(s)
        const stillIran = s.node_iran?.verdict === 'checking' || s.results.some((r) => r.iran?.verdict === 'checking')
        if (!['done', 'error'].includes(s.state) || stillIran) poll(nodeId)
      })
      .catch(() => {
        /* an older agent or an unreachable node: the start button reports it */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  const busy = !!scan && !['done', 'error', 'idle'].includes(scan.state)

  function poll(id: number) {
    timer.current = window.setTimeout(async () => {
      try {
        const next = await getNodeRealityScan(id)
        setScan(next)
        const stillIran = next.node_iran?.verdict === 'checking' || next.results.some((r) => r.iran?.verdict === 'checking')
        if (!['done', 'error'].includes(next.state) || stillIran) poll(id)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t.common.genericError)
      }
    }, POLL_MS)
  }

  async function start() {
    if (timer.current) window.clearTimeout(timer.current)
    if (nodeId == null) return
    setError(null)
    setShowAll(false)
    try {
      setScan(await startNodeRealityScan(nodeId))
      poll(nodeId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  const results = scan?.results ?? []
  const usable = results.filter((r) => r.usable)
  const checkingIran = !!scan && (scan.node_iran?.verdict === 'checking' || results.some((r) => r.iran?.verdict === 'checking'))

  // Open from every Iranian city that answered is the entry condition, not a
  // score: a filtered name is not a slower target, it is no target. Among
  // those, speed decides — how fast Iran reaches the name first, then the
  // node->target handshake REALITY waits on for every new connection.
  const iranMs = (r: RealityCandidate) => r.iran?.ms ?? UNKNOWN
  // "Works well while it's open" comes before "fast": a target that drops
  // handshakes under load, or shuts the node out once it has seen enough of
  // them, breaks users' connections however quick it is when idle.
  const good = usable
    .filter((r) => r.iran?.verdict === 'open')
    .sort(
      (a, b) =>
        Number(b.fingerprints?.chrome?.ok ?? 0) - Number(a.fingerprints?.chrome?.ok ?? 0) ||
        reliability(a.stress) - reliability(b.stress) ||
        iranMs(a) - iranMs(b) ||
        (a.latency_ms ?? UNKNOWN) - (b.latency_ms ?? UNKNOWN),
    )
  // A name the admin's own operator blocks sinks below the rest on screen.
  // Only the display order: the field test keeps getting `good` as it is, so
  // a device test never swaps its configs out from under a phone mid-test.
  const blockedHere = (r: RealityCandidate) => Object.values(device).some((byHost) => byHost[r.host]?.ok === false)
  const ranked = [...good].sort((a, b) => Number(blockedHere(a)) - Number(blockedHere(b)))
  // Ten on screen: past that a list of maybes buries the tests below it.
  const TOP = 10
  const shown = showAll ? [...results].sort((a, b) => Number(!a.usable) - Number(!b.usable) || iranMs(a) - iranMs(b)) : ranked.slice(0, TOP)

  async function whoami() {
    try {
      setDeviceNet(await getRealityWhoami())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  async function testDevice(operator: string) {
    const hosts = good.slice(0, 20).map((r) => r.host)
    setDeviceBusy({ done: 0, total: hosts.length })
    const out: Record<string, DeviceResult> = {}
    let next = 0
    // Four at a time: quick, and too few to skew each other on a phone link.
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (next < hosts.length) {
          const host = hosts[next++]
          out[host] = await probeHost(host)
          setDeviceBusy((b) => (b ? { ...b, done: b.done + 1 } : b))
        }
      }),
    )
    setDevice((d) => ({ ...d, [operator]: out }))
    setDeviceBusy(null)
  }

  const pct = scan && scan.phase_total ? Math.round((scan.phase_done / scan.phase_total) * 100) : busy ? 5 : 100
  const PHASES = ['discovering', 'validating', 'checking', 'testing', 'done'] as const
  const phaseIndex = scan?.state === 'done' ? PHASES.length : PHASES.indexOf(scan?.state as (typeof PHASES)[number])

  return (
    <Sheet title={rs.title} sub={rs.sub} onClose={onClose} width={760} footer={<button type="button" className="btn lg" onClick={onClose}>{t.usersPage.cancelAction}</button>}>
      <div className="rsc">
        {nodes !== null && nodes.length === 0 ? (
          <div className="tf-note">{rs.noNodes}</div>
        ) : (
          <>
            <div className="rsc-controls">
              <label className="rsc-node">
                <span>{rs.node}</span>
                <select id="rsc-node" className="input" value={nodeId ?? ''} onChange={(e) => setNodeId(Number(e.target.value))} disabled={busy}>
                  {(nodes ?? []).map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} — {n.address}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="hint" style={{ margin: 0 }}>{rs.intro}</div>
            {/* Every scan walks one ring further out and skips what has been
                seen, so "again" is always the next range — there is no button
                that re-reads the same neighbours. */}
            <button type="button" className="btn primary lg" onClick={start} disabled={busy || nodeId == null}>
              {busy ? rs.phase[scan!.state] : scan ? rs.more : rs.start}
            </button>
          </>
        )}

        {error && <div className="tf-alert">{error}</div>}

        {scan && (
          <>
            <div className="rsc-node-iran">
              <span>{rs.nodeIran}</span>
              <IranPill check={scan.node_iran} />
            </div>
            {scan.node_iran?.verdict === 'blocked' && <div className="tf-alert">{rs.nodeBlockedWarn}</div>}

            <div className="rsc-progress" aria-live="polite">
              <ol className="rsc-steps">
                {PHASES.slice(0, 4).map((s, i) => (
                  <li key={s} className={i < phaseIndex ? 'done' : i === phaseIndex ? 'now' : ''}>
                    <span className="d">{i < phaseIndex ? '✓' : i + 1}</span>
                    {rs.phase[s]}
                  </li>
                ))}
              </ol>
              {busy && (
                <div className="rsc-bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
              )}
              <div className="hint" style={{ margin: 0 }}>
                {rs.found(usable.length, results.length)}
                {checkingIran ? ` · ${rs.iran.checking}` : ''}
              </div>
              {scan.blocks && scan.blocks.length > 0 && (
                <div className="hint" style={{ margin: 0 }}>
                  {rs.ring((scan.ring ?? 0) + 1)} ·{' '}
                  <span className="en" dir="ltr">
                    {scan.blocks.join(' , ')}
                  </span>
                  {scan.seen_total ? ` · ${rs.seenTotal(scan.seen_total)}` : ''}
                </div>
              )}
              {scan.state === 'error' && scan.error && <div className="tf-alert">{scan.error}</div>}
            </div>

            {good.length > 0 && (
              <div className="form-section">
                <b style={{ fontSize: '0.9rem' }}>📱 {rs.device.title}</b>
                <div className="hint" style={{ margin: 0 }}>{rs.device.intro}</div>
                {deviceNet &&
                  (deviceNet.operator ? (
                    <div className="hint" style={{ margin: 0 }}>{rs.device.net(rs.device.ops[deviceNet.operator] ?? deviceNet.operator, deviceNet.ip)}</div>
                  ) : (
                    <div className="tf-alert">{rs.device.notIran(deviceNet.ip)}</div>
                  ))}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!deviceNet ? (
                    <button type="button" className="btn solid" onClick={whoami}>
                      {rs.device.check}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn solid"
                        disabled={!!deviceBusy}
                        onClick={() => testDevice(deviceNet.operator ?? 'unknown')}
                      >
                        {deviceBusy
                          ? rs.device.running(deviceBusy.done, deviceBusy.total)
                          : deviceNet.operator
                            ? rs.device.run(good.slice(0, 20).length)
                            : rs.device.runAnyway}
                      </button>
                      <button type="button" className="btn" disabled={!!deviceBusy} onClick={whoami}>
                        {rs.device.recheck}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
            {shown.length > 0 && <div className="hint" style={{ margin: 0 }}>{rs.legend}</div>}
            <ul className="rsc-list">
              {shown.map((r, i) => {
                const best = !showAll && i === 0
                const st = fpStats(r)
                return (
                  <li key={r.host} className={`rsc-row ${r.usable ? '' : 'bad'} ${best ? 'best' : ''}`}>
                    <div className="rsc-head">
                      <div className="rsc-name">
                        <b className="mono">{r.host}</b>
                        <small>
                          {r.dest && <span className="mono">{r.dest}</span>}
                          {r.iran?.ms != null && (
                            <span className="en" dir="ltr" title={rs.iranMsTitle}>
                              🇮🇷 {r.iran.ms} ms
                            </span>
                          )}
                          {r.usable && r.rtt_ms != null ? (
                            <span className="en" dir="ltr" title={rs.pingTitle}>
                              ping {r.rtt_ms} ms · TLS {r.latency_ms} ms
                            </span>
                          ) : (
                            r.latency_ms != null && <span className="en" dir="ltr">{r.latency_ms} ms</span>
                          )}
                          {r.usable ? <span className="en">TLS 1.3 · h2</span> : <span className="err-text">{r.error}</span>}
                        </small>
                      </div>
                      <div className="rsc-side">
                        {best && <span className="pill accent">★ {rs.best}</span>}
                        {Object.entries(device).map(([op, byHost]) => {
                          const d = byHost[r.host]
                          if (!d) return null
                          const name = rs.device.ops[op] ?? rs.device.unknown
                          return (
                            <span key={op} className={`pill ${d.ok ? 'ok' : 'bad'}`} title={rs.device.pillTitle}>
                              <i />
                              {d.ok ? rs.device.ok(name, d.ms!) : rs.device.blocked(name)}
                            </span>
                          )
                        })}
                        {r.usable && <StressPill s={r.stress} />}
                        {r.usable && <IranPill check={r.iran} />}
                        {r.usable && (
                          <button type="button" className={`btn ${picked === r.host ? 'on' : 'solid'}`} onClick={() => onPick(r)}>
                            {picked === r.host ? rs.used : rs.use}
                          </button>
                        )}
                      </div>
                    </div>
                    {r.usable &&
                      (r.fingerprints ? (
                        <div className="rsc-fps">
                          {rankedFps(r).map(([fp, v]) => {
                            const cls = v?.ok == null ? 'wait' : v.ok ? 'ok' : 'no'
                            const tag = fp === st.fastest ? 'fast' : fp === st.slowest ? 'slow' : ''
                            return (
                              <span key={fp} className={`fp ${cls} ${tag}`} title={tag === 'fast' ? rs.fastest : tag === 'slow' ? rs.slowest : undefined}>
                                {tag === 'fast' ? '⚡' : tag === 'slow' ? '🐢' : cls === 'wait' ? '…' : cls === 'ok' ? '✓' : '✕'} {fp}
                                {cls === 'ok' && v?.ms != null && <em>{v.ms}ms</em>}
                              </span>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="hint" style={{ margin: 0 }}>{rs.notTested}</div>
                      ))}
                    {r.usable && r.fingerprints && (st.even || st.fastest) && (
                      <div className="hint" style={{ margin: 0 }}>
                        {st.even ? rs.fpEven : rs.fpSpread(st.fastest!, st.slowest!)}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            {nodeId != null && scan.state === 'done' && (
              <FieldTestPanel nodeId={nodeId} candidates={good} onPick={onPick} picked={picked} />
            )}
            {scan.state === 'done' && !checkingIran && good.length === 0 && !showAll && <div className="tf-alert">{rs.noneGood}</div>}
            {results.length > shown.length && !showAll ? (
              <button type="button" className="btn" onClick={() => setShowAll(true)}>
                {rs.showUnusable(results.length - shown.length)}
              </button>
            ) : showAll && (
              <button type="button" className="btn" onClick={() => setShowAll(false)}>
                {rs.hideUnusable}
              </button>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}
