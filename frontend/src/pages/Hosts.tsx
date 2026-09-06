import { useEffect, useState, type FormEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createHost,
  deleteHost,
  FINGERPRINTS,
  getWireGuardKeypair,
  listCores,
  listHosts,
  updateHost,
  type Core,
  type Host,
  type HostProtocol,
  type HostSecurity,
  type Inbound,
} from '../lib/api'

const ACCENT = '#22D3EE'

const inputClass =
  'rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60'
const labelClass = 'mb-1.5 block text-xs text-slate-400'

const PROTOCOLS: HostProtocol[] = ['vless', 'vmess', 'trojan', 'shadowsocks', 'wireguard', 'hysteria2', 'ikev2', 'l2tp']
const XRAY_PROTOCOLS: HostProtocol[] = ['vless', 'vmess', 'trojan', 'shadowsocks']
const PLACEHOLDER_KEYS = ['username', 'protocol', 'days_left', 'expire_date', 'data_limit_gb', 'data_left_gb'] as const

function emptyForm() {
  return {
    remark: '',
    address: '',
    protocol: '' as HostProtocol | '',
    inbound_id: null as number | null,
    port_override: '',
    sni_override: '',
    alpn_override: '',
    fingerprint_override: '',
    path_override: '',
    host_header_override: '',
    security_override: '' as HostSecurity | '',
    allowinsecure: false,
    wireguard_public_key: '',
    wireguard_private_key: '',
    wireguard_subnet: '',
    wireguard_port: '',
    hysteria2_sni: '',
    hysteria2_port: '',
    ikev2_psk: '',
    l2tp_psk: '',
  }
}

type Form = ReturnType<typeof emptyForm>

