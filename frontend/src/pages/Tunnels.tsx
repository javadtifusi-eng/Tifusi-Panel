import { useEffect, useState, type FormEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createTunnel,
  deleteTunnel,
  getTunnelConfig,
  listNodes,
  listTunnels,
  recommendTunnelTransport,
  testTunnel,
  updateTunnel,
  type Node,
  type Tunnel,
  type TunnelConfig,
  type TunnelForward,
  type TunnelRecommendResult,
  type TunnelStatus,
  type TunnelTestResult,
  type TunnelTransport,
} from '../lib/api'

const ACCENT = '#22D3EE'

const TRANSPORTS: TunnelTransport[] = ['tcp', 'tls', 'ws', 'wss', 'tcpmux', 'wsmux', 'wssmux', 'udp']

const statusDot: Record<TunnelStatus, string> = {
  connected: 'bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.6)]',
  pending: 'bg-slate-500',
  error: 'bg-red-400 shadow-[0_0_8px_2px_rgba(248,113,113,0.5)]',
}

const statusBadge: Record<TunnelStatus, string> = {
  connected: 'bg-success-tint text-success border-success',
  pending: 'bg-neutral-tint text-muted border-neutral',
  error: 'bg-danger-tint text-danger border-danger',
}

const inputClass =
  'rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60'
const labelClass = 'mb-1.5 block text-xs text-muted'

type ForeignSource = 'node' | 'address'

function emptyForward(): TunnelForward {
  return { name: '', listen_port: 0, net: 'tcp', target_port: 0 }
}

