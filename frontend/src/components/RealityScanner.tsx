import { useEffect, useRef, useState } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  getNodeRealityScan,
  listNodes,
  startNodeRealityScan,
  type IranCheck,
  type Node,
  type RealityCandidate,
  type RealityNodeScan,
} from '../lib/api'
import { Sheet } from './ui'

type Mode = 'neighbors' | 'list' | 'custom'
const FPS = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', '360', 'qq', 'random', 'randomized']
const POLL_MS = 1500

// Fastest/slowest are only called out when the gap is real; measured from
// the node, working fingerprints are usually within a few ms of each other.
function fpStats(r: RealityCandidate) {
  const ok = Object.entries(r.fingerprints ?? {}).filter(([, v]) => v.ok && v.ms != null) as [string, { ok: boolean; ms: number }][]
  if (!ok.length) return { ping: null as number | null, fastest: null as string | null, slowest: null as string | null, even: false }
  const sorted = [...ok].sort((a, b) => a[1].ms - b[1].ms)
  const lo = sorted[0], hi = sorted[sorted.length - 1]
  const real = sorted.length > 1 && hi[1].ms - lo[1].ms >= 15 && hi[1].ms >= lo[1].ms * 1.25
  return { ping: lo[1].ms, fastest: real ? lo[0] : null, slowest: real ? hi[0] : null, even: sorted.length > 1 && !real }
}

function IranPill({ check }: { check: IranCheck | null }) {
  const { t } = useLang()
  const rs = t.ui.realityScan
  if (!check) return <span className="pill idle">🇮🇷 —</span>
  const tone = { open: 'ok', blocked: 'bad', partial: 'warn', unknown: 'idle', checking: 'info live' }[check.verdict]
  const cities = check.checked ? ` · ${rs.cities(check.ok ?? 0, check.checked)}` : ''
  return (
    <span className={`pill ${tone}`} title={(check.cities ?? []).map((c) => `${c.node}: ${c.ok ? '✓' : '✕'}${c.ms ? ` ${c.ms}ms` : ''}`).join('  ')}>
      <i />
      🇮🇷 {rs.iran[check.verdict]}
      {cities}
    </span>
  )
}

export default function RealityScanner({ onPick, onClose, picked }: { onPick: (c: RealityCandidate) => void; onClose: () => void; picked?: string }) {
  const { t } = useLang()
  const rs = t.ui.realityScan
  const [nodes, setNodes] = useState<Node[] | null>(null)
  const [nodeId, setNodeId] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode>('neighbors')
  const [custom, setCustom] = useState('')
  const [scan, setScan] = useState<RealityNodeScan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const timer = useRef<number | null>(null)

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

  const busy = !!scan && !['done', 'error', 'idle'].includes(scan.state)
  const checkingIran = !!scan && (scan.node_iran?.verdict === 'checking' || scan.results.some((r) => r.iran?.verdict === 'checking'))

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
    if (nodeId == null) return
    if (timer.current) window.clearTimeout(timer.current)
    setError(null)
    setShowAll(false)
    try {
      const hosts = mode === 'custom' ? custom.split(/[\s,،]+/).map((h) => h.trim()).filter(Boolean) : []
      setScan(await startNodeRealityScan(nodeId, { mode, hosts }))
      poll(nodeId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  const results = scan?.results ?? []
  const usable = results.filter((r) => r.usable)
  const IRAN_RANK: Record<string, number> = { open: 0, partial: 1, checking: 2, unknown: 2, blocked: 3 }
  const score = (r: RealityCandidate) => [
    r.usable ? 0 : 1,
    IRAN_RANK[r.iran?.verdict ?? 'unknown'],
    r.fingerprints?.chrome?.ok ? 0 : 1,
    -Object.values(r.fingerprints ?? {}).filter((v) => v.ok).length,
    fpStats(r).ping ?? r.latency_ms ?? 1e6,
  ]
  const byScore = (a: RealityCandidate, b: RealityCandidate) => {
    const x = score(a), y = score(b)
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]
    return 0
  }
  const shown = [...(showAll ? results : usable)].sort(byScore)
  const pct = scan && scan.phase_total ? Math.round((scan.phase_done / scan.phase_total) * 100) : busy ? 5 : 100
  const phaseIndex = scan?.state === 'done' ? 4 : ['discovering', 'validating', 'testing', 'done'].indexOf(scan?.state ?? '')

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
              <div className="tf-seg" role="group" aria-label={rs.title}>
                {(['neighbors', 'list', 'custom'] as Mode[]).map((m) => (
                  <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} disabled={busy}>
                    {rs.mode[m]}
                  </button>
                ))}
              </div>
            </div>
            <div className="hint" style={{ margin: 0 }}>
              {rs.modeHint[mode]}
            </div>
            {mode === 'custom' && (
              <input id="rsc-custom" className="input ltr" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={rs.customPlaceholder} disabled={busy} />
            )}
            <button type="button" className="btn primary lg" onClick={start} disabled={busy || nodeId == null || (mode === 'custom' && !custom.trim())}>
              {busy ? rs.phase[scan!.state] : scan ? rs.again : rs.start}
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
                {(['discovering', 'validating', 'testing', 'done'] as const).map((s, i) => (
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
              {scan.state === 'error' && scan.error && <div className="tf-alert">{scan.error}</div>}
            </div>

            {shown.length > 0 && <div className="hint" style={{ margin: 0 }}>{rs.legend}</div>}
            <ul className="rsc-list">
              {shown.map((r, i) => {
                const best = i === 0 && r.usable && !!r.fingerprints?.chrome?.ok && r.iran?.verdict !== 'blocked'
                const st = fpStats(r)
                return (
                  <li key={r.host} className={`rsc-row ${r.usable ? '' : 'bad'} ${best ? 'best' : ''}`}>
                    <div className="rsc-head">
                      <div className="rsc-name">
                        <b className="mono">{r.host}</b>
                        <small>
                          <span className="chip">{rs.source[r.source]}</span>
                          {r.dest && <span className="mono">{r.dest}</span>}
                          {st.ping != null ? (
                            <span className="en" dir="ltr">
                              ping {st.ping} ms
                            </span>
                          ) : (
                            r.latency_ms != null && <span className="en" dir="ltr">{r.latency_ms} ms</span>
                          )}
                          {r.usable ? <span className="en">TLS 1.3 · h2</span> : <span className="err-text">{r.error}</span>}
                        </small>
                      </div>
                      <div className="rsc-side">
                        {best && <span className="pill accent">★ {rs.best}</span>}
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
                          {FPS.map((fp) => {
                            const v = r.fingerprints?.[fp]
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
                    {r.usable &&
                      r.fingerprints &&
                      (st.even || st.fastest) && (
                        <div className="hint" style={{ margin: 0 }}>
                          {st.even ? rs.fpEven : rs.fpSpread(st.fastest!, st.slowest!)}
                        </div>
                      )}
                  </li>
                )
              })}
            </ul>
            {results.length > usable.length && (
              <button type="button" className="btn" onClick={() => setShowAll((v) => !v)}>
                {showAll ? rs.hideUnusable : rs.showUnusable(results.length - usable.length)}
              </button>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}
