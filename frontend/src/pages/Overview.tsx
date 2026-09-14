import { useEffect, useId, useState, type ReactNode } from 'react'
import ServerGauges from '../components/SystemStats'
import {
  IconAlert,
  IconCheck,
  IconCheckCircle,
  IconClock,
  IconDownload,
  IconPlus,
  IconRefresh,
  IconServer,
  IconUsers,
  IconX,
} from '../components/icons'
import type { Lang } from '../i18n/dict'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
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
  type NodeStatus,
  type ProxyUser,
  type RecentAppReport,
  type TrafficHistoryPoint,
  type UserStatus,
} from '../lib/api'
import { avatarColor, initials, parseServerDate } from '../lib/format'

export type OverviewTab = 'users' | 'hosts' | 'groups' | 'nodes' | 'cores'

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

const STATUS_CHIP: Record<UserStatus, string> = {
  active: 'border-success/30 bg-success/[0.08] text-success',
  limited: 'border-warning/30 bg-warning/[0.08] text-warning',
  expired: 'border-danger/30 bg-danger/[0.08] text-danger',
  on_hold: 'border-edge bg-neutral-tint text-muted',
  disabled: 'border-edge bg-neutral-tint text-faint',
}

const NODE_DOT: Record<NodeStatus, string> = { connected: 'bg-success', pending: 'bg-neutral', error: 'bg-danger' }
const NODE_CHIP: Record<NodeStatus, string> = {
  connected: STATUS_CHIP.active,
  pending: STATUS_CHIP.on_hold,
  error: STATUS_CHIP.expired,
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

const PERIODS = [7, 14, 30]
const GB = 1024 ** 3
const MB = 1024 ** 2
const LIST_ROWS = 6

const WELL = 'mx-4 mb-4 mt-3 rounded-[10px] border border-well-edge bg-well'
const SELECT =
  'rounded-md border border-[#272727] bg-[#1b1b1b] px-2 py-[3px] text-[11.5px] text-muted outline-none transition-colors hover:text-primary focus:border-strong'

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

function splitBytes(bytes: number): { value: string; unit: string } {
  if (bytes >= GB) return { value: (bytes / GB).toFixed(2), unit: 'GB' }
  if (bytes >= MB) return { value: (bytes / MB).toFixed(bytes >= 100 * MB ? 0 : 1), unit: 'MB' }
  if (bytes > 0) return { value: '<1', unit: 'MB' }
  return { value: '0', unit: 'GB' }
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

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-subtle bg-surface">
      <div className="flex min-h-[34px] flex-wrap items-center justify-between gap-3 px-4 pt-3.5">
        <h2 className="text-sm font-semibold text-heading">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-10 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-full border border-subtle bg-raised text-faint">{icon}</div>
      <p className="max-w-xs text-xs leading-relaxed text-faint">{text}</p>
    </div>
  )
}

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-hair px-3.5 py-[11px] last:border-b-0">
          <div className="h-8 w-8 flex-shrink-0 animate-pulse rounded-full bg-raised" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-24 animate-pulse rounded bg-raised" />
            <div className="h-2.5 w-40 max-w-full animate-pulse rounded bg-raised/70" />
          </div>
        </div>
      ))}
    </div>
  )
}

function Kpi({
  label,
  value,
  unit,
  delta,
  deltaClass = 'text-muted',
  icon,
  tone,
}: {
  label: string
  value: string | null | undefined
  unit?: string
  delta?: string
  deltaClass?: string
  icon: ReactNode
  tone: Tone
}) {
  return (
    <div className="flex items-start justify-between gap-2.5 rounded-xl border border-subtle bg-surface px-4 py-3.5">
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className="mt-0.5 text-[22px] font-semibold leading-[1.3] text-heading">
          {value === undefined ? (
            <span className="my-1 inline-block h-6 w-14 animate-pulse rounded bg-raised align-middle" />
          ) : (
            <span dir="ltr" className="inline-block font-en tabular">
              {value ?? '—'}
              {unit && value !== null && <span className="ms-1 text-[13px] font-normal text-muted">{unit}</span>}
            </span>
          )}
        </div>
        <div className={`mt-1 truncate text-[11.5px] ${deltaClass}`}>{delta ?? ' '}</div>
      </div>
      <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg" style={{ background: tone.bg, color: tone.fg }}>
        {icon}
      </div>
    </div>
  )
}

function niceStep(raw: number): number {
  if (raw <= 0) return 0.25
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const n = raw / magnitude
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * magnitude
}

