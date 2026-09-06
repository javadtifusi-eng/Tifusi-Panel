import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createCore,
  deleteCore,
  getRealityKeypair,
  listCores,
  scanReality,
  updateCore,
  type Core,
  type RealityScanResult,
} from '../lib/api'

const ACCENT = '#22D3EE'

const inputClass =
  'rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60'
const labelClass = 'mb-1.5 block text-xs text-slate-400'
const monoTextarea =
  'w-full rounded-lg border border-white/15 bg-black/30 p-3 font-mono text-xs text-cyan-100 outline-none focus:border-cyan-400/60'

function emptyForm() {
  return { name: '', note: '', configText: '' }
}

export default function CoresPage() {
  const { t } = useLang()
  const protocolLabels = t.coresPage.protocolLabels
  const [cores, setCores] = useState<Core[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [lastWarnings, setLastWarnings] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<RealityScanResult[] | null>(null)
  const [generatingKeys, setGeneratingKeys] = useState(false)
  const [generatedKey, setGeneratedKey] = useState<{ private_key: string; public_key: string; short_id: string } | null>(
    null,
  )
  const [copiedField, setCopiedField] = useState<string | null>(null)

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
    setLastWarnings([])
    setError(null)
  }

  function startEdit(core: Core) {
    setEditingId(core.id)
    setForm({ name: core.name, note: core.note ?? '', configText: JSON.stringify(core.config, null, 2) })
    setLastWarnings([])
    setShowForm(true)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setForm((f) => ({ ...f, configText: text }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function copy(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard API unavailable — value stays visible to select by hand.
    }
    setCopiedField(field)
    window.setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 1200)
  }

  async function runScan() {
    setScanning(true)
    setError(null)
    setScanResults(null)
    try {
      const res = await scanReality()
      setScanResults(res.results)
      if (!res.results.some((r) => r.recommended)) setError(t.coresPage.noTargetFound)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.coresPage.scanFailed)
    } finally {
      setScanning(false)
    }
  }

  async function generateKeys() {
    setGeneratingKeys(true)
    setError(null)
    try {
      setGeneratedKey(await getRealityKeypair())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.coresPage.keyGenFailed)
    } finally {
      setGeneratingKeys(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLastWarnings([])

    let config: Record<string, unknown>
    try {
      config = JSON.parse(form.configText)
    } catch {
      setError(t.coresPage.invalidJson)
      return
    }

    setSubmitting(true)
    try {
      const payload = { name: form.name, note: form.note || null, config }
      const result = editingId ? await updateCore(editingId, payload) : await createCore(payload)
      setLastWarnings(result.warnings)
      if (result.warnings.length === 0) resetForm()
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
      setError(err instanceof ApiError ? err.message : t.coresPage.inUseError)
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
        <div className="mb-6 rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4">
          <div className="mb-4 rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="mb-2 text-xs font-bold text-slate-300">{t.coresPage.realityToolsTitle}</div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={generateKeys}
                disabled={generatingKeys}
                className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-60"
                style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
              >
                {generatingKeys ? t.coresPage.generatingKeys : t.coresPage.generateNewKey}
              </button>
              <button
                type="button"
                onClick={runScan}
                disabled={scanning}
                className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-60"
                style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
              >
                {scanning ? t.coresPage.scanning : t.coresPage.suggestTarget}
              </button>
            </div>

            {generatedKey && (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(['private_key', 'public_key', 'short_id'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => copy(generatedKey[key], key)}
                    dir="ltr"
                    className="truncate rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-left font-mono text-[11px] text-cyan-200 hover:border-cyan-400/40"
                    title={generatedKey[key]}
                  >
                    {copiedField === key ? t.coresPage.copied : `${key}: ${generatedKey[key]}`}
                  </button>
                ))}
              </div>
            )}

            {scanResults !== null && scanResults.length > 0 && (
              <div className="mt-3 max-h-64 overflow-y-auto overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400">
                      <th className="px-3 py-2 text-left font-medium" dir="ltr">
                        {t.coresPage.scanColHost}
                      </th>
                      <th className="px-3 py-2 font-medium">{t.coresPage.scanColStatus}</th>
                      <th className="px-3 py-2 font-medium">{t.coresPage.scanColTls}</th>
                      <th className="px-3 py-2 font-medium">{t.coresPage.scanColLatency}</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanResults.map((r) => (
                      <tr key={r.host} className="border-b border-white/5 last:border-0">
                        <td dir="ltr" className="px-3 py-2 text-left font-mono text-slate-200">
                          {r.host}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {r.recommended ? (
                            <span className="font-bold" style={{ color: ACCENT }}>
                              {t.coresPage.scanStatusRecommended}
                            </span>
                          ) : r.reachable ? (
                            <span className="text-slate-300">{t.coresPage.scanStatusUsable}</span>
                          ) : (
                            <span className="text-red-400">{t.coresPage.scanStatusUnreachable}</span>
                          )}
                        </td>
                        <td dir="ltr" className="px-3 py-2 text-center font-mono text-slate-400">
                          {r.tls_version ?? '—'}
                        </td>
                        <td dir="ltr" className="px-3 py-2 text-center font-mono text-slate-400">
                          {r.latency_ms != null ? `${r.latency_ms}ms` : '—'}
                        </td>
                        <td className="px-3 py-2 text-left">
                          {r.reachable && (
                            <button
                              type="button"
                              onClick={() => copy(r.host, `scan-${r.host}`)}
                              className="text-[11px] hover:underline"
                              style={{ color: ACCENT }}
                            >
                              {copiedField === `scan-${r.host}` ? t.coresPage.copied : t.coresPage.copyValue}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit}>
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

            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <label className={labelClass}>{t.coresPage.configLabel}</label>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="core-json-upload"
                  />
                  <label
                    htmlFor="core-json-upload"
                    className="cursor-pointer rounded-lg border px-3 py-1 text-xs font-bold"
                    style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                  >
                    {t.coresPage.uploadJsonBtn}
                  </label>
                </div>
              </div>
              <textarea
                dir="ltr"
                value={form.configText}
                onChange={(e) => setForm((f) => ({ ...f, configText: e.target.value }))}
                placeholder={t.coresPage.configPlaceholder}
                required
                rows={14}
                className={monoTextarea}
              />
            </div>

            {lastWarnings.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
                <div className="mb-1 font-bold">{t.coresPage.warningsTitle}</div>
                <ul className="list-inside list-disc">
                  {lastWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

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
        </div>
      )}

      {!showForm && error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      {cores === null && <div className="py-8 text-center text-slate-500">{t.loading}</div>}
      {cores !== null && cores.length === 0 && (
        <div className="rounded-xl border border-white/10 py-8 text-center text-slate-500">
          {t.coresPage.noCoresYet}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {cores?.map((c) => (
          <div key={c.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="font-bold text-slate-100">{c.name}</div>
                {c.note && <div className="text-xs text-slate-500">{c.note}</div>}
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-slate-400">
                  {t.coresPage.colNodes}: <span className="text-slate-200">{c.node_count}</span>
                </span>
                <button onClick={() => startEdit(c)} className="text-xs text-slate-400 hover:underline">
                  {t.common.edit}
                </button>
                <button onClick={() => handleDelete(c)} className="text-xs text-red-400 hover:underline">
                  {t.common.delete}
                </button>
              </div>
            </div>

            {c.inbounds.length === 0 ? (
              <div className="text-xs text-slate-500">{t.coresPage.noInbounds}</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400">
                      <th className="px-3 py-2 text-left font-medium" dir="ltr">
                        {t.coresPage.inboundColTag}
                      </th>
                      <th className="px-3 py-2 font-medium">{t.coresPage.inboundColProtocol}</th>
                      <th className="px-3 py-2 font-medium">{t.coresPage.inboundColNetwork}</th>
                      <th className="px-3 py-2 font-medium">{t.coresPage.inboundColSecurity}</th>
                      <th className="px-3 py-2 font-medium">{t.coresPage.inboundColPort}</th>
                      <th className="px-3 py-2 font-medium">{t.coresPage.inboundColHosts}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.inbounds.map((i) => (
                      <tr key={i.id} className="border-b border-white/5 last:border-0">
                        <td dir="ltr" className="px-3 py-2 text-left font-mono text-slate-200">
                          {i.tag}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-300">
                          {protocolLabels[i.protocol as keyof typeof protocolLabels] ?? i.protocol}
                        </td>
                        <td dir="ltr" className="px-3 py-2 text-center font-mono text-slate-400">
                          {i.network}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-400">
                          {i.security === 'reality' ? (
                            <span style={{ color: ACCENT }}>REALITY</span>
                          ) : (
                            i.security
                          )}
                        </td>
                        <td dir="ltr" className="px-3 py-2 text-center font-mono text-slate-400">
                          {i.port ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-400">{i.host_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
