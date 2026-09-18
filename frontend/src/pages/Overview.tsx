import { useEffect, useRef, useState, type ReactNode } from 'react'
import ServerGauges from '../components/SystemStats'
import {
  IconAlert,
  IconCheck,
  IconCheckCircle,
  IconClock,
  IconDownload,
  IconLock,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconServer,
  IconUsers,
  IconX,
} from '../components/icons'
import { CountUp, Sparkline } from '../components/ui'
import type { Lang } from '../i18n/dict'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  getTlsStatus,
  getTrafficHistory,
  listCores,
  listGroups,
  listHosts,
  listNodes,
  listRecentAppReports,
  listUsers,
  type Core,
  type Host,
  type Node,
  type ProxyUser,
  type RecentAppReport,
  type TlsStatus,
  type TrafficHistoryPoint,
  type UserStatus,
} from '../lib/api'
import { avatarColor, initials, parseServerDate } from '../lib/format'
import NetworkHealth from '../components/NetworkHealth'

export type OverviewTab = 'users' | 'hosts' | 'groups' | 'nodes' | 'cores' | 'tunnels' | 'settings'

// Every piece of data below is `undefined` while loading, `null` when the
// request failed (or this admin lacks the scope), and the value otherwise.

const STATUS_ORDER: UserStatus[] = ['active', 'limited', 'expired', 'on_hold', 'disabled']

// The owner asked for the gauges' orange family here rather than green.
const STATUS_COLOR: Record<UserStatus, string> = {
  active: '#f97316',
  limited: '#facc15',
  expired: '#ef4444',
  on_hold: '#a3a3a3',
  disabled: '#525252',
}

interface Tone {
  bg: string
  fg: string
}

const TONES = {
  neutral: { bg: '#232323', fg: '#d4d4d4' },
  green: { bg: 'rgba(34,197,94,.14)', fg: '#22c55e' },
  purple: { bg: 'rgba(168,85,247,.14)', fg: '#a855f7' },
  amber: { bg: 'rgba(245,158,11,.14)', fg: '#f59e0b' },
  red: { bg: 'rgba(239,68,68,.14)', fg: '#ef4444' },
} satisfies Record<string, Tone>

// Validated dark categorical slots; a fifth protocol and beyond folds into "other".
const PROTO_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500']
const OTHER_COLOR = '#5c5c5c'

const PERIODS = [7, 14, 30]
const GB = 1024 ** 3
const MB = 1024 ** 2
const DAY = 86400000
const LIST_ROWS = 6

const PROTOCOL_NAMES: Record<string, string> = {
  ikev2: 'IKEv2',
  l2tp: 'L2TP',
  vless: 'VLESS',
  vmess: 'VMess',
  trojan: 'Trojan',
  shadowsocks: 'Shadowsocks',
  hysteria2: 'Hysteria2',
  reality: 'Reality',
  xray: 'Xray',
}

function protocolName(p: string): string {
  return PROTOCOL_NAMES[p.toLowerCase()] ?? p
}