function TrafficAreaChart({
  points,
  lang,
  label,
  emptyText,
}: {
  points: TrafficHistoryPoint[]
  lang: Lang
  label: string
  emptyText: string
}) {
  const gradientId = `traffic-fill-${useId().replace(/:/g, '')}`
  const W = 620
  const H = 250
  const P = { l: 44, r: 16, t: 22, b: 30 }
  const max = Math.max(0, ...points.map((p) => p.total_bytes))
  const unit = max >= GB ? { div: GB, label: 'GB' } : { div: MB, label: 'MB' }
  const maxValue = max / unit.div
  const step = max > 0 ? niceStep(maxValue / 4) : 0.25
  const top = max > 0 ? Math.max(step, Math.ceil(maxValue / step) * step) : 1
  const ticks: number[] = []
  for (let i = 0; i * step <= top + step / 1000; i++) ticks.push(i * step)

  const n = points.length
  const last = n - 1
  const x = (i: number) => P.l + (n > 1 ? (i * (W - P.l - P.r)) / (n - 1) : 0)
  const y = (v: number) => H - P.b - (v / top) * (H - P.t - P.b)
  const labelEvery = n <= 7 ? 1 : n <= 14 ? 2 : 5
  const dayFormat = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian-nu-latn' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
  })
  const values = points.map((p) => p.total_bytes / unit.div)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))
  const font = 'Poppins, Vazirmatn, sans-serif'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full min-w-[420px]">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.28} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </linearGradient>
      </defs>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={P.l} x2={W - P.r} y1={y(tick)} y2={y(tick)} stroke="#1c1c1c" />
          <text x={P.l - 8} y={y(tick) + 4} fill="#5c5c5c" fontSize={10} textAnchor="end" fontFamily={font}>
            {String(Number(tick.toFixed(2)))}
          </text>
        </g>
      ))}
      {points.map((p, i) =>
        (last - i) % labelEvery === 0 ? (
          <text key={p.date} x={x(i)} y={H - 10} fill="#5c5c5c" fontSize={10} textAnchor="middle" fontFamily={font}>
            {dayFormat.format(dayDate(p.date))}
          </text>
        ) : null,
      )}
      <text x={P.l} y={P.t - 8} fill="#5c5c5c" fontSize={10} fontFamily={font}>
        {unit.label}
      </text>
      {max > 0 && <path d={`${line} L${x(last)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${gradientId})`} />}
      <path d={line} fill="none" stroke={max > 0 ? '#e5e5e5' : '#2e2e2e'} strokeWidth={2} strokeLinejoin="round" />
      {max > 0 &&
        values.map((v, i) => (
          <g key={points[i].date}>
            <circle cx={x(i)} cy={y(v)} r={i === last ? 4.5 : 2.5} fill="#f5f5f5" />
            <circle cx={x(i)} cy={y(v)} r={10} fill="transparent">
              <title>{`${dayFormat.format(dayDate(points[i].date))}: ${fmt(v)} ${unit.label}`}</title>
            </circle>
          </g>
        ))}
      {max > 0 && (
        <text x={x(last) - 8} y={y(values[last]) - 10} fill="#f5f5f5" fontSize={11} textAnchor="end" fontFamily={font}>
          {`${fmt(values[last])} ${unit.label}`}
        </text>
      )}
      {max === 0 && (
        <text x={(P.l + W - P.r) / 2} y={(P.t + H - P.b) / 2} fill="#8b8b8b" fontSize={12} textAnchor="middle" fontFamily="Vazirmatn, Poppins, sans-serif">
          {emptyText}
        </text>
      )}
    </svg>
  )
}

