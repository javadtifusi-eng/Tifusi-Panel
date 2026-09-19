import { useEffect, useState, type FormEvent } from 'react'
import { IconCopy, IconPlus } from '../components/icons'
import { Empty, Field, Sheet, useReducedMotion, useToast } from '../components/ui'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createTunnel,
  deleteTunnel,
  getTunnelConfig,
  listNodes,
  listTunnels,
  recommendTunnelTransport,
  spoofTestCommands,
  testTunnel,
  updateTunnel,
  type Node,
  type SpoofTestCommands,
  type Tunnel,
  type TunnelConfig,
  type TunnelForward,
  type TunnelRecommendResult,
  type TunnelStatus,
  type TunnelTestResult,
  type TunnelTransport,
  type CdnProvider,
} from '../lib/api'
import { copyToClipboard } from '../lib/clipboard'
import { parseServerDate } from '../lib/format'

// The form offers only the three that earn their place; older tunnels on
// another transport still show (and keep) theirs.
const PICK: TunnelTransport[] = ['tcpmux', 'wssmux', 'udp']
const PILL: Record<TunnelStatus, string> = { connected: 'ok live', pending: 'idle', error: 'bad' }
// The HTTPS ports Cloudflare proxies; it reaches the relay on the same one.
const CF_PORTS = [443, 2053, 2083, 2087, 2096, 8443]

type ForeignSource = 'node' | 'address'

function emptyForward(): TunnelForward {
  return { name: '', listen_port: 0, net: 'tcp', target_port: 0 }
}

function code(name: string): string {
  return (name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '#').toUpperCase()
}

interface MapEnd {
  key: string
  label: string
  sub: string
  x: number
  y: number
}

type StepState = 'wait' | 'now' | 'done' | 'fail' | 'skip'

function stepFor(reachable: boolean | null): StepState {
  return reachable === null ? 'skip' : reachable ? 'done' : 'fail'
}

