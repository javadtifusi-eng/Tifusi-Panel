import { useEffect, useState } from 'react'
import { ApiError, getRealityTargetCount, scanReality, type RealityScanResponse } from '../lib/api'

const ACCENT = '#22D3EE'

export default function RealityScanPage() {
  const [targetCount, setTargetCount] = useState<number | null>(null)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<RealityScanResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedHost, setCopiedHost] = useState<string | null>(null)

  useEffect(() => {
    getRealityTargetCount()
      .then(setTargetCount)
      .catch(() => setTargetCount(null))
  }, [])

  async function runScan() {
    setScanning(true)
    setError(null)
    try {
      const res = await scanReality()
      setResult(res)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'اسکن با خطا مواجه شد')
    } finally {
      setScanning(false)
    }
  }

  async function copyHost(host: string) {
    try {
      await navigator.clipboard.writeText(host)
    } catch {
      // Clipboard API unavailable; nothing to fall back to here.
    }
    setCopiedHost(host)
    window.setTimeout(() => setCopiedHost((h) => (h === host ? null : h)), 1500)
  }

  const best = result?.results.find((r) => r.recommended) ?? null

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-50">اسکنر تارگت REALITY</h1>
        <button
          onClick={runScan}
          disabled={scanning}
          className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
        >
          {scanning ? 'در حال اسکن…' : 'شروع اسکن'}
        </button>
      </div>
      <p className="mb-6 text-sm text-slate-400">
        از سرور خودت به {targetCount ?? '۱۵۰+'} دامنه‌ی معتبر و پرترافیک وصل می‌شه، تأخیر و پشتیبانی TLS 1.3
        هرکدوم رو می‌سنجه، و بهترین گزینه رو برای استفاده به‌عنوان تارگت REALITY پیشنهاد می‌ده.
      </p>

      {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      {scanning && (
        <div className="mb-6 rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4 text-sm text-slate-400">
          در حال تست همزمان دامنه‌ها… ممکنه چند ثانیه طول بکشه.
        </div>
      )}

      {best && !scanning && (
        <div
          className="mb-6 flex items-center justify-between rounded-xl border p-4"
          style={{ borderColor: 'rgba(34,211,238,0.35)', backgroundColor: 'rgba(34,211,238,0.08)' }}
        >
          <div>
            <div className="text-[11px] font-bold tracking-wider" style={{ color: ACCENT }}>
              پیشنهاد بهترین تارگت
            </div>
            <div dir="ltr" className="mt-1 text-left font-mono text-lg font-bold text-slate-50">
              {best.host}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {best.latency_ms} میلی‌ثانیه تأخیر &middot; {best.tls_version} &middot; ALPN: {best.alpn ?? '—'}
            </div>
          </div>
          <button
            onClick={() => copyHost(best.host)}
            className="flex-shrink-0 rounded-lg px-4 py-2 text-sm font-bold text-slate-950"
            style={{ backgroundColor: ACCENT }}
          >
            {copiedHost === best.host ? 'کپی شد ✓' : 'کپی'}
          </button>
        </div>
      )}

      {result && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs text-slate-400">
                <th className="px-4 py-3 font-medium">دامنه</th>
                <th className="px-4 py-3 font-medium">وضعیت</th>
                <th className="px-4 py-3 font-medium">TLS</th>
                <th className="px-4 py-3 font-medium">تأخیر</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {result.results.map((r) => (
                <tr
                  key={r.host}
                  className="border-b border-white/5 last:border-0"
                  style={r.recommended ? { backgroundColor: 'rgba(34,211,238,0.06)' } : undefined}
                >
                  <td dir="ltr" className="px-4 py-3 text-left font-mono text-slate-100">
                    {r.host}
                  </td>
                  <td className="px-4 py-3">
                    {r.recommended ? (
                      <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-300">
                        پیشنهادی
                      </span>
                    ) : r.reachable ? (
                      <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-300">
                        قابل استفاده
                      </span>
                    ) : (
                      <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2.5 py-1 text-[11px] text-slate-400">
                        غیرقابل دسترس
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{r.tls_version ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{r.latency_ms != null ? `${r.latency_ms} ms` : '—'}</td>
                  <td className="px-4 py-3 text-left">
                    {r.reachable && (
                      <button onClick={() => copyHost(r.host)} className="text-xs hover:underline" style={{ color: ACCENT }}>
                        {copiedHost === r.host ? 'کپی شد' : 'کپی'}
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
  )
}
