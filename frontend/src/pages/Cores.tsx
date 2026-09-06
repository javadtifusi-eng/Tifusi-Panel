import { useEffect, useState, type FormEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createCore,
  deleteCore,
  getRealityKeypair,
  getWireGuardKeypair,
  listCores,
  scanReality,
  updateCore,
  type Core,
  type CorePayload,
  type HostNetwork,
  type HostProtocol,
  type HostSecurity,
  type RealityScanResult,
} from '../lib/api'

const ACCENT = '#22D3EE'

const inputClass =
  'rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60'
const labelClass = 'mb-1.5 block text-xs text-slate-400'

const TRANSPORT_PROTOCOLS: HostProtocol[] = ['vless', 'vmess', 'trojan']

function randomPort() {
  return String(10000 + Math.floor(Math.random() * 50000))
}

function emptyForm() {
  return {
    name: '',
    note: '',
    protocol: '' as HostProtocol | '',
    network: '' as HostNetwork | '',
    security: '' as HostSecurity | '',
    default_port: '',
    sni: '',
    fingerprint: '',
    alpn: '',
    path: '',
    host_header: '',
    reality_public_key: '',
    reality_private_key: '',
    reality_short_id: '',
    wireguard_public_key: '',
    wireguard_private_key: '',
    wireguard_subnet: '10.66.66.0/24',
  }
}

type Form = ReturnType<typeof emptyForm>

