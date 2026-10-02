import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  getRealityScan,
  listNodes,
  listRealityResults,
  startRealityScan,
  stopRealityScan,
  type Node,
  type RealityResult,
  type RealityScan,
} from '../lib/api'
import { copyToClipboard } from '../lib/clipboard'
import { parseServerDate } from '../lib/format'
import { useToast } from './ui'

// REALITY SNI scanner for an Iranian operator. The measuring happens in the
// probe on a phone (Termux) or laptop on that operator; this card starts a
// scan, hands out its link and downloads, and ranks what comes back by
// upload — the direction MCI throttles.

const TEXT = {
  fa: {
    title: 'اسکنر SNI برای اپراتور (Reality)',
    intro:
      'اسکن را شروع کن، بعد برنامه‌ی تست را روی گوشی یا لپ‌تاپی که به همان اپراتور (مثلاً همراه اول) وصل است اجرا کن. برنامه هر SNI را از داخل اینترنت خود اپراتور تا نود می‌سنجد و نتیجه را به همین جدول می‌فرستد.',
    node: 'نود',
    start: 'شروع اسکن',
    stop: 'توقف اسکن',
    collecting: 'نود دارد سایت‌ها را جمع می‌کند (۱ تا ۲ دقیقه)…',
    ready: (n: number, r: number) => `آماده است: ${n} کانفیگ در دور ${r}. حالا برنامه را با لینک زیر اجرا کن.`,
    failed: 'اسکن خراب شد',
    link: 'لینک اسکن',
    copy: 'کپی',
    copied: 'کپی شد',
    phone: 'گوشی اندروید (Termux)',
    windows: 'ویندوز',
    linux: 'لینوکس',
    phoneSteps: 'در Termux (بدون SSH):',
    winSteps: 'فایل را اجرا کن و لینک را بچسبان.',
    results: 'نتیجه‌ها (بهترین اپلود هر SNI)',
    lastRun: 'فقط اسکن آخر',
    allRuns: '۱۴ روز اخیر',
    none: 'هنوز نتیجه‌ای نیامده.',
    sni: 'SNI',
    port: 'پورت',
    fp: 'Fingerprint',
    up: 'اپلود',
    down: 'دانلود',
    ping: 'پینگ',
    op: 'اپراتور',
    src: 'منبع',
    when: 'زمان',
    failedRows: (n: number) => `${n} SNI وصل نشد`,
    sources: { winners: 'برنده‌ی قبلی', seed: 'لیست دستی', control: 'کنترل', traffic: 'ترافیک کاربران', tail: 'کم‌معروف' } as Record<string, string>,
  },
  en: {
    title: 'SNI scanner for an operator (REALITY)',
    intro:
      'Start a scan, then run the probe on a phone or laptop on that operator (MCI, say). It measures every SNI from inside the operator to the node and reports back to this table.',
    node: 'Node',
    start: 'Start scan',
    stop: 'Stop scan',
    collecting: 'The node is gathering names (1–2 minutes)…',
    ready: (n: number, r: number) => `Ready: ${n} configs in round ${r}. Run the probe with the link below.`,
    failed: 'Scan failed',
    link: 'Scan link',
    copy: 'Copy',
    copied: 'Copied',
    phone: 'Android phone (Termux)',
    windows: 'Windows',
    linux: 'Linux',
    phoneSteps: 'In Termux (not over SSH):',
    winSteps: 'Run the file and paste the link.',
    results: 'Results (best upload per SNI)',
    lastRun: 'Last scan only',
    allRuns: 'Last 14 days',
    none: 'No results yet.',
    sni: 'SNI',
    port: 'Port',
    fp: 'Fingerprint',
    up: 'Upload',
    down: 'Download',
    ping: 'Ping',
    op: 'Operator',
    src: 'Source',
    when: 'When',
    failedRows: (n: number) => `${n} SNIs did not connect`,
    sources: { winners: 'past winner', seed: 'manual list', control: 'control', traffic: 'users’ traffic', tail: 'long tail' } as Record<string, string>,
  },
}

const mbps = (bps: number | null) => (bps ? ((bps * 8) / 1e6).toFixed(2) : '—')

