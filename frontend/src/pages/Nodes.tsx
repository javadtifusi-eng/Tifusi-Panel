import { useEffect, useState, type FormEvent } from 'react'
import { IconPlus } from '../components/icons'
import { CountUp, Empty, Field, Sheet, useToast } from '../components/ui'
import type { Lang } from '../i18n/dict'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createNode,
  deleteNode,
  getTrafficHistory,
  listCores,
  listNodes,
  syncNode,
  updateNode,
  type Core,
  type Node,
  type NodeStatus,
  type TrafficHistoryPoint,
} from '../lib/api'
import { copyToClipboard } from '../lib/clipboard'
import { parseServerDate } from '../lib/format'

// Which core a node runs is assigned from the Cores page (a core lists and
// toggles the nodes running it), not repeated here — this form only owns
// what's actually the node's own identity (name/address/agent port).

const GB = 1024 ** 3
const MB = 1024 ** 2

function setupCommand(node: Node): string {
  // The one-line installer (not a raw docker build/run) — it clones the
  // repo itself into a temp dir, so it works on a brand-new server with
  // nothing on it yet, unlike a bare `docker build -f backend/... backend`
  // which only works from inside an already-cloned panel checkout.
  return `bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install-node.sh)" -- ${node.api_key} ${node.port}`
}

function code(name: string): string {
  return (name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '#').toUpperCase()
}

const PILL: Record<NodeStatus, string> = { connected: 'ok live', pending: 'idle', error: 'bad' }

function fmtBytes(bytes: number): { value: number; decimals: number; unit: string } {
  if (bytes >= GB) return { value: bytes / GB, decimals: bytes >= 100 * GB ? 0 : 1, unit: 'GB' }
  return { value: bytes / MB, decimals: 0, unit: 'MB' }
}

