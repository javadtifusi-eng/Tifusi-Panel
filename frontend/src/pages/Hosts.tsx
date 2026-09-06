import { useEffect, useState, type FormEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createHost,
  deleteHost,
  getRealityKeypair,
  getWireGuardKeypair,
  listHosts,
  scanReality,
  updateHost,
  type Host,
  type HostNetwork,
  type HostProtocol,
  type HostSecurity,
} from '../lib/api'

const ACCENT = '#22D3EE'

const inputClass =
  'rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60'
const labelClass = 'mb-1.5 block text-xs text-slate-400'

function emptyForm() {
  return {
    remark: '',
    protocol: 'vless' as HostProtocol,
    address: '',
    port: '443',
    network: 'tcp' as HostNetwork,
    security: 'reality' as HostSecurity,
    sni: '',
    reality_public_key: '',
    reality_private_key: '',
    reality_short_id: '',
    wireguard_public_key: '',
    wireguard_private_key: '',
    wireguard_subnet: '10.66.66.0/24',
  }
}

export default function HostsPage() {
  const { t, align } = useLang()
  const protocolLabels = t.hostsPage.protocolLabels
  const [hosts, setHosts] = useState<Host[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [findingTarget, setFindingTarget] = useState(false)
  const [generatingKeys, setGeneratingKeys] = useState(false)
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [generatingWgKeys, setGeneratingWgKeys] = useState(false)
  const [showWgPrivateKey, setShowWgPrivateKey] = useState(false)

  const usesTransport = form.protocol === 'vless' || form.protocol === 'trojan'
  const usesReality = usesTransport && form.security === 'reality'
  const usesWireguard = form.protocol === 'wireguard'

  async function refresh() {
    try {
      const res = await listHosts()
      setHosts(res.hosts)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.hostsPage.fetchError)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  function update<K extends keyof ReturnType<typeof emptyForm>>(key: K, value: ReturnType<typeof emptyForm>[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function findBestTarget() {
    setFindingTarget(true)
    setError(null)
    try {
      const res = await scanReality()
      const best = res.results.find((r) => r.recommended)
      if (best) update('sni', best.host)
      else setError(t.hostsPage.noTargetFound)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.hostsPage.scanFailed)
    } finally {
      setFindingTarget(false)
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
      setError(err instanceof ApiError ? err.message : t.hostsPage.keyGenFailed)
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
      setError(err instanceof ApiError ? err.message : t.hostsPage.keyGenFailed)
    } finally {
      setGeneratingWgKeys(false)
    }
  }

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(false)
    setShowPrivateKey(false)
    setShowWgPrivateKey(false)
  }

  function startEdit(host: Host) {
    setEditingId(host.id)
    setForm({
      remark: host.remark,
      protocol: host.protocol,
      address: host.address,
      port: String(host.port),
      network: host.network ?? 'tcp',
      security: host.security ?? 'none',
      sni: host.sni ?? '',
      reality_public_key: host.reality_public_key ?? '',
      reality_private_key: host.reality_private_key ?? '',
      reality_short_id: host.reality_short_id ?? '',
      wireguard_public_key: host.wireguard_public_key ?? '',
      wireguard_private_key: host.wireguard_private_key ?? '',
      wireguard_subnet: host.wireguard_subnet ?? '10.66.66.0/24',
    })
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const payload = {
      remark: form.remark,
      address: form.address,
      port: parseInt(form.port, 10),
      network: usesTransport ? form.network : null,
      security: usesTransport ? form.security : null,
      sni: usesReality ? form.sni : null,
      reality_public_key: usesReality ? form.reality_public_key : null,
      reality_private_key: usesReality ? form.reality_private_key : null,
      reality_short_id: usesReality ? form.reality_short_id : null,
      wireguard_public_key: usesWireguard ? form.wireguard_public_key : null,
      wireguard_private_key: usesWireguard ? form.wireguard_private_key : null,
      wireguard_subnet: usesWireguard ? form.wireguard_subnet : null,
    }
    try {
      if (editingId) {
        await updateHost(editingId, payload)
      } else {
        await createHost({ ...payload, protocol: form.protocol })
      }
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
              <label className={labelClass}>{t.hostsPage.protocol}</label>
              <select
                value={form.protocol}
                onChange={(e) => update('protocol', e.target.value as HostProtocol)}
                disabled={editingId !== null}
                className={`${inputClass} disabled:opacity-50`}
              >
                {Object.entries(protocolLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {editingId !== null && (
                <div className="mt-1 text-[10px] text-slate-500">{t.hostsPage.protocolLockedNote}</div>
              )}
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
                required
                className={`${inputClass} w-24`}
              />
            </div>
          </div>

          {usesTransport && (
            <div className="mt-3 flex flex-wrap gap-3">
              <div>
                <label className={labelClass}>{t.hostsPage.network}</label>
                <select
                  value={form.network}
                  onChange={(e) => update('network', e.target.value as HostNetwork)}
                  className={inputClass}
                >
                  <option value="tcp">{t.hostsPage.networkTcp}</option>
                  <option value="ws">{t.hostsPage.networkWs}</option>
                  <option value="grpc">{t.hostsPage.networkGrpc}</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>{t.hostsPage.security}</label>
                <select
                  value={form.security}
                  onChange={(e) => update('security', e.target.value as HostSecurity)}
                  className={inputClass}
                >
                  <option value="none">{t.hostsPage.securityNone}</option>
                  <option value="tls">{t.hostsPage.securityTls}</option>
                  <option value="reality">{t.hostsPage.securityReality}</option>
                </select>
              </div>
            </div>
          )}

          {usesReality && (
            <div className="mt-4 rounded-lg border border-cyan-400/15 bg-black/25 p-3">
              <div className="mb-3 flex items-end gap-3">
                <div className="flex-1">
                  <label className={labelClass}>{t.hostsPage.sniLabel}</label>
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
                  onClick={findBestTarget}
                  disabled={findingTarget}
                  className="flex-shrink-0 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-60"
                  style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                >
                  {findingTarget ? t.hostsPage.scanning : t.hostsPage.suggestTarget}
                </button>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">{t.hostsPage.realityKeyLabel}</span>
                <button
                  type="button"
                  onClick={generateKeys}
                  disabled={generatingKeys}
                  className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-60"
                  style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                >
                  {generatingKeys ? t.hostsPage.generatingKeys : t.hostsPage.generateNewKey}
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
                    {showPrivateKey ? t.hostsPage.hide : t.hostsPage.show}
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

          {usesWireguard && (
            <div className="mt-4 rounded-lg border border-cyan-400/15 bg-black/25 p-3">
              <div className="mb-3">
                <label className={labelClass}>{t.hostsPage.wgSubnetLabel}</label>
                <input
                  dir="ltr"
                  value={form.wireguard_subnet}
                  onChange={(e) => update('wireguard_subnet', e.target.value)}
                  placeholder="10.66.66.0/24"
                  className={`${inputClass} w-48 text-left font-mono text-xs`}
                />
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
                    {showWgPrivateKey ? t.hostsPage.hide : t.hostsPage.show}
                  </button>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-slate-500">{t.hostsPage.wgHint}</div>
            </div>
          )}

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
                  {h.address}:{h.port}
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {h.security === 'reality' ? (
                    <span dir="ltr" className="font-mono text-xs" style={{ color: ACCENT }}>
                      REALITY · {h.sni}
                    </span>
                  ) : h.protocol === 'wireguard' ? (
                    <span dir="ltr" className="font-mono text-xs text-slate-400">
                      {h.wireguard_subnet ?? '—'}
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
