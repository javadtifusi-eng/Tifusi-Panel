import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createCore,
  deleteCore,
  FINGERPRINTS,
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

type WizardProtocol = 'vless' | 'vmess' | 'trojan' | 'shadowsocks'

function emptyWizard() {
  return {
    protocol: '' as WizardProtocol | '',
    network: '' as 'tcp' | 'ws' | 'grpc' | '',
    security: '' as 'none' | 'tls' | 'reality' | '',
    tag: '',
    port: '',
    sni: '',
    fingerprint: '',
    alpn: '',
    path: '',
    hostHeader: '',
    method: '',
    realityPrivateKey: '',
    realityShortId: '',
  }
}

function randomPort(): string {
  return String(10000 + Math.floor(Math.random() * 50000))
}

function buildInboundJson(w: ReturnType<typeof emptyWizard>): Record<string, unknown> {
  const isTransport = w.protocol !== 'shadowsocks'
  const settings: Record<string, unknown> = { clients: [] }
  if (w.protocol === 'vless') {
    settings.decryption = 'none'
    if (w.security === 'reality' && w.network === 'tcp') settings.flow = 'xtls-rprx-vision'
  } else if (w.protocol === 'shadowsocks') {
    settings.method = w.method
  }

  const streamSettings: Record<string, unknown> = isTransport ? { network: w.network, security: w.security } : {}

  if (isTransport && w.security === 'reality') {
    const realitySettings: Record<string, unknown> = {
      show: false,
      dest: `${w.sni}:443`,
      serverNames: [w.sni],
      privateKey: w.realityPrivateKey,
      shortIds: [w.realityShortId],
    }
    if (w.fingerprint) realitySettings.fingerprint = w.fingerprint
    streamSettings.realitySettings = realitySettings
  } else if (isTransport && w.security === 'tls') {
    const tlsSettings: Record<string, unknown> = {}
    if (w.sni) tlsSettings.serverName = w.sni
    if (w.alpn) tlsSettings.alpn = w.alpn.split(',').map((s) => s.trim()).filter(Boolean)
    if (w.fingerprint) tlsSettings.fingerprint = w.fingerprint
    streamSettings.tlsSettings = tlsSettings
  }

  if (isTransport && w.network === 'ws') {
    const wsSettings: Record<string, unknown> = {}
    if (w.path) wsSettings.path = w.path
    if (w.hostHeader) wsSettings.headers = { Host: w.hostHeader }
    streamSettings.wsSettings = wsSettings
  } else if (isTransport && w.network === 'grpc') {
    streamSettings.grpcSettings = { serviceName: w.path || '' }
  }

  const inbound: Record<string, unknown> = {
    tag: w.tag,
    listen: '0.0.0.0',
    port: Number(w.port),
    protocol: w.protocol,
    settings,
  }
  if (isTransport) inbound.streamSettings = streamSettings
  return inbound
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

  const [wizard, setWizard] = useState(emptyWizard())
  const [addedFlash, setAddedFlash] = useState(false)
  const isTransportProtocol = wizard.protocol !== '' && wizard.protocol !== 'shadowsocks'

  const wizardCanAdd =
    !!wizard.tag &&
    !!wizard.port &&
    !!wizard.protocol &&
    (!isTransportProtocol ||
      (!!wizard.network &&
        !!wizard.security &&
        (wizard.security !== 'reality' || (!!wizard.sni && !!wizard.realityPrivateKey && !!wizard.realityShortId))))

  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<RealityScanResult[] | null>(null)
  const [generatingKeys, setGeneratingKeys] = useState(false)
  const [generatedKey, setGeneratedKey] = useState<{ private_key: string; public_key: string; short_id: string } | null>(
    null,
  )
  const [copiedField, setCopiedField] = useState<string | null>(null)

  function updateWizard<K extends keyof ReturnType<typeof emptyWizard>>(
    key: K,
    value: ReturnType<typeof emptyWizard>[K],
  ) {
    setWizard((w) => ({ ...w, [key]: value }))
  }

  function addWizardToJson() {
    if (!wizardCanAdd) return
    let config: Record<string, unknown>
    try {
      config = form.configText.trim() ? JSON.parse(form.configText) : { inbounds: [] }
    } catch {
      setError(t.coresPage.invalidJson)
      return
    }
    if (!Array.isArray(config.inbounds)) config.inbounds = []
    const inbounds = config.inbounds as Record<string, unknown>[]
    const newInbound = buildInboundJson(wizard)
    const idx = inbounds.findIndex((i) => i.tag === wizard.tag)
    if (idx >= 0) inbounds[idx] = newInbound
    else inbounds.push(newInbound)
    setForm((f) => ({ ...f, configText: JSON.stringify(config, null, 2) }))
    setError(null)
    setAddedFlash(true)
    window.setTimeout(() => setAddedFlash(false), 1500)
  }

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
    setWizard(emptyWizard())
    setScanResults(null)
    setGeneratedKey(null)
    setShowForm(false)
    setLastWarnings([])
    setError(null)
  }

  function startEdit(core: Core) {
    setEditingId(core.id)
    setForm({ name: core.name, note: core.note ?? '', configText: JSON.stringify(core.config, null, 2) })
    setWizard(emptyWizard())
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
      const keys = await getRealityKeypair()
      setGeneratedKey(keys)
      setWizard((w) => ({ ...w, realityPrivateKey: keys.private_key, realityShortId: keys.short_id }))
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
                              onClick={() => updateWizard('sni', r.host)}
                              className="text-[11px] hover:underline"
                              style={{ color: ACCENT }}
                            >
                              {wizard.sni === r.host ? t.coresPage.copied : t.coresPage.useAsTarget}
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

          <div className="mb-4 rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="mb-1 text-xs font-bold text-slate-300">{t.coresPage.wizardTitle}</div>
            <div className="mb-3 text-[11px] text-slate-500">{t.coresPage.wizardHint}</div>

            <div className="flex flex-wrap gap-3">
              <div>
                <label className={labelClass}>{t.coresPage.tagLabel}</label>
                <input
                  dir="ltr"
                  value={wizard.tag}
                  onChange={(e) => updateWizard('tag', e.target.value)}
                  placeholder="vless-reality-1"
                  className={`${inputClass} w-40 text-left`}
                />
              </div>
              <div>
                <label className={labelClass}>{t.coresPage.protocolLabel}</label>
                <select
                  value={wizard.protocol}
                  onChange={(e) => updateWizard('protocol', e.target.value as WizardProtocol)}
                  className={inputClass}
                >
                  <option value="" disabled>
                    {t.coresPage.selectPlaceholder}
                  </option>
                  <option value="vless">{protocolLabels.vless}</option>
                  <option value="vmess">{protocolLabels.vmess}</option>
                  <option value="trojan">{protocolLabels.trojan}</option>
                  <option value="shadowsocks">{protocolLabels.shadowsocks}</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>{t.coresPage.portLabel}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={wizard.port}
                    onChange={(e) => updateWizard('port', e.target.value)}
                    className={`${inputClass} w-24`}
                  />
                  <button
                    type="button"
                    onClick={() => updateWizard('port', randomPort())}
                    className="rounded-lg border px-2.5 py-2 text-xs font-bold"
                    style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                  >
                    🎲
                  </button>
                </div>
              </div>

              {isTransportProtocol && (
                <>
                  <div>
                    <label className={labelClass}>{t.coresPage.networkLabel}</label>
                    <select
                      value={wizard.network}
                      onChange={(e) => updateWizard('network', e.target.value as typeof wizard.network)}
                      className={inputClass}
                    >
                      <option value="" disabled>
                        {t.coresPage.selectPlaceholder}
                      </option>
                      <option value="tcp">{t.coresPage.networkTcp}</option>
                      <option value="ws">{t.coresPage.networkWs}</option>
                      <option value="grpc">{t.coresPage.networkGrpc}</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>{t.coresPage.securityLabel}</label>
                    <select
                      value={wizard.security}
                      onChange={(e) => updateWizard('security', e.target.value as typeof wizard.security)}
                      className={inputClass}
                    >
                      <option value="" disabled>
                        {t.coresPage.selectPlaceholder}
                      </option>
                      <option value="none">{t.coresPage.securityNone}</option>
                      <option value="tls">{t.coresPage.securityTls}</option>
                      <option value="reality">{t.coresPage.securityReality}</option>
                    </select>
                  </div>
                </>
              )}
              {wizard.protocol === 'shadowsocks' && (
                <div>
                  <label className={labelClass}>{t.coresPage.methodLabel}</label>
                  <input
                    dir="ltr"
                    value={wizard.method}
                    onChange={(e) => updateWizard('method', e.target.value)}
                    placeholder="2022-blake3-aes-128-gcm"
                    className={`${inputClass} w-52 text-left`}
                  />
                </div>
              )}
            </div>

            {isTransportProtocol && (wizard.security === 'tls' || wizard.security === 'reality') && (
              <div className="mt-3 flex flex-wrap gap-3">
                <div>
                  <label className={labelClass}>{t.coresPage.sniLabel}</label>
                  <input
                    dir="ltr"
                    value={wizard.sni}
                    onChange={(e) => updateWizard('sni', e.target.value)}
                    placeholder="www.example.com"
                    className={`${inputClass} text-left`}
                  />
                </div>
                <div>
                  <label className={labelClass}>{t.coresPage.fingerprintLabel}</label>
                  <select
                    dir="ltr"
                    value={wizard.fingerprint}
                    onChange={(e) => updateWizard('fingerprint', e.target.value)}
                    className={`${inputClass} w-36 text-left`}
                  >
                    <option value="">{t.coresPage.selectPlaceholder}</option>
                    {FINGERPRINTS.map((fp) => (
                      <option key={fp} value={fp}>
                        {fp}
                      </option>
                    ))}
                  </select>
                </div>
                {wizard.security === 'tls' && (
                  <div>
                    <label className={labelClass}>{t.coresPage.alpnLabel}</label>
                    <input
                      dir="ltr"
                      value={wizard.alpn}
                      onChange={(e) => updateWizard('alpn', e.target.value)}
                      placeholder="h2,http/1.1"
                      className={`${inputClass} text-left`}
                    />
                  </div>
                )}
                {wizard.security === 'reality' && (
                  <div className="flex flex-col justify-end gap-1 text-[11px] text-slate-500">
                    <div dir="ltr" className="font-mono">
                      privateKey: {wizard.realityPrivateKey ? '••••••••' : '—'}
                    </div>
                    <div dir="ltr" className="font-mono">
                      shortId: {wizard.realityShortId || '—'}
                    </div>
                  </div>
                )}
              </div>
            )}

            {isTransportProtocol && (wizard.network === 'ws' || wizard.network === 'grpc') && (
              <div className="mt-3 flex flex-wrap gap-3">
                <div>
                  <label className={labelClass}>
                    {wizard.network === 'ws' ? t.coresPage.wsPathLabel : t.coresPage.grpcServiceLabel}
                  </label>
                  <input
                    dir="ltr"
                    value={wizard.path}
                    onChange={(e) => updateWizard('path', e.target.value)}
                    className={`${inputClass} w-40 text-left`}
                  />
                </div>
                {wizard.network === 'ws' && (
                  <div>
                    <label className={labelClass}>{t.coresPage.hostHeaderLabel}</label>
                    <input
                      dir="ltr"
                      value={wizard.hostHeader}
                      onChange={(e) => updateWizard('hostHeader', e.target.value)}
                      className={`${inputClass} w-40 text-left`}
                    />
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={addWizardToJson}
              disabled={!wizardCanAdd}
              className="mt-3 rounded-lg px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-40"
              style={{ backgroundColor: ACCENT }}
            >
              {addedFlash ? t.coresPage.addedToJson : t.coresPage.addToJsonBtn}
            </button>
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