// Daily traffic for one node: bars (a magnitude per day), today in the accent.
function DailyBars({ points, lang, label }: { points: TrafficHistoryPoint[]; lang: Lang; label: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = 190
  const P = { l: 40, r: 12, t: 16, b: 26 }
  const max = Math.max(0, ...points.map((p) => p.total_bytes))
  const unit = max >= GB ? { div: GB, label: 'GB' } : { div: MB, label: 'MB' }
  const top = max > 0 ? Math.ceil((max / unit.div) * 1.1 * 10) / 10 : 1
  const n = points.length
  const band = (W - P.l - P.r) / Math.max(1, n)
  const bw = Math.max(4, band - 2)
  const y = (v: number) => H - P.b - (v / top) * (H - P.t - P.b)
  const dayFormat = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian-nu-latn' : 'en-US', { month: '2-digit', day: '2-digit' })
  const font = 'Poppins, Vazirmatn, sans-serif'
  const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))
  const every = n <= 7 ? 1 : n <= 14 ? 2 : 5
  return (
    <div className="chart" dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
        {[0, top / 2, top].map((tick) => (
          <g key={tick}>
            <line x1={P.l} x2={W - P.r} y1={y(tick)} y2={y(tick)} stroke="#1f1f1f" />
            <text x={P.l - 6} y={y(tick) + 3} fill="#5c5c5c" fontSize={10} textAnchor="end" fontFamily={font}>
              {fmt(tick)}
            </text>
          </g>
        ))}
        <text x={P.l} y={P.t - 5} fill="#5c5c5c" fontSize={10} fontFamily={font}>
          {unit.label}
        </text>
        {points.map((p, i) => {
          const v = p.total_bytes / unit.div
          const x = P.l + i * band + (band - bw) / 2
          const h = Math.max(v > 0 ? 2 : 0, H - P.b - y(v))
          const isLast = i === n - 1
          return (
            <g key={p.date} onPointerEnter={() => setHover(i)}>
              <rect x={P.l + i * band} y={P.t} width={band} height={H - P.t - P.b} fill="transparent" />
              <path
                d={`M${x} ${H - P.b} V${H - P.b - h + Math.min(4, h)} Q${x} ${H - P.b - h} ${x + Math.min(4, bw / 2)} ${H - P.b - h} H${x + bw - Math.min(4, bw / 2)} Q${x + bw} ${H - P.b - h} ${x + bw} ${H - P.b - h + Math.min(4, h)} V${H - P.b} Z`}
                fill={isLast ? '#f97316' : hover === i ? '#6aa6ee' : 'var(--cat1)'}
                opacity={hover === null || hover === i ? 1 : 0.55}
              />
              {(n - 1 - i) % every === 0 && (
                <text x={x + bw / 2} y={H - 8} fill="#5c5c5c" fontSize={10} textAnchor="middle" fontFamily={font}>
                  {dayFormat.format(new Date(`${p.date}T12:00:00`))}
                </text>
              )}
              {isLast && v > 0 && (
                <text x={x + bw / 2} y={H - P.b - h - 6} fill="#f5f5f5" fontSize={11} textAnchor="middle" fontFamily={font}>
                  {fmt(v)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {hover !== null && points[hover] && (
        <div
          className="tip"
          style={{ left: `${((P.l + hover * band + band / 2) / W) * 100}%`, top: `${(y(points[hover].total_bytes / unit.div) / H) * 100}%` }}
        >
          <div style={{ color: 'var(--faint)', fontSize: '.68rem' }}>{dayFormat.format(new Date(`${points[hover].date}T12:00:00`))}</div>
          <b>
            {fmt(points[hover].total_bytes / unit.div)} {unit.label}
          </b>
        </div>
      )}
    </div>
  )
}

export default function NodesPage({ createSignal = 0 }: { createSignal?: number } = {}) {
  const { t, lang } = useLang()
  const nd = t.ui.nodes
  const say = useToast()
  const [nodes, setNodes] = useState<Node[] | null>(null)
  const [cores, setCores] = useState<Core[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [port, setPort] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [syncingAll, setSyncingAll] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showCmd, setShowCmd] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [traffic, setTraffic] = useState<TrafficHistoryPoint[] | null>()

  const coreById = new Map(cores.map((c) => [c.id, c]))

  async function refresh() {
    try {
      const res = await listNodes()
      setNodes(res.nodes)
      setSelectedId((id) => (id != null && res.nodes.some((n) => n.id === id) ? id : res.nodes[0]?.id ?? null))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.nodesPage.fetchError)
    }
  }

  useEffect(() => {
    refresh()
    listCores()
      .then((res) => setCores(res.cores))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (createSignal > 0) openNew()
  }, [createSignal])

  useEffect(() => {
    if (selectedId == null) return
    let cancelled = false
    setTraffic(undefined)
    getTrafficHistory(14, selectedId)
      .then((res) => {
        if (!cancelled) setTraffic(res.points)
      })
      .catch(() => {
        if (!cancelled) setTraffic(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  function openNew() {
    setEditingId(null)
    setName('')
    setAddress('')
    setPort('')
    setFormError(null)
    setShowForm(true)
  }

  function resetForm() {
    setEditingId(null)
    setName('')
    setAddress('')
    setPort('')
    setShowForm(false)
  }

  function startEdit(node: Node) {
    setEditingId(node.id)
    setName(node.name)
    setAddress(node.address)
    setPort(String(node.port))
    setFormError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      if (editingId) {
        await updateNode(editingId, { name, address, port: parseInt(port, 10) })
        resetForm()
        say(nd.saved)
      } else {
        const created = await createNode({ name, address, port: parseInt(port, 10) })
        resetForm()
        setSelectedId(created.id)
        setShowCmd(true)
      }
      await refresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSync(node: Node) {
    if (syncingId !== null) return
    setSyncingId(node.id)
    setError(null)
    try {
      const res = await syncNode(node.id)
      await refresh()
      say(res.status === 'connected' ? nd.synced(node.name, res.inbound_count) : res.error ?? t.nodesPage.syncFailed)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.nodesPage.syncFailed)
    } finally {
      setSyncingId(null)
    }
  }

  async function handleSyncAll() {
    if (!nodes || syncingAll) return
    setSyncingAll(true)
    setError(null)
    let ok = 0
    for (const node of nodes) {
      setSyncingId(node.id)
      try {
        const res = await syncNode(node.id)
        if (res.status === 'connected') ok++
      } catch {
        // One unreachable node must not stop the rest.
      }
    }
    setSyncingId(null)
    setSyncingAll(false)
    await refresh()
    say(nd.syncedAll(ok, nodes.length))
  }

  async function handleDelete(node: Node) {
    if (!window.confirm(t.nodesPage.confirmDelete(node.name))) return
    try {
      await deleteNode(node.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  async function copySetup(node: Node) {
    if (await copyToClipboard(setupCommand(node))) {
      setCopyFailed(false)
      say(t.common.copiedCheck)
    } else {
      // Both copy methods failed (e.g. the panel's reached over plain HTTP,
      // where navigator.clipboard doesn't exist at all) — say so instead of
      // claiming success, and the command below is already there to select.
      setCopyFailed(true)
    }
  }

  function ago(iso: string | null): string {
    if (!iso) return nd.never
    const minutes = Math.round((Date.now() - parseServerDate(iso).getTime()) / 60000)
    if (minutes < 1) return t.usersPage.onlineNow
    if (minutes < 60) return t.usersPage.minutesAgo(minutes)
    const hours = Math.round(minutes / 60)
    if (hours < 24) return t.usersPage.hoursAgo(hours)
    return t.usersPage.daysAgo(Math.round(hours / 24))
  }

  const current = nodes?.find((n) => n.id === selectedId) ?? null
  const core = current?.core_id != null ? coreById.get(current.core_id) : undefined
  const ipsecCore = current?.ipsec_core_id != null ? coreById.get(current.ipsec_core_id) : undefined
  const todayBytes = traffic?.length ? traffic[traffic.length - 1].total_bytes : 0
  const totalBytes = traffic?.reduce((s, p) => s + p.total_bytes, 0) ?? 0
  const today = fmtBytes(todayBytes)
  const total = fmtBytes(totalBytes)
  const hasTraffic = !!traffic && totalBytes > 0

  return (
    <div className="pg-nodes">
      <h1 className="sr-only">{t.nodesPage.title}</h1>
      {error && <div className="tf-alert">{error}</div>}

      {nodes !== null && nodes.length === 0 ? (
        <Empty
          title={t.nodesPage.noNodesYet}
          text={t.nodesPage.intro}
          action={
            <button type="button" className="btn solid" onClick={openNew}>
              <IconPlus size={14} />
              {t.nodesPage.newBtn.replace(/^\+\s*/, '')}
            </button>
          }
        />
      ) : (
        <div className="layout">
          <aside className="rack" aria-label={t.nodesPage.title}>
            <div className="rack-head">
              <span>
                <b>{t.nodesPage.title}</b>
                <small>{nodes?.length ?? ''}</small>
              </span>
              <button type="button" className="btn" onClick={handleSyncAll} disabled={!nodes || syncingAll}>
                {syncingAll ? t.nodesPage.syncing : nd.syncAll}
              </button>
            </div>
            {nodes === null
              ? [0, 1].map((i) => <div key={i} className="skel" style={{ height: 62, borderRadius: 14 }} />)
              : nodes.map((n) => {
                  const busy = syncingId === n.id
                  return (
                    <button
                      key={n.id}
                      type="button"
                      className={`unit ${n.status === 'error' ? 'down' : ''}`}
                      aria-current={n.id === selectedId}
                      onClick={() => {
                        setSelectedId(n.id)
                        setShowCmd(false)
                      }}
                    >
                      <span className="leds" aria-hidden="true">
                        {n.status === 'connected' || busy ? (
                          <>
                            <i className="led on" />
                            <i className={`led ${busy ? 'act' : 'on'}`} style={{ ['--d' as string]: '.6s' }} />
                            <i className="led on" />
                            <i className={`led ${busy ? 'act' : ''}`} style={{ ['--d' as string]: '.9s' }} />
                          </>
                        ) : n.status === 'error' ? (
                          <>
                            <i className="led err" />
                            <i className="led" />
                            <i className="led" />
                            <i className="led" />
                          </>
                        ) : (
                          <>
                            <i className="led wait" />
                            <i className="led" />
                            <i className="led wait" />
                            <i className="led" />
                          </>
                        )}
                      </span>
                      <span className="u-main">
                        <span className="u-name">
                          <b>{n.name}</b>
                          <span className="chip en">{code(n.name)}</span>
                        </span>
                        <span className="u-sub mono">
                          {n.address}:{n.port}
                        </span>
                      </span>
                      <span className="u-side">
                        <b>{n.status === 'error' ? '✕' : n.status === 'connected' ? '✓' : '…'}</b>
                        {busy ? t.nodesPage.syncing : t.nodesPage.status[n.status]}
                      </span>
                    </button>
                  )
                })}
            <button type="button" className="add-unit" onClick={openNew}>
              {t.nodesPage.newBtn}
            </button>
          </aside>

          {current ? (
            <div className="detail" aria-live="polite">
              <div className="nd-head">
                <span className="nd-flag" style={current.status === 'error' ? { color: 'var(--bad)' } : undefined}>
                  {code(current.name)}
                </span>
                <span className="nd-title">
                  <b>{current.name}</b>
                  <small className="mono">
                    {current.address}:{current.port}
                  </small>
                </span>
                <span className={`pill ${PILL[current.status]}`}>
                  <i />
                  {syncingId === current.id ? t.nodesPage.syncing : t.nodesPage.status[current.status]}
                </span>
                <span className="nd-actions">
                  <button type="button" className="btn solid" onClick={() => handleSync(current)} disabled={syncingId !== null}>
                    {syncingId === current.id ? t.nodesPage.syncing : t.nodesPage.sync}
                  </button>
                  <button type="button" className={`btn ${showCmd ? 'on' : ''}`} onClick={() => setShowCmd((v) => !v)}>
                    {t.nodesPage.installCmd}
                  </button>
                  <button type="button" className="btn" onClick={() => startEdit(current)}>
                    {t.common.edit}
                  </button>
                  <button type="button" className="btn danger" onClick={() => handleDelete(current)}>
                    {t.common.delete}
                  </button>
                </span>
              </div>

              {showCmd && (
                <div className="panel cmd">
                  <div className="panel-head">
                    <h3>{t.nodesPage.installCmd}</h3>
                    <button type="button" className="btn solid" onClick={() => copySetup(current)}>
                      {t.nodesPage.copyCommand}
                    </button>
                  </div>
                  <div className="hint" style={{ marginTop: -4 }}>
                    {t.nodesPage.setupIntro}
                  </div>
                  <pre onClick={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)}>{setupCommand(current)}</pre>
                  {copyFailed && <div className="hint" style={{ color: 'var(--warn)' }}>{t.copyFailedHint}</div>}
                </div>
              )}

              <div className="kpis">
                <div className="kpi">
                  <span>{nd.todayTraffic}</span>
                  <b>
                    {traffic === undefined ? '—' : <CountUp value={today.value} decimals={today.decimals} />}
                    <small>{today.unit}</small>
                  </b>
                </div>
                <div className="kpi">
                  <span>{nd.total14}</span>
                  <b>
                    {traffic === undefined ? '—' : <CountUp value={total.value} decimals={total.decimals} />}
                    <small>{total.unit}</small>
                  </b>
                </div>
                <div className="kpi">
                  <span>{nd.lastSync}</span>
                  <b className="txt">{ago(current.last_synced_at)}</b>
                </div>
                <div className="kpi">
                  <span>{nd.xray}</span>
                  <b className="en" style={{ fontSize: '1rem' }}>
                    {current.xray_version ?? '—'}
                  </b>
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <h3>{nd.trafficTitle}</h3>
                  <small>{nd.trafficSub}</small>
                </div>
                {traffic === undefined ? (
                  <div className="skel" style={{ height: 170 }} />
                ) : traffic === null ? (
                  <div className="no-data">{t.overviewPage.loadFailed}</div>
                ) : !hasTraffic ? (
                  <div className="no-data">{current.status === 'error' ? nd.noTrafficDown : t.overviewPage.trafficHistoryNoData}</div>
                ) : (
                  <DailyBars points={traffic} lang={lang} label={`${nd.trafficTitle} · ${current.name}`} />
                )}
              </div>

              <div className="two">
                <div className="panel">
                  <div className="panel-head">
                    <h3>{nd.servicesTitle}</h3>
                  </div>
                  <div className="svc">
                    <span className={`tf-led ${current.status === 'connected' ? 'on' : current.status === 'error' ? 'err' : 'wait'}`} aria-hidden="true" />
                    <span className="t">
                      <b>{nd.agent}</b>
                      <small className="en">{nd.agentDetail(current.port)}</small>
                    </span>
                    <span className="up">{t.nodesPage.status[current.status]}</span>
                  </div>
                  <div className="svc">
                    <span className={`tf-led ${core && current.status === 'connected' ? 'on' : core ? 'wait' : ''}`} aria-hidden="true" />
                    <span className="t">
                      <b>Xray{core ? ` · ${core.name}` : ''}</b>
                      <small>{core ? nd.inbounds(core.inbounds.length) : nd.noCore}</small>
                    </span>
                    <span className="up en">{current.xray_version ?? '—'}</span>
                  </div>
                  <div className="svc">
                    <span className={`tf-led ${ipsecCore && current.status === 'connected' ? 'on' : ipsecCore ? 'wait' : ''}`} aria-hidden="true" />
                    <span className="t">
                      <b>{ipsecCore ? `${t.coresPage.coreTypeLabels[ipsecCore.core_type]} · ${ipsecCore.name}` : 'IKEv2 / L2TP'}</b>
                      <small>{ipsecCore ? nd.ipsecOn : nd.noCore}</small>
                    </span>
                    <span className="up">{ipsecCore ? '✓' : '—'}</span>
                  </div>
                  <div className="hint">{t.nodesPage.assignCoreHint}</div>
                </div>
                <div className="panel">
                  <div className="panel-head">
                    <h3>{nd.healthTitle}</h3>
                  </div>
                  {current.last_error ? (
                    <div className="err-box">
                      <b>{t.nodesPage.lastError}</b> {current.last_error}
                    </div>
                  ) : (
                    <div className="hint" style={{ margin: 0 }}>
                      {current.status === 'connected' ? nd.healthy : nd.notSynced}
                    </div>
                  )}
                  <div className="svc">
                    <span className="t">
                      <b>{nd.lastSync}</b>
                      <small>{current.last_synced_at ? parseServerDate(current.last_synced_at).toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-US') : nd.never}</small>
                    </span>
                    <span />
                    <span className="up">{ago(current.last_synced_at)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="skel" style={{ height: 320, borderRadius: 20 }} />
          )}
        </div>
      )}

      {showForm && (
        <Sheet
          title={editingId ? nd.formEdit : t.nodesPage.newBtn.replace(/^\+\s*/, '')}
          sub={t.nodesPage.intro}
          onClose={resetForm}
          footer={
            <>
              <button type="submit" form="node-form" disabled={submitting} className="btn primary lg">
                {submitting ? t.common.saving : editingId ? t.common.save : t.nodesPage.registerBtn}
              </button>
              <button type="button" className="btn lg" onClick={resetForm}>
                {t.usersPage.cancelAction}
              </button>
            </>
          }
        >
          <form id="node-form" onSubmit={handleSubmit} className="form-grid">
            <Field label={t.nodesPage.nameLabel} wide>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </Field>
            <Field label={t.nodesPage.addressLabel}>
              <input className="input ltr" value={address} onChange={(e) => setAddress(e.target.value)} required placeholder="1.2.3.4" />
            </Field>
            <Field label={t.nodesPage.agentPortLabel}>
              <input className="input" type="number" min="1" max="65535" value={port} onChange={(e) => setPort(e.target.value)} placeholder="62050" required />
            </Field>
            <div className="wide hint">{t.nodesPage.assignCoreHint}</div>
            {formError && <div className="wide tf-alert">{formError}</div>}
          </form>
        </Sheet>
      )}
    </div>
  )
}
