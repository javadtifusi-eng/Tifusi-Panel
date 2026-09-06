import { useEffect, useState, type FormEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createHost,
  deleteHost,
  listCores,
  listHosts,
  updateHost,
  type Core,
  type Host,
} from '../lib/api'

const ACCENT = '#22D3EE'

const inputClass =
  'rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60'
const labelClass = 'mb-1.5 block text-xs text-slate-400'

function emptyForm() {
  return {
    remark: '',
    address: '',
    port: '',
    sni_override: '',
    alpn_override: '',
    core_id: null as number | null,
  }
}

export default function HostsPage() {
  const { t, align } = useLang()
  const protocolLabels = t.coresPage.protocolLabels
  const [hosts, setHosts] = useState<Host[] | null>(null)
  const [cores, setCores] = useState<Core[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [submitting, setSubmitting] = useState(false)

  async function refresh() {
    try {
      const res = await listHosts()
      setHosts(res.hosts)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.hostsPage.fetchError)
    }
  }

  async function refreshCores() {
    try {
      const res = await listCores()
      setCores(res.cores)
    } catch {
      // ignored — the core select just stays empty
    }
  }

  useEffect(() => {
    refresh()
    refreshCores()
  }, [])

  function update<K extends keyof ReturnType<typeof emptyForm>>(key: K, value: ReturnType<typeof emptyForm>[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(false)
    setError(null)
  }

  function startEdit(host: Host) {
    setEditingId(host.id)
    setForm({
      remark: host.remark,
      address: host.address,
      port: host.port != null ? String(host.port) : '',
      sni_override: host.sni_override ?? '',
      alpn_override: host.alpn_override ?? '',
      core_id: host.core_id,
    })
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.core_id) return
    setSubmitting(true)
    const payload = {
      remark: form.remark,
      address: form.address,
      core_id: form.core_id,
      port: form.port ? parseInt(form.port, 10) : null,
      sni_override: form.sni_override || null,
      alpn_override: form.alpn_override || null,
    }
    try {
      if (editingId) await updateHost(editingId, payload)
      else await createHost(payload)
      resetForm()
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(host: Host) {
    if (!window.confirm(t.hostsPage.confirmDelete(host.remark))) return
    try {
      await deleteHost(host.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-50">{t.hostsPage.title}</h1>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
        >
          {t.hostsPage.newBtn}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={labelClass}>{t.hostsPage.remark}</label>
              <input
                value={form.remark}
                onChange={(e) => update('remark', e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t.hostsPage.coreLabel}</label>
              <select
                value={form.core_id ?? ''}
                onChange={(e) => update('core_id', e.target.value ? Number(e.target.value) : null)}
                required
                className={inputClass}
              >
                <option value="" disabled>
                  {t.coresPage.selectPlaceholder}
                </option>
                {cores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {protocolLabels[c.protocol]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>{t.hostsPage.address}</label>
              <input
                dir="ltr"
                value={form.address}
                onChange={(e) => update('address', e.target.value)}
                required
                placeholder="1.2.3.4"
                className={`${inputClass} text-left`}
              />
            </div>
            <div>
              <label className={labelClass}>{t.hostsPage.port}</label>
              <input
                type="number"
                min="1"
                max="65535"
                value={form.port}
                onChange={(e) => update('port', e.target.value)}
                className={`${inputClass} w-28`}
              />
            </div>
            <div>
              <label className={labelClass}>{t.hostsPage.sniOverride}</label>
              <input
                dir="ltr"
                value={form.sni_override}
                onChange={(e) => update('sni_override', e.target.value)}
                className={`${inputClass} text-left`}
              />
            </div>
            <div>
              <label className={labelClass}>{t.hostsPage.alpnOverride}</label>
              <input
                dir="ltr"
                value={form.alpn_override}
                onChange={(e) => update('alpn_override', e.target.value)}
                className={`${inputClass} text-left`}
              />
            </div>
          </div>

          {error && <div className="mt-3 text-xs text-red-400">{error}</div>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-4 rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60"
            style={{ backgroundColor: ACCENT }}
          >
            {editingId ? t.common.save : t.hostsPage.createHostBtn}
          </button>
        </form>
      )}

      {!showForm && error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className={`w-full text-sm ${align}`}>
          <thead>
            <tr className="border-b border-white/10 text-xs text-slate-400">
              <th className="px-4 py-3 font-medium">{t.hostsPage.colName}</th>
              <th className="px-4 py-3 font-medium">{t.hostsPage.colProtocol}</th>
              <th className="px-4 py-3 font-medium">{t.hostsPage.colAddress}</th>
              <th className="px-4 py-3 font-medium">{t.hostsPage.colSecurity}</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {hosts === null && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {t.loading}
                </td>
              </tr>
            )}
            {hosts !== null && hosts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {t.hostsPage.noHostsYet}
                </td>
              </tr>
            )}
            {hosts?.map((h) => (
              <tr key={h.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-slate-100">{h.remark}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                    {protocolLabels[h.protocol]}
                  </span>
                </td>
                <td dir="ltr" className="px-4 py-3 text-left font-mono text-xs text-slate-400">
                  {h.address}:{h.effective_port ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {h.security === 'reality' ? (
                    <span dir="ltr" className="font-mono text-xs" style={{ color: ACCENT }}>
                      REALITY · {h.effective_sni ?? '—'}
                    </span>
                  ) : (
                    (h.security ?? '—')
                  )}
                </td>
                <td className="px-4 py-3 text-left">
                  <button
                    onClick={() => startEdit(h)}
                    className="ml-3 text-xs text-slate-400 hover:underline"
                  >
                    {t.common.edit}
                  </button>
                  <button onClick={() => handleDelete(h)} className="text-xs text-red-400 hover:underline">
                    {t.common.delete}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
