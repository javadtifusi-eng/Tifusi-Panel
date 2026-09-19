import { useState } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  cdnSpeedTest,
  getTunnelConfig,
  scanCdnEdges,
  scanCdnFronts,
  updateTunnel,
  type CdnEdgeScan,
  type CdnFrontScan,
  type CdnSpeed,
  type Tunnel,
} from '../lib/api'
import { copyToClipboard } from '../lib/clipboard'
import { Sheet } from './ui'

const PICK_TOP = 3

// Everything here is measured for real from the tunnel's foreign server (or
// the panel when the foreign side isn't a node); nothing is estimated.
export default function CdnTuner({ tunnel, onClose, onSaved }: { tunnel: Tunnel; onClose: () => void; onSaved: (t: Tunnel) => void }) {
  const { t } = useLang()
  const tn = t.ui.tunnels
  const cq = t.ui.cdnTune
  const provider = tn.cdnName[tunnel.cdn_provider ?? 'arvan']

  const [edges, setEdges] = useState<CdnEdgeScan | null>(null)
  const [edgeBusy, setEdgeBusy] = useState(false)
  const [picked, setPicked] = useState<string[]>(tunnel.cdn_ips)
  const [fronts, setFronts] = useState<CdnFrontScan | null>(null)
  const [frontBusy, setFrontBusy] = useState(false)
  const [front, setFront] = useState<string | null>(tunnel.cdn_front)
  const [speeds, setSpeeds] = useState<CdnSpeed[]>([])
  const [speedBusy, setSpeedBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<Tunnel>(tunnel)
  const [foreignCmd, setForeignCmd] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const ranOn = edges ?? fronts ?? speeds[0] ?? null
  const dirty = picked.join(',') !== saved.cdn_ips.join(',') || (front ?? null) !== (saved.cdn_front ?? null)

  const fail = (err: unknown) => setError(err instanceof ApiError ? err.message : t.common.genericError)

  async function runEdges() {
    setEdgeBusy(true)
    setError(null)
    try {
      const r = await scanCdnEdges(tunnel.id)
      setEdges(r)
      const good = r.edges.filter((e) => e.ok === e.tries && e.ms != null)
      if (good.length) setPicked(good.slice(0, PICK_TOP).map((e) => e.ip))
    } catch (err) {
      fail(err)
    } finally {
      setEdgeBusy(false)
    }
  }

  async function runFronts() {
    setFrontBusy(true)
    setError(null)
    try {
      setFronts(await scanCdnFronts(tunnel.id))
    } catch (err) {
      fail(err)
    } finally {
      setFrontBusy(false)
    }
  }

  async function runSpeed() {
    setSpeedBusy(true)
    setError(null)
    try {
      const r = await cdnSpeedTest(tunnel.id)
      setSpeeds((s) => [r, ...s].slice(0, 4))
    } catch (err) {
      fail(err)
    } finally {
      setSpeedBusy(false)
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const next = await updateTunnel(tunnel.id, { cdn_ips: picked, cdn_front: front })
      setSaved(next)
      onSaved(next)
      const cfg = await getTunnelConfig(tunnel.id)
      setForeignCmd(cfg.foreign_install_command)
    } catch (err) {
      fail(err)
    } finally {
      setSaving(false)
    }
  }

  function toggleIp(ip: string) {
    setPicked((p) => (p.includes(ip) ? p.filter((x) => x !== ip) : [...p, ip].slice(0, 5)))
  }

  const workingFronts = fronts?.fronts.filter((f) => f.works) ?? []
  const brokenFronts = fronts?.fronts.filter((f) => !f.works) ?? []

  return (
    <Sheet
      title={cq.title(provider)}
      sub={cq.sub(tunnel.name)}
      onClose={onClose}
      width={680}
      footer={
        <>
          <button type="button" className="btn primary lg" onClick={save} disabled={!dirty || saving}>
            {saving ? cq.saving : cq.save}
          </button>
          <button type="button" className="btn lg" onClick={onClose}>
            {t.usersPage.cancelAction}
          </button>
        </>
      }
    >
      <div className="cdt">
        {ranOn && <div className="hint" style={{ margin: 0 }}>{ranOn.ran_on === 'node' ? cq.ranOnNode(ranOn.ran_on_name) : cq.ranOnPanel}</div>}
        {error && <div className="tf-alert">{error}</div>}

        {/* 1 — clean edge IPs */}
        <section className="form-section">
          <div className="cdt-head">
            <div>
              <h4>{cq.edgesTitle(provider)}</h4>
              <div className="hint" style={{ margin: 0 }}>{cq.edgesHint}</div>
            </div>
            <button type="button" className="btn solid" onClick={runEdges} disabled={edgeBusy}>
              {edgeBusy ? cq.scanning : edges ? cq.again : cq.edgesBtn}
            </button>
          </div>
          {edgeBusy && <div className="rsc-bar indeterminate"><i /></div>}
          {edges && (
            <>
              <div className="hint" style={{ margin: 0 }}>{cq.edgesSummary(edges.tested, edges.ranges, edges.answered)}</div>
              {edges.edges.length === 0 ? (
                <div className="tf-alert">{cq.edgesNone}</div>
              ) : (
                <ul className="cdt-list">
                  {edges.edges.map((e, i) => {
                    const clean = e.ok === e.tries
                    return (
                      <li key={e.ip} className={`cdt-row ${picked.includes(e.ip) ? 'on' : ''} ${clean ? '' : 'weak'}`}>
                        <label className="sh-check">
                          <input type="checkbox" checked={picked.includes(e.ip)} onChange={() => toggleIp(e.ip)} />
                          <b className="mono" dir="ltr">{e.ip}</b>
                        </label>
                        {i === 0 && clean && <span className="pill accent">★ {cq.best}</span>}
                        <span className="cdt-stats en" dir="ltr">
                          {e.ms != null ? `${e.ms} ms` : '—'}
                          {e.jitter != null && <em>±{e.jitter}</em>}
                          <span className={clean ? 'ok' : 'warn'}>
                            {e.ok}/{e.tries}
                          </span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
          {!edges && saved.cdn_ips.length > 0 && (
            <div className="cdt-chips">
              <span className="hint" style={{ margin: 0 }}>{cq.current}</span>
              {saved.cdn_ips.map((ip) => (
                <span key={ip} className="chip en">
                  {ip}
                </span>
              ))}
            </div>
          )}
          {picked.length > 0 && (
            <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setPicked([])}>
              {cq.edgesAuto}
            </button>
          )}
        </section>

        {/* 2 — domain fronting */}
        <section className="form-section">
          <div className="cdt-head">
            <div>
              <h4>{cq.frontTitle}</h4>
              <div className="hint" style={{ margin: 0 }}>{cq.frontHint(provider)}</div>
            </div>
            <button type="button" className="btn solid" onClick={runFronts} disabled={frontBusy}>
              {frontBusy ? cq.scanning : fronts ? cq.again : cq.frontBtn}
            </button>
          </div>
          {frontBusy && <div className="rsc-bar indeterminate"><i /></div>}
          {fronts && <div className="hint" style={{ margin: 0 }}>{cq.frontSummary(fronts.checked, fronts.on_cdn, workingFronts.length)}</div>}
          <ul className="cdt-list">
            <li className={`cdt-row ${front == null ? 'on' : ''}`}>
              <label className="sh-check">
                <input type="radio" name="cdt-front" checked={front == null} onChange={() => setFront(null)} />
                <b>{cq.frontNone}</b>
              </label>
              <span className="cdt-stats en" dir="ltr">
                SNI = {tunnel.cdn_host}
              </span>
            </li>
            {workingFronts.map((f) => (
              <li key={f.domain} className={`cdt-row ${front === f.domain ? 'on' : ''}`}>
                <label className="sh-check">
                  <input type="radio" name="cdt-front" checked={front === f.domain} onChange={() => setFront(f.domain)} />
                  <b className="mono" dir="ltr">{f.domain}</b>
                </label>
                <span className="cdt-stats en" dir="ltr">
                  {f.ms != null && `${f.ms} ms`}
                  <span className="ok">✓ {cq.works}</span>
                </span>
              </li>
            ))}
            {!fronts && saved.cdn_front && front === saved.cdn_front && (
              <li className="cdt-row on">
                <label className="sh-check">
                  <input type="radio" name="cdt-front" checked readOnly />
                  <b className="mono" dir="ltr">{saved.cdn_front}</b>
                </label>
                <span className="cdt-stats">{cq.current}</span>
              </li>
            )}
          </ul>
          {brokenFronts.length > 0 && (
            <details className="cdt-more">
              <summary>{cq.frontRejected(brokenFronts.length)}</summary>
              <ul>
                {brokenFronts.map((f) => (
                  <li key={f.domain}>
                    <span className="mono" dir="ltr">{f.domain}</span> <span className="err-text">{f.error}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {/* 3 — real speed through the CDN */}
        <section className="form-section">
          <div className="cdt-head">
            <div>
              <h4>{cq.speedTitle}</h4>
              <div className="hint" style={{ margin: 0 }}>{cq.speedHint(provider)}</div>
            </div>
            <button type="button" className="btn solid" onClick={runSpeed} disabled={speedBusy}>
              {speedBusy ? cq.measuring : cq.speedBtn}
            </button>
          </div>
          {speedBusy && <div className="rsc-bar indeterminate"><i /></div>}
          {speeds.length > 0 && (
            <div className="cdt-speeds">
              {speeds.map((r, i) =>
                r.ok ? (
                  <div key={i} className={`cdt-speed ${i === 0 ? 'now' : ''}`}>
                    <b className="en">
                      {r.mbps}
                      <small> Mbps</small>
                    </b>
                    <span className="en" dir="ltr">
                      ping {r.ping_ms} ms · {(r.bytes / 1048576).toFixed(0)} MB / {r.seconds}s
                    </span>
                    <span className="mono" dir="ltr">
                      {r.via}
                    </span>
                  </div>
                ) : (
                  <div key={i} className="cdt-speed bad">
                    <span className="err-text">{r.error}</span>
                  </div>
                ),
              )}
            </div>
          )}
        </section>

        {foreignCmd && (
          <div className="form-section">
            <h4>{cq.applyTitle}</h4>
            <div className="hint" style={{ margin: 0 }}>{cq.applyHint}</div>
            <code className="cdt-cmd" dir="ltr">
              {foreignCmd}
            </code>
            <button
              type="button"
              className="btn"
              style={{ alignSelf: 'flex-start' }}
              onClick={async () => {
                if (await copyToClipboard(foreignCmd)) setCopied(true)
              }}
            >
              {copied ? t.common.copiedCheck : cq.copy}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