export default function SniScanner() {
  const { lang } = useLang()
  const x = TEXT[lang === 'en' ? 'en' : 'fa']
  const say = useToast()
  const [nodes, setNodes] = useState<Node[]>([])
  const [nodeId, setNodeId] = useState<number | null>(null)
  const [scan, setScan] = useState<RealityScan>({ state: 'idle' })
  const [results, setResults] = useState<RealityResult[]>([])
  const [onlyLast, setOnlyLast] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      const [s, r] = await Promise.all([getRealityScan(), listRealityResults()])
      setScan(s)
      setResults(r.results)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }

  useEffect(() => {
    listNodes()
      .then((l) => {
        setNodes(l.nodes)
        setNodeId((id) => id ?? l.nodes[0]?.id ?? null)
      })
      .catch(() => undefined)
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [])

  async function act(fn: () => Promise<RealityScan>) {
    setBusy(true)
    setError(null)
    try {
      setScan(await fn())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function copy(text: string) {
    if (await copyToClipboard(text)) say(x.copied)
  }

  // Best upload per SNI. "Last scan" means the newest run that reported.
  const rows = useMemo(() => {
    const lastRun = results[0]?.run_id
    const pool = onlyLast ? results.filter((r) => r.run_id === lastRun) : results
    const best = new Map<string, RealityResult>()
    for (const r of pool) {
      const cur = best.get(r.sni)
      const score = (v: RealityResult) => (v.ok ? 1 : 0) * 1e15 + (v.up_bps ?? 0)
      if (!cur || score(r) > score(cur)) best.set(r.sni, r)
    }
    return [...best.values()].sort((a, b) => Number(b.ok) - Number(a.ok) || (b.up_bps ?? 0) - (a.up_bps ?? 0))
  }, [results, onlyLast])
  const okRows = rows.filter((r) => r.ok)
  const failed = rows.length - okRows.length

  const live = scan.state === 'collecting' || scan.state === 'ready'
  const dl = scan.download_base ?? '/api/reality/probe'
  const termux = `curl -Lo probe ${dl}/tifusi-probe-arm64 && chmod +x probe\n./probe "${scan.link ?? ''}"`

  return (
    <section className="sni-scan" style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ fontSize: '1rem', margin: 0 }}>{x.title}</h2>
      <div className="hint" style={{ margin: 0 }}>{x.intro}</div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {nodes.length > 1 && (
          <select className="input" style={{ width: 'auto' }} value={nodeId ?? ''} onChange={(e) => setNodeId(Number(e.target.value))} aria-label={x.node}>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn solid" disabled={busy || nodeId == null} onClick={() => nodeId != null && act(() => startRealityScan(nodeId))}>
          {x.start}
        </button>
        {live && (
          <button type="button" className="btn danger" disabled={busy} onClick={() => act(stopRealityScan)}>
            {x.stop}
          </button>
        )}
      </div>

      {error && <div className="err-text">{error}</div>}
      {scan.state === 'collecting' && <div className="tf-note">⏳ {x.collecting}</div>}
      {scan.state === 'failed' && <div className="err-text">{x.failed}: {scan.error}</div>}
      {scan.state === 'ready' && <div className="tf-note">✅ {x.ready(scan.count ?? 0, scan.round ?? 1)}</div>}

      {live && scan.link && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ background: '#fff', padding: 8, borderRadius: 8 }}>
            <QRCodeSVG value={scan.link} size={132} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 260px', minWidth: 0 }}>
            <label className="tf-note">{x.link}</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input ltr mono" readOnly value={scan.link} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn" onClick={() => copy(scan.link!)}>
                {x.copy}
              </button>
            </div>
            <label className="tf-note">
              📱 {x.phone} — {x.phoneSteps}
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <textarea className="input ltr mono" readOnly rows={2} value={termux} style={{ resize: 'none' }} />
              <button type="button" className="btn" onClick={() => copy(termux)}>
                {x.copy}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a className="btn" href={`${dl}/TifusiProbe.exe`} download>
                💻 {x.windows}
              </a>
              <a className="btn" href={`${dl}/tifusi-probe-amd64`} download>
                🐧 {x.linux}
              </a>
              <a className="btn" href={`${dl}/tifusi-probe-arm64`} download>
                📱 {x.phone}
              </a>
            </div>
            <div className="hint" style={{ margin: 0 }}>{x.winSteps}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <b style={{ fontSize: '0.9rem' }}>{x.results}</b>
        <button type="button" className={`btn ${onlyLast ? 'solid' : ''}`} onClick={() => setOnlyLast(true)}>
          {x.lastRun}
        </button>
        <button type="button" className={`btn ${onlyLast ? '' : 'solid'}`} onClick={() => setOnlyLast(false)}>
          {x.allRuns}
        </button>
      </div>

      {okRows.length === 0 ? (
        <div className="tf-note">{x.none}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['#', x.sni, x.up, x.down, x.ping, x.port, x.fp, x.op, x.src, x.when].map((h) => (
                  <th key={h} style={{ textAlign: 'start', padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {okRows.map((r, i) => (
                <tr key={r.sni} style={{ borderTop: '1px solid var(--edge2)' }}>
                  <td style={{ padding: '6px 8px' }}>{i + 1}</td>
                  <td className="mono ltr" style={{ padding: '6px 8px' }}>
                    <button type="button" className="btn" style={{ padding: '0 6px' }} onClick={() => copy(r.sni)} title={x.copy}>
                      {r.sni}
                    </button>
                  </td>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{mbps(r.up_bps)}</td>
                  <td style={{ padding: '6px 8px' }}>{mbps(r.down_bps)}</td>
                  <td style={{ padding: '6px 8px' }}>{r.delay_ms ? `${r.delay_ms}ms` : '—'}</td>
                  <td className="mono" style={{ padding: '6px 8px' }}>{r.port}</td>
                  <td style={{ padding: '6px 8px' }}>{r.fingerprint}</td>
                  <td style={{ padding: '6px 8px' }}>{r.operator ?? '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{(r.source && x.sources[r.source]) || r.source || '—'}</td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{parseServerDate(r.run_at).toLocaleString(lang === 'en' ? 'en-GB' : 'fa-IR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint">Mbps · {failed > 0 ? x.failedRows(failed) : ''}</div>
        </div>
      )}
    </section>
  )
}