export default function TunnelsPage({ createSignal = 0 }: { createSignal?: number } = {}) {
  const { t } = useLang()
  const tn = t.ui.tunnels
  const say = useToast()
  const reduce = useReducedMotion()
  const [tunnels, setTunnels] = useState<Tunnel[] | null>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, TunnelTestResult>>({})
  const [steps, setSteps] = useState<Record<number, StepState[]>>({})
  const [configId, setConfigId] = useState<number | null>(null)
  const [configData, setConfigData] = useState<TunnelConfig | null>(null)
  const [recommending, setRecommending] = useState(false)
  const [recommendResult, setRecommendResult] = useState<TunnelRecommendResult | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)

  const [showSpoof, setShowSpoof] = useState(false)
  const [spoofSource, setSpoofSource] = useState<ForeignSource>('node')
  const [spoofNodeId, setSpoofNodeId] = useState<number | null>(null)
  const [spoofForeign, setSpoofForeign] = useState('')
  const [spoofPort, setSpoofPort] = useState('443')
  const [spoofIp, setSpoofIp] = useState('')
  const [spoofBusy, setSpoofBusy] = useState(false)
  const [spoofError, setSpoofError] = useState<string | null>(null)
  const [spoofCmds, setSpoofCmds] = useState<SpoofTestCommands | null>(null)

  const [name, setName] = useState('')
  const [iranAddress, setIranAddress] = useState('')
  const [iranPort, setIranPort] = useState('8443')
  const [foreignSource, setForeignSource] = useState<ForeignSource | null>(null)
  const [foreignNodeId, setForeignNodeId] = useState<number | null>(null)
  const [foreignAddress, setForeignAddress] = useState('')
  const [foreignPort, setForeignPort] = useState('')
  const [transport, setTransport] = useState<TunnelTransport | null>(null)
  const [sni, setSni] = useState('')
  const [domain, setDomain] = useState('')
  const [path, setPath] = useState('')
  const [connectionCount, setConnectionCount] = useState('8')
  const [forwards, setForwards] = useState<TunnelForward[]>([])
  const [useCdn, setUseCdn] = useState(false)
  const [cdnProvider, setCdnProvider] = useState<CdnProvider>('arvan')
  const [cdnHost, setCdnHost] = useState('')
  const [cdnPort, setCdnPort] = useState('443')

  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  async function refresh() {
    try {
      const res = await listTunnels()
      setTunnels(res.tunnels)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.tunnelsPage.fetchError)
    }
  }

  useEffect(() => {
    refresh()
    listNodes()
      .then((res) => setNodes(res.nodes))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (createSignal > 0) openNew()
  }, [createSignal])

  function openNew() {
    resetForm()
    setShowForm(true)
  }

  function resetForm() {
    setEditingId(null)
    setName('')
    setIranAddress('')
    setIranPort('8443')
    setForeignSource(null)
    setForeignNodeId(null)
    setForeignAddress('')
    setForeignPort('')
    setTransport(null)
    setSni('')
    setDomain('')
    setPath('')
    setConnectionCount('8')
    setForwards([])
    setUseCdn(false)
    setCdnProvider('arvan')
    setCdnHost('')
    setCdnPort('443')
    setShowForm(false)
    setRecommendResult(null)
    setFormError(null)
  }

  function startEdit(tunnel: Tunnel) {
    setEditingId(tunnel.id)
    setName(tunnel.name)
    setIranAddress(tunnel.iran_address)
    setIranPort(String(tunnel.iran_port))
    setForeignSource(tunnel.foreign_node_id != null ? 'node' : 'address')
    setForeignNodeId(tunnel.foreign_node_id)
    setForeignAddress(tunnel.foreign_address ?? '')
    setForeignPort(tunnel.foreign_port != null ? String(tunnel.foreign_port) : '')
    setTransport(tunnel.transport)
    setSni(tunnel.sni ?? '')
    setDomain(tunnel.domain ?? '')
    setPath(tunnel.path ?? '')
    setConnectionCount(String(tunnel.connection_count))
    setForwards(tunnel.forwards)
    setUseCdn(!!tunnel.cdn_host)
    setCdnProvider(tunnel.cdn_provider ?? 'arvan')
    setCdnHost(tunnel.cdn_host ?? '')
    setCdnPort(String(tunnel.cdn_port ?? 443))
    setRecommendResult(null)
    setFormError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!transport) return
    if (!foreignSource || (foreignSource === 'node' && foreignNodeId == null) || (foreignSource === 'address' && !foreignAddress)) {
      setFormError(t.tunnelsPage.noNeedForeign)
      return
    }
    // Half-filled rows used to be dropped on save, so the admin walked away
    // believing a port was forwarded when nothing had been stored.
    if (forwards.some((f) => !f.name || !f.listen_port || !f.target_port)) {
      setFormError(t.tunnelsPage.forwardIncomplete)
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      const payload = {
        name,
        iran_address: iranAddress,
        iran_port: parseInt(iranPort, 10),
        foreign_node_id: foreignSource === 'node' ? foreignNodeId : null,
        foreign_address: foreignSource === 'address' ? foreignAddress : null,
        foreign_port: foreignSource === 'address' && foreignPort ? parseInt(foreignPort, 10) : null,
        transport,
        sni: sni || null,
        domain: domain || null,
        path: path || null,
        connection_count: parseInt(connectionCount, 10) || 8,
        forwards,
        cdn_provider: useCdn ? cdnProvider : null,
        cdn_host: useCdn ? cdnHost.trim() || null : null,
        cdn_port: useCdn && cdnProvider === 'cloudflare' ? parseInt(cdnPort, 10) || 443 : null,
      }
      if (editingId) await updateTunnel(editingId, payload)
      else await createTunnel(payload)
      const wasEdit = !!editingId
      resetForm()
      await refresh()
      say(wasEdit ? tn.saved : tn.created)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRecommend() {
    if (!iranAddress) {
      setFormError(t.tunnelsPage.recommendNeedsIran)
      return
    }
    if (!foreignSource || (foreignSource === 'node' && foreignNodeId == null) || (foreignSource === 'address' && !foreignAddress)) {
      setFormError(t.tunnelsPage.noNeedForeign)
      return
    }
    setRecommending(true)
    setFormError(null)
    try {
      const result = await recommendTunnelTransport({
        iran_address: iranAddress,
        iran_port: parseInt(iranPort, 10) || 8443,
        foreign_node_id: foreignSource === 'node' ? foreignNodeId : null,
        foreign_address: foreignSource === 'address' ? foreignAddress : null,
        foreign_port: foreignSource === 'address' && foreignPort ? parseInt(foreignPort, 10) : null,
      })
      setRecommendResult(result)
      if (result.ranked.length > 0) setTransport(result.ranked[0])
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setRecommending(false)
    }
  }

  // The test is one request; the three steps show what it checks and fill in from its result.
  async function handleTest(tunnel: Tunnel) {
    if (testingId !== null) return
    setTestingId(tunnel.id)
    setError(null)
    setSteps((s) => ({ ...s, [tunnel.id]: tunnel.cdn_host ? ['now', 'wait', 'wait', 'wait'] : ['now', 'wait', 'wait'] }))
    const started = performance.now()
    try {
      const result = await testTunnel(tunnel.id)
      const minWait = reduce ? 0 : Math.max(0, 900 - (performance.now() - started))
      await new Promise((r) => window.setTimeout(r, minWait))
      const final: StepState[] = [
        stepFor(result.iran_reachable),
        stepFor(result.foreign_reachable),
        ...(tunnel.cdn_host ? [stepFor(result.cdn_reachable ?? null)] : []),
        result.status === 'connected' ? 'done' : result.status === 'pending' ? 'skip' : 'fail',
      ]
      setSteps((s) => ({ ...s, [tunnel.id]: final }))
      setTestResults((r) => ({ ...r, [tunnel.id]: result }))
      await refresh()
      say(
        result.status === 'connected'
          ? tn.testOk
          : result.status === 'pending'
            ? tn.testSkipped
            : result.error ?? tn.testFail,
      )
      window.setTimeout(() => setSteps((s) => {
        const next = { ...s }
        delete next[tunnel.id]
        return next
      }), 5000)
    } catch (err) {
      setSteps((s) => {
        const next = { ...s }
        delete next[tunnel.id]
        return next
      })
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setTestingId(null)
    }
  }

  async function handleDelete(tunnel: Tunnel) {
    if (!window.confirm(t.tunnelsPage.confirmDelete(tunnel.name))) return
    try {
      await deleteTunnel(tunnel.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  async function toggleConfig(tunnel: Tunnel) {
    if (configId === tunnel.id) {
      setConfigId(null)
      setConfigData(null)
      return
    }
    try {
      const cfg = await getTunnelConfig(tunnel.id)
      setConfigId(tunnel.id)
      setConfigData(cfg)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  async function copy(text: string) {
    if (await copyToClipboard(text)) say(t.common.copiedCheck)
  }

  function openSpoof() {
    setSpoofSource(nodes.length ? 'node' : 'address')
    setSpoofNodeId(null)
    setSpoofForeign('')
    setSpoofPort('443')
    setSpoofIp('')
    setSpoofCmds(null)
    setSpoofError(null)
    setShowSpoof(true)
  }

  async function handleSpoofGenerate(e: FormEvent) {
    e.preventDefault()
    if ((spoofSource === 'node' ? spoofNodeId == null : !spoofForeign) || !spoofIp) {
      setSpoofError(tn.spoofNeedInputs)
      return
    }
    setSpoofBusy(true)
    setSpoofError(null)
    try {
      const cmds = await spoofTestCommands({
        foreign_node_id: spoofSource === 'node' ? spoofNodeId : null,
        foreign_address: spoofSource === 'address' ? spoofForeign : null,
        port: parseInt(spoofPort, 10) || 443,
        spoof_ip: spoofIp,
      })
      setSpoofCmds(cmds)
    } catch (err) {
      setSpoofError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSpoofBusy(false)
    }
  }

  function updateForward(idx: number, patch: Partial<TunnelForward>) {
    setForwards((fs) => fs.map((f, i) => (i === idx ? { ...f, ...patch } : f)))
  }

  // ── Map: Iran entries on the right, servers abroad on the left.
  const list = tunnels ?? []
  const foreignKey = (tu: Tunnel) => (tu.foreign_node_id != null ? `n${tu.foreign_node_id}` : `a${tu.foreign_address}`)
  const foreignLabel = (tu: Tunnel) => {
    const node = tu.foreign_node_id != null ? nodeById.get(tu.foreign_node_id) : undefined
    return { label: node?.name ?? tu.foreign_address ?? '—', sub: node?.address ?? tu.foreign_address ?? '' }
  }
  const irans = [...new Set(list.map((tu) => tu.iran_address))]
  const foreigns = [...new Map(list.map((tu) => [foreignKey(tu), tu])).values()]
  const spread = (i: number, count: number, lo: number, hi: number) => (count <= 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (count - 1))
  const iranEnds: MapEnd[] = irans.map((addr, i) => ({ key: `ir:${addr}`, label: tn.iranEntry, sub: addr, x: 660, y: spread(i, irans.length, 110, 320) }))
  const foreignEnds: MapEnd[] = foreigns.map((tu, i) => ({
    key: `fo:${foreignKey(tu)}`,
    ...foreignLabel(tu),
    x: i % 2 === 0 ? 200 : 250,
    y: spread(i, foreigns.length, 80, 350),
  }))
  const endByKey = new Map([...iranEnds, ...foreignEnds].map((e) => [e.key, e]))
  const pairCount = new Map<string, number>()
  const wires = list.map((tu) => {
    const a = endByKey.get(`ir:${tu.iran_address}`)!
    const b = endByKey.get(`fo:${foreignKey(tu)}`)!
    const pair = `${a.key}|${b.key}`
    const k = pairCount.get(pair) ?? 0
    pairCount.set(pair, k + 1)
    const bend = (k % 2 === 0 ? -1 : 1) * (40 + k * 30)
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2 + bend
    return { tu, a, b, d: `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`, mid: { x: (a.x + 2 * mx + b.x) / 4, y: (a.y + 2 * my + b.y) / 4 } }
  })
  const focused = focusKey ? endByKey.get(focusKey) : iranEnds[0]
  const focusedTunnels = focused
    ? list.filter((tu) => (focused.key.startsWith('ir:') ? `ir:${tu.iran_address}` === focused.key : `fo:${foreignKey(tu)}` === focused.key))
    : []
  const focusedUp = focusedTunnels.filter((tu) => tu.status === 'connected').length
  const focusedDown = focusedTunnels.some((tu) => tu.status === 'error')

  function latencyOf(tu: Tunnel): string {
    const r = testResults[tu.id]
    if (!r) return '—'
    const ms = [r.iran_latency_ms, r.foreign_latency_ms].filter((v): v is number => v != null)
    return ms.length ? `${Math.round(Math.max(...ms))} ms` : '—'
  }

  function checkedAgo(tu: Tunnel): string {
    if (!tu.last_checked_at) return t.tunnelsPage.status.pending
    const minutes = Math.round((Date.now() - parseServerDate(tu.last_checked_at).getTime()) / 60000)
    if (minutes < 60) return t.usersPage.minutesAgo(Math.max(1, minutes))
    const hours = Math.round(minutes / 60)
    return hours < 24 ? t.usersPage.hoursAgo(hours) : t.usersPage.daysAgo(Math.round(hours / 24))
  }

  const stepLabelsFor = (tu: Tunnel) => (tu.cdn_host ? [tn.stepIran, tn.stepForeign, tn.cdnStep(tn.cdnName[tu.cdn_provider ?? 'arvan']), tn.stepTunnel] : [tn.stepIran, tn.stepForeign, tn.stepTunnel])

  return (
    <div className="pg-tunnels">
      <h1 className="sr-only">{t.tunnelsPage.title}</h1>

      {tunnels !== null && tunnels.length > 0 && (
        <div className="map-card">
          <div className="map" dir="ltr">
            <svg viewBox="0 0 900 430" role="img" aria-label={t.tunnelsPage.title}>
              <defs>
                <linearGradient id="tfBeamGrad" x1="0" x2="1">
                  <stop offset="0" stopColor="#f97316" stopOpacity="0" />
                  <stop offset=".6" stopColor="#f97316" />
                  <stop offset="1" stopColor="#fde68a" />
                </linearGradient>
              </defs>
              <g className="sonar">
                {[70, 140, 220, 310].map((r) => (
                  <circle key={r} cx={660} cy={215} r={r} />
                ))}
              </g>
              {wires.map(({ tu, d, mid }) =>
                tu.status === 'connected' ? (
                  <g key={tu.id}>
                    <path id={`tfw${tu.id}`} className="wire-base" d={d} />
                    <path className="wire-beam" d={d} style={{ animationDelay: `${-(tu.id % 5) * 0.6}s` }} />
                    {!reduce && (
                      <circle className="packet" r={3.2}>
                        <animateMotion dur={`${2.6 + (tu.id % 3) * 0.5}s`} repeatCount="indefinite" path={d} />
                      </circle>
                    )}
                  </g>
                ) : tu.status === 'error' ? (
                  <g key={tu.id}>
                    <path className="wire-cut" d={d} />
                    <g transform={`translate(${mid.x} ${mid.y})`}>
                      <line className="xmark" x1={-7} y1={-7} x2={7} y2={7} />
                      <line className="xmark" x1={7} y1={-7} x2={-7} y2={7} />
                    </g>
                  </g>
                ) : (
                  <path key={tu.id} className="wire-wait" d={d} />
                ),
              )}
              {foreignEnds.map((e) => {
                const mine = list.filter((tu) => `fo:${foreignKey(tu)}` === e.key)
                const down = mine.some((tu) => tu.status === 'error')
                const up = mine.some((tu) => tu.status === 'connected')
                return (
                  <g
                    key={e.key}
                    className={`mnode ${focused?.key === e.key ? 'active' : ''}`}
                    tabIndex={0}
                    onPointerEnter={() => setFocusKey(e.key)}
                    onFocus={() => setFocusKey(e.key)}
                  >
                    {up && !reduce && (
                      <g className="orbit" style={{ transformOrigin: `${e.x}px ${e.y}px` }}>
                        <circle cx={e.x} cy={e.y - 44} r={3} />
                        <circle cx={e.x + 40} cy={e.y} r={2.4} />
                        <circle cx={e.x - 30} cy={e.y + 32} r={2.2} />
                      </g>
                    )}
                    <circle className="disc" cx={e.x} cy={e.y} r={26} style={down ? { stroke: 'rgb(239 68 68 / .5)' } : undefined} />
                    <text className="code" x={e.x} y={e.y + 4} style={down ? { fill: '#ef4444' } : undefined}>
                      {code(e.label)}
                    </text>
                    <text x={e.x} y={e.y + 46}>
                      {e.label}
                    </text>
                    <text className="sub" x={e.x} y={e.y + 60}>
                      {e.sub !== e.label ? e.sub : ''}
                    </text>
                  </g>
                )
              })}
              {iranEnds.map((e) => (
                <g
                  key={e.key}
                  className={`mnode ${focused?.key === e.key ? 'active' : ''}`}
                  tabIndex={0}
                  onPointerEnter={() => setFocusKey(e.key)}
                  onFocus={() => setFocusKey(e.key)}
                >
                  {!reduce && list.some((tu) => tu.status === 'connected') && (
                    <circle className="hub-pulse" cx={e.x} cy={e.y} r={34} strokeWidth={1.5} />
                  )}
                  <circle className="disc" cx={e.x} cy={e.y} r={34} style={{ stroke: 'rgb(249 115 22 / .55)' }} />
                  <text className="code" x={e.x} y={e.y + 5} style={{ fontSize: 14 }}>
                    IR
                  </text>
                  <text x={e.x} y={e.y + 56}>
                    {tn.iranEntry}
                  </text>
                  <text className="sub" x={e.x} y={e.y + 70}>
                    {e.sub}
                  </text>
                </g>
              ))}
            </svg>
          </div>
          <aside className="details" aria-live="polite">
            {focused && (
              <>
                <h3>
                  <span className="dot" style={{ ['--c' as string]: focusedDown ? 'var(--bad)' : focusedUp ? 'var(--ok)' : 'var(--muted)' }} />
                  <span className="en" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {focused.label}
                  </span>
                </h3>
                <div className="route mono">{focused.sub}</div>
                <div className="tf-facts">
                  <div>
                    <span>{t.tunnelsPage.title}</span>
                    <b className="en">{focusedTunnels.length}</b>
                  </div>
                  <div>
                    <span>{t.tunnelsPage.status.connected}</span>
                    <b className="en">
                      {focusedUp} / {focusedTunnels.length}
                    </b>
                  </div>
                  <div>
                    <span>{t.tunnelsPage.transportLabel}</span>
                    <b className="en">{[...new Set(focusedTunnels.map((tu) => tu.transport.toUpperCase()))].join(', ') || '—'}</b>
                  </div>
                  <div>
                    <span>{tn.forwardsTitle}</span>
                    <b className="en">{focusedTunnels.reduce((s, tu) => s + tu.forwards.length, 0)}</b>
                  </div>
                </div>
                <div className="hint" style={{ margin: 0 }}>
                  {tn.mapHint}
                </div>
              </>
            )}
            <div className="map-legend">
              <span>
                <i style={{ background: 'linear-gradient(90deg,#f97316,#fde68a)' }} />
                {tn.legendUp}
              </span>
              <span>
                <i style={{ background: 'repeating-linear-gradient(90deg,#ef4444 0 4px,transparent 4px 9px)' }} />
                {tn.legendDown}
              </span>
              <span>
                <i style={{ background: 'repeating-linear-gradient(90deg,#5c5c5c 0 2px,transparent 2px 8px)' }} />
                {tn.legendWait}
              </span>
            </div>
          </aside>
        </div>
      )}

      <div className="sub-head">
        <h2>
          {t.tunnelsPage.title}
          {tunnels && (
            <span className="chip en" style={{ marginInlineStart: 8 }}>
              {tunnels.length}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <button type="button" className="btn solid" onClick={openNew}>
            <IconPlus size={14} />
            {t.tunnelsPage.newBtn.replace(/^\+\s*/, '')}
          </button>
        </div>
      </div>

      {error && <div className="tf-alert">{error}</div>}

      {tunnels === null ? (
        <div className="cards">
          {[0, 1].map((i) => (
            <div key={i} className="skel" style={{ height: 210, borderRadius: 18 }} />
          ))}
        </div>
      ) : tunnels.length === 0 ? (
        <Empty
          title={t.tunnelsPage.noTunnelsYet}
          text={t.tunnelsPage.intro}
          action={
            <button type="button" className="btn solid" onClick={openNew}>
              <IconPlus size={14} />
              {t.tunnelsPage.newBtn.replace(/^\+\s*/, '')}
            </button>
          }
        />
      ) : (
        <div className="cards">
          {tunnels.map((tunnel) => {
            const foreign = foreignLabel(tunnel)
            const isTesting = testingId === tunnel.id
            const tunnelSteps = steps[tunnel.id]
            return (
              <div key={tunnel.id} className={`rc-shell ${isTesting ? 'testing' : ''}`}>
                <article className="route-card">
                  <div className="top-strip">
                    <span className="name">{tunnel.name}</span>
                    <span className={`pill ${PILL[tunnel.status]}`}>
                      <i />
                      {isTesting ? t.tunnelsPage.testing : t.tunnelsPage.status[tunnel.status]}
                    </span>
                  </div>
                  <div className="route">
                    <div className="end">
                      <span className="box">IR</span>
                      <small>
                        {tunnel.iran_address}:{tunnel.iran_port}
                      </small>
                    </div>
                    <svg className="wire" viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden="true">
                      {tunnel.status === 'connected' ? (
                        <>
                          <line x1="0" y1="12" x2="200" y2="12" />
                          <line className="flow" x1="0" y1="12" x2="200" y2="12" />
                        </>
                      ) : (
                        <line className={tunnel.status === 'error' ? 'cut' : 'wait'} x1="0" y1="12" x2="200" y2="12" />
                      )}
                    </svg>
                    <div className="end">
                      <span className="box" style={tunnel.status === 'error' ? { color: 'var(--bad)' } : undefined}>
                        {code(foreign.label)}
                      </span>
                      <small>{foreign.label}</small>
                    </div>
                  </div>
                  <div className="facts-line">
                    <span>
                      {t.tunnelsPage.transportLabel} <b className="en">{t.tunnelsPage.transportLabels[tunnel.transport]}</b>
                    </span>
                    <span>
                      {tn.ports}{' '}
                      <b className="mono">
                        {tunnel.forwards.length ? tunnel.forwards.map((f) => `${f.listen_port}→${f.target_port}`).join(' · ') : '—'}
                      </b>
                    </span>
                    <span>
                      {tn.latency} <b className="en">{latencyOf(tunnel)}</b>
                    </span>
                    {tunnel.cdn_host && (
                      <span>
                        {tn.viaCdn} <b className="en">{tn.cdnName[tunnel.cdn_provider ?? 'arvan']} · {tunnel.cdn_host}</b>
                      </span>
                    )}
                    <span>
                      {tn.checked} <b>{checkedAgo(tunnel)}</b>
                    </span>
                  </div>
                  {tunnel.last_error && tunnel.status === 'error' && <p className="alert">{tunnel.last_error}</p>}
                  {tunnelSteps && (
                    <ol className="steps">
                      {stepLabelsFor(tunnel).map((label, i) => (
                        <li key={label} className={tunnelSteps[i] === 'wait' ? '' : tunnelSteps[i]}>
                          <span className="ic">
                            {tunnelSteps[i] === 'done' ? '✓' : tunnelSteps[i] === 'fail' ? '✕' : tunnelSteps[i] === 'skip' ? '–' : tunnelSteps[i] === 'now' ? '' : i + 1}
                          </span>
                          {label}
                        </li>
                      ))}
                    </ol>
                  )}
                  {configId === tunnel.id && configData && (
                    <div className="cfg">
                      {(
                        [
                          [t.tunnelsPage.iranInstallCommandLabel, configData.iran_install_command],
                          [t.tunnelsPage.foreignInstallCommandLabel, configData.foreign_install_command],
                        ] as const
                      ).map(([label, command]) => (
                        <div key={label} className="tf-linkrow">
                          <span style={{ flex: 1, fontSize: '.76rem', color: 'var(--muted)' }}>{label}</span>
                          <button type="button" className="btn solid" onClick={() => copy(command)}>
                            <IconCopy size={13} />
                            {t.tunnelsPage.copyConfig}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="foot">
                    <button type="button" className="btn solid" onClick={() => handleTest(tunnel)} disabled={testingId !== null}>
                      {isTesting ? t.tunnelsPage.testing : t.tunnelsPage.test}
                    </button>
                    <button type="button" className={`btn ${configId === tunnel.id ? 'on' : ''}`} onClick={() => toggleConfig(tunnel)}>
                      {tn.installCmd}
                    </button>
                    <button type="button" className="btn" onClick={() => startEdit(tunnel)}>
                      {t.common.edit}
                    </button>
                    <button type="button" className="btn danger" onClick={() => handleDelete(tunnel)}>
                      {t.common.delete}
                    </button>
                  </div>
                </article>
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <Sheet
          title={editingId ? tn.formEdit(name) : tn.formNew}
          sub={t.tunnelsPage.intro}
          onClose={resetForm}
          width={600}
          footer={
            <>
              <button type="submit" form="tunnel-form" disabled={submitting || !transport} className="btn primary lg">
                {submitting ? t.common.saving : editingId ? t.common.save : t.tunnelsPage.registerBtn}
              </button>
              <button type="button" className="btn lg" onClick={resetForm}>
                {t.usersPage.cancelAction}
              </button>
            </>
          }
        >
          <form id="tunnel-form" onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <div className="form-grid">
              <Field label={t.tunnelsPage.nameLabel} wide>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </Field>
              <Field label={t.tunnelsPage.iranAddressLabel}>
                <input className="input ltr" value={iranAddress} onChange={(e) => setIranAddress(e.target.value)} required placeholder="1.2.3.4" />
              </Field>
              <Field label={t.tunnelsPage.iranPortLabel}>
                <input className="input" type="number" min="1" max="65535" value={iranPort} onChange={(e) => setIranPort(e.target.value)} required />
              </Field>
            </div>

            <div className="form-section">
              <h4>{t.tunnelsPage.foreignSourceLabel}</h4>
              <div className="tf-seg" style={{ alignSelf: 'flex-start' }}>
                {(['node', 'address'] as ForeignSource[]).map((src) => (
                  <button key={src} type="button" aria-pressed={foreignSource === src} onClick={() => setForeignSource(src)}>
                    {src === 'node' ? t.tunnelsPage.foreignNodeOption : t.tunnelsPage.foreignAddressOption}
                  </button>
                ))}
              </div>
              {foreignSource === 'node' && (
                <Field label={t.tunnelsPage.foreignNodeLabel}>
                  <select className="input" value={foreignNodeId ?? ''} onChange={(e) => setForeignNodeId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">{t.coresPage.selectPlaceholder}</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {foreignSource === 'address' && (
                <div className="form-grid">
                  <Field label={t.tunnelsPage.foreignAddressLabel}>
                    <input className="input ltr" value={foreignAddress} onChange={(e) => setForeignAddress(e.target.value)} placeholder="5.6.7.8" />
                  </Field>
                  <Field label={t.tunnelsPage.foreignPortLabel}>
                    <input className="input" type="number" min="1" max="65535" value={foreignPort} onChange={(e) => setForeignPort(e.target.value)} placeholder="22" />
                  </Field>
                  <div className="hint" style={{ margin: 0, gridColumn: '1 / -1' }}>
                    {t.tunnelsPage.foreignPortHint}
                  </div>
                </div>
              )}
            </div>

            <div className="form-section">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 style={{ margin: 0 }} title={t.tunnelsPage.transportHint}>
                  {t.tunnelsPage.transportLabel}
                </h4>
                <button type="button" onClick={handleRecommend} disabled={recommending} className="btn">
                  {recommending ? t.tunnelsPage.recommending : t.tunnelsPage.recommendBtn}
                </button>
              </div>
              {recommendResult && (
                <div className="tf-facts">
                  <div>
                    <span>{t.tunnelsPage.testResultIran}</span>
                    <b style={{ color: recommendResult.iran_reachable ? 'var(--ok)' : 'var(--bad)' }}>
                      {recommendResult.iran_reachable ? `${t.tunnelsPage.reachable} (${Math.round(recommendResult.iran_latency_ms ?? 0)}ms)` : t.tunnelsPage.unreachable}
                    </b>
                  </div>
                  <div>
                    <span>{t.tunnelsPage.testResultForeign}</span>
                    <b style={{ color: recommendResult.foreign_reachable ? 'var(--ok)' : 'var(--bad)' }}>
                      {recommendResult.foreign_reachable
                        ? `${t.tunnelsPage.reachable} (${Math.round(recommendResult.foreign_latency_ms ?? 0)}ms)`
                        : t.tunnelsPage.unreachable}
                    </b>
                  </div>
                </div>
              )}
              {recommendResult && <div className="hint" style={{ margin: 0 }}>{t.tunnelsPage.recommendReason[recommendResult.link]}</div>}
              <div className="tr-pick">
                {(() => {
                  const base = transport && !PICK.includes(transport) ? [...PICK, transport] : PICK
                  const order = recommendResult ? recommendResult.ranked.filter((x) => base.includes(x)) : base
                  return order.map((tr, i) => (
                    <button key={tr} type="button" onClick={() => setTransport(tr)} aria-pressed={transport === tr} className="tr-card">
                      <b>
                        {recommendResult && i === 0 ? '★ ' : ''}
                        {tn.pickName[tr] ?? t.tunnelsPage.transportLabels[tr]}
                      </b>
                      <small>{tn.pickTag[tr] ?? tn.pickLegacy}</small>
                    </button>
                  ))
                })()}
                <button
                  type="button"
                  className="tr-card spoof"
                  onClick={() => {
                    setShowForm(false)
                    openSpoof()
                  }}
                >
                  <b>IP Spoofing</b>
                  <small>{tn.pickSpoof}</small>
                </button>
              </div>
            </div>

            {(transport === 'wss' || transport === 'wssmux') && (
            <div className="form-section">
              <label className="sh-check">
                <input
                  id="tunnel-cdn"
                  type="checkbox"
                  checked={useCdn}
                  onChange={(e) => {
                    setUseCdn(e.target.checked)
                    if (e.target.checked && transport !== 'wss' && transport !== 'wssmux') setTransport('wssmux')
                  }}
                />
                <b>{tn.cdnToggle}</b>
              </label>
              <div className="hint" style={{ margin: 0 }}>
                {tn.cdnIntro}
              </div>
              {useCdn && (
                <>
                  <div className="tf-seg" style={{ alignSelf: 'flex-start' }}>
                    {(['arvan', 'cloudflare'] as CdnProvider[]).map((p) => (
                      <button key={p} type="button" aria-pressed={cdnProvider === p} onClick={() => setCdnProvider(p)}>
                        {tn.cdnName[p]}
                        {p === 'arvan' ? ` · ${tn.cdnRecommended}` : ''}
                      </button>
                    ))}
                  </div>
                  <div className="form-grid">
                    <Field label={tn.cdnHostLabel} htmlFor="tunnel-cdn-host">
                      <input id="tunnel-cdn-host" className="input ltr" value={cdnHost} onChange={(e) => setCdnHost(e.target.value)} placeholder={cdnProvider === 'arvan' ? 'tun.example.ir' : 'tun.example.com'} required />
                    </Field>
                    {cdnProvider === 'cloudflare' ? (
                      <Field label={tn.cdnPortLabel} htmlFor="tunnel-cdn-port">
                        <select
                          id="tunnel-cdn-port"
                          className="input"
                          value={cdnPort}
                          onChange={(e) => {
                            setCdnPort(e.target.value)
                            setIranPort(e.target.value)
                          }}
                        >
                          {CF_PORTS.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ) : null}
                  </div>
                  {(transport !== 'wss' && transport !== 'wssmux') && <div className="tf-alert">{tn.cdnNeedsWss}</div>}
                  <ol className="cdn-steps">
                    {(cdnProvider === 'arvan'
                      ? tn.cdnStepsArvan(cdnHost.trim() || 'tun.example.ir', iranAddress || 'IP', iranPort || '8443')
                      : tn.cdnStepsCloudflare(cdnHost.trim() || 'tun.example.com', iranAddress || 'IP', cdnPort)
                    ).map((step: string, i: number) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </>
              )}
            </div>
            )}

            {!useCdn && transport && (transport === 'tls' || transport === 'ws' || transport === 'wss' || transport === 'wsmux' || transport === 'wssmux') && (
              <div className="form-grid">
                {(transport === 'tls' || transport === 'wss' || transport === 'wssmux') && (
                  <>
                    <Field label={t.tunnelsPage.sniLabel}>
                      <input className="input ltr" value={sni} onChange={(e) => setSni(e.target.value)} placeholder="www.bing.com" />
                    </Field>
                    <Field label={t.tunnelsPage.domainLabel}>
                      <input className="input ltr" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="vpn.example.com" />
                    </Field>
                  </>
                )}
                {(transport === 'ws' || transport === 'wss' || transport === 'wsmux' || transport === 'wssmux') && (
                  <Field label={t.tunnelsPage.pathLabel}>
                    <input className="input ltr" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/tunnel" />
                  </Field>
                )}
              </div>
            )}

            <Field label={t.tunnelsPage.connectionCountLabel}>
              <input className="input" type="number" min="1" max="256" value={connectionCount} onChange={(e) => setConnectionCount(e.target.value)} />
            </Field>

            <div className="form-section">
              <div className="flex items-center justify-between gap-2">
                <h4 style={{ margin: 0 }}>{t.tunnelsPage.forwardsLabel}</h4>
                <button type="button" onClick={() => setForwards((fs) => [...fs, emptyForward()])} className="btn">
                  {t.tunnelsPage.addForwardBtn}
                </button>
              </div>
              {forwards.map((fwd, idx) => (
                <div key={idx} className="rule-edit" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8, padding: 8, borderRadius: 12, border: '1px solid var(--hair)', background: 'var(--well)' }}>
                  <input className="input" style={{ flex: '1 1 110px', width: 'auto' }} value={fwd.name} onChange={(e) => updateForward(idx, { name: e.target.value })} placeholder={t.tunnelsPage.forwardNameLabel} />
                  <input
                    className="input ltr"
                    style={{ flex: '1 1 110px', width: 'auto' }}
                    type="number"
                    value={fwd.listen_port || ''}
                    onChange={(e) => updateForward(idx, { listen_port: parseInt(e.target.value, 10) || 0 })}
                    placeholder={t.tunnelsPage.forwardListenPortLabel}
                  />
                  <select className="input" style={{ flex: '0 1 90px', width: 'auto' }} value={fwd.net} onChange={(e) => updateForward(idx, { net: e.target.value as 'tcp' | 'udp' })}>
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                  </select>
                  <input
                    className="input ltr"
                    style={{ flex: '1 1 110px', width: 'auto' }}
                    type="number"
                    value={fwd.target_port || ''}
                    onChange={(e) => updateForward(idx, { target_port: parseInt(e.target.value, 10) || 0 })}
                    placeholder={t.tunnelsPage.forwardTargetPortLabel}
                  />
                  <button type="button" onClick={() => setForwards((fs) => fs.filter((_, i) => i !== idx))} className="btn danger">
                    {t.tunnelsPage.removeForward}
                  </button>
                </div>
              ))}
            </div>

            {formError && <div className="tf-alert">{formError}</div>}
          </form>
        </Sheet>
      )}

      {showSpoof && (
        <Sheet
          title={tn.spoofTestBtn}
          sub={tn.spoofIntro}
          onClose={() => setShowSpoof(false)}
          width={600}
          footer={
            <button type="button" className="btn lg" onClick={() => setShowSpoof(false)}>
              {t.usersPage.cancelAction}
            </button>
          }
        >
          <form onSubmit={handleSpoofGenerate} className="flex flex-col gap-3.5">
            <div className="form-section">
              <h4>{t.tunnelsPage.foreignSourceLabel}</h4>
              <div className="tf-seg" style={{ alignSelf: 'flex-start' }}>
                {(['node', 'address'] as ForeignSource[]).map((src) => (
                  <button key={src} type="button" aria-pressed={spoofSource === src} onClick={() => setSpoofSource(src)}>
                    {src === 'node' ? t.tunnelsPage.foreignNodeOption : t.tunnelsPage.foreignAddressOption}
                  </button>
                ))}
              </div>
              {spoofSource === 'node' && (
                <Field label={t.tunnelsPage.foreignNodeLabel}>
                  <select className="input" value={spoofNodeId ?? ''} onChange={(e) => setSpoofNodeId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">{t.coresPage.selectPlaceholder}</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} — {n.address}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <div className="form-grid">
              {spoofSource === 'address' && (
                <Field label={tn.spoofForeignLabel}>
                  <input className="input ltr" value={spoofForeign} onChange={(e) => setSpoofForeign(e.target.value)} placeholder="5.6.7.8" />
                </Field>
              )}
              <Field label={tn.spoofPortLabel}>
                <input className="input" type="number" min="1" max="65535" value={spoofPort} onChange={(e) => setSpoofPort(e.target.value)} />
              </Field>
              <Field label={tn.spoofIpLabel} wide>
                <input className="input ltr" value={spoofIp} onChange={(e) => setSpoofIp(e.target.value)} placeholder="1.2.3.4 · 1.2.3.0/24 · 1.2.3.4-1.2.3.9" required />
              </Field>
            </div>
            <div className="hint" style={{ margin: 0 }}>{tn.spoofIpHint}</div>
            <button type="submit" className="btn primary" disabled={spoofBusy}>
              {spoofBusy ? t.common.saving : tn.spoofGenerate}
            </button>
            {spoofError && <div className="tf-alert">{spoofError}</div>}
          </form>

          {spoofCmds && (
            <div className="flex flex-col gap-3" style={{ marginTop: 16 }}>
              <ol className="tf-spoof-steps">
                <li>
                  <b>{tn.spoofStep1}</b>
                  <div className="tf-linkrow">
                    <code style={{ flex: 1, fontSize: '.72rem', overflowWrap: 'anywhere' }}>{spoofCmds.foreign_recv_command}</code>
                    <button type="button" className="btn solid" onClick={() => copy(spoofCmds.foreign_recv_command)}>
                      <IconCopy size={13} />
                    </button>
                  </div>
                </li>
                <li>
                  <b>{tn.spoofStep2}</b>
                  <div className="tf-linkrow">
                    <code style={{ flex: 1, fontSize: '.72rem', overflowWrap: 'anywhere' }}>{spoofCmds.iran_send_command}</code>
                    <button type="button" className="btn solid" onClick={() => copy(spoofCmds.iran_send_command)}>
                      <IconCopy size={13} />
                    </button>
                  </div>
                </li>
                <li>
                  <b>{tn.spoofStep3}</b>
                  <div className="hint" style={{ margin: 0 }}>{tn.spoofStep3Hint}</div>
                </li>
              </ol>
            </div>
          )}
        </Sheet>
      )}
    </div>
  )
}
