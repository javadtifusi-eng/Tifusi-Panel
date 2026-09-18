import { useEffect, useRef, useState } from 'react'
import { useLang } from '../i18n/LangContext'
import { ApiError, getNetworkHealth, type NetworkHealthReport, type OperatorHealth } from '../lib/api'
import { parseServerDate } from '../lib/format'

const RANGES = [
  { hours: 6, key: 'h6' },
  { hours: 24, key: 'h24' },
  { hours: 168, key: 'h168' },
] as const
const SERIES_COLORS = ['var(--cat1)', 'var(--cat2)', 'var(--cat3)']
const STATE_PILL: Record<string, string> = { good: 'ok', warn: 'warn', bad: 'bad', unknown: 'idle' }
const STATE_ICON: Record<string, string> = { good: '✓', warn: '▲', bad: '✕', unknown: '·' }
const REFRESH_MS = 30_000

const W = 720
const H = 220
const M = { t: 10, r: 14, b: 26, l: 42 }

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Counts from the previous value to the new one, so a refresh visibly moves the number.
function AnimatedRate({ value, format }: { value: number | null; format: (v: number | null) => string }) {
  const [shown, setShown] = useState<number | null>(value == null ? null : 0)
  const from = useRef(0)
  useEffect(() => {
    if (value == null) return setShown(null)
    if (reduceMotion()) return setShown(value)
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 900)
      const v = a + (value - a) * (1 - Math.pow(1 - k, 3))
      setShown(v)
      if (k < 1) raf = requestAnimationFrame(step)
      else from.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{format(shown)}</>
}

function Spark({ values, color }: { values: (number | null)[]; color: string }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null)
  if (pts.length < 2) return <svg className="nh-spark" viewBox="0 0 100 28" aria-hidden="true" />
  const n = Math.max(1, values.length - 1)
  const lo = Math.min(...pts.map((p) => p[1]), 0.5)
  const xy = pts.map(([i, v]) => [(i / n) * 100, 26 - ((v - lo) / Math.max(0.05, 1 - lo)) * 22] as const)
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  const last = xy[xy.length - 1]
  return (
    <svg className="nh-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d}L${last[0]},28L${xy[0][0]},28Z`} fill={color} fillOpacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" pathLength={1} className="nh-draw" />
      <circle cx={last[0]} cy={last[1]} r={2.2} fill={color} className="nh-dot" />
    </svg>
  )
}