function splitBytes(bytes: number): { value: number; decimals: number; unit: string } {
  if (bytes >= GB) return { value: bytes / GB, decimals: 2, unit: 'GB' }
  if (bytes >= MB) return { value: bytes / MB, decimals: bytes >= 100 * MB ? 0 : 1, unit: 'MB' }
  return { value: 0, decimals: 0, unit: bytes > 0 ? 'MB' : 'GB' }
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// A traffic-history date is a plain YYYY-MM-DD; noon keeps it on the same
// calendar day in every timezone.
function dayDate(date: string): Date {
  return new Date(`${date}T12:00:00`)
}

function countBy<T>(items: T[], key: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function niceStep(raw: number): number {
  if (raw <= 0) return 0.25
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const n = raw / magnitude
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * magnitude
}

function Card({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="dcard">
      <div className="dcard-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function DEmpty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="dempty">
      <div className="grid h-10 w-10 place-items-center rounded-full border border-subtle bg-raised text-faint">{icon}</div>
      <p className="m-0 max-w-xs">{text}</p>
    </div>
  )
}

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="list-row">
          <div className="skel h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="skel h-3 w-24" />
            <div className="skel h-2.5 w-40 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

function Kpi({
  label,
  value,
  decimals = 0,
  unit,
  delta,
  deltaClass = '',
  icon,
  tone,
  spark,
  sparkDot,
}: {
  label: string
  value: number | null | undefined
  decimals?: number
  unit?: string
  delta?: string
  deltaClass?: string
  icon: ReactNode
  tone: Tone
  spark?: number[]
  sparkDot?: string
}) {
  return (
    <div className="kpi">
      <span className="lbl">{label}</span>
      <span className="ico" style={{ background: tone.bg, color: tone.fg }}>
        {icon}
      </span>
      <span className="val">
        {value === undefined ? (
          <span className="skel inline-block h-6 w-14 align-middle" />
        ) : value === null ? (
          '—'
        ) : (
          <>
            <CountUp value={value} decimals={decimals} />
            {unit && <small>{unit}</small>}
          </>
        )}
      </span>
      <span className="foot">
        <span className={`kdelta ${deltaClass}`}>{delta ?? ' '}</span>
        {spark && spark.length > 1 ? <Sparkline values={spark} dot={sparkDot} /> : <span />}
      </span>
    </div>
  )
}

// This period in primary ink, the previous one muted; a crosshair snaps to the nearest day.
function TrafficChart({
  cur,
  prev,
  lang,
  label,
  emptyText,
  names,
}: {
  cur: TrafficHistoryPoint[]
  prev: TrafficHistoryPoint[]
  lang: Lang
  label: string
  emptyText: string
  names: { cur: string; prev: string }
}) {
  const W = 640
  const H = 250
  const P = { l: 44, r: 62, t: 20, b: 30 }
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const n = cur.length
  const max = Math.max(0, ...cur.map((p) => p.total_bytes), ...prev.map((p) => p.total_bytes))
  const unit = max >= GB ? { div: GB, label: 'GB' } : { div: MB, label: 'MB' }
  const maxValue = max / unit.div
  const step = max > 0 ? niceStep(maxValue / 4) : 0.25
  const top = max > 0 ? Math.max(step, Math.ceil(maxValue / step) * step) : 1
  const ticks: number[] = []
  for (let i = 0; i * step <= top + step / 1000; i++) ticks.push(i * step)
  const x = (i: number) => P.l + (n > 1 ? (i * (W - P.l - P.r)) / (n - 1) : 0)
  const y = (v: number) => H - P.b - (v / top) * (H - P.t - P.b)
  const labelEvery = n <= 7 ? 1 : n <= 14 ? 2 : 5
  const dayFormat = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian-nu-latn' : 'en-US', { month: '2-digit', day: '2-digit' })
  const longFormat = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US', { day: 'numeric', month: 'long' })
  const curV = cur.map((p) => p.total_bytes / unit.div)
  // Align the previous period to this one from the end, so "day 3 of 14" lines up.
  const prevV = cur.map((_, i) => {
    const j = prev.length - n + i
    return j >= 0 ? prev[j].total_bytes / unit.div : null
  })
  const path = (vals: (number | null)[]) =>
    vals
      .map((v, i) => (v === null ? '' : `${i && vals[i - 1] !== null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .join(' ')
  const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))
  const font = 'Poppins, Vazirmatn, sans-serif'
  const last = n - 1

  function onMove(e: React.PointerEvent) {
    const svg = svgRef.current
    if (!svg || n < 2) return
    const r = svg.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    if (px < P.l - 10 || px > W - P.r + 10) return setHover(null)
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (n - 1)))))
  }

  const scale = svgRef.current ? svgRef.current.getBoundingClientRect().width / W : 1
  const hv = hover !== null ? { c: curV[hover], p: prevV[hover] } : null

  return (
    <div className="relative" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={P.l} x2={W - P.r} y1={y(tick)} y2={y(tick)} stroke="#1c1c1c" />
            <text x={P.l - 8} y={y(tick) + 4} fill="#5c5c5c" fontSize={10} textAnchor="end" fontFamily={font}>
              {String(Number(tick.toFixed(2)))}
            </text>
          </g>
        ))}
        {cur.map((p, i) =>
          (last - i) % labelEvery === 0 ? (
            <text key={p.date} x={x(i)} y={H - 10} fill="#5c5c5c" fontSize={10} textAnchor="middle" fontFamily={font}>
              {dayFormat.format(dayDate(p.date))}
            </text>
          ) : null,
        )}
        <text x={P.l} y={P.t - 8} fill="#5c5c5c" fontSize={10} fontFamily={font}>
          {unit.label}
        </text>
        {max > 0 && n > 1 && (
          <>
            <path d={`${path(curV)} L${x(last)},${y(0)} L${x(0)},${y(0)} Z`} fill="#e5e5e5" fillOpacity={0.1} />
            <path d={path(prevV)} fill="none" stroke="#5c5c5c" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={path(curV)} fill="none" stroke="#e5e5e5" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={x(last)} cy={y(curV[last])} r={4.5} fill="#f97316" stroke="#0e0e0e" strokeWidth={2} />
            <text x={x(last) + 9} y={y(curV[last]) + 4} fill="#f5f5f5" fontSize={11} fontFamily={font}>
              {`${fmt(curV[last])} ${unit.label}`}
            </text>
          </>
        )}
        {hover !== null && hv && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="#404040" />
            {hv.p !== null && <circle cx={x(hover)} cy={y(hv.p)} r={4} fill="#5c5c5c" stroke="#0e0e0e" strokeWidth={2} />}
            <circle cx={x(hover)} cy={y(hv.c)} r={4} fill="#e5e5e5" stroke="#0e0e0e" strokeWidth={2} />
          </>
        )}
        {max === 0 && (
          <text x={(P.l + W - P.r) / 2} y={(P.t + H - P.b) / 2} fill="#8b8b8b" fontSize={12} textAnchor="middle" fontFamily="Vazirmatn, Poppins, sans-serif">
            {emptyText}
          </text>
        )}
      </svg>
      {hover !== null && hv && (
        <div
          className="tip"
          style={{
            left: Math.min(Math.max(8, x(hover) * scale + 12), Math.max(8, W * scale - 160)),
            top: Math.max(4, y(Math.max(hv.c, hv.p ?? 0)) * scale - 64),
          }}
        >
          <div className="d">{longFormat.format(dayDate(cur[hover].date))}</div>
          <div>
            <span className="lk" style={{ background: '#e5e5e5' }} />
            <b>{`${fmt(hv.c)} ${unit.label}`}</b> {names.cur}
          </div>
          {hv.p !== null && (
            <div>
              <span className="lk" style={{ background: '#5c5c5c' }} />
              <b>{`${fmt(hv.p)} ${unit.label}`}</b> {names.prev}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusDonut({
  counts,
  labels,
  unitLabel,
  ariaLabel,
  onPick,
}: {
  counts: Record<UserStatus, number>
  labels: Record<UserStatus, string>
  unitLabel: string
  ariaLabel: string
  onPick?: () => void
}) {
  const [hot, setHot] = useState<UserStatus | null>(null)
  const total = STATUS_ORDER.reduce((sum, s) => sum + counts[s], 0)
  const R = 58
  const C = 2 * Math.PI * R
  const GAP = total > 0 && STATUS_ORDER.filter((s) => counts[s] > 0).length > 1 ? 2 : 0
  let offset = 0
  const arcs = STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => {
    const len = (counts[s] / total) * C
    const el = (
      <circle
        key={s}
        className={`seg-arc ${hot === s ? 'hot' : ''}`}
        cx={85}
        cy={85}
        r={R}
        fill="none"
        stroke={STATUS_COLOR[s]}
        strokeWidth={20}
        strokeDasharray={`${Math.max(0, len - GAP)} ${C - Math.max(0, len - GAP)}`}
        strokeDashoffset={-offset}
        transform="rotate(-90 85 85)"
        onPointerEnter={() => setHot(s)}
        onPointerLeave={() => setHot(null)}
      />
    )
    offset += len
    return el
  })

  return (
    <div className={`donut-box ${hot ? 'hovering' : ''}`}>
      <svg width={170} height={170} viewBox="0 0 170 170" role="img" aria-label={`${ariaLabel}: ${total}`}>
        <circle cx={85} cy={85} r={R} fill="none" stroke="#1f1f1f" strokeWidth={20} />
        {arcs}
        <text x={85} y={84} fill="#f5f5f5" fontSize={26} fontWeight={600} textAnchor="middle" fontFamily="Poppins, sans-serif">
          {hot ? counts[hot] : total}
        </text>
        <text x={85} y={104} fill="#8b8b8b" fontSize={11} textAnchor="middle" fontFamily="Vazirmatn, Poppins, sans-serif">
          {hot ? labels[hot] : unitLabel}
        </text>
      </svg>
      <div className="status-rows">
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            className={hot === s ? 'hot' : ''}
            onPointerEnter={() => setHot(s)}
            onPointerLeave={() => setHot(null)}
            onFocus={() => setHot(s)}
            onBlur={() => setHot(null)}
            onClick={onPick}
          >
            <span className="sw" style={{ background: STATUS_COLOR[s] }} />
            <span className="truncate">{labels[s]}</span>
            <b>
              {counts[s]} · {total ? Math.round((counts[s] / total) * 100) : 0}%
            </b>
          </button>
        ))}
      </div>
    </div>
  )
}

interface Activity {
  key: string
  at: number
  tone: Tone
  icon: ReactNode
  title: string
  sub: string
}

interface Attention {
  key: string
  sev: string
  icon: ReactNode
  title: string
  sub: string
  action: string
  tab: OverviewTab
}

export default function OverviewPage({
  username,
  onNavigate,
  onCreate,
  onOpenPalette,
  canOpen,
}: {
  username: string
  onNavigate?: (tab: OverviewTab) => void
  onCreate?: (tab: OverviewTab) => void
  onOpenPalette?: () => void
  canOpen?: (tab: OverviewTab) => boolean
}) {
  const { t, lang } = useLang()
  const o = t.overviewPage
  const d = t.ui.dash

  const [users, setUsers] = useState<ProxyUser[] | null>()
  const [usersTotal, setUsersTotal] = useState<number | null>()
  const [usersForbidden, setUsersForbidden] = useState(false)
  const [statusCounts, setStatusCounts] = useState<Record<UserStatus, number> | null>()
  const [nodes, setNodes] = useState<Node[] | null>()
  const [kpiTraffic, setKpiTraffic] = useState<TrafficHistoryPoint[] | null>()
  const [reports, setReports] = useState<RecentAppReport[] | null>()
  const [hosts, setHosts] = useState<Host[] | null>()
  const [groupsCount, setGroupsCount] = useState<number | null>()
  const [cores, setCores] = useState<Core[] | null>()
  const [tls, setTls] = useState<TlsStatus | null>(null)

  const [period, setPeriod] = useState(14)
  const [chartNodeId, setChartNodeId] = useState<number | null>(null)
  const [chart, setChart] = useState<TrafficHistoryPoint[] | null>()
  const [chartBusy, setChartBusy] = useState(false)
  const seenActivity = useRef<Set<string> | null>(null)

  useEffect(() => {
    let cancelled = false
    const ok = <T,>(set: (v: T | null) => void) => (v: T | null) => {
      if (!cancelled) set(v)
    }
    const fail = (set: (v: null) => void) => (err: unknown) => {
      if (cancelled) return
      if (err instanceof ApiError && err.status === 403) setUsersForbidden(true)
      set(null)
    }

    // Each section loads on its own: an admin scoped to only some of these
    // resources gets 403s on the rest, which must not blank the whole page.
    listUsers({ limit: 200 })
      .then((res) => {
        if (cancelled) return
        setUsers(res.users)
        setUsersTotal(res.total)
      })
      .catch((err) => {
        fail(setUsers)(err)
        if (!cancelled) setUsersTotal(null)
      })
    Promise.all(STATUS_ORDER.map((status) => listUsers({ status, limit: 1 }).then((res) => [status, res.total] as const)))
      .then((pairs) => ok(setStatusCounts)(Object.fromEntries(pairs) as Record<UserStatus, number>))
      .catch(fail(setStatusCounts))
    listNodes()
      .then((res) => ok(setNodes)(res.nodes))
      .catch(() => ok(setNodes)(null))
    getTrafficHistory(14)
      .then((res) => ok(setKpiTraffic)(res.points))
      .catch(() => ok(setKpiTraffic)(null))
    listHosts()
      .then((res) => ok(setHosts)(res.hosts))
      .catch(() => ok(setHosts)(null))
    listGroups()
      .then((res) => ok(setGroupsCount)(res.total))
      .catch(() => ok(setGroupsCount)(null))
    listCores()
      .then((res) => ok(setCores)(res.cores))
      .catch(() => ok(setCores)(null))
    getTlsStatus()
      .then((res) => ok(setTls)(res))
      .catch(() => undefined)

    // App reports refresh on their own so the activity feed stays live.
    function loadReports() {
      listRecentAppReports(100).then(ok(setReports)).catch(fail(setReports))
    }
    loadReports()
    const id = window.setInterval(loadReports, 30000)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setChartBusy(true)
    // Twice the period: the older half is drawn as the comparison line.
    getTrafficHistory(period * 2, chartNodeId)
      .then((res) => {
        if (!cancelled) setChart(res.points)
      })
      .catch(() => {
        if (!cancelled) setChart(null)
      })
      .finally(() => {
        if (!cancelled) setChartBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [period, chartNodeId])

  function formatWhen(dt: Date): string {
    const time = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false }).format(dt)
    const now = new Date()
    if (sameLocalDay(dt, now)) return o.today(time)
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    if (sameLocalDay(dt, yesterday)) return o.yesterday(time)
    const date = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US', { day: 'numeric', month: 'short' }).format(dt)
    return `${date} ${time}`
  }

  function formatDay(dt: Date): string {
    return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US', { day: 'numeric', month: 'long' }).format(dt)
  }

  function limitText(u: ProxyUser): string {
    if (!u.data_limit) return t.usersPage.unlimited
    const gb = u.data_limit / GB
    return `${Number(gb.toFixed(gb >= 10 ? 0 : 1))} ${t.usersPage.gbSuffix}`
  }

  function userSubtitle(u: ProxyUser): string {
    let second: string
    if (u.expire) second = o.until(formatDay(parseServerDate(u.expire)))
    else if (u.status === 'on_hold' && u.on_hold_expire_days) second = o.onHoldDays(u.on_hold_expire_days)
    else second = o.createdWhen(formatWhen(parseServerDate(u.created_at)))
    return `${limitText(u)} · ${second}`
  }

  function networkLabel(network: string | null): string | null {
    if (!network) return null
    const n = network.toLowerCase()
    if (n === 'mobile' || n === 'cellular') return o.networkMobile
    if (n === 'wifi' || n === 'wi-fi') return o.networkWifi
    return network
  }

  function reportActivity(r: RecentAppReport): Activity {
    const u = r.username
    let tone: Tone = TONES.red
    let icon: ReactNode = <IconX size={15} strokeWidth={2} />
    let title = o.actFailed(u)
    let showDetail = true
    if (r.result === 'connected') {
      tone = TONES.green
      icon = <IconCheck size={15} strokeWidth={2} />
      title = r.protocol ? o.actConnected(u, protocolName(r.protocol)) : o.actConnectedPlain(u)
      showDetail = false
    } else if (r.result === 'ok') {
      tone = TONES.neutral
      icon = <IconRefresh size={15} strokeWidth={2} />
      title = o.actSubscription(u)
      showDetail = false
    } else if (r.result === 'disconnected_early') {
      tone = TONES.amber
      icon = <IconAlert size={15} strokeWidth={2} />
      title = o.actDisconnected(u)
    } else if (r.result === 'timeout') {
      icon = <IconClock size={15} strokeWidth={2} />
      title = o.actTimeout(u)
    }
    const at = parseServerDate(r.reported_at)
    const sub = [r.carrier || r.sim_carrier, networkLabel(r.network), showDetail ? r.detail : null, formatWhen(at)]
      .filter(Boolean)
      .join(' · ')
    return { key: `r${r.id}`, at: at.getTime(), tone, icon, title, sub }
  }

  // App reports and newly created users, merged into one newest-first feed.
  const activity: Activity[] = [
    ...(reports ?? []).slice(0, 20).map(reportActivity),
    ...(users ?? []).slice(0, 20).map((u) => {
      const at = parseServerDate(u.created_at)
      return {
        key: `u${u.id}`,
        at: at.getTime(),
        tone: TONES.purple,
        icon: <IconPlus size={15} strokeWidth={2} />,
        title: o.actUserCreated(u.username),
        sub: `${limitText(u)} · ${formatWhen(at)}`,
      }
    }),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, LIST_ROWS)

  // Rows that arrive after the first render slide in; the first batch doesn't.
  const firstBatch = seenActivity.current === null
  const freshKeys = new Set<string>()
  if (reports !== undefined && users !== undefined) {
    if (firstBatch) seenActivity.current = new Set(activity.map((a) => a.key))
    else
      for (const a of activity)
        if (!seenActivity.current!.has(a.key)) {
          freshKeys.add(a.key)
          seenActivity.current!.add(a.key)
        }
  }

  // KPI figures.
  const now = new Date()
  const newToday = users ? users.filter((u) => sameLocalDay(parseServerDate(u.created_at), now)).length : 0
  const activeCount = statusCounts?.active
  const activeTotal = statusCounts ? STATUS_ORDER.reduce((sum, s) => sum + statusCounts[s], 0) : 0
  const todayBytes = kpiTraffic?.length ? kpiTraffic[kpiTraffic.length - 1].total_bytes : 0
  const yesterdayBytes = kpiTraffic && kpiTraffic.length > 1 ? kpiTraffic[kpiTraffic.length - 2].total_bytes : 0
  const today = splitBytes(todayBytes)
  const connectedNodes = nodes ? nodes.filter((n) => n.status === 'connected').length : 0

  // A users trend is only honest when every user is in the fetched list.
  const usersSpark =
    users && usersTotal != null && users.length >= usersTotal
      ? Array.from({ length: 14 }, (_, i) => {
          const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (13 - i) + 1).getTime()
          return users.filter((u) => parseServerDate(u.created_at).getTime() < end).length
        })
      : undefined

  let trafficDelta: string | undefined
  let trafficDeltaClass = ''
  if (kpiTraffic) {
    if (yesterdayBytes === 0) {
      trafficDelta = todayBytes > 0 ? o.trafficFirstDay : o.trafficNone
    } else {
      const pct = Math.round(((todayBytes - yesterdayBytes) / yesterdayBytes) * 100)
      if (pct > 0) {
        trafficDelta = o.trafficUp(pct)
        trafficDeltaClass = 'up'
      } else if (pct < 0) {
        trafficDelta = o.trafficDown(-pct)
        trafficDeltaClass = 'down'
      } else {
        trafficDelta = o.trafficSame
      }
    }
  } else if (kpiTraffic === null) {
    trafficDelta = o.unavailable
  }

  const usersBlockedText = usersForbidden ? o.noUsersAccess : o.loadFailed
  const may = (tab: OverviewTab) => !!onNavigate && (!canOpen || canOpen(tab))

  function viewAll(tab: OverviewTab) {
    if (!may(tab)) return null
    return (
      <button type="button" onClick={() => onNavigate!(tab)} className="btn">
        {o.viewAll}
      </button>
    )
  }

  // Needs attention: only things the panel actually knows.
  const attention: Attention[] = []
  for (const n of nodes ?? []) {
    if (n.status !== 'error') continue
    attention.push({
      key: `node-${n.id}`,
      sev: 'var(--bad)',
      icon: <IconServer size={15} />,
      title: d.attnNodeDown(n.name),
      sub: n.last_error ?? n.address,
      action: d.review,
      tab: 'nodes',
    })
  }
  const expiringSoon = (users ?? []).filter((u) => {
    if (u.status !== 'active' || !u.expire) return false
    const left = parseServerDate(u.expire).getTime() - Date.now()
    return left > 0 && left <= 3 * DAY
  })
  if (expiringSoon.length > 0) {
    attention.push({
      key: 'expiring',
      sev: 'var(--warn)',
      icon: <IconClock size={15} />,
      title: d.attnExpiring(expiringSoon.length),
      sub: expiringSoon.slice(0, 3).map((u) => u.username).join('، ') + (expiringSoon.length > 3 ? ' …' : ''),
      action: d.review,
      tab: 'users',
    })
  }
  if (statusCounts && statusCounts.limited > 0) {
    attention.push({
      key: 'limited',
      sev: 'var(--warn)',
      icon: <IconAlert size={15} />,
      title: d.attnLimited(statusCounts.limited),
      sub: d.attnLimitedSub,
      action: d.view,
      tab: 'users',
    })
  }
  if (statusCounts && statusCounts.expired > 0) {
    attention.push({
      key: 'expired',
      sev: 'var(--faint)',
      icon: <IconX size={15} />,
      title: d.attnExpired(statusCounts.expired),
      sub: d.attnExpiredSub,
      action: d.view,
      tab: 'users',
    })
  }
  if (tls && !tls.enabled) {
    attention.push({
      key: 'tls',
      sev: 'var(--faint)',
      icon: <IconLock size={15} />,
      title: d.attnTls,
      sub: d.attnTlsSub,
      action: d.fix,
      tab: 'settings',
    })
  }
  const attentionReady = nodes !== undefined && statusCounts !== undefined && users !== undefined
  const serious = attention.some((a) => a.sev === 'var(--bad)')
  const shownAttention = attention.filter((a) => may(a.tab))

  // Protocol share of today's successful app connections.
  const dayAgo = Date.now() - DAY
  const todayConnected = (reports ?? []).filter(
    (r) => r.result === 'connected' && r.protocol && parseServerDate(r.reported_at).getTime() >= dayAgo,
  )
  const protoCounts = countBy(todayConnected, (r) => protocolName(r.protocol!))
  const protoSlices =
    protoCounts.length > PROTO_COLORS.length
      ? [
          ...protoCounts.slice(0, PROTO_COLORS.length - 1).map(([name, v], i) => ({ name, v, c: PROTO_COLORS[i] })),
          { name: d.other, v: protoCounts.slice(PROTO_COLORS.length - 1).reduce((s, [, v]) => s + v, 0), c: OTHER_COLOR },
        ]
      : protoCounts.map(([name, v], i) => ({ name, v, c: PROTO_COLORS[i] }))
  const protoTotal = todayConnected.length

  // Traffic chart halves and summary.
  const curPts = chart ? chart.slice(-period) : []
  const prevPts = chart ? chart.slice(0, Math.max(0, chart.length - period)) : []
  const sumCur = curPts.reduce((s, p) => s + p.total_bytes, 0)
  const sumPrev = prevPts.reduce((s, p) => s + p.total_bytes, 0)
  const peak = curPts.reduce((m, p) => Math.max(m, p.total_bytes), 0)
  const changePct = sumPrev > 0 ? Math.round(((sumCur - sumPrev) / sumPrev) * 100) : null
  const fmtBytes = (b: number) => {
    const s = splitBytes(b)
    return `${s.value.toFixed(s.unit === 'GB' ? (s.value >= 100 ? 0 : 1) : s.decimals)} ${s.unit}`
  }

  const infraCounts: { label: string; count: number | null | undefined }[] = [
    { label: o.totalHosts, count: hosts === undefined ? undefined : hosts?.length ?? null },
    { label: o.totalGroups, count: groupsCount },
    { label: o.totalCores, count: cores === undefined ? undefined : cores?.length ?? null },
  ]

  return (
    <div className="pg-dash">
      <section className="hello">
        <div className="min-w-0">
          <h2>{d.welcome(username)}</h2>
          <div className="line">
            <span className={`health-dot ${!attentionReady ? '' : serious ? 'bad' : attention.length ? 'warn' : ''}`} aria-hidden="true" />
            <span>{!attentionReady ? t.loading : attention.length ? d.healthIssues(attention.length) : d.healthAllGood}</span>
          </div>
        </div>
        <div className="actions">
          {onCreate && may('users') && (
            <button type="button" className="btn solid" onClick={() => onCreate('users')}>
              <IconPlus size={14} />
              {t.usersPage.newBtn.replace(/^\+\s*/, '')}
            </button>
          )}
          {may('nodes') && (
            <button type="button" className="btn" onClick={() => onNavigate!('nodes')}>
              <IconServer size={14} />
              {d.actNodes}
            </button>
          )}
          {onOpenPalette && (
            <button type="button" className="btn" onClick={onOpenPalette}>
              <IconSearch size={14} />
              {t.ui.shell.quickSearch} <kbd>Ctrl K</kbd>
            </button>
          )}
        </div>
      </section>

      <section aria-label={o.summaryTitle} className="kpis">
        <Kpi
          label={o.kpiTotalUsers}
          value={usersTotal}
          delta={users ? (newToday > 0 ? o.newToday(newToday) : o.noNewToday) : users === null ? usersBlockedText : undefined}
          deltaClass={newToday > 0 ? 'up' : ''}
          icon={<IconUsers size={18} />}
          tone={TONES.neutral}
          spark={usersSpark}
        />
        <Kpi
          label={o.kpiActiveUsers}
          value={statusCounts === undefined ? undefined : activeCount === undefined ? null : activeCount}
          delta={
            statusCounts
              ? o.activeShare(activeTotal ? Math.round(((activeCount ?? 0) / activeTotal) * 100) : 0)
              : statusCounts === null
                ? usersBlockedText
                : undefined
          }
          deltaClass={statusCounts && (activeCount ?? 0) > 0 ? 'up' : ''}
          icon={<IconCheckCircle size={18} strokeWidth={2} />}
          tone={TONES.green}
        />
        <Kpi
          label={o.kpiTodayTraffic}
          value={kpiTraffic === undefined ? undefined : kpiTraffic === null ? null : today.value}
          decimals={today.decimals}
          unit={today.unit}
          delta={trafficDelta}
          deltaClass={trafficDeltaClass}
          icon={<IconDownload size={18} strokeWidth={2} />}
          tone={TONES.purple}
          spark={kpiTraffic?.map((p) => p.total_bytes)}
          sparkDot={trafficDeltaClass === 'down' ? '#ef4444' : '#f97316'}
        />
        <Kpi
          label={o.kpiNodes}
          value={nodes === undefined ? undefined : nodes === null ? null : connectedNodes}
          unit={nodes ? `/ ${nodes.length}` : undefined}
          delta={
            nodes
              ? nodes.length === 0
                ? o.noNodesYet
                : connectedNodes === nodes.length
                  ? o.nodesAllUp
                  : o.nodesDown(nodes.length - connectedNodes)
              : nodes === null
                ? o.unavailable
                : undefined
          }
          deltaClass={nodes && nodes.length > 0 && connectedNodes < nodes.length ? 'down' : ''}
          icon={<IconServer size={18} />}
          tone={TONES.amber}
        />
      </section>

      <section className="row-a">
        <Card
          title={o.trafficTitle}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {nodes && nodes.length > 0 && (
                <select
                  value={chartNodeId ?? ''}
                  onChange={(e) => setChartNodeId(e.target.value ? Number(e.target.value) : null)}
                  aria-label={o.allNodesOption}
                  className="select"
                >
                  <option value="">{o.allNodesOption}</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="dseg" role="group" aria-label={o.trafficTitle}>
                {PERIODS.map((p) => (
                  <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>
                    {d.periodShort(p)}
                  </button>
                ))}
              </span>
            </div>
          }
        >
          <div className="dlegend">
            <span style={{ ['--c' as string]: '#e5e5e5' }}>
              <i className="lk" />
              {d.thisPeriod}
            </span>
            <span style={{ ['--c' as string]: '#5c5c5c' }}>
              <i className="lk" />
              {d.prevPeriod}
            </span>
          </div>
          <div className="well" style={{ marginTop: 8 }}>
            <div dir="ltr" className={`chart-wrap ${chartBusy ? 'busy' : ''}`}>
              {chart === undefined ? (
                <div className="skel m-2 aspect-[640/250] min-w-[400px] opacity-40" />
              ) : chart === null ? (
                <DEmpty icon={<IconDownload size={18} />} text={o.loadFailed} />
              ) : (
                <TrafficChart
                  cur={curPts}
                  prev={prevPts}
                  lang={lang}
                  label={`${o.trafficTitle}, ${o.periodDays(period)}`}
                  emptyText={o.trafficHistoryNoData}
                  names={{ cur: d.thisPeriod, prev: d.prevPeriod }}
                />
              )}
            </div>
          </div>
          {chart && sumCur > 0 && (
            <div className="chart-sum">
              <span>
                {d.sumTotal} <b dir="ltr">{fmtBytes(sumCur)}</b>
              </span>
              {changePct !== null && (
                <span className={changePct >= 0 ? 'up' : 'down'}>{d.sumChange(Math.abs(changePct), changePct >= 0)}</span>
              )}
              <span>
                {d.sumPeak} <b dir="ltr">{fmtBytes(peak)}</b>
              </span>
            </div>
          )}
        </Card>

        <Card title={d.attnTitle} action={shownAttention.length > 0 ? <span className="chip">{d.attnCount(shownAttention.length)}</span> : undefined}>
          {!attentionReady ? (
            <div className="well">
              <ListSkeleton rows={3} />
            </div>
          ) : shownAttention.length === 0 ? (
            <div className="attn-empty">✓ {d.attnAllClear}</div>
          ) : (
            <ul className="attn">
              {shownAttention.map((a) => (
                <li key={a.key} style={{ ['--sev' as string]: a.sev }}>
                  <span className="ic">{a.icon}</span>
                  <span className="t">
                    <b>{a.title}</b>
                    <small title={a.sub}>{a.sub}</small>
                  </span>
                  <button type="button" className="btn" onClick={() => onNavigate!(a.tab)}>
                    {a.action}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <NetworkHealth />

      <ServerGauges />

      <section className="row-c">
        <Card title={o.statusTitle} action={viewAll('users')}>
          <div className="well">
            {statusCounts === undefined ? (
              <div className="flex items-center gap-[18px] px-4 py-3.5">
                <div className="h-[170px] w-[170px] flex-shrink-0 animate-pulse rounded-full border-[20px] border-raised" />
                <div className="flex-1 space-y-3">
                  {STATUS_ORDER.map((s) => (
                    <div key={s} className="skel h-3" />
                  ))}
                </div>
              </div>
            ) : statusCounts === null ? (
              <DEmpty icon={<IconUsers size={18} />} text={usersBlockedText} />
            ) : (
              <StatusDonut
                counts={statusCounts}
                labels={t.usersPage.status}
                unitLabel={o.usersUnit}
                ariaLabel={o.statusTitle}
                onPick={may('users') ? () => onNavigate!('users') : undefined}
              />
            )}
          </div>
        </Card>

        <Card title={d.protoTitle}>
          <div className="well">
            {reports === undefined ? (
              <ListSkeleton rows={3} />
            ) : protoTotal === 0 ? (
              <DEmpty icon={<IconCheck size={18} />} text={d.protoEmpty} />
            ) : (
              <div className="protomix">
                <div className="pstack" role="img" aria-label={protoSlices.map((s) => `${s.name} ${s.v}`).join('، ')}>
                  {protoSlices.map((s) => (
                    <i
                      key={s.name}
                      style={{ width: `${(s.v / protoTotal) * 100}%`, background: s.c }}
                      title={`${s.name}: ${s.v} (${Math.round((s.v / protoTotal) * 100)}%)`}
                    />
                  ))}
                </div>
                <div className="proto-rows">
                  {protoSlices.map((s) => (
                    <div key={s.name}>
                      <span className="sq" style={{ background: s.c }} />
                      <span className="en">{s.name}</span>
                      <b>
                        {s.v} · {Math.round((s.v / protoTotal) * 100)}%
                      </b>
                    </div>
                  ))}
                </div>
                <div className="proto-cap">{d.protoCaption(protoTotal)}</div>
              </div>
            )}
          </div>
        </Card>

        <Card title={o.nodesStatusTitle} action={viewAll('nodes')}>
          <div className="well">
            {nodes === undefined ? (
              <ListSkeleton rows={3} />
            ) : nodes === null ? (
              <DEmpty icon={<IconServer size={18} />} text={o.unavailable} />
            ) : nodes.length === 0 ? (
              <DEmpty icon={<IconServer size={18} />} text={o.noNodesYet} />
            ) : (
              nodes.map((n) => (
                <div key={n.id} className="node-row">
                  <span className={`tf-led ${n.status === 'connected' ? 'on' : n.status === 'error' ? 'err' : 'wait'}`} />
                  <span className="nm">
                    <bdi>{n.name}</bdi>
                    <small dir="ltr">{n.address}</small>
                  </span>
                  <span className={`chip-st ${n.status === 'connected' ? 'st-active' : n.status === 'error' ? 'st-expired' : 'st-on_hold'}`}>
                    {t.nodesPage.status[n.status]}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <section className="row-d">
        <Card title={o.recentUsersTitle} action={viewAll('users')}>
          <div className="well">
            {users === undefined ? (
              <ListSkeleton rows={LIST_ROWS} />
            ) : users === null ? (
              <DEmpty icon={<IconUsers size={18} />} text={usersBlockedText} />
            ) : users.length === 0 ? (
              <DEmpty icon={<IconPlus size={18} />} text={o.noUsersYet} />
            ) : (
              users.slice(0, LIST_ROWS).map((u) => (
                <div key={u.id} className="list-row">
                  <span className="davatar" style={{ background: avatarColor(u.username) }}>
                    {initials(u.username)}
                  </span>
                  <span className="t">
                    <b>
                      <bdi className="font-en">{u.username}</bdi>
                    </b>
                    <small>{userSubtitle(u)}</small>
                  </span>
                  <span className={`chip-st st-${u.status}`}>{t.usersPage.status[u.status]}</span>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card
          title={o.recentActivityTitle}
          action={
            <span className="tf-live">
              <i />
              {d.live}
            </span>
          }
        >
          <div className="well">
            {users === undefined || reports === undefined ? (
              <ListSkeleton rows={LIST_ROWS} />
            ) : users === null && reports === null ? (
              <DEmpty icon={<IconClock size={18} />} text={usersBlockedText} />
            ) : activity.length === 0 ? (
              <DEmpty icon={<IconClock size={18} />} text={o.noActivityYet} />
            ) : (
              activity.map((a) => (
                <div key={a.key} className={`list-row ${freshKeys.has(a.key) ? 'act-new' : ''}`}>
                  <span className="act-ic" style={{ background: a.tone.bg, color: a.tone.fg }}>
                    {a.icon}
                  </span>
                  <span className="t">
                    <b>{a.title}</b>
                    <small>{a.sub}</small>
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <Card title={o.infraTitle}>
        <div className="well infra">
          <div className="infra-counts">
            {infraCounts.map((c) => (
              <div key={c.label}>
                <span>{c.label}</span>
                <b className="tabular">{c.count === undefined ? <span className="skel inline-block h-4 w-6" /> : c.count ?? '—'}</b>
              </div>
            ))}
          </div>
          {hosts && hosts.length > 0 && (
            <>
              <div className="infra-sub">{o.hostsByProtocolTitle}</div>
              <div className="flex flex-wrap gap-1.5">
                {countBy(hosts, (h) => h.protocol).map(([protocol, count]) => (
                  <span key={protocol} className="chip">
                    {t.coresPage.protocolLabels[protocol as keyof typeof t.coresPage.protocolLabels] ?? protocol} <b>{count}</b>
                  </span>
                ))}
              </div>
            </>
          )}
          {cores && cores.length > 0 && (
            <>
              <div className="infra-sub">{o.coresByTypeTitle}</div>
              <div className="flex flex-wrap gap-1.5">
                {countBy(cores, (c) => c.core_type).map(([type, count]) => (
                  <span key={type} className="chip">
                    {t.coresPage.coreTypeLabels[type as keyof typeof t.coresPage.coreTypeLabels] ?? type} <b>{count}</b>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