export default function TunnelsPage() {
  const { t } = useLang()
  const [tunnels, setTunnels] = useState<Tunnel[] | null>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, TunnelTestResult>>({})
  const [configId, setConfigId] = useState<number | null>(null)
  const [configData, setConfigData] = useState<TunnelConfig | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [recommending, setRecommending] = useState(false)
  const [recommendResult, setRecommendResult] = useState<TunnelRecommendResult | null>(null)

  const [name, setName] = useState('')
  const [iranAddress, setIranAddress] = useState('')
  const [iranPort, setIranPort] = useState('8443')
  const [foreignSource, setForeignSource] = useState<ForeignSource | null>(null)
  const [foreignNodeId, setForeignNodeId] = useState<number | null>(null)
  const [foreignAddress, setForeignAddress] = useState('')
  const [transport, setTransport] = useState<TunnelTransport | null>(null)
  const [sni, setSni] = useState('')
  const [domain, setDomain] = useState('')
  const [path, setPath] = useState('')
  const [connectionCount, setConnectionCount] = useState('8')
  const [forwards, setForwards] = useState<TunnelForward[]>([])

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

  function resetForm() {
    setEditingId(null)
    setName('')
    setIranAddress('')
    setIranPort('8443')
    setForeignSource(null)
    setForeignNodeId(null)
    setForeignAddress('')
    setTransport(null)
    setSni('')
    setDomain('')
    setPath('')
    setConnectionCount('8')
    setForwards([])
    setShowForm(false)
    setRecommendResult(null)
  }

  function startEdit(tunnel: Tunnel) {
    setEditingId(tunnel.id)
    setName(tunnel.name)
    setIranAddress(tunnel.iran_address)
    setIranPort(String(tunnel.iran_port))
    setForeignSource(tunnel.foreign_node_id != null ? 'node' : 'address')
    setForeignNodeId(tunnel.foreign_node_id)
    setForeignAddress(tunnel.foreign_address ?? '')
    setTransport(tunnel.transport)
    setSni(tunnel.sni ?? '')
    setDomain(tunnel.domain ?? '')
    setPath(tunnel.path ?? '')
    setConnectionCount(String(tunnel.connection_count))
    setForwards(tunnel.forwards)
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!transport) return
    if (!foreignSource || (foreignSource === 'node' && foreignNodeId == null) || (foreignSource === 'address' && !foreignAddress)) {
      setError(t.tunnelsPage.noNeedForeign)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        name,
        iran_address: iranAddress,
        iran_port: parseInt(iranPort, 10),
        foreign_node_id: foreignSource === 'node' ? foreignNodeId : null,
        foreign_address: foreignSource === 'address' ? foreignAddress : null,
        transport,
        sni: sni || null,
        domain: domain || null,
        path: path || null,
        connection_count: parseInt(connectionCount, 10) || 8,
        forwards: forwards.filter((f) => f.name && f.listen_port && f.target_port),
      }
      if (editingId) {
        await updateTunnel(editingId, payload)
      } else {
        await createTunnel(payload)
      }
      resetForm()
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRecommend() {
    if (!iranAddress) {
      setError(t.tunnelsPage.recommendNeedsIran)
      return
    }
    if (!foreignSource || (foreignSource === 'node' && foreignNodeId == null) || (foreignSource === 'address' && !foreignAddress)) {
      setError(t.tunnelsPage.noNeedForeign)
      return
    }
    setRecommending(true)
    setError(null)
    try {
      const result = await recommendTunnelTransport({
        iran_address: iranAddress,
        iran_port: parseInt(iranPort, 10) || 8443,
        foreign_node_id: foreignSource === 'node' ? foreignNodeId : null,
        foreign_address: foreignSource === 'address' ? foreignAddress : null,
      })
      setRecommendResult(result)
      if (result.ranked.length > 0) setTransport(result.ranked[0].transport)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setRecommending(false)
    }
  }

  async function handleTest(tunnel: Tunnel) {
    if (testingId !== null) return
    setTestingId(tunnel.id)
    setError(null)
    try {
      const result = await testTunnel(tunnel.id)
      setTestResults((r) => ({ ...r, [tunnel.id]: result }))
      await refresh()
    } catch (err) {
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
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard API unavailable; the text stays visible to select by hand.
    }
    setCopied(text)
    window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500)
  }

  function updateForward(idx: number, patch: Partial<TunnelForward>) {
    setForwards((fs) => fs.map((f, i) => (i === idx ? { ...f, ...patch } : f)))
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold text-heading">{t.tunnelsPage.title}</h1>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
        >
          {t.tunnelsPage.newBtn}
        </button>
      </div>
      <p className="mb-6 text-sm text-muted">{t.tunnelsPage.intro}</p>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 flex flex-col gap-4 rounded-xl border border-cyan-400/20 bg-surface p-4"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={labelClass}>{t.tunnelsPage.nameLabel}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t.tunnelsPage.iranAddressLabel}</label>
              <input
                dir="ltr"
                value={iranAddress}
                onChange={(e) => setIranAddress(e.target.value)}
                required
                placeholder="1.2.3.4"
                className={`${inputClass} text-left`}
              />
            </div>
            <div>
              <label className={labelClass}>{t.tunnelsPage.iranPortLabel}</label>
              <input
                type="number"
                min="1"
                max="65535"
                value={iranPort}
                onChange={(e) => setIranPort(e.target.value)}
                required
                className={`${inputClass} w-28`}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={labelClass}>{t.tunnelsPage.foreignSourceLabel}</label>
              <div className="flex gap-2">
                {(['node', 'address'] as ForeignSource[]).map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setForeignSource(src)}
                    className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                      foreignSource === src
                        ? 'border-cyan-400/60 bg-accent-tint text-accent'
                        : 'border-edge text-muted hover:border-strong'
                    }`}
                  >
                    {src === 'node' ? t.tunnelsPage.foreignNodeOption : t.tunnelsPage.foreignAddressOption}
                  </button>
                ))}
              </div>
            </div>
            {foreignSource === 'node' && (
              <div>
                <label className={labelClass}>{t.tunnelsPage.foreignNodeLabel}</label>
                <select
                  value={foreignNodeId ?? ''}
                  onChange={(e) => setForeignNodeId(e.target.value ? Number(e.target.value) : null)}
                  className={inputClass}
                >
                  <option value="">{t.coresPage.selectPlaceholder}</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {foreignSource === 'address' && (
              <div>
                <label className={labelClass}>{t.tunnelsPage.foreignAddressLabel}</label>
                <input
                  dir="ltr"
                  value={foreignAddress}
                  onChange={(e) => setForeignAddress(e.target.value)}
                  placeholder="5.6.7.8"
                  className={`${inputClass} text-left`}
                />
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-xs text-muted" title={t.tunnelsPage.transportHint}>
                {t.tunnelsPage.transportLabel}
              </label>
              <button
                type="button"
                onClick={handleRecommend}
                disabled={recommending}
                className="text-xs font-bold disabled:opacity-60"
                style={{ color: ACCENT }}
              >
                {recommending ? t.tunnelsPage.recommending : t.tunnelsPage.recommendBtn}
              </button>
            </div>
            {recommendResult && (
              <div className="mb-2 flex flex-col gap-1 rounded-lg border border-subtle bg-well p-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted">{t.tunnelsPage.testResultIran}</span>
                  <span className={recommendResult.iran_reachable ? 'text-success' : 'text-danger'}>
                    {recommendResult.iran_reachable
                      ? `${t.tunnelsPage.reachable} (${Math.round(recommendResult.iran_latency_ms ?? 0)}ms)`
                      : t.tunnelsPage.unreachable}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">{t.tunnelsPage.testResultForeign}</span>
                  <span className={recommendResult.foreign_reachable ? 'text-success' : 'text-danger'}>
                    {recommendResult.foreign_reachable
                      ? `${t.tunnelsPage.reachable} (${Math.round(recommendResult.foreign_latency_ms ?? 0)}ms)`
                      : t.tunnelsPage.unreachable}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {recommendResult.ranked.map((r, i) => (
                    <button
                      key={r.transport}
                      type="button"
                      onClick={() => setTransport(r.transport)}
                      className={`rounded-md border px-2 py-1 text-[10.5px] font-bold ${
                        transport === r.transport ? 'border-cyan-400/60 bg-accent-tint text-accent' : 'border-edge text-muted'
                      }`}
                    >
                      {i === 0 ? '★ ' : ''}
                      {t.tunnelsPage.transportLabels[r.transport]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {TRANSPORTS.map((tr) => (
                <button
                  key={tr}
                  type="button"
                  onClick={() => setTransport(tr)}
                  title={t.tunnelsPage.transportHints[tr]}
                  className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                    transport === tr
                      ? 'border-cyan-400/60 bg-accent-tint text-accent'
                      : 'border-edge text-muted hover:border-strong'
                  }`}
                >
                  {t.tunnelsPage.transportLabels[tr]}
                </button>
              ))}
            </div>
            {transport && <div className="mt-1.5 text-[11px] text-faint">{t.tunnelsPage.transportHints[transport]}</div>}
          </div>

          {transport && (transport === 'tls' || transport === 'ws' || transport === 'wss' || transport === 'wsmux' || transport === 'wssmux') && (
            <div className="flex flex-wrap items-end gap-3">
              {(transport === 'tls' || transport === 'wss' || transport === 'wssmux') && (
                <div>
                  <label className={labelClass}>{t.tunnelsPage.sniLabel}</label>
                  <input
                    dir="ltr"
                    value={sni}
                    onChange={(e) => setSni(e.target.value)}
                    placeholder="www.bing.com"
                    className={`${inputClass} text-left`}
                  />
                </div>
              )}
              {(transport === 'tls' || transport === 'wss' || transport === 'wssmux') && (
                <div>
                  <label className={labelClass}>{t.tunnelsPage.domainLabel}</label>
                  <input
                    dir="ltr"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="vpn.example.com"
                    className={`${inputClass} text-left`}
                  />
                </div>
              )}
              {(transport === 'ws' || transport === 'wss' || transport === 'wsmux' || transport === 'wssmux') && (
                <div>
                  <label className={labelClass}>{t.tunnelsPage.pathLabel}</label>
                  <input
                    dir="ltr"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="/tunnel"
                    className={`${inputClass} text-left`}
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <label className={labelClass}>{t.tunnelsPage.connectionCountLabel}</label>
            <input
              type="number"
              min="1"
              max="256"
              value={connectionCount}
              onChange={(e) => setConnectionCount(e.target.value)}
              className={`${inputClass} w-28`}
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs text-muted">{t.tunnelsPage.forwardsLabel}</label>
              <button
                type="button"
                onClick={() => setForwards((fs) => [...fs, emptyForward()])}
                className="text-xs font-bold"
                style={{ color: ACCENT }}
              >
                {t.tunnelsPage.addForwardBtn}
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {forwards.map((fwd, idx) => (
                <div key={idx} className="flex flex-wrap items-end gap-2 rounded-lg border border-subtle p-2">
                  <input
                    value={fwd.name}
                    onChange={(e) => updateForward(idx, { name: e.target.value })}
                    placeholder={t.tunnelsPage.forwardNameLabel}
                    className={`${inputClass} w-32`}
                  />
                  <input
                    dir="ltr"
                    type="number"
                    value={fwd.listen_port || ''}
                    onChange={(e) => updateForward(idx, { listen_port: parseInt(e.target.value, 10) || 0 })}
                    placeholder={t.tunnelsPage.forwardListenPortLabel}
                    className={`${inputClass} w-32 text-left`}
                  />
                  <select
                    value={fwd.net}
                    onChange={(e) => updateForward(idx, { net: e.target.value as 'tcp' | 'udp' })}
                    className={inputClass}
                  >
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                  </select>
                  <input
                    dir="ltr"
                    type="number"
                    value={fwd.target_port || ''}
                    onChange={(e) => updateForward(idx, { target_port: parseInt(e.target.value, 10) || 0 })}
                    placeholder={t.tunnelsPage.forwardTargetPortLabel}
                    className={`${inputClass} w-32 text-left`}
                  />
                  <button
                    type="button"
                    onClick={() => setForwards((fs) => fs.filter((_, i) => i !== idx))}
                    className="text-xs text-danger hover:underline"
                  >
                    {t.tunnelsPage.removeForward}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={submitting || !transport}
              className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60"
              style={{ backgroundColor: ACCENT }}
            >
              {editingId ? t.common.save : t.tunnelsPage.registerBtn}
            </button>
          </div>
        </form>
      )}

      {error && <div className="mb-4 text-sm text-danger">{error}</div>}

      {tunnels === null && <div className="py-8 text-center text-faint">{t.loading}</div>}
      {tunnels !== null && tunnels.length === 0 && (
        <div className="rounded-xl border border-subtle py-8 text-center text-faint">{t.tunnelsPage.noTunnelsYet}</div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {tunnels?.map((tunnel) => {
          const foreignNode = tunnel.foreign_node_id != null ? nodeById.get(tunnel.foreign_node_id) : undefined
          const isTesting = testingId === tunnel.id
          const result = testResults[tunnel.id]
          return (
            <div key={tunnel.id} className="rounded-xl border border-subtle bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                      isTesting ? 'animate-pulse bg-cyan-400' : statusDot[tunnel.status]
                    }`}
                  />
                  <span className="font-bold text-primary">{tunnel.name}</span>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] ${statusBadge[tunnel.status]}`}>
                  {isTesting ? t.tunnelsPage.testing : t.tunnelsPage.status[tunnel.status]}
                </span>
              </div>

              <div dir="ltr" className="mb-1 text-left font-mono text-xs text-muted">
                {tunnel.iran_address}:{tunnel.iran_port} → {foreignNode ? foreignNode.address : tunnel.foreign_address}
              </div>
              <div className="mb-3 text-xs text-faint">
                {t.tunnelsPage.transportLabels[tunnel.transport]}
                {tunnel.forwards.length > 0 && ` · ${tunnel.forwards.length}`}
              </div>

              {result && (
                <div className="mb-3 flex flex-col gap-1 rounded-lg border border-subtle bg-well p-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">{t.tunnelsPage.testResultIran}</span>
                    <span className={result.iran_reachable ? 'text-success' : 'text-danger'}>
                      {result.iran_reachable
                        ? `${t.tunnelsPage.reachable} (${Math.round(result.iran_latency_ms ?? 0)}ms)`
                        : t.tunnelsPage.unreachable}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">{t.tunnelsPage.testResultForeign}</span>
                    <span className={result.foreign_reachable ? 'text-success' : 'text-danger'}>
                      {result.foreign_reachable
                        ? `${t.tunnelsPage.reachable} (${Math.round(result.foreign_latency_ms ?? 0)}ms)`
                        : t.tunnelsPage.unreachable}
                    </span>
                  </div>
                </div>
              )}

              {configId === tunnel.id && configData && (
                <div className="mb-3 flex flex-col gap-2">
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] text-faint">{t.tunnelsPage.iranConfigLabel}</span>
                      <button
                        onClick={() => copy(JSON.stringify(configData.iran_config, null, 2))}
                        className="text-[10px] font-bold"
                        style={{ color: ACCENT }}
                      >
                        {copied === JSON.stringify(configData.iran_config, null, 2) ? t.common.copiedCheck : t.tunnelsPage.copyConfig}
                      </button>
                    </div>
                    <pre
                      dir="ltr"
                      className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-well p-2 text-left font-mono text-[10px] text-muted"
                    >
                      {JSON.stringify(configData.iran_config, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] text-faint">{t.tunnelsPage.foreignConfigLabel}</span>
                      <button
                        onClick={() => copy(JSON.stringify(configData.foreign_config, null, 2))}
                        className="text-[10px] font-bold"
                        style={{ color: ACCENT }}
                      >
                        {copied === JSON.stringify(configData.foreign_config, null, 2) ? t.common.copiedCheck : t.tunnelsPage.copyConfig}
                      </button>
                    </div>
                    <pre
                      dir="ltr"
                      className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-well p-2 text-left font-mono text-[10px] text-muted"
                    >
                      {JSON.stringify(configData.foreign_config, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] text-faint">{t.tunnelsPage.iranInstallCommandLabel}</span>
                      <button
                        onClick={() => copy(configData.iran_install_command)}
                        className="text-[10px] font-bold"
                        style={{ color: ACCENT }}
                      >
                        {copied === configData.iran_install_command ? t.common.copiedCheck : t.tunnelsPage.copyConfig}
                      </button>
                    </div>
                    <pre
                      dir="ltr"
                      className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-well p-2 text-left font-mono text-[10px] text-accent"
                    >
                      {configData.iran_install_command}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] text-faint">{t.tunnelsPage.foreignInstallCommandLabel}</span>
                      <button
                        onClick={() => copy(configData.foreign_install_command)}
                        className="text-[10px] font-bold"
                        style={{ color: ACCENT }}
                      >
                        {copied === configData.foreign_install_command ? t.common.copiedCheck : t.tunnelsPage.copyConfig}
                      </button>
                    </div>
                    <pre
                      dir="ltr"
                      className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-well p-2 text-left font-mono text-[10px] text-accent"
                    >
                      {configData.foreign_install_command}
                    </pre>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 border-t border-hair pt-3">
                <button onClick={() => handleTest(tunnel)} className="text-xs text-muted hover:underline">
                  {t.tunnelsPage.test}
                </button>
                <button onClick={() => toggleConfig(tunnel)} className="text-xs text-muted hover:underline">
                  {t.tunnelsPage.showConfig}
                </button>
                <button onClick={() => startEdit(tunnel)} className="text-xs text-muted hover:underline">
                  {t.common.edit}
                </button>
                <button onClick={() => handleDelete(tunnel)} className="text-xs text-danger hover:underline">
                  {t.common.delete}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
