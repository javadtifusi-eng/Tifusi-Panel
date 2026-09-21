import { useEffect, useRef, useState } from 'react'
import { useLang } from '../i18n/LangContext'
import { ApiError, CfCandidate, CfScan, listNodes, Node, startCfScan, getCfScan } from '../lib/api'

const POLL_MS = 3000

// Self-contained bilingual strings: this is a new, standalone panel, so its
// copy lives here rather than swelling the shared dictionary. fa/en by dir.
function strings(rtl: boolean) {
  return rtl
    ? {
        title: 'اسکنر IP تمیز کلودفلر',
        sub: 'رنج‌های کلودفلر را هر بار زنده می‌گیرد، تصادفی نمونه برمی‌دارد، با TLS تست می‌کند و بر اساس سرعت واقعی از داخل ایران مرتب می‌کند',
        node: 'نود',
        pickNode: 'یک نود انتخاب کن',
        noNodes: 'اول یک نود اضافه کن؛ اسکن روی خود نود انجام می‌شود.',
        sniLabel: 'دامنه‌ی پشت کلودفلر (اختیاری)',
        sniHint: 'اگر دامنه‌ی خودت را بدهی با همان SNI تست می‌شود؛ خالی هم اشکالی ندارد.',
        start: 'شروع اسکن',
        again: 'اسکن دوباره',
        scanning: 'در حال اسکن…',
        fetching: 'گرفتن رنج‌های کلودفلر…',
        probing: 'تست TLS ادج‌ها…',
        empty: 'هنوز چیزی پیدا نشد.',
        ip: 'IP ادج',
        nodeLat: 'از نود',
        iran: 'از ایران',
        op: 'اپراتور',
        copy: 'کپی',
        copied: 'کپی شد ✓',
        open: 'باز',
        blocked: 'بسته',
        checking: 'در حال بررسی…',
        unknown: '—',
        nodeLatTitle: 'میانه‌ی هندشیک TLS از خود نود تا این IP کلودفلر.',
        iranTitle: 'میانه‌ی زمانی که پروب‌های داخل ایران (check-host.net) برای رسیدن به این IP صرف کردند. کمتر یعنی مسیر ایران تا این ادج تمیزتر و سریع‌تر.',
        found: (n: number) => `${n.toLocaleString('fa-IR')} ادج سالم`,
        close: 'بستن',
        error: 'خطا',
      }
    : {
        title: 'Cloudflare clean-IP scanner',
        sub: "Fetches Cloudflare's ranges live, samples them at random, tests each with TLS, and ranks by real speed from inside Iran",
        node: 'Node',
        pickNode: 'Pick a node',
        noNodes: 'Add a node first — the scan runs on the node itself.',
        sniLabel: 'Domain behind Cloudflare (optional)',
        sniHint: 'Give your own domain to probe with that SNI; leaving it blank is fine.',
        start: 'Start scan',
        again: 'Scan again',
        scanning: 'Scanning…',
        fetching: "Fetching Cloudflare's ranges…",
        probing: 'Probing edge TLS…',
        empty: 'Nothing found yet.',
        ip: 'Edge IP',
        nodeLat: 'from node',
        iran: 'from Iran',
        op: 'Operator',
        copy: 'Copy',
        copied: 'Copied ✓',
        open: 'open',
        blocked: 'blocked',
        checking: 'checking…',
        unknown: '—',
        nodeLatTitle: 'Median TLS handshake from the node itself to this Cloudflare IP.',
        iranTitle: 'Median time the probes inside Iran (check-host.net) took to reach this IP. Lower means the path from Iran to this edge is cleaner and faster.',
        found: (n: number) => `${n} clean edges`,
        close: 'Close',
        error: 'Error',
      }
}

