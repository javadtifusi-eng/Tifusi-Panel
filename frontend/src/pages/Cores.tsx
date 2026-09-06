import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createCore,
  deleteCore,
  FINGERPRINTS,
  getRealityKeypair,
  getWireGuardKeypair,
  listCores,
  scanReality,
  updateCore,
  type Core,
  type CoreType,
  type RealityScanResult,
} from '../lib/api'

const ACCENT = '#22D3EE'

const inputClass =
  'rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60'
const labelClass = 'mb-1.5 block text-xs text-slate-400'
const monoTextarea =
  'w-full rounded-lg border border-white/15 bg-black/30 p-3 font-mono text-xs text-cyan-100 outline-none focus:border-cyan-400/60'

const CORE_TYPES: CoreType[] = ['xray', 'wireguard', 'l2tp', 'ikev2']

function emptyForm() {
  return {
    coreType: '' as CoreType | '',
    name: '',
    note: '',
    configText: '',
    wireguardPublicKey: '',
    wireguardPrivateKey: '',
    wireguardPort: '',
    wireguardSubnet: '',
    l2tpPsk: '',
    ikev2Psk: '',
    ikev2RemoteId: '',
  }
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

  const [generatingWgKeys, setGeneratingWgKeys] = useState(false)
  const [showWgPrivateKey, setShowWgPrivateKey] = useState(false)

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
    setForm({
      coreType: core.core_type,
      name: core.name,
      note: core.note ?? '',
      configText: core.config ? JSON.stringify(core.config, null, 2) : '',
      wireguardPublicKey: core.wireguard_public_key ?? '',
      wireguardPrivateKey: core.wireguard_private_key ?? '',
      wireguardPort: core.wireguard_port != null ? String(core.wireguard_port) : '',
      wireguardSubnet: core.wireguard_subnet ?? '',
      l2tpPsk: core.l2tp_psk ?? '',
      ikev2Psk: core.ikev2_psk ?? '',
      ikev2RemoteId: core.ikev2_remote_id ?? '',
    })
    setWizard(emptyWizard())
    setLastWarnings([])
    setShowForm(true)
  }

  async function generateWgKeys() {
    setGeneratingWgKeys(true)
    setError(null)
    try {
      const keys = await getWireGuardKeypair()
      setForm((f) => ({ ...f, wireguardPublicKey: keys.public_key, wireguardPrivateKey: keys.private_key }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.hostsPage.keyGenFailed)
    } finally {
      setGeneratingWgKeys(false)
    }
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
    if (!form.coreType) return

    let config: Record<string, unknown> | undefined
    if (form.coreType === 'xray') {
      try {
        config = JSON.parse(form.configText)
      } catch {
        setError(t.coresPage.invalidJson)
        return
      }
    }

    setSubmitting(true)
    try {
      const payload = {
        name: form.name,
        note: form.note || null,
        core_type: form.coreType,
        config,
        wireguard_public_key: form.coreType === 'wireguard' ? form.wireguardPublicKey || null : null,
        wireguard_private_key: form.coreType === 'wireguard' ? form.wireguardPrivateKey || null : null,
        wireguard_port: form.coreType === 'wireguard' && form.wireguardPort ? parseInt(form.wireguardPort, 10) : null,
        wireguard_subnet: form.coreType === 'wireguard' ? form.wireguardSubnet || null : null,
        l2tp_psk: form.coreType === 'l2tp' ? form.l2tpPsk || null : null,
        ikev2_psk: form.coreType === 'ikev2' ? form.ikev2Psk || null : null,
        ikev2_remote_id: form.coreType === 'ikev2' ? form.ikev2RemoteId || null : null,
      }
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
          <div className="mb-4">
            <label className={labelClass}>{t.coresPage.coreTypeLabel}</label>
            <div className="flex flex-wrap gap-2">
              {CORE_TYPES.map((ct) => (
                <button
                  key={ct}
                  type="button"
                  disabled={!!editingId}
                  onClick={() => setForm((f) => ({ ...emptyForm(), coreType: ct, name: f.name, note: f.note }))}
                  className="rounded-lg border px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                  style={
                    form.coreType === ct
                      ? { borderColor: ACCENT, color: ACCENT, backgroundColor: 'rgba(34,211,238,0.1)' }
                      : { borderColor: 'rgba(255,255,255,0.15)', color: '#cbd5e1' }
                  }
                >
                  {t.coresPage.coreTypeLabels[ct]}
                </button>
              ))}
            </div>
            {editingId && <div className="mt-1.5 text-[11px] text-slate-500">{t.coresPage.coreTypeHint}</div>}
          </div>

          {form.coreType === 'xray' && (
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
              </div>
            )}

            {isTransportProtocol && wizard.security === 'reality' && (
              <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
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
                  <div className="text-[11px] text-slate-500">
                    <span dir="ltr" className="font-mono">
                      privateKey: {wizard.realityPrivateKey ? '••••••••' : '—'} · shortId:{' '}
                      {wizard.realityShortId || '—'}
                    </span>
                  </div>
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
          )}

          {form.coreType && (
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

            {form.coreType === 'xray' && (
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
            )}

            {form.coreType === 'wireguard' && (
              <div className="mt-4 rounded-lg border border-cyan-400/15 bg-black/25 p-3">
                <div className="mb-3 flex flex-wrap gap-3">
                  <div>
                    <label className={labelClass}>{t.hostsPage.wgPortLabel}</label>
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      value={form.wireguardPort}
                      onChange={(e) => setForm((f) => ({ ...f, wireguardPort: e.target.value }))}
                      required
                      className={`${inputClass} w-28`}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>{t.hostsPage.wgSubnetLabel}</label>
                    <input
                      dir="ltr"
                      value={form.wireguardSubnet}
                      onChange={(e) => setForm((f) => ({ ...f, wireguardSubnet: e.target.value }))}
                      placeholder="10.66.66.0/24"
                      required
                      className={`${inputClass} w-48 text-left font-mono text-xs`}
                    />
                  </div>
                </div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-slate-400">{t.hostsPage.wgServerKeyLabel}</span>
                  <button
                    type="button"
                    onClick={generateWgKeys}
                    disabled={generatingWgKeys}
                    className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-60"
                    style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                  >
                    {generatingWgKeys ? t.hostsPage.generatingKeys : t.hostsPage.generateNewKey}
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    dir="ltr"
                    readOnly
                    value={form.wireguardPublicKey}
                    placeholder="Public Key"
                    className={`${inputClass} text-left font-mono text-xs`}
                  />
                  <div className="relative">
                    <input
                      dir="ltr"
                      readOnly
                      type={showWgPrivateKey ? 'text' : 'password'}
                      value={form.wireguardPrivateKey}
                      placeholder="Private Key"
                      className={`${inputClass} w-full pr-12 text-left font-mono text-xs`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowWgPrivateKey((v) => !v)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400"
                    >
                      {showWgPrivateKey ? t.hostsPage.hide : t.hostsPage.show}
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-slate-500">{t.hostsPage.wgHint}</div>
              </div>
            )}

            {form.coreType === 'l2tp' && (
              <div className="mt-3 flex flex-wrap gap-3">
                <div>
                  <label className={labelClass}>{t.hostsPage.l2tpPskLabel}</label>
                  <input
                    dir="ltr"
                    value={form.l2tpPsk}
                    onChange={(e) => setForm((f) => ({ ...f, l2tpPsk: e.target.value }))}
                    required
                    className={`${inputClass} w-64 font-mono text-xs`}
                  />
                </div>
                <div className="self-end pb-2 text-[10px] text-slate-500">{t.hostsPage.l2tpHint}</div>
              </div>
            )}

            {form.coreType === 'ikev2' && (
              <div className="mt-3 flex flex-wrap gap-3">
                <div>
                  <label className={labelClass}>{t.hostsPage.ikev2PskLabel}</label>
                  <input
                    dir="ltr"
                    value={form.ikev2Psk}
                    onChange={(e) => setForm((f) => ({ ...f, ikev2Psk: e.target.value }))}
                    required
                    className={`${inputClass} w-64 font-mono text-xs`}
                  />
                </div>
                <div>
                  <label className={labelClass}>{t.coresPage.ikev2RemoteIdLabel}</label>
                  <input
                    dir="ltr"
                    value={form.ikev2RemoteId}
                    onChange={(e) => setForm((f) => ({ ...f, ikev2RemoteId: e.target.value }))}
                    className={`${inputClass} w-56 text-left`}
                  />
                </div>
                <div className="self-end pb-2 text-[10px] text-slate-500">{t.hostsPage.ikev2PortsHint}</div>
              </div>
            )}

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
          )}
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
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-100">{c.name}</span>
                  <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                    {t.coresPage.coreTypeLabels[c.core_type]}
                  </span>
                </div>
                {c.note && <div className="text-xs text-slate-500">{c.note}</div>}
              </div>
              <div className="flex items-center gap-4">
                {c.core_type === 'xray' ? (
                  <span className="text-xs text-slate-400">
                    {t.coresPage.colNodes}: <span className="text-slate-200">{c.node_count}</span>
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">
                    {t.coresPage.colHosts}: <span className="text-slate-200">{c.host_count}</span>
                  </span>
                )}
                <button onClick={() => startEdit(c)} className="text-xs text-slate-400 hover:underline">
                  {t.common.edit}
                </button>
                <button onClick={() => handleDelete(c)} className="text-xs text-red-400 hover:underline">
                  {t.common.delete}
                </button>
              </div>
            </div>

            {c.core_type === 'wireguard' && (
              <div dir="ltr" className="font-mono text-xs text-slate-400">
                {c.wireguard_subnet} · port {c.wireguard_port}
              </div>
            )}
            {c.core_type === 'l2tp' && (
              <div className="text-xs text-slate-400">PSK: {c.l2tp_psk ? '••••••••' : '—'}</div>
            )}
            {c.core_type === 'ikev2' && (
              <div className="text-xs text-slate-400">
                PSK: {c.ikev2_psk ? '••••••••' : '—'}
                {c.ikev2_remote_id && (
                  <span dir="ltr" className="font-mono">
                    {' '}
                    · {c.ikev2_remote_id}
                  </span>
                )}
              </div>
            )}

            {c.core_type === 'xray' && c.inbounds.length === 0 ? (
              <div className="text-xs text-slate-500">{t.coresPage.noInbounds}</div>
            ) : c.core_type === 'xray' ? (
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
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
