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

const PLACEHOLDER_KEYS = ['username', 'protocol', 'days_left', 'expire_date', 'data_limit_gb', 'data_left_gb'] as const

export default function HostsPage() {
  const { t } = useLang()
  const protocolLabels = t.coresPage.protocolLabels
  const [hosts, setHosts] = useState<Host[] | null>(null)
  const [cores, setCores] = useState<Core[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [showPlaceholders, setShowPlaceholders] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

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

  async function insertPlaceholder(key: string) {
    const token = `{${key}}`
    update('remark', form.remark + token)
    try {
      await navigator.clipboard.writeText(token)
    } catch {
      // Clipboard API unavailable — the token is still inserted into the field above.
    }
    setCopiedToken(key)
    window.setTimeout(() => setCopiedToken((k) => (k === key ? null : k)), 1200)
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
            <div className="relative">
              <div className="mb-1.5 flex items-center gap-1.5">
                <label className="text-xs text-slate-400">{t.hostsPage.remark}</label>
                <button
                  type="button"
                  onClick={() => setShowPlaceholders((v) => !v)}
                  className="flex h-4 w-4 items-center justify-center rounded-full border border-white/20 text-[10px] text-slate-400 hover:border-cyan-400/50 hover:text-cyan-300"
                >
                  ?
                </button>
              </div>
              <input
                value={form.remark}
                onChange={(e) => update('remark', e.target.value)}
                required
                className={inputClass}
              />
              {showPlaceholders && (
                <div className="absolute top-full z-10 mt-1 w-64 rounded-lg border border-cyan-400/20 bg-slate-900 p-2 shadow-xl">
                  <div className="mb-1.5 text-[10px] text-slate-500">{t.hostsPage.remarkPlaceholdersTitle}</div>
                  {PLACEHOLDER_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => insertPlaceholder(key)}
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-white/5"
                    >
                      <span dir="ltr" className="font-mono" style={{ color: ACCENT }}>
                        {`{${key}}`}
                      </span>
                      <span className="text-slate-400">
                        {copiedToken === key ? t.hostsPage.remarkPlaceholderCopied : t.hostsPage.placeholders[key]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
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

      {hosts === null && <div className="py-8 text-center text-slate-500">{t.loading}</div>}
      {hosts !== null && hosts.length === 0 && (
        <div className="rounded-xl border border-white/10 py-8 text-center text-slate-500">
          {t.hostsPage.noHostsYet}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {hosts?.map((h) => (
          <div key={h.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-bold text-slate-100">{h.remark}</span>
              <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                {protocolLabels[h.protocol]}
              </span>
            </div>
            <div dir="ltr" className="mb-1 text-left font-mono text-xs text-slate-400">
              {h.address}:{h.effective_port ?? '—'}
            </div>
            <div className="mb-3 text-xs text-slate-400">
              {h.security === 'reality' ? (
                <span dir="ltr" className="font-mono" style={{ color: ACCENT }}>
                  REALITY · {h.effective_sni ?? '—'}
                </span>
              ) : (
                (h.security ?? '—')
              )}
            </div>
            <div className="flex gap-3 border-t border-white/5 pt-3">
              <button onClick={() => startEdit(h)} className="text-xs text-slate-400 hover:underline">
                {t.common.edit}
              </button>
              <button onClick={() => handleDelete(h)} className="text-xs text-red-400 hover:underline">
                {t.common.delete}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
