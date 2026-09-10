import { useEffect, useState } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  getTrafficHistory,
  listCores,
  listGroups,
  listHosts,
  listNodes,
  listUsers,
  type Core,
  type Host,
  type Node,
  type NodeStatus,
  type ProxyUser,
  type TrafficHistoryPoint,
  type UserStatus,
} from '../lib/api'

const TRAFFIC_DAYS = 14

const ACCENT = '#22D3EE'

const statusDot: Record<NodeStatus, string> = {
  connected: 'bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.6)]',
  pending: 'bg-slate-500',
  error: 'bg-red-400 shadow-[0_0_8px_2px_rgba(248,113,113,0.5)]',
}

const statusBadge: Record<NodeStatus, string> = {
  connected: 'bg-success-tint text-success border-success',
  pending: 'bg-neutral-tint text-muted border-neutral',
  error: 'bg-danger-tint text-danger border-danger',
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-subtle bg-surface p-4">
      <div className="text-2xl font-bold text-heading">{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  )
}

function BreakdownCard({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const { t } = useLang()
  return (
    <div className="rounded-xl border border-subtle bg-surface p-4">
      <div className="mb-3 text-sm font-bold text-primary">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-faint">{t.overviewPage.noneYet}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between text-sm">
              <span className="text-secondary">{r.label}</span>
              <span className="font-bold" style={{ color: ACCENT }}>
                {r.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 GB'
  const gb = bytes / 1024 ** 3
  if (gb < 0.1) return '<0.1 GB'
  return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`
}

function TrafficChart({
  points,
  nodes,
  nodeId,
  onNodeChange,
}: {
  points: TrafficHistoryPoint[]
  nodes: Node[]
  nodeId: number | null
  onNodeChange: (id: number | null) => void
}) {
  const { t, align } = useLang()
  const max = Math.max(1, ...points.map((p) => p.total_bytes))
  const total = points.reduce((sum, p) => sum + p.total_bytes, 0)
  const hasData = total > 0
  const chartHeight = 140
  const barGapPx = 4

  return (
    <div className="rounded-xl border border-subtle bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-primary">{t.overviewPage.trafficHistoryTitle}</div>
        <div className="flex items-center gap-3">
          {nodes.length > 0 && (
            <select
              value={nodeId ?? ''}
              onChange={(e) => onNodeChange(e.target.value ? Number(e.target.value) : null)}
              className="rounded-md border border-edge bg-field px-2 py-1 text-xs text-primary outline-none focus:border-cyan-400/60"
            >
              <option value="">{t.overviewPage.allNodesOption}</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          )}
          <div dir="ltr" className="font-mono text-xs" style={{ fontVariantNumeric: 'tabular-nums', color: ACCENT }}>
            {t.overviewPage.trafficHistoryTotal(formatBytes(total))}
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className={`py-6 text-center text-xs text-faint ${align}`}>{t.overviewPage.trafficHistoryNoData}</div>
      ) : (
        <div dir="ltr" className="flex items-end" style={{ height: chartHeight, gap: barGapPx }}>
          {points.map((p) => {
            const heightPct = Math.max(2, (p.total_bytes / max) * 100)
            const isLast = p === points[points.length - 1]
            const d = new Date(p.date)
            const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            return (
              <div key={p.date} className="flex flex-1 flex-col items-center justify-end" style={{ height: '100%' }}>
                <div
                  title={`${label}: ${formatBytes(p.total_bytes)}`}
                  className="w-full rounded-t"
                  style={{
                    height: `${heightPct}%`,
                    minHeight: 2,
                    backgroundColor: isLast ? ACCENT : 'rgba(34,211,238,0.35)',
                  }}
                />
              </div>
            )
          })}
        </div>
      )}
      {hasData && (
        <div dir="ltr" className="mt-2 flex justify-between text-[10px] text-faint">
          <span>{new Date(points[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          <span>{new Date(points[points.length - 1].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        </div>
      )}
    </div>
  )
}

function countBy<T, K extends string>(items: T[], key: (item: T) => K): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const k = key(item)
    counts[k] = (counts[k] ?? 0) + 1
  }
  return counts
}

export default function OverviewPage() {
  const { t, dir } = useLang()
  const protocolLabels = t.coresPage.protocolLabels
  const coreTypeLabels = t.coresPage.coreTypeLabels
  const userStatusLabels = t.usersPage.status
  const nodeStatusLabels = t.nodesPage.status

  const [users, setUsers] = useState<ProxyUser[] | null>(null)
  const [hosts, setHosts] = useState<Host[] | null>(null)
  const [groupsCount, setGroupsCount] = useState<number | null>(null)
  const [nodes, setNodes] = useState<Node[] | null>(null)
  const [cores, setCores] = useState<Core[] | null>(null)
  const [trafficHistory, setTrafficHistory] = useState<TrafficHistoryPoint[] | null>(null)
  const [trafficNodeId, setTrafficNodeId] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // Promise.allSettled, not .all — an admin scoped to only some of these
    // resources gets 403s on the rest, which shouldn't blank the whole
    // tab; each section below just stays out (its StatTile/BreakdownCard
    // simply isn't rendered) instead of the page showing a hard error.
    Promise.allSettled([
      listUsers(),
      listHosts(),
      listGroups(),
      listNodes(),
      listCores(),
      getTrafficHistory(TRAFFIC_DAYS),
    ]).then(([u, h, g, n, c, th]) => {
      if (u.status === 'fulfilled') setUsers(u.value.users)
      if (h.status === 'fulfilled') setHosts(h.value.hosts)
      if (g.status === 'fulfilled') setGroupsCount(g.value.total)
      if (n.status === 'fulfilled') setNodes(n.value.nodes)
      if (c.status === 'fulfilled') setCores(c.value.cores)
      if (th.status === 'fulfilled') setTrafficHistory(th.value.points)
      setLoaded(true)
    })
  }, [])

  function changeTrafficNode(id: number | null) {
    setTrafficNodeId(id)
    getTrafficHistory(TRAFFIC_DAYS, id)
      .then((res) => setTrafficHistory(res.points))
      .catch(() => undefined)
  }

  const loading = !loaded

  const usersByStatus = users ? countBy(users, (u) => u.status as UserStatus) : {}
  const hostsByProtocol = hosts ? countBy(hosts, (h) => h.protocol) : {}
  const coresByType = cores ? countBy(cores, (c) => c.core_type) : {}

  return (
    <div dir={dir}>
      <h1 className="mb-6 text-xl font-bold text-heading">{t.overviewPage.title}</h1>

      {loading && <div className="py-8 text-center text-faint">{t.loading}</div>}

      {!loading && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {users && <StatTile label={t.overviewPage.totalUsers} value={users.length} />}
            {hosts && <StatTile label={t.overviewPage.totalHosts} value={hosts.length} />}
            {groupsCount !== null && <StatTile label={t.overviewPage.totalGroups} value={groupsCount} />}
            {nodes && <StatTile label={t.overviewPage.totalNodes} value={nodes.length} />}
            {cores && <StatTile label={t.overviewPage.totalCores} value={cores.length} />}
          </div>

          {trafficHistory && (
            <div className="mb-6">
              <TrafficChart
                points={trafficHistory}
                nodes={nodes ?? []}
                nodeId={trafficNodeId}
                onNodeChange={changeTrafficNode}
              />
            </div>
          )}

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {users && (
              <BreakdownCard
                title={t.overviewPage.usersByStatusTitle}
                rows={Object.entries(usersByStatus).map(([status, count]) => ({
                  label: userStatusLabels[status as UserStatus],
                  count,
                }))}
              />
            )}
            {hosts && (
              <BreakdownCard
                title={t.overviewPage.hostsByProtocolTitle}
                rows={Object.entries(hostsByProtocol).map(([protocol, count]) => ({
                  label: protocolLabels[protocol as keyof typeof protocolLabels] ?? protocol,
                  count,
                }))}
              />
            )}
            {cores && (
              <BreakdownCard
                title={t.overviewPage.coresByTypeTitle}
                rows={Object.entries(coresByType).map(([type, count]) => ({
                  label: coreTypeLabels[type as keyof typeof coreTypeLabels] ?? type,
                  count,
                }))}
              />
            )}
          </div>

          {nodes && (
            <div className="rounded-xl border border-subtle bg-surface p-4">
              <div className="mb-3 text-sm font-bold text-primary">{t.overviewPage.nodesStatusTitle}</div>
              {nodes.length === 0 ? (
                <div className="text-xs text-faint">{t.overviewPage.noneYet}</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {nodes.map((n) => (
                    <div key={n.id} className="flex items-center justify-between rounded-lg border border-hair bg-field px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${statusDot[n.status]}`} />
                        <span className="text-sm text-body">{n.name}</span>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] ${statusBadge[n.status]}`}>
                        {nodeStatusLabels[n.status]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
