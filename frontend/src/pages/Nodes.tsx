import { Fragment, useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  createNode,
  deleteNode,
  listNodes,
  syncNode,
  type Node,
  type NodeStatus,
} from '../lib/api'

const ACCENT = '#22D3EE'

const statusStyles: Record<NodeStatus, string> = {
  connected: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/30',
  pending: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  error: 'bg-red-400/10 text-red-300 border-red-400/30',
}

const statusLabels: Record<NodeStatus, string> = {
  connected: 'متصل',
  pending: 'در انتظار همگام‌سازی',
  error: 'خطا',
}

const inputClass =
  'rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60'

function setupCommand(node: Node): string {
  return [
    'docker build -t tifusi-node-agent -f backend/node_agent/Dockerfile backend',
    `docker run -d --name tifusi-node --restart unless-stopped -p ${node.port}:62050 -e TIFUSI_NODE_API_KEY=${node.api_key} tifusi-node-agent`,
  ].join('\n')
}

export default function NodesPage() {
  const [nodes, setNodes] = useState<Node[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [port, setPort] = useState('62050')
  const [submitting, setSubmitting] = useState(false)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [setupNodeId, setSetupNodeId] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  async function refresh() {
    try {
      const res = await listNodes()
      setNodes(res.nodes)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در دریافت لیست نودها')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const created = await createNode({ name, address, port: parseInt(port, 10) })
      setName('')
      setAddress('')
      setPort('62050')
      setShowForm(false)
      setSetupNodeId(created.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'مشکلی پیش اومد')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSync(node: Node) {
    setSyncingId(node.id)
    setError(null)
    try {
      await syncNode(node.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'همگام‌سازی با خطا مواجه شد')
    } finally {
      setSyncingId(null)
    }
  }

  async function handleDelete(node: Node) {
    if (!window.confirm(`نود «${node.name}» حذف بشه؟`)) return
    try {
      await deleteNode(node.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'مشکلی پیش اومد')
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

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-50">نودها</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
        >
          + نود جدید
        </button>
      </div>
      <p className="mb-6 text-sm text-slate-400">
        هر نود یه سرور جداست که Xray واقعی روش اجرا می‌شه. اول نود رو اینجا ثبت کن، بعد با دستوری که
        نشون داده می‌شه ایجنت رو روی همون سرور بالا بیار، بعد «همگام‌سازی» رو بزن تا کانفیگ هاست‌ها و
        کاربرها براش فرستاده بشه.
      </p>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4"
        >
          <div>
            <label className="mb-1.5 block text-xs text-slate-400">نام</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-slate-400">آدرس سرور</label>
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
            <label className="mb-1.5 block text-xs text-slate-400">پورت ایجنت</label>
            <input
              type="number"
              min="1"
              max="65535"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              required
              className={`${inputClass} w-28`}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60"
            style={{ backgroundColor: ACCENT }}
          >
            ثبت نود
          </button>
        </form>
      )}

      {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-right text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs text-slate-400">
              <th className="px-4 py-3 font-medium">نام</th>
              <th className="px-4 py-3 font-medium">آدرس</th>
              <th className="px-4 py-3 font-medium">وضعیت</th>
              <th className="px-4 py-3 font-medium">نسخه Xray</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {nodes === null && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  در حال بارگذاری…
                </td>
              </tr>
            )}
            {nodes !== null && nodes.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  هنوز نودی ثبت نشده
                </td>
              </tr>
            )}
            {nodes?.map((node) => (
              <Fragment key={node.id}>
                <tr className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 text-slate-100">{node.name}</td>
                  <td dir="ltr" className="px-4 py-3 text-left font-mono text-xs text-slate-400">
                    {node.address}:{node.port}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] ${statusStyles[node.status]}`}>
                      {statusLabels[node.status]}
                    </span>
                  </td>
                  <td dir="ltr" className="px-4 py-3 text-left text-xs text-slate-400">
                    {node.xray_version ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-left">
                    <button
                      onClick={() => handleSync(node)}
                      disabled={syncingId === node.id}
                      className="ml-3 text-xs hover:underline disabled:opacity-60"
                      style={{ color: ACCENT }}
                    >
                      {syncingId === node.id ? 'در حال همگام‌سازی…' : 'همگام‌سازی'}
                    </button>
                    <button
                      onClick={() => setSetupNodeId((id) => (id === node.id ? null : node.id))}
                      className="ml-3 text-xs text-slate-400 hover:underline"
                    >
                      دستور نصب
                    </button>
                    <button onClick={() => handleDelete(node)} className="text-xs text-red-400 hover:underline">
                      حذف
                    </button>
                  </td>
                </tr>
                {setupNodeId === node.id && (
                  <tr>
                    <td colSpan={5} className="border-b border-white/5 bg-black/25 px-4 py-4">
                      <div className="mb-2 text-xs text-slate-400">
                        این دستورها رو روی سروری که می‌خوای این نود روش اجرا بشه وارد کن:
                      </div>
                      <pre
                        dir="ltr"
                        className="mb-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-cyan-400/20 bg-black/40 p-3 text-left font-mono text-[11px] text-cyan-200"
                      >
                        {setupCommand(node)}
                      </pre>
                      {node.last_error && (
                        <div className="mb-2 text-xs text-red-400">آخرین خطا: {node.last_error}</div>
                      )}
                      <button
                        onClick={() => copySetup(node)}
                        className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-950"
                        style={{ backgroundColor: ACCENT }}
                      >
                        {copied ? 'کپی شد ✓' : 'کپی دستور'}
                      </button>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