const STATE_COLOR: Record<string, string> = { good: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', unknown: 'var(--faint)' }

export default function NetworkHealth() {
  const { t, lang } = useLang()
  const nh = t.ui.netHealth
  const [hours, setHours] = useState<number>(24)
  const [data, setData] = useState<NetworkHealthReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  useEffect(() => {
    if (!data || ready) return
    const raf = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(raf)
  }, [data])

  useEffect(() => {
    let alive = true
    const load = () =>
      getNetworkHealth(hours)
        .then((d) => alive && (setData(d), setError(null), setUpdatedAt(Date.now())))
        .catch((err) => alive && setError(err instanceof ApiError ? err.message : nh.fetchError))
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [hours])

  const pct = new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { style: 'percent', maximumFractionDigits: 0 })
  const fmtRate = (r: number | null) => (r == null ? '—' : pct.format(r))
  const opName = (o: Pick<OperatorHealth, 'name_fa' | 'name_en'>) => (lang === 'fa' ? o.name_fa : o.name_en)
  const byKey = new Map((data?.operators ?? []).map((o) => [o.key, o]))

  const n = data?.buckets.length ?? 0
  const x = (i: number) => M.l + (n <= 1 ? 0 : (i * (W - M.l - M.r)) / (n - 1))
  const y = (r: number) => M.t + (1 - r) * (H - M.t - M.b)
  const timeFmt = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-US', data && data.bucket_minutes >= 360 ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit' })
  const labelEvery = n <= 8 ? 1 : Math.ceil(n / 6)

  function path(rates: (number | null)[]): string {
    let d = ''
    let open = false
    rates.forEach((r, i) => {
      if (r == null) {
        open = false
        return
      }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(r).toFixed(1)}`
      open = true
    })
    return d
  }

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = svgRef.current?.getBoundingClientRect()
    if (!box || n === 0) return
    const sx = ((e.clientX - box.left) * W) / box.width
    setHover(Math.max(0, Math.min(n - 1, Math.round(((sx - M.l) / (W - M.l - M.r)) * (n - 1)))))
  }

  const hasData = !!data && (data.attempts > 0 || data.operators.length > 0)
  const known = (data?.operators ?? []).filter((o) => o.attempts > 0 || o.sub_attempts > 0)
  const matrixOps = (data?.operators ?? []).filter((o) => o.attempts > 0)

  return (
    <section className="dcard nh">
      <div className="dcard-head">
        <h2 className="nh-title">
          {nh.title}
          {updatedAt != null && (
            <span className="nh-live">
              <i />
              {nh.live} · {nh.updatedAgo(Math.max(0, Math.round((now - updatedAt) / 1000)))}
            </span>
          )}
        </h2>
        <div className="dseg" role="group" aria-label={nh.title}>
          {RANGES.map((r) => (
            <button key={r.hours} type="button" aria-pressed={hours === r.hours} onClick={() => setHours(r.hours)}>
              {nh.range[r.key]}
            </button>
          ))}
        </div>
      </div>
      <p className="nh-source">{nh.source}</p>

      {error && !data && <p className="nh-empty err-text">{error}</p>}
      {!data && !error && <div className="skel nh-skel" aria-hidden="true" />}
      {data && !hasData && <p className="nh-empty">{nh.empty}</p>}

      {data && hasData && (
        <div className="nh-body">
          <div className="nh-row1">
          <div className="nh-top">
            <div className="nh-overall">
              <span className="lbl">{nh.overall}</span>
              <b className="en">
                <AnimatedRate value={data.rate} format={fmtRate} />
              </b>
              <small>
                {nh.attempts(data.attempts)} · {nh.users(data.users)}
              </small>
            </div>
            <ul className="nh-alerts">
              {data.alerts.length === 0 ? (
                <li className="ok">
                  <span className="ic">✓</span>
                  {nh.allGood}
                </li>
              ) : (
                data.alerts.map((a) => {
                  const op = byKey.get(a.operator)
                  const name = op ? opName(op) : a.operator
                  return (
                    <li key={`${a.kind}-${a.operator}`} className="bad">
                      <span className="ic">!</span>
                      {a.kind === 'drop' ? nh.alertDrop(name, fmtRate(a.previous_rate), fmtRate(a.recent_rate)) : nh.alertSub(name, fmtRate(a.recent_rate))}
                    </li>
                  )
                })
              )}
            </ul>
          </div>

          <div className="nh-ops">
            {known.map((o) => {
              const delta = o.recent_rate != null && o.previous_rate != null ? o.recent_rate - o.previous_rate : null
              return (
              <article key={o.key} className={`nh-op ${o.state}`}>
                <div className="nh-op-top">
                  <b>{opName(o)}</b>
                  <span className={`pill ${STATE_PILL[o.state]}`}>
                    {STATE_ICON[o.state]} {nh.state[o.state]}
                  </span>
                </div>
                <div className="nh-rate-row">
                  <div className="nh-rate en">
                    <AnimatedRate value={o.rate} format={fmtRate} />
                  </div>
                  {delta != null && Math.abs(delta) >= 0.02 && (
                    <span className={`nh-delta ${delta > 0 ? 'up' : 'down'}`} title={nh.vsBefore}>
                      {delta > 0 ? '▲' : '▼'} {pct.format(Math.abs(delta))}
                    </span>
                  )}
                </div>
                <Spark values={o.trend ?? []} color={STATE_COLOR[o.state]} />
                <div className="nh-bar" aria-hidden="true">
                  <i className={o.state} style={{ width: `${ready ? Math.round((o.rate ?? 0) * 100) : 0}%` }} />
                </div>
                <div className="nh-op-meta">
                  <span>{nh.attempts(o.attempts)}</span>
                  <span>{nh.users(o.users)}</span>
                  {o.sub_attempts > 0 && (
                    <span>
                      {nh.subRate} <b className="en">{fmtRate(o.sub_successes / o.sub_attempts)}</b>
                    </span>
                  )}
                </div>
              </article>
              )
            })}
          </div>
          </div>

          <div className="nh-row2">
          {data.series.length > 0 && (
            <div className="nh-chart">
              <div className="nh-sub-head">
                <h3>{nh.chartTitle}</h3>
                <div className="dlegend" style={{ padding: 0, margin: 0 }}>
                  {data.series.map((s, i) => {
                    const op = byKey.get(s.key)
                    return (
                      <span key={s.key}>
                        <span className="lk" style={{ ['--c' as string]: SERIES_COLORS[i] }} />
                        {op ? opName(op) : s.key}
                      </span>
                    )
                  })}
                </div>
              </div>
              <div className="chart-wrap" dir="ltr">
                <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={nh.chartTitle}>
                  {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                    <g key={v}>
                      <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="#1f1f1f" />
                      <text x={M.l - 8} y={y(v) + 4} textAnchor="end" fill="#6b6b6b" fontSize="11" fontFamily="Poppins, sans-serif">
                        {Math.round(v * 100)}%
                      </text>
                    </g>
                  ))}
                  {data.buckets.map((b, i) =>
                    i % labelEvery === 0 || i === n - 1 ? (
                      <text key={b} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fill="#6b6b6b" fontSize="11" fontFamily="Poppins, Vazirmatn, sans-serif">
                        {timeFmt.format(parseServerDate(b))}
                      </text>
                    ) : null,
                  )}
                  {data.series.map((s, i) => (
                    <path key={s.key} d={path(s.rates)} fill="none" stroke={SERIES_COLORS[i]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="nh-draw" />
                  ))}
                  {data.series.map((s, i) => {
                    const last = s.rates.map((r, j) => [r, j] as const).filter(([r]) => r != null).pop()
                    return last ? <circle key={s.key} cx={x(last[1])} cy={y(last[0]!)} r={4} fill={SERIES_COLORS[i]} stroke="#141414" strokeWidth={2} className="nh-dot" /> : null
                  })}
                  {hover != null && (
                    <>
                      <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={H - M.b} stroke="#4a4a4a" />
                      {data.series.map((s, i) =>
                        s.rates[hover] != null ? <circle key={s.key} cx={x(hover)} cy={y(s.rates[hover]!)} r={4} fill={SERIES_COLORS[i]} stroke="#141414" strokeWidth={2} /> : null,
                      )}
                    </>
                  )}
                  <rect x={M.l} y={0} width={W - M.l - M.r} height={H} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
                </svg>
                {hover != null && (
                  <div className="tip" style={{ left: `${(x(hover) / W) * 100}%`, top: 4, transform: `translateX(${hover > n / 2 ? '-105%' : '5%'})` }} dir={lang === 'fa' ? 'rtl' : 'ltr'}>
                    <div className="d">{timeFmt.format(parseServerDate(data.buckets[hover]))}</div>
                    {data.series.map((s, i) => {
                      const op = byKey.get(s.key)
                      return (
                        <div key={s.key} className="nh-tip-row">
                          <span className="lk" style={{ background: SERIES_COLORS[i] }} />
                          {op ? opName(op) : s.key} <b>{fmtRate(s.rates[hover])}</b>
                          <small>({s.attempts[hover]})</small>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {data.protocols.length > 0 && matrixOps.length > 0 && (
            <div className="nh-matrix">
              <h3>{nh.matrixTitle}</h3>
              <div className="nh-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{nh.protocol}</th>
                      {matrixOps.map((o) => (
                        <th key={o.key}>{opName(o)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.protocols.map((p) => (
                      <tr key={p.protocol}>
                        <th className="en">{p.protocol.toUpperCase()}</th>
                        {matrixOps.map((o) => {
                          const cell = p.cells.find((c) => c.operator === o.key)
                          if (!cell || cell.attempts === 0) return <td key={o.key} className="none">—</td>
                          const r = cell.successes / cell.attempts
                          const low = cell.attempts >= 5 && r < 0.75
                          return (
                            <td key={o.key} className={low ? 'low' : ''} style={{ ['--r' as string]: r.toFixed(2) }} title={nh.attempts(cell.attempts)}>
                              {low ? '✕ ' : ''}
                              <span className="en">{pct.format(r)}</span>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </div>
        </div>
      )}
    </section>
  )
}