export default function CloudflareScanner({ onPick, onClose }: { onPick?: (ip: string) => void; onClose: () => void }) {
  const { dir } = useLang()
  const s = strings(dir === 'rtl')
  const [nodes, setNodes] = useState<Node[] | null>(null)
  const [nodeId, setNodeId] = useState<number | null>(null)
  const [sni, setSni] = useState('')
  const [scan, setScan] = useState<CfScan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    listNodes()
      .then((r) => {
        setNodes(r.nodes)
        if (r.nodes.length) setNodeId(r.nodes[0].id)
      })
      .catch(() => setNodes([]))
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  // Recover a scan already running (or finished) on the node after a refresh.
  const restored = useRef<number | null>(null)
  useEffect(() => {
    if (nodeId == null || restored.current === nodeId) return
    restored.current = nodeId
    getCfScan(nodeId)
      .then((sc) => {
        if (sc.state === 'idle' || !sc.results.length) return
        setScan(sc)
        if (stillMoving(sc)) poll(nodeId)
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  function stillMoving(sc: CfScan): boolean {
    if (!['done', 'error'].includes(sc.state)) return true
    return sc.results.some((r) => r.iran?.verdict === 'checking')
  }

  const busy = !!scan && stillMoving(scan)

  function poll(id: number) {
    timer.current = window.setTimeout(async () => {
      try {
        const next = await getCfScan(id)
        setScan(next)
        if (stillMoving(next)) poll(id)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err))
      }
    }, POLL_MS)
  }

  async function start() {
    if (timer.current) window.clearTimeout(timer.current)
    if (nodeId == null) return
    setError(null)
    try {
      const sc = await startCfScan(nodeId, sni.trim() || undefined)
      setScan(sc)
      poll(nodeId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }

  async function copy(ip: string) {
    try {
      await navigator.clipboard.writeText(ip)
      setCopied(ip)
      window.setTimeout(() => setCopied((c) => (c === ip ? null : c)), 1500)
    } catch {
      /* clipboard blocked; the value is still on screen */
    }
    onPick?.(ip)
  }

  const results = (scan?.results ?? []).filter((r) => r.usable)
  const phase = scan?.state === 'fetching' ? s.fetching : scan?.state === 'probing' ? s.probing : s.scanning

  return (
    <div className="cf-scanner" style={{ border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16, marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>{s.title}</h3>
          <div className="hint" style={{ marginTop: 4 }}>{s.sub}</div>
        </div>
        <button type="button" className="btn" onClick={onClose}>{s.close}</button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginTop: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="hint">{s.node}</span>
          <select
            className="input"
            value={nodeId ?? ''}
            onChange={(e) => setNodeId(e.target.value ? Number(e.target.value) : null)}
            disabled={!nodes || !nodes.length || busy}
          >
            {!nodes?.length && <option value="">{s.pickNode}</option>}
            {nodes?.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 220 }}>
          <span className="hint">{s.sniLabel}</span>
          <input className="input ltr" value={sni} onChange={(e) => setSni(e.target.value)} placeholder="example.com" disabled={busy} />
        </label>
        <button type="button" className="btn btn-primary" onClick={start} disabled={nodeId == null || busy}>
          {busy ? phase : scan ? s.again : s.start}
        </button>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>{nodes && !nodes.length ? s.noNodes : s.sniHint}</div>

      {error && <div className="hint" style={{ color: 'var(--text-danger)', marginTop: 10 }}>{s.error}: {error}</div>}

      {busy && (
        <div className="hint" style={{ marginTop: 12 }}>
          {phase} {scan && scan.phase_total > 0 ? `(${scan.phase_done}/${scan.phase_total})` : ''}
        </div>
      )}

      {scan && !!results.length && (
        <>
          <div className="hint" style={{ marginTop: 14 }}>{s.found(results.length)}</div>
          <div style={{ overflowX: 'auto', marginTop: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: dir === 'rtl' ? 'right' : 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '6px 8px' }}>{s.ip}</th>
                  <th style={{ padding: '6px 8px' }} title={s.iranTitle}>{s.iran}</th>
                  <th style={{ padding: '6px 8px' }} title={s.nodeLatTitle}>{s.nodeLat}</th>
                  <th style={{ padding: '6px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <CfRow key={r.ip} r={r} s={s} copied={copied === r.ip} onCopy={() => copy(r.ip)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {scan && scan.state === 'done' && !results.length && (
        <div className="hint" style={{ marginTop: 12 }}>{s.empty}</div>
      )}
    </div>
  )
}

function CfRow({ r, s, copied, onCopy }: { r: CfCandidate; s: ReturnType<typeof strings>; copied: boolean; onCopy: () => void }) {
  const v = r.iran?.verdict
  const iranText =
    v === 'open' ? `${s.open}${r.iran?.ms != null ? ` · ${r.iran.ms}ms` : ''}` : v === 'checking' ? s.checking : v ? s.blocked : s.unknown
  const iranColor = v === 'open' ? 'var(--accent, #22D3EE)' : v === 'checking' ? 'var(--text-muted)' : v ? 'var(--text-danger)' : 'var(--text-muted)'
  return (
    <tr style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <td style={{ padding: '6px 8px' }} className="mono ltr">{r.ip}</td>
      <td style={{ padding: '6px 8px', color: iranColor }}>{iranText}</td>
      <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }} className="ltr">{r.latency_ms != null ? `${r.latency_ms}ms` : s.unknown}</td>
      <td style={{ padding: '6px 8px', textAlign: 'end' }}>
        <button type="button" className="btn" onClick={onCopy}>{copied ? s.copied : s.copy}</button>
      </td>
    </tr>
  )
}