export default function CoresPage() {
  const { t, align } = useLang()
  const protocolLabels = t.coresPage.protocolLabels
  const [cores, setCores] = useState<Core[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<Form>(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<RealityScanResult[] | null>(null)
  const [generatingKeys, setGeneratingKeys] = useState(false)
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [generatingWgKeys, setGeneratingWgKeys] = useState(false)
  const [showWgPrivateKey, setShowWgPrivateKey] = useState(false)

  const isTransport = form.protocol !== '' && TRANSPORT_PROTOCOLS.includes(form.protocol)
  const isWireguard = form.protocol === 'wireguard'
  const usesReality = isTransport && form.security === 'reality'
  const usesTls = isTransport && form.security === 'tls'

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

  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(false)
    setScanResults(null)
    setShowPrivateKey(false)
    setShowWgPrivateKey(false)
    setError(null)
  }

  function startEdit(core: Core) {
    setEditingId(core.id)
    setForm({
      name: core.name,
      note: core.note ?? '',
      protocol: core.protocol,
      network: core.network ?? '',
      security: core.security ?? '',
      default_port: core.default_port != null ? String(core.default_port) : '',
      sni: core.sni ?? '',
      fingerprint: core.fingerprint ?? '',
      alpn: core.alpn ?? '',
      path: core.path ?? '',
      host_header: core.host_header ?? '',
      reality_public_key: core.reality_public_key ?? '',
      reality_private_key: core.reality_private_key ?? '',
      reality_short_id: core.reality_short_id ?? '',
      wireguard_public_key: core.wireguard_public_key ?? '',
      wireguard_private_key: core.wireguard_private_key ?? '',
      wireguard_subnet: core.wireguard_subnet ?? '10.66.66.0/24',
    })
    setScanResults(null)
    setShowForm(true)
  }

  async function runScan() {
    setScanning(true)
    setError(null)
    setScanResults(null)
    try {
      const res = await scanReality()
      setScanResults(res.results)
      const best = res.results.find((r) => r.recommended)
      if (!best) setError(t.coresPage.noTargetFound)
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
      setForm((f) => ({
        ...f,
        reality_public_key: keys.public_key,
        reality_private_key: keys.private_key,
        reality_short_id: keys.short_id,
      }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.coresPage.keyGenFailed)
    } finally {
      setGeneratingKeys(false)
    }
  }

  async function generateWgKeys() {
    setGeneratingWgKeys(true)
    setError(null)
    try {
      const keys = await getWireGuardKeypair()
      setForm((f) => ({
        ...f,
        wireguard_public_key: keys.public_key,
        wireguard_private_key: keys.private_key,
      }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.coresPage.keyGenFailed)
    } finally {
      setGeneratingWgKeys(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.protocol) {
      setError(t.coresPage.protocolRequired)
      return
    }
    if (isTransport && (!form.network || !form.security)) {
      setError(t.coresPage.networkSecurityRequired)
      return
    }
    setSubmitting(true)
    const payload: CorePayload = {
      name: form.name,
      note: form.note || null,
      protocol: form.protocol,
      network: isTransport ? (form.network as HostNetwork) : null,
      security: isTransport ? (form.security as HostSecurity) : null,
      default_port: form.default_port ? parseInt(form.default_port, 10) : null,
      sni: usesReality || usesTls ? form.sni || null : null,
      fingerprint: isTransport ? form.fingerprint || null : null,
      alpn: usesTls ? form.alpn || null : null,
      path: isTransport && (form.network === 'ws' || form.network === 'grpc') ? form.path || null : null,
      host_header: isTransport && form.network === 'ws' ? form.host_header || null : null,
      reality_public_key: usesReality ? form.reality_public_key || null : null,
      reality_private_key: usesReality ? form.reality_private_key || null : null,
      reality_short_id: usesReality ? form.reality_short_id || null : null,
      wireguard_public_key: isWireguard ? form.wireguard_public_key || null : null,
      wireguard_private_key: isWireguard ? form.wireguard_private_key || null : null,
      wireguard_subnet: isWireguard ? form.wireguard_subnet || null : null,
    }
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
                onChange={(e) => update('name', e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t.coresPage.noteLabel}</label>
              <input
                value={form.note}
                onChange={(e) => update('note', e.target.value)}
                className={`${inputClass} w-56`}
              />
            </div>
            <div>
              <label className={labelClass}>{t.coresPage.protocolLabel}</label>
              <select
                value={form.protocol}
                onChange={(e) => {
                  update('protocol', e.target.value as HostProtocol)
                  setScanResults(null)
                }}
                required
                className={inputClass}
              >
                <option value="" disabled>
                  {t.coresPage.selectPlaceholder}
                </option>
                {Object.entries(protocolLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isTransport && (
            <div className="mt-3 flex flex-wrap gap-3">
              <div>
                <label className={labelClass}>{t.coresPage.networkLabel}</label>
                <select
                  value={form.network}
                  onChange={(e) => update('network', e.target.value as HostNetwork)}
                  required
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
                  value={form.security}
                  onChange={(e) => update('security', e.target.value as HostSecurity)}
                  required
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
              <div>
                <label className={labelClass}>{t.coresPage.defaultPortLabel}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={form.default_port}
                    onChange={(e) => update('default_port', e.target.value)}
                    className={`${inputClass} w-24`}
                  />
                  <button
                    type="button"
                    onClick={() => update('default_port', randomPort())}
                    className="rounded-lg border px-2.5 py-2 text-xs font-bold"
                    style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                  >
                    🎲
                  </button>
                </div>
              </div>
              <div>
                <label className={labelClass}>{t.coresPage.fingerprintLabel}</label>
                <input
                  dir="ltr"
                  value={form.fingerprint}
                  onChange={(e) => update('fingerprint', e.target.value)}
                  placeholder="chrome"
                  className={`${inputClass} w-32 text-left`}
                />
              </div>
              {(form.network === 'ws' || form.network === 'grpc') && (
                <div>
                  <label className={labelClass}>
                    {form.network === 'ws' ? t.coresPage.wsPathLabel : t.coresPage.grpcServiceLabel}
                  </label>
                  <input
                    dir="ltr"
                    value={form.path}
                    onChange={(e) => update('path', e.target.value)}
                    className={`${inputClass} w-40 text-left`}
                  />
                </div>
              )}
              {form.network === 'ws' && (
                <div>
                  <label className={labelClass}>{t.coresPage.hostHeaderLabel}</label>
                  <input
                    dir="ltr"
                    value={form.host_header}
                    onChange={(e) => update('host_header', e.target.value)}
                    className={`${inputClass} w-40 text-left`}
                  />
                </div>
              )}
            </div>
          )}

          {usesTls && (
            <div className="mt-3 flex flex-wrap gap-3">
              <div>
                <label className={labelClass}>{t.coresPage.sniLabel}</label>
                <input
                  dir="ltr"
                  value={form.sni}
                  onChange={(e) => update('sni', e.target.value)}
                  placeholder="www.example.com"
                  className={`${inputClass} text-left`}
                />
              </div>
              <div>
                <label className={labelClass}>{t.coresPage.alpnLabel}</label>
                <input
                  dir="ltr"
                  value={form.alpn}
                  onChange={(e) => update('alpn', e.target.value)}
                  placeholder="h2,http/1.1"
                  className={`${inputClass} text-left`}
                />
              </div>
            </div>
          )}

          {usesReality && (
            <div className="mt-4 rounded-lg border border-cyan-400/15 bg-black/25 p-3">
              <div className="mb-3 flex items-end gap-3">
                <div className="flex-1">
                  <label className={labelClass}>{t.coresPage.sniLabel}</label>
                  <input
                    dir="ltr"
                    value={form.sni}
                    onChange={(e) => update('sni', e.target.value)}
                    placeholder="www.example.com"
                    className={`${inputClass} w-full text-left`}
                  />
                </div>
                <button
                  type="button"
                  onClick={runScan}
                  disabled={scanning}
                  className="flex-shrink-0 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-60"
                  style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                >
                  {scanning ? t.coresPage.scanning : t.coresPage.suggestTarget}
                </button>
              </div>

              {scanResults !== null && scanResults.length > 0 && (
                <div className="mb-4 overflow-x-auto rounded-lg border border-white/10">
                  <table className={`w-full text-xs ${align}`}>
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
                                onClick={() => update('sni', r.host)}
                                className="text-[11px] hover:underline"
                                style={{ color: ACCENT }}
                              >
                                {t.coresPage.useAsTarget}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">{t.coresPage.realityKeyLabel}</span>
                <button
                  type="button"
                  onClick={generateKeys}
                  disabled={generatingKeys}
                  className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-60"
                  style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                >
                  {generatingKeys ? t.coresPage.generatingKeys : t.coresPage.generateNewKey}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  dir="ltr"
                  readOnly
                  value={form.reality_public_key}
                  placeholder="Public Key"
                  className={`${inputClass} text-left font-mono text-xs`}
                />
                <div className="relative">
                  <input
                    dir="ltr"
                    readOnly
                    type={showPrivateKey ? 'text' : 'password'}
                    value={form.reality_private_key}
                    placeholder="Private Key"
                    className={`${inputClass} w-full pr-12 text-left font-mono text-xs`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPrivateKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400"
                  >
                    {showPrivateKey ? t.coresPage.hide : t.coresPage.show}
                  </button>
                </div>
                <input
                  dir="ltr"
                  readOnly
                  value={form.reality_short_id}
                  placeholder="Short ID"
                  className={`${inputClass} text-left font-mono text-xs`}
                />
              </div>
            </div>
          )}

          {isWireguard && (
            <div className="mt-4 rounded-lg border border-cyan-400/15 bg-black/25 p-3">
              <div className="mb-3 flex flex-wrap gap-3">
                <div>
                  <label className={labelClass}>{t.coresPage.defaultPortLabel}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      value={form.default_port}
                      onChange={(e) => update('default_port', e.target.value)}
                      className={`${inputClass} w-24`}
                    />
                    <button
                      type="button"
                      onClick={() => update('default_port', randomPort())}
                      className="rounded-lg border px-2.5 py-2 text-xs font-bold"
                      style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                    >
                      🎲
                    </button>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>{t.coresPage.wgSubnetLabel}</label>
                  <input
                    dir="ltr"
                    value={form.wireguard_subnet}
                    onChange={(e) => update('wireguard_subnet', e.target.value)}
                    placeholder="10.66.66.0/24"
                    className={`${inputClass} w-48 text-left font-mono text-xs`}
                  />
                </div>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">{t.coresPage.wgServerKeyLabel}</span>
                <button
                  type="button"
                  onClick={generateWgKeys}
                  disabled={generatingWgKeys}
                  className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-60"
                  style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                >
                  {generatingWgKeys ? t.coresPage.generatingKeys : t.coresPage.generateNewKey}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  dir="ltr"
                  readOnly
                  value={form.wireguard_public_key}
                  placeholder="Public Key"
                  className={`${inputClass} text-left font-mono text-xs`}
                />
                <div className="relative">
                  <input
                    dir="ltr"
                    readOnly
                    type={showWgPrivateKey ? 'text' : 'password'}
                    value={form.wireguard_private_key}
                    placeholder="Private Key"
                    className={`${inputClass} w-full pr-12 text-left font-mono text-xs`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowWgPrivateKey((v) => !v)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400"
                  >
                    {showWgPrivateKey ? t.coresPage.hide : t.coresPage.show}
                  </button>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-slate-500">{t.coresPage.wgHint}</div>
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
      )}

      {!showForm && error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className={`w-full text-sm ${align}`}>
          <thead>
            <tr className="border-b border-white/10 text-xs text-slate-400">
              <th className="px-4 py-3 font-medium">{t.coresPage.colName}</th>
              <th className="px-4 py-3 font-medium">{t.coresPage.protocolLabel}</th>
              <th className="px-4 py-3 font-medium">{t.coresPage.colNote}</th>
              <th className="px-4 py-3 font-medium">{t.coresPage.colHosts}</th>
              <th className="px-4 py-3 font-medium">{t.coresPage.colNodes}</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {cores === null && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  {t.loading}
                </td>
              </tr>
            )}
            {cores !== null && cores.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  {t.coresPage.noCoresYet}
                </td>
              </tr>
            )}
            {cores?.map((c) => (
              <tr key={c.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-slate-100">{c.name}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                    {protocolLabels[c.protocol]}
                  </span>
                </td>
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