function StatusDonut({
  counts,
  labels,
  unitLabel,
  ariaLabel,
}: {
  counts: Record<UserStatus, number>
  labels: Record<UserStatus, string>
  unitLabel: string
  ariaLabel: string
}) {
  const total = STATUS_ORDER.reduce((sum, s) => sum + counts[s], 0)
  const R = 58
  const C = 2 * Math.PI * R
  let offset = 0
  const segments = STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => {
    const length = (counts[s] / total) * C
    const segment = (
      <circle
        key={s}
        cx={85}
        cy={85}
        r={R}
        fill="none"
        stroke={STATUS_COLOR[s]}
        strokeWidth={20}
        strokeDasharray={`${length} ${C - length}`}
        strokeDashoffset={-offset}
        transform="rotate(-90 85 85)"
      />
    )
    offset += length
    return segment
  })

  return (
    <div className={`${WELL} grid grid-cols-1 items-center justify-items-center gap-[18px] px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:justify-items-stretch`}>
      <svg width={170} height={170} viewBox="0 0 170 170" role="img" aria-label={`${ariaLabel}: ${total}`}>
        <circle cx={85} cy={85} r={R} fill="none" stroke="#1f1f1f" strokeWidth={20} />
        {segments}
        <text x={85} y={84} fill="#f5f5f5" fontSize={26} fontWeight={600} textAnchor="middle" fontFamily="Poppins, sans-serif">
          {total}
        </text>
        <text x={85} y={104} fill="#8b8b8b" fontSize={11} textAnchor="middle" fontFamily="Vazirmatn, Poppins, sans-serif">
          {unitLabel}
        </text>
      </svg>
      <div className="flex w-full flex-col gap-2.5">
        {STATUS_ORDER.map((s) => (
          <div key={s} className="flex items-center gap-2 text-[12.5px] text-muted">
            <span className="h-[9px] w-[9px] flex-shrink-0 rounded-[3px]" style={{ background: STATUS_COLOR[s] }} />
            <span className="truncate">{labels[s]}</span>
            <b dir="ltr" className="ms-auto whitespace-nowrap font-en font-medium text-primary">
              {counts[s]} · {total ? Math.round((counts[s] / total) * 100) : 0}%
            </b>
          </div>
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

export default function OverviewPage({
  onNavigate,
  canOpen,
}: {
  onNavigate?: (tab: OverviewTab) => void
  canOpen?: (tab: OverviewTab) => boolean
}) {
  const { t, lang } = useLang()
  const o = t.overviewPage

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

  const [period, setPeriod] = useState(14)
  const [chartNodeId, setChartNodeId] = useState<number | null>(null)
  const [chart, setChart] = useState<TrafficHistoryPoint[] | null>()
  const [chartBusy, setChartBusy] = useState(false)

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
    listRecentAppReports(20).then(ok(setReports)).catch(fail(setReports))
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

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setChartBusy(true)
    getTrafficHistory(period, chartNodeId)
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

  function formatWhen(d: Date): string {
    const time = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d)
    const now = new Date()
    if (sameLocalDay(d, now)) return o.today(time)
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    if (sameLocalDay(d, yesterday)) return o.yesterday(time)
    const date = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US', {
      day: 'numeric',
      month: 'short',
    }).format(d)
    return `${date} ${time}`
  }

  function formatDay(d: Date): string {
    return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US', { day: 'numeric', month: 'long' }).format(d)
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
    ...(reports ?? []).map(reportActivity),
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

  // KPI figures.
  const now = new Date()
  const newToday = users ? users.filter((u) => sameLocalDay(parseServerDate(u.created_at), now)).length : 0
  const activeCount = statusCounts?.active
  const activeTotal = statusCounts ? STATUS_ORDER.reduce((sum, s) => sum + statusCounts[s], 0) : 0
  const todayBytes = kpiTraffic?.length ? kpiTraffic[kpiTraffic.length - 1].total_bytes : 0
  const yesterdayBytes = kpiTraffic && kpiTraffic.length > 1 ? kpiTraffic[kpiTraffic.length - 2].total_bytes : 0
  const today = splitBytes(todayBytes)
  const connectedNodes = nodes ? nodes.filter((n) => n.status === 'connected').length : 0

  let trafficDelta: string | undefined
  let trafficDeltaClass = 'text-muted'
  if (kpiTraffic) {
    if (yesterdayBytes === 0) {
      trafficDelta = todayBytes > 0 ? o.trafficFirstDay : o.trafficNone
    } else {
      const pct = Math.round(((todayBytes - yesterdayBytes) / yesterdayBytes) * 100)
      if (pct > 0) {
        trafficDelta = o.trafficUp(pct)
        trafficDeltaClass = 'text-success'
      } else if (pct < 0) {
        trafficDelta = o.trafficDown(-pct)
        trafficDeltaClass = 'text-danger'
      } else {
        trafficDelta = o.trafficSame
      }
    }
  } else if (kpiTraffic === null) {
    trafficDelta = o.unavailable
  }

  const usersBlockedText = usersForbidden ? o.noUsersAccess : o.loadFailed

  function viewAll(tab: OverviewTab) {
    if (!onNavigate || (canOpen && !canOpen(tab))) return null
    return (
      <button type="button" onClick={() => onNavigate(tab)} className="text-[11.5px] text-faint transition-colors hover:text-muted">
        {o.viewAll}
      </button>
    )
  }

  const infraCounts: { label: string; count: number | null | undefined }[] = [
    { label: o.totalHosts, count: hosts === undefined ? undefined : hosts?.length ?? null },
    { label: o.totalGroups, count: groupsCount },
    { label: o.totalCores, count: cores === undefined ? undefined : cores?.length ?? null },
  ]
  const showInfra = !!hosts || !!cores || (groupsCount !== undefined && groupsCount !== null)

  return (
    <div className="flex flex-col gap-4">
      <section aria-label={o.summaryTitle} className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label={o.kpiTotalUsers}
          value={usersTotal === undefined ? undefined : usersTotal === null ? null : String(usersTotal)}
          delta={users ? (newToday > 0 ? o.newToday(newToday) : o.noNewToday) : users === null ? usersBlockedText : undefined}
          deltaClass={newToday > 0 ? 'text-success' : 'text-muted'}
          icon={<IconUsers size={18} />}
          tone={TONES.neutral}
        />
        <Kpi
          label={o.kpiActiveUsers}
          value={statusCounts === undefined ? undefined : activeCount === undefined ? null : String(activeCount)}
          delta={
            statusCounts
              ? o.activeShare(activeTotal ? Math.round(((activeCount ?? 0) / activeTotal) * 100) : 0)
              : statusCounts === null
                ? usersBlockedText
                : undefined
          }
          deltaClass={statusCounts && (activeCount ?? 0) > 0 ? 'text-success' : 'text-muted'}
          icon={<IconCheckCircle size={18} strokeWidth={2} />}
          tone={TONES.green}
        />
        <Kpi
          label={o.kpiTodayTraffic}
          value={kpiTraffic === undefined ? undefined : kpiTraffic === null ? null : today.value}
          unit={today.unit}
          delta={trafficDelta}
          deltaClass={trafficDeltaClass}
          icon={<IconDownload size={18} strokeWidth={2} />}
          tone={TONES.purple}
        />
        <Kpi
          label={o.kpiNodes}
          value={nodes === undefined ? undefined : nodes === null ? null : String(connectedNodes)}
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
          deltaClass={nodes && nodes.length > 0 && connectedNodes < nodes.length ? 'text-danger' : 'text-muted'}
          icon={<IconServer size={18} />}
          tone={TONES.amber}
        />
      </section>

      <ServerGauges />

      <section className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card
          title={o.trafficTitle}
          action={
            <div className="flex items-center gap-2">
              {nodes && nodes.length > 0 && (
                <select
                  value={chartNodeId ?? ''}
                  onChange={(e) => setChartNodeId(e.target.value ? Number(e.target.value) : null)}
                  aria-label={o.allNodesOption}
                  className={SELECT}
                >
                  <option value="">{o.allNodesOption}</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              )}
              <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} aria-label={o.trafficTitle} className={SELECT}>
                {PERIODS.map((d) => (
                  <option key={d} value={d}>
                    {o.periodDays(d)}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          <div dir="ltr" className={`${WELL} overflow-x-auto px-1.5 pb-1 pt-2.5`}>
            {chart === undefined ? (
              <div className="m-2 aspect-[620/250] min-w-[400px] animate-pulse rounded-md bg-raised/40" />
            ) : chart === null ? (
              <EmptyState icon={<IconDownload size={18} />} text={o.loadFailed} />
            ) : (
              <div className={`transition-opacity ${chartBusy ? 'opacity-50' : ''}`}>
                <TrafficAreaChart
                  points={chart}
                  lang={lang}
                  label={`${o.trafficTitle}, ${o.periodDays(period)}`}
                  emptyText={o.trafficHistoryNoData}
                />
              </div>
            )}
          </div>
        </Card>

        <Card title={o.statusTitle} action={viewAll('users')}>
          {statusCounts === undefined ? (
            <div className={`${WELL} flex items-center gap-[18px] px-4 py-3.5`}>
              <div className="h-[170px] w-[170px] flex-shrink-0 animate-pulse rounded-full border-[20px] border-raised" />
              <div className="flex-1 space-y-3">
                {STATUS_ORDER.map((s) => (
                  <div key={s} className="h-3 animate-pulse rounded bg-raised" />
                ))}
              </div>
            </div>
          ) : statusCounts === null ? (
            <div className={WELL}>
              <EmptyState icon={<IconUsers size={18} />} text={usersBlockedText} />
            </div>
          ) : (
            <StatusDonut counts={statusCounts} labels={t.usersPage.status} unitLabel={o.usersUnit} ariaLabel={o.statusTitle} />
          )}
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Card title={o.recentUsersTitle} action={viewAll('users')}>
          <div className={WELL}>
            {users === undefined ? (
              <ListSkeleton rows={LIST_ROWS} />
            ) : users === null ? (
              <EmptyState icon={<IconUsers size={18} />} text={usersBlockedText} />
            ) : users.length === 0 ? (
              <EmptyState icon={<IconPlus size={18} />} text={o.noUsersYet} />
            ) : (
              users.slice(0, LIST_ROWS).map((u) => (
                <div key={u.id} className="flex items-center gap-3 border-b border-hair px-3.5 py-[11px] last:border-b-0">
                  <div
                    className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full font-en text-xs font-semibold text-app"
                    style={{ background: avatarColor(u.username) }}
                  >
                    {initials(u.username)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-primary">
                      <bdi className="font-en">{u.username}</bdi>
                    </div>
                    <div className="truncate text-[11.5px] text-faint">{userSubtitle(u)}</div>
                  </div>
                  <span className={`flex-shrink-0 whitespace-nowrap rounded-md border px-[9px] py-[2px] text-[11px] ${STATUS_CHIP[u.status]}`}>
                    {t.usersPage.status[u.status]}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card title={o.recentActivityTitle} action={viewAll('users')}>
          <div className={WELL}>
            {users === undefined || reports === undefined ? (
              <ListSkeleton rows={LIST_ROWS} />
            ) : users === null && reports === null ? (
              <EmptyState icon={<IconClock size={18} />} text={usersBlockedText} />
            ) : activity.length === 0 ? (
              <EmptyState icon={<IconClock size={18} />} text={o.noActivityYet} />
            ) : (
              activity.map((a) => (
                <div key={a.key} className="flex items-center gap-3 border-b border-hair px-3.5 py-[11px] last:border-b-0">
                  <div
                    className="grid h-[30px] w-[30px] flex-shrink-0 place-items-center rounded-full"
                    style={{ background: a.tone.bg, color: a.tone.fg }}
                  >
                    {a.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-primary">{a.title}</div>
                    <div className="truncate text-[11.5px] text-faint">{a.sub}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      {(nodes || showInfra) && (
        <section className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          {nodes && (
            <Card title={o.nodesStatusTitle} action={viewAll('nodes')}>
              <div className={WELL}>
                {nodes.length === 0 ? (
                  <EmptyState icon={<IconServer size={18} />} text={o.noNodesYet} />
                ) : (
                  nodes.map((n) => (
                    <div key={n.id} className="flex items-center gap-3 border-b border-hair px-3.5 py-[11px] last:border-b-0">
                      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${NODE_DOT[n.status]}`} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-primary">
                        <bdi>{n.name}</bdi>
                      </span>
                      <span className={`flex-shrink-0 whitespace-nowrap rounded-md border px-[9px] py-[2px] text-[11px] ${NODE_CHIP[n.status]}`}>
                        {t.nodesPage.status[n.status]}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          )}

          {showInfra && (
            <Card title={o.infraTitle}>
              <div className={`${WELL} p-3.5`}>
                <div className="grid grid-cols-3 gap-2">
                  {infraCounts.map((c) => (
                    <div key={c.label} className="rounded-lg border border-hair bg-surface/60 px-3 py-2">
                      <div className="truncate text-[11px] text-muted">{c.label}</div>
                      <div className="font-en text-lg font-semibold text-heading tabular">
                        {c.count === undefined ? <span className="inline-block h-4 w-6 animate-pulse rounded bg-raised" /> : c.count ?? '—'}
                      </div>
                    </div>
                  ))}
                </div>
                {hosts && hosts.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1.5 text-[11px] text-faint">{o.hostsByProtocolTitle}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {countBy(hosts, (h) => h.protocol).map(([protocol, count]) => (
                        <span key={protocol} className="rounded-md border border-edge bg-raised px-2 py-0.5 text-[11px] text-secondary">
                          {t.coresPage.protocolLabels[protocol as keyof typeof t.coresPage.protocolLabels] ?? protocol}{' '}
                          <b className="font-en font-medium text-primary">{count}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {cores && cores.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1.5 text-[11px] text-faint">{o.coresByTypeTitle}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {countBy(cores, (c) => c.core_type).map(([type, count]) => (
                        <span key={type} className="rounded-md border border-edge bg-raised px-2 py-0.5 text-[11px] text-secondary">
                          {t.coresPage.coreTypeLabels[type as keyof typeof t.coresPage.coreTypeLabels] ?? type}{' '}
                          <b className="font-en font-medium text-primary">{count}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}
        </section>
      )}
    </div>
  )
}
