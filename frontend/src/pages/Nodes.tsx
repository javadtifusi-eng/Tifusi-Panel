import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createNode,
  deleteNode,
  listCores,
  listNodes,
  syncNode,
  updateNode,
  type Core,
  type Node,
  type NodeStatus,
} from '../lib/api'

const ACCENT = '#22D3EE'

const statusDot: Record<NodeStatus, string> = {
  connected: 'bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.6)]',
  pending: 'bg-slate-500',
  error: 'bg-red-400 shadow-[0_0_8px_2px_rgba(248,113,113,0.5)]',
}

const statusBadge: Record<NodeStatus, string> = {
  connected: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/30',
  pending: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  error: 'bg-red-400/10 text-red-300 border-red-400/30',
}

const inputClass =
  'rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60'

function setupCommand(node: Node): string {
  // The one-line installer (not a raw docker build/run) — it clones the
  // repo itself into a temp dir, so it works on a brand-new server with
  // nothing on it yet, unlike a bare `docker build -f backend/... backend`
  // which only works from inside an already-cloned panel checkout.
  return `bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install-node.sh)" -- ${node.api_key} ${node.port}`
}

export default function NodesPage() {
  const { t } = useLang()
  const [nodes, setNodes] = useState<Node[] | null>(null)
  const [cores, setCores] = useState<Core[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [port, setPort] = useState('')
  const [coreId, setCoreId] = useState<number | null>(null)
  const [ipsecCoreId, setIpsecCoreId] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [setupNodeId, setSetupNodeId] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  const coreById = new Map(cores.map((c) => [c.id, c]))

  async function refresh() {
    try {
      const res = await listNodes()
      setNodes(res.nodes)
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

  function resetForm() {
    setEditingId(null)
    setName('')
    setAddress('')
    setPort('')
    setCoreId(null)
    setIpsecCoreId(null)
    setShowForm(false)
  }

  function startEdit(node: Node) {
    setEditingId(node.id)
    setName(node.name)
    setAddress(node.address)
    setPort(String(node.port))
    setCoreId(node.core_id)
    setIpsecCoreId(node.ipsec_core_id)
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (editingId) {
        await updateNode(editingId, {
          name,
          address,
          port: parseInt(port, 10),
          core_id: coreId,
          ipsec_core_id: ipsecCoreId,
        })
        resetForm()
      } else {
        const created = await createNode({
          name,
          address,
          port: parseInt(port, 10),
          core_id: coreId,
          ipsec_core_id: ipsecCoreId,
        })
        resetForm()
        setSetupNodeId(created.id)
      }
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSync(node: Node) {
    if (syncingId !== null) return
    setSyncingId(node.id)
    setError(null)
    try {
      await syncNode(node.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.nodesPage.syncFailed)
    } finally {
      setSyncingId(null)
    }
  }

  async function handleDelete(node: Node, e: MouseEvent) {
    e.stopPropagation()
    if (!window.confirm(t.nodesPage.confirmDelete(node.name))) return
    try {
      await deleteNode(node.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  async function copySetup(node: Node) {
    try {
      await navigator.clipboard.writeText(setupCommand(node))
    } catch {
      // Clipboard API unavailable; the command stays visible to select by hand.
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const setupNode = nodes?.find((n) => n.id === setupNodeId) ?? null

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-50">{t.nodesPage.title}</h1>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
        >
          {t.nodesPage.newBtn}
        </button>
      </div>
      <p className="mb-6 text-sm text-slate-400">{t.nodesPage.intro}</p>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4"
        >
          <div>
            <label className="mb-1.5 block text-xs text-slate-400">{t.nodesPage.nameLabel}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-slate-400">{t.nodesPage.addressLabel}</label>
            <input
              dir="ltr"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              placeholder="1.2.3.4"
              className={`${inputClass} text-left`}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-slate-400">{t.nodesPage.agentPortLabel}</label>
            <input
              type="number"
              min="1"
              max="65535"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="62050"
              required
              className={`${inputClass} w-28`}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-slate-400">{t.nodesPage.coreLabel}</label>
            <select
              value={coreId ?? ''}
              onChange={(e) => setCoreId(e.target.value ? Number(e.target.value) : null)}
              className={inputClass}
            >
              <option value="">{t.coresPage.selectPlaceholder}</option>
              {cores
                .filter((c) => c.core_type === 'xray')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-slate-400" title={t.nodesPage.ipsecCoreHint}>
              {t.nodesPage.ipsecCoreLabel}
            </label>
            <select
              value={ipsecCoreId ?? ''}
              onChange={(e) => setIpsecCoreId(e.target.value ? Number(e.target.value) : null)}
              className={inputClass}
            >
              <option value="">{t.coresPage.selectPlaceholder}</option>
              {cores
                .filter((c) => c.core_type === 'l2tp' || c.core_type === 'ikev2')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {t.coresPage.coreTypeLabels[c.core_type]}
                  </option>
                ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60"
            style={{ backgroundColor: ACCENT }}
          >
            {editingId ? t.common.save : t.nodesPage.registerBtn}
          </button>
        </form>
      )}

      {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      {setupNode && (
        <div className="mb-6 rounded-xl border border-cyan-400/20 bg-black/25 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-bold text-slate-100">{setupNode.name}</div>
            <button onClick={() => setSetupNodeId(null)} className="text-xs text-slate-400 hover:underline">
              ✕
            </button>
          </div>
          <div className="mb-2 text-xs text-slate-400">{t.nodesPage.setupIntro}</div>
          <pre
            dir="ltr"
            className="mb-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-cyan-400/20 bg-black/40 p-3 text-left font-mono text-[11px] text-cyan-200"
          >
            {setupCommand(setupNode)}
          </pre>
          {setupNode.last_error && (
            <div className="mb-2 text-xs text-red-400">
              {t.nodesPage.lastError} {setupNode.last_error}
            </div>
          )}
          <button
            onClick={() => copySetup(setupNode)}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-950"
            style={{ backgroundColor: ACCENT }}
          >
            {copied ? t.common.copiedCheck : t.nodesPage.copyCommand}
          </button>
        </div>
      )}

      {nodes === null && <div className="py-8 text-center text-slate-500">{t.loading}</div>}
      {nodes !== null && nodes.length === 0 && (
        <div className="rounded-xl border border-white/10 py-8 text-center text-slate-500">
          {t.nodesPage.noNodesYet}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {nodes?.map((node) => {
          const core = node.core_id != null ? coreById.get(node.core_id) : undefined
          const ipsecCore = node.ipsec_core_id != null ? coreById.get(node.ipsec_core_id) : undefined
          const isSyncing = syncingId === node.id
          return (
            <div
              key={node.id}
              onClick={() => handleSync(node)}
              title={t.nodesPage.sync}
              className="cursor-pointer rounded-xl border border-white/10 bg-slate-950/60 p-4 transition-colors hover:border-cyan-400/40"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                      isSyncing ? 'animate-pulse bg-cyan-400' : statusDot[node.status]
                    }`}
                  />
                  <span className="font-bold text-slate-100">{node.name}</span>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] ${statusBadge[node.status]}`}>
                  {isSyncing ? t.nodesPage.syncing : t.nodesPage.status[node.status]}
                </span>
              </div>

              <div dir="ltr" className="mb-1 text-left font-mono text-xs text-slate-400">
                {node.address}:{node.port}
              </div>
              {core && (
                <div className="mb-1 text-xs text-slate-500">
                  {core.name} · {t.nodesPage.inboundsCount(core.inbounds.length)}
                </div>
              )}
              {ipsecCore && (
                <div className="mb-1 text-xs text-slate-500">
                  {ipsecCore.name} · {t.coresPage.coreTypeLabels[ipsecCore.core_type]}
                </div>
              )}
              <div dir="ltr" className="mb-3 text-left text-xs text-slate-500">
                {node.xray_version ?? '—'}
              </div>

              <div className="flex items-center gap-3 border-t border-white/5 pt-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setSetupNodeId((id) => (id === node.id ? null : node.id))
                  }}
                  className="text-xs text-slate-400 hover:underline"
                >
                  {t.nodesPage.installCmd}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    startEdit(node)
                  }}
                  className="text-xs text-slate-400 hover:underline"
                >
                  {t.common.edit}
                </button>
                <button onClick={(e) => handleDelete(node, e)} className="text-xs text-red-400 hover:underline">
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