export default function HostsPage() {
  const { t } = useLang()
  const protocolLabels = t.coresPage.protocolLabels
  const [hosts, setHosts] = useState<Host[] | null>(null)
  const [cores, setCores] = useState<Core[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<Form>(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [showPlaceholders, setShowPlaceholders] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [generatingKeys, setGeneratingKeys] = useState(false)
  const [showPrivateKey, setShowPrivateKey] = useState(false)

  const allInbounds: Inbound[] = cores.flatMap((c) => c.inbounds)
  const isXray = form.protocol !== '' && XRAY_PROTOCOLS.includes(form.protocol)
  const isWireguard = form.protocol === 'wireguard'
  const isHysteria2 = form.protocol === 'hysteria2'
  const isIkev2 = form.protocol === 'ikev2'
  const isL2tp = form.protocol === 'l2tp'
  const inboundsForProtocol = allInbounds.filter((i) => i.protocol === form.protocol)

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
      // ignored — the inbound select just stays empty
    }
  }

  useEffect(() => {
    refresh()
    refreshCores()
  }, [])

  function update<K extends keyof Form>(key: K, value: Form[K]) {
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
    setShowPrivateKey(false)
    setError(null)
  }

  function startEdit(host: Host) {
    setEditingId(host.id)
    setForm({
      remark: host.remark,
      address: host.address,
      protocol: host.protocol,
      inbound_id: host.inbound_id,
      port_override: host.port_override != null ? String(host.port_override) : '',
      sni_override: host.sni_override ?? '',
      alpn_override: host.alpn_override ?? '',
      fingerprint_override: host.fingerprint_override ?? '',
      path_override: host.path_override ?? '',
      host_header_override: host.host_header_override ?? '',
      security_override: host.security_override ?? '',
      allowinsecure: host.allowinsecure,
      wireguard_public_key: host.wireguard_public_key ?? '',
      wireguard_private_key: host.wireguard_private_key ?? '',
      wireguard_subnet: host.wireguard_subnet ?? '',
      wireguard_port: host.wireguard_port != null ? String(host.wireguard_port) : '',
      hysteria2_sni: host.hysteria2_sni ?? '',
      hysteria2_port: host.hysteria2_port != null ? String(host.hysteria2_port) : '',
      ikev2_psk: host.ikev2_psk ?? '',
      l2tp_psk: host.l2tp_psk ?? '',
    })
    setShowForm(true)
  }

  async function generateWgKeys() {
    setGeneratingKeys(true)
    setError(null)
    try {
      const keys = await getWireGuardKeypair()
      setForm((f) => ({ ...f, wireguard_public_key: keys.public_key, wireguard_private_key: keys.private_key }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.hostsPage.keyGenFailed)
    } finally {
      setGeneratingKeys(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.protocol) return
    setSubmitting(true)
    const payload = {
      remark: form.remark,
      address: form.address,
      protocol: form.protocol,
      inbound_id: isXray ? form.inbound_id : null,
      port_override: isXray && form.port_override ? parseInt(form.port_override, 10) : null,
      sni_override: isXray ? form.sni_override || null : null,
      alpn_override: isXray ? form.alpn_override || null : null,
      fingerprint_override: isXray ? form.fingerprint_override || null : null,
      path_override: isXray ? form.path_override || null : null,
      host_header_override: isXray ? form.host_header_override || null : null,
      security_override: isXray && form.security_override ? form.security_override : null,
      allowinsecure: isXray ? form.allowinsecure : false,
      wireguard_public_key: isWireguard ? form.wireguard_public_key || null : null,
      wireguard_private_key: isWireguard ? form.wireguard_private_key || null : null,
      wireguard_subnet: isWireguard ? form.wireguard_subnet || null : null,
      wireguard_port: isWireguard && form.wireguard_port ? parseInt(form.wireguard_port, 10) : null,
      hysteria2_sni: isHysteria2 ? form.hysteria2_sni || null : null,
      hysteria2_port: isHysteria2 && form.hysteria2_port ? parseInt(form.hysteria2_port, 10) : null,
      ikev2_psk: isIkev2 ? form.ikev2_psk || null : null,
      l2tp_psk: isL2tp ? form.l2tp_psk || null : null,
    }
    try {
      if (editingId) await updateHost(editingId, payload)
      else await createHost({ ...payload, protocol: form.protocol })
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
              <label className={labelClass}>{t.hostsPage.protocolLabel}</label>
              <select
                value={form.protocol}
                onChange={(e) => {
                  update('protocol', e.target.value as HostProtocol)
                  update('inbound_id', null)
                }}
                required
                className={inputClass}
              >
                <option value="" disabled>
                  {t.coresPage.selectPlaceholder}
                </option>
                {PROTOCOLS.map((p) => (
                  <option key={p} value={p}>
                    {protocolLabels[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isXray && (
            <div className="mt-3 flex flex-wrap gap-3">
              <div>
                <label className={labelClass}>{t.hostsPage.inboundLabel}</label>
                <select
                  value={form.inbound_id ?? ''}
                  onChange={(e) => update('inbound_id', e.target.value ? Number(e.target.value) : null)}
                  required
                  className={`${inputClass} w-56`}
                >
                  <option value="" disabled>
                    {t.coresPage.selectPlaceholder}
                  </option>
                  {inboundsForProtocol.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.tag} — {i.network}/{i.security}
                    </option>
                  ))}
                </select>
                {inboundsForProtocol.length === 0 && (
                  <div className="mt-1 text-[10px] text-amber-400">{t.hostsPage.noInboundsForProtocol}</div>
                )}
              </div>
              <div>
                <label className={labelClass}>{t.hostsPage.portOverride}</label>
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={form.port_override}
                  onChange={(e) => update('port_override', e.target.value)}
                  className={`${inputClass} w-32`}
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
              <div>
                <label className={labelClass}>{t.hostsPage.fingerprintOverride}</label>
                <select
                  dir="ltr"
                  value={form.fingerprint_override}
                  onChange={(e) => update('fingerprint_override', e.target.value)}
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
              <div>
                <label className={labelClass}>{t.hostsPage.pathOverride}</label>
                <input
                  dir="ltr"
                  value={form.path_override}
                  onChange={(e) => update('path_override', e.target.value)}
                  className={`${inputClass} text-left`}
                />
              </div>
              <div>
                <label className={labelClass}>{t.hostsPage.hostHeaderOverride}</label>
                <input
                  dir="ltr"
                  value={form.host_header_override}
                  onChange={(e) => update('host_header_override', e.target.value)}
                  className={`${inputClass} text-left`}
                />
              </div>
              <div>
                <label className={labelClass}>{t.hostsPage.securityOverrideLabel}</label>
                <select
                  value={form.security_override}
                  onChange={(e) => update('security_override', e.target.value as HostSecurity)}
                  className={inputClass}
                >
                  <option value="">{t.hostsPage.securityInherit}</option>
                  <option value="none">{t.hostsPage.securityNone}</option>
                  <option value="tls">{t.hostsPage.securityTls}</option>
                  <option value="reality">{t.hostsPage.securityReality}</option>
                </select>
              </div>
              <div className="flex items-end pb-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.allowinsecure}
                    onChange={(e) => update('allowinsecure', e.target.checked)}
                  />
                  {t.hostsPage.allowinsecureLabel}
                </label>
              </div>
            </div>
          )}

          {isWireguard && (
            <div className="mt-4 rounded-lg border border-cyan-400/15 bg-black/25 p-3">
              <div className="mb-3 flex flex-wrap gap-3">
                <div>
                  <label className={labelClass}>{t.hostsPage.wgPortLabel}</label>
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={form.wireguard_port}
                    onChange={(e) => update('wireguard_port', e.target.value)}
                    className={`${inputClass} w-28`}
                  />
                </div>
                <div>
                  <label className={labelClass}>{t.hostsPage.wgSubnetLabel}</label>
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
                <span className="text-xs text-slate-400">{t.hostsPage.wgServerKeyLabel}</span>
                <button
                  type="button"
                  onClick={generateWgKeys}
                  disabled={generatingKeys}
                  className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-60"
                  style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                >
                  {generatingKeys ? t.hostsPage.generatingKeys : t.hostsPage.generateNewKey}
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
                    type={showPrivateKey ? 'text' : 'password'}
                    value={form.wireguard_private_key}
                    placeholder="Private Key"
                    className={`${inputClass} w-full pr-12 text-left font-mono text-xs`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPrivateKey((v) => !v)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400"
                  >
                    {showPrivateKey ? t.hostsPage.hide : t.hostsPage.show}
                  </button>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-slate-500">{t.hostsPage.wgHint}</div>
            </div>
          )}

          {isHysteria2 && (
            <div className="mt-3 flex flex-wrap gap-3">
              <div>
                <label className={labelClass}>{t.hostsPage.hysteria2SniLabel}</label>
                <input
                  dir="ltr"
                  value={form.hysteria2_sni}
                  onChange={(e) => update('hysteria2_sni', e.target.value)}
                  className={`${inputClass} text-left`}
                />
              </div>
              <div>
                <label className={labelClass}>{t.hostsPage.hysteria2PortLabel}</label>
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={form.hysteria2_port}
                  onChange={(e) => update('hysteria2_port', e.target.value)}
                  className={`${inputClass} w-28`}
                />
              </div>
            </div>
          )}

          {isIkev2 && (
            <div className="mt-3 flex flex-wrap gap-3">
              <div>
                <label className={labelClass}>{t.hostsPage.ikev2PskLabel}</label>
                <input
                  dir="ltr"
                  value={form.ikev2_psk}
                  onChange={(e) => update('ikev2_psk', e.target.value)}
                  className={`${inputClass} w-64 font-mono text-xs`}
                />
              </div>
              <div className="self-end pb-2 text-[10px] text-slate-500">{t.hostsPage.ikev2PortsHint}</div>
            </div>
          )}

          {isL2tp && (
            <div className="mt-3 flex flex-wrap gap-3">
              <div>
                <label className={labelClass}>{t.hostsPage.l2tpPskLabel}</label>
                <input
                  dir="ltr"
                  value={form.l2tp_psk}
                  onChange={(e) => update('l2tp_psk', e.target.value)}
                  className={`${inputClass} w-64 font-mono text-xs`}
                />
              </div>
              <div className="self-end pb-2 text-[10px] text-slate-500">{t.hostsPage.l2tpHint}</div>
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
              {h.address}
              {h.effective_port != null ? `:${h.effective_port}` : ''}
            </div>
            <div className="mb-3 text-xs text-slate-400">
              {h.effective_security === 'reality' ? (
                <span dir="ltr" className="font-mono" style={{ color: ACCENT }}>
                  REALITY · {h.effective_sni ?? '—'}
                </span>
              ) : (
                (h.effective_security ?? '—')
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
