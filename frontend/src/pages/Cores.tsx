import { useEffect, useState, type FormEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import { ApiError, createCore, deleteCore, listCores, updateCore, type Core } from '../lib/api'

const ACCENT = '#22D3EE'

const inputClass =
  'rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60'
const labelClass = 'mb-1.5 block text-xs text-slate-400'

function emptyForm() {
  return { name: '', note: '' }
}

export default function CoresPage() {
  const { t, align } = useLang()
  const [cores, setCores] = useState<Core[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [submitting, setSubmitting] = useState(false)

  async function refresh() {
    try {
      const res = await listCores()
      setCores(res.cores)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.coresPage.fetchError)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(false)
  }

  function startEdit(core: Core) {
    setEditingId(core.id)
    setForm({ name: core.name, note: core.note ?? '' })
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const payload = { name: form.name, note: form.note || null }
    try {
      if (editingId) await updateCore(editingId, payload)
      else await createCore(payload)
      resetForm()
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(core: Core) {
    if (!window.confirm(t.coresPage.confirmDelete(core.name))) return
    try {
      await deleteCore(core.id)
      await refresh()
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(core.host_count + core.node_count > 0 ? t.coresPage.inUseError : t.coresPage.onlyCoreError)
      } else {
        setError(err instanceof ApiError ? err.message : t.common.genericError)
      }
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-50">{t.coresPage.title}</h1>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
        >
          {t.coresPage.newBtn}
        </button>
      </div>
      <p className="mb-6 text-sm text-slate-400">{t.coresPage.intro}</p>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={labelClass}>{t.coresPage.nameLabel}</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t.coresPage.noteLabel}</label>
              <input
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                className={`${inputClass} w-56`}
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
            {editingId ? t.common.save : t.coresPage.createCoreBtn}
          </button>
        </form>
      )}

      {!showForm && error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className={`w-full text-sm ${align}`}>
          <thead>
            <tr className="border-b border-white/10 text-xs text-slate-400">
              <th className="px-4 py-3 font-medium">{t.coresPage.colName}</th>
              <th className="px-4 py-3 font-medium">{t.coresPage.colNote}</th>
              <th className="px-4 py-3 font-medium">{t.coresPage.colHosts}</th>
              <th className="px-4 py-3 font-medium">{t.coresPage.colNodes}</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {cores === null && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {t.loading}
                </td>
              </tr>
            )}
            {cores !== null && cores.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {t.coresPage.noCoresYet}
                </td>
              </tr>
            )}
            {cores?.map((c) => (
              <tr key={c.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-slate-100">{c.name}</td>
                <td className="px-4 py-3 text-slate-400">{c.note ?? '—'}</td>
                <td className="px-4 py-3 text-slate-400">{c.host_count}</td>
                <td className="px-4 py-3 text-slate-400">{c.node_count}</td>
                <td className="px-4 py-3 text-left">
                  <button onClick={() => startEdit(c)} className="ml-3 text-xs text-slate-400 hover:underline">
                    {t.common.edit}
                  </button>
                  <button onClick={() => handleDelete(c)} className="text-xs text-red-400 hover:underline">
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
