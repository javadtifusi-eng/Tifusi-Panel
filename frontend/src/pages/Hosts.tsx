import { useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  createHost,
  deleteHost,
  getRealityKeypair,
  listHosts,
  scanReality,
  updateHost,
  type Host,
  type HostNetwork,
  type HostProtocol,
  type HostSecurity,
} from '../lib/api'

const ACCENT = '#22D3EE'

const protocolLabels: Record<HostProtocol, string> = {
  vless: 'VLESS',
  trojan: 'Trojan',
  wireguard: 'WireGuard',
  hysteria2: 'Hysteria2',
}

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
  }
}

export default function HostsPage() {
  const [hosts, setHosts] = useState<Host[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [findingTarget, setFindingTarget] = useState(false)
  const [generatingKeys, setGeneratingKeys] = useState(false)
  const [showPrivateKey, setShowPrivateKey] = useState(false)

  const usesTransport = form.protocol === 'vless' || form.protocol === 'trojan'
  const usesReality = usesTransport && form.security === 'reality'

  async function refresh() {
    try {
      const res = await listHosts()
      setHosts(res.hosts)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در دریافت لیست هاست‌ها')
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
      else setError('هیچ تارگت قابل‌استفاده‌ای پیدا نشد')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'اسکن با خطا مواجه شد')
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
      setError(err instanceof ApiError ? err.message : 'ساخت کلید با خطا مواجه شد')
    } finally {
      setGeneratingKeys(false)
    }
  }

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(false)
    setShowPrivateKey(false)
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
      setError(err instanceof ApiError ? err.message : 'مشکلی پیش اومد')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(host: Host) {
    if (!window.confirm(`هاست «${host.remark}» حذف بشه؟`)) return
    try {
      await deleteHost(host.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'مشکلی پیش اومد')
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-50">هاست‌ها</h1>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
        >
          + هاست جدید
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={labelClass}>نام نمایشی</label>
              <input
                value={form.remark}
                onChange={(e) => update('remark', e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>پروتکل</label>
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
                <div className="mt-1 text-[10px] text-slate-500">پروتکل بعد از ساخت قابل تغییر نیست</div>
              )}
            </div>
            <div>
              <label className={labelClass}>آدرس</label>
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
              <label className={labelClass}>پورت</label>
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
                <label className={labelClass}>شبکه انتقال</label>
                <select
                  value={form.network}
                  onChange={(e) => update('network', e.target.value as HostNetwork)}
                  className={inputClass}
                >
                  <option value="tcp">TCP</option>
                  <option value="ws">WebSocket</option>
                  <option value="grpc">gRPC</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>امنیت</label>
                <select
                  value={form.security}
                  onChange={(e) => update('security', e.target.value as HostSecurity)}
                  className={inputClass}
                >
                  <option value="none">بدون TLS</option>
                  <option value="tls">TLS</option>
                  <option value="reality">REALITY</option>
                </select>
              </div>
            </div>
          )}

          {usesReality && (
            <div className="mt-4 rounded-lg border border-cyan-400/15 bg-black/25 p-3">
              <div className="mb-3 flex items-end gap-3">
                <div className="flex-1">
                  <label className={labelClass}>SNI (تارگت REALITY)</label>
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
                  {findingTarget ? 'در حال اسکن…' : 'پیشنهاد بهترین تارگت'}
                </button>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">کلید REALITY</span>
                <button
                  type="button"
                  onClick={generateKeys}
                  disabled={generatingKeys}
                  className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-60"
                  style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                >
                  {generatingKeys ? 'در حال ساخت…' : 'تولید کلید تازه'}
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
                    className={`${inputClass} w-full text-left font-mono text-xs`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPrivateKey((v) => !v)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400"
                  >
                    {showPrivateKey ? 'مخفی' : 'نمایش'}
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

          {error && <div className="mt-3 text-xs text-red-400">{error}</div>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-4 rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60"
            style={{ backgroundColor: ACCENT }}
          >
            {editingId ? 'ذخیره تغییرات' : 'ساخت هاست'}
          </button>
        </form>
      )}

      {!showForm && error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-right text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs text-slate-400">
              <th className="px-4 py-3 font-medium">نام</th>
              <th className="px-4 py-3 font-medium">پروتکل</th>
              <th className="px-4 py-3 font-medium">آدرس</th>
              <th className="px-4 py-3 font-medium">امنیت</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {hosts === null && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  در حال بارگذاری…
                </td>
              </tr>
            )}
            {hosts !== null && hosts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  هنوز هاستی ساخته نشده
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
                  ) : (
                    (h.security ?? '—')
                  )}
                </td>
                <td className="px-4 py-3 text-left">
                  <button
                    onClick={() => startEdit(h)}
                    className="ml-3 text-xs text-slate-400 hover:underline"
                  >
                    ویرایش
                  </button>
                  <button onClick={() => handleDelete(h)} className="text-xs text-red-400 hover:underline">
                    حذف
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
