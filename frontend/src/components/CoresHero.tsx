import { useEffect, useRef, useState } from 'react'
import type { Core, CoreType, Node } from '../lib/api'
import { useLang } from '../i18n/LangContext'

// Board layout on a 400×400 canvas: the Tifusi "die" sits in the centre and
// each core tile is wired to it with a right-angle trace. Paths run tile → die;
// the dashes are animated backwards so traffic reads as leaving the logo.
const BOARD: { type: CoreType; code: string; x: number; y: number; path: string }[] = [
  { type: 'xray', code: 'XR', x: 84, y: 66, path: 'M112 66 H178 V148' },
  { type: 'ikev2', code: 'IK', x: 316, y: 66, path: 'M288 66 H222 V148' },
  { type: 'l2tp', code: 'L2', x: 52, y: 200, path: 'M80 200 H148' },
  { type: 'pptp', code: 'PP', x: 348, y: 200, path: 'M320 200 H252' },
  { type: 'hysteria2', code: 'HY2', x: 84, y: 334, path: 'M112 334 H178 V252' },
  { type: 'wireguard', code: 'WG', x: 316, y: 334, path: 'M288 334 H222 V252' },
]

// PPTP's colour is the theme's own text colour (near-white on dark, near-black
// on light) — a fixed grey would vanish on one of the two themes.
export const CORE_TINT: Record<CoreType, string> = {
  xray: '#4aa3ff',
  ikev2: '#2fd26f',
  l2tp: '#f5c542',
  pptp: 'var(--text)',
  hysteria2: '#ff8a3d',
  wireguard: '#a78bfa',
}

const NAME: Record<CoreType, string> = {
  xray: 'Xray',
  ikev2: 'IKEv2',
  l2tp: 'L2TP',
  pptp: 'PPTP',
  hysteria2: 'Hysteria2',
  wireguard: 'WireGuard',
}

const TILE_ORDER: CoreType[] = ['xray', 'ikev2', 'l2tp', 'pptp', 'hysteria2', 'wireguard']

// Outbounds the panel/node inject for their own plumbing, not the admin's routing.
const INTERNAL_OUTBOUNDS = new Set(['api', 'tifusi-limit-block'])

type Status = 'live' | 'idle' | 'none'

function Signal({ status }: { status: Status }) {
  return (
    <span className={`ch-sig ${status}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

export default function CoresHero({
  cores,
  nodes,
  engine,
  onPick,
  holds,
}: {
  cores: Core[]
  nodes: Node[]
  engine: CoreType
  onPick: (type: CoreType) => void
  /** Cores.tsx owns the node-slot mapping (with its L2TP-in-IPsec-slot quirk). */
  holds: (node: Node, core: Core) => boolean
}) {
  const { t } = useLang()
  const c = t.ui.cores

  const byType = (type: CoreType) => cores.filter((x) => x.core_type === type)
  const runningOn = (type: CoreType) => nodes.filter((n) => byType(type).some((core) => holds(n, core)))
  const statusOf = (type: CoreType): Status => {
    if (byType(type).length === 0) return 'none'
    return runningOn(type).some((n) => n.status === 'connected') ? 'live' : 'idle'
  }
  const subOf = (type: CoreType) => {
    const count = byType(type).length
    return count === 0 ? c.notCreated : c.engineCount(count, runningOn(type).length)
  }
  const live = TILE_ORDER.filter((type) => statusOf(type) === 'live')
  const xray = byType('xray')[0]

  return (
    <>
      <section className="ch-box" aria-label={c.mapTitle}>
        <div className="ch-stats">
          <span className="lbl">{c.activeCores}</span>
          <span className="big">{live.length}</span>
          <div className="seg">
            {TILE_ORDER.map((type) => (
              <i key={type} style={{ background: statusOf(type) === 'live' ? CORE_TINT[type] : undefined }} />
            ))}
          </div>
          <p>{c.heroNote}</p>
          <div className="legend">
            {TILE_ORDER.map((type) => (
              <div key={type} className="lgi">
                <span className="nm">
                  <i style={{ background: CORE_TINT[type], opacity: statusOf(type) === 'none' ? 0.45 : 1 }} />
                  {NAME[type]}
                </span>
                <span className="st">{subOf(type)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="ch-board">
          <svg viewBox="0 0 400 400" role="img" aria-label={c.mapTitle}>
            <defs>
              <radialGradient id="ch-die-glow">
                <stop offset="0" stopColor="#f97316" stopOpacity=".3" />
                <stop offset="1" stopColor="#f97316" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="200" cy="200" r="90" fill="url(#ch-die-glow)" className="ch-breathe" />
            {BOARD.map((b) => {
              const s = statusOf(b.type)
              return (
                <g key={b.type} style={{ ['--c' as string]: CORE_TINT[b.type] }} className={`ch-wire ${s}`}>
                  <path d={b.path} className="trace" />
                  {s === 'live' && <path d={b.path} className="flow" />}
                </g>
              )
            })}
            {Array.from({ length: 7 }, (_, k) => {
              const o = 158 + k * 14
              return (
                <g key={k} className="pin">
                  <rect x={o - 2} y={140} width={4} height={8} rx={1} />
                  <rect x={o - 2} y={252} width={4} height={8} rx={1} />
                  <rect x={140} y={o - 2} width={8} height={4} rx={1} />
                  <rect x={252} y={o - 2} width={8} height={4} rx={1} />
                </g>
              )
            })}
            <rect x={148} y={148} width={104} height={104} rx={18} className="die" />
            <rect x={156} y={156} width={88} height={88} rx={13} className="die-in" />
            <text x={200} y={236} textAnchor="middle" className="die-cap">
              TIFUSI
            </text>
            {BOARD.map((b) => {
              const s = statusOf(b.type)
              const n = byType(b.type).length
              return (
                <g
                  key={b.type}
                  className={`ch-node ${s} ${engine === b.type ? 'sel' : ''}`}
                  style={{ ['--c' as string]: CORE_TINT[b.type] }}
                  transform={`translate(${b.x} ${b.y})`}
                  onClick={() => onPick(b.type)}
                >
                  <rect x={-28} y={-28} width={56} height={56} rx={12} className="t" />
                  <text y={5} className="code">
                    {b.code}
                  </text>
                  <text y={44} className="name">
                    {NAME[b.type]}
                  </text>
                  <circle cx={26} cy={-26} r={8} className="badge" />
                  <text x={26} y={-23} className="badge-n">
                    {n}
                  </text>
                </g>
              )
            })}
          </svg>
          {/* The griffin is an HTML mask over the SVG so it takes the theme's heading colour, like <Logo>. */}
          <div className="ch-mark" role="img" aria-label="Tifusi" />
        </div>
      </section>

      <section className="ch-tiles" role="tablist" aria-label={t.coresPage.coreTypeLabel}>
        {TILE_ORDER.map((type) => {
          const s = statusOf(type)
          return (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={engine === type}
              className={`ch-tile ${s}`}
              style={{ ['--c' as string]: CORE_TINT[type] }}
              onClick={() => onPick(type)}
            >
              <span className="top">
                <span className="cd">{BOARD.find((b) => b.type === type)!.code}</span>
                <Signal status={s} />
              </span>
              <span className="nm">
                <b>{NAME[type]}</b>
                <small>{subOf(type)}</small>
              </span>
              <span className="bar" />
            </button>
          )
        })}
        {xray && <TrafficMap core={xray} onOpen={() => onPick('xray')} />}
      </section>
    </>
  )
}

function TrafficMap({ core, onOpen }: { core: Core; onOpen: () => void }) {
  const { t } = useLang()
  const c = t.ui.cores
  const box = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 480))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const config = (core.config ?? {}) as { outbounds?: { tag?: string; protocol?: string }[]; routing?: { rules?: { outboundTag?: string }[] } }
  const ins = core.inbounds.slice(0, 4)
  const outs = (config.outbounds ?? []).filter((o) => !INTERNAL_OUTBOUNDS.has(o.tag ?? '')).slice(0, 4)
  const rules = (config.routing?.rules ?? []).filter((r) => !INTERNAL_OUTBOUNDS.has(r.outboundTag ?? '')).length
  const more = core.inbounds.length - ins.length
  const rulesLabel = rules ? c.rulesCount(rules) : c.mapRest
  const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

  return (
    <div className="ch-map" ref={box}>
      <div className="tm-h">
        <div>
          <span className="eyebrow">TRAFFIC MAP</span>
          <b>{c.mapTitle}</b>
        </div>
        <span className="tm-leg">
          <i />
          Xray · {core.name}
        </span>
      </div>
      {narrow ? (
        <VerticalMap ins={ins} outs={outs} more={more} coreName={core.name} rulesLabel={rulesLabel} short={short} onOpen={onOpen} />
      ) : (
        <WideMap ins={ins} outs={outs} more={more} coreName={core.name} rulesLabel={rulesLabel} short={short} onOpen={onOpen} />
      )}
    </div>
  )
}

type MapProps = {
  ins: Core['inbounds']
  outs: { tag?: string; protocol?: string }[]
  more: number
  coreName: string
  rulesLabel: string
  short: (s: string, n: number) => string
  onOpen: () => void
}

const BLUE = '#4aa3ff'
const GREEN = '#2fd26f'

function WideMap({ ins, outs, more, coreName, rulesLabel, short, onOpen }: MapProps) {
  const { t } = useLang()
  const c = t.ui.cores
  const H = 220
  const top = 34
  const avail = H - top - 14
  const step = Math.min(40, avail / Math.max(ins.length, 1))
  const y0 = top + (avail - step * (Math.max(ins.length, 1) - 1)) / 2
  const cx = 320
  const cy = top + avail / 2
  const oStep = 34
  const oy0 = cy - ((outs.length - 1) * oStep) / 2
  return (
    <svg className="tm-svg" viewBox={`0 0 640 ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={c.mapTitle}>
      <text x={553} y={16} className="cap">{c.mapIn}</text>
      <text x={320} y={16} className="cap">{c.mapCore}</text>
      <text x={80} y={16} className="cap">{c.mapOut}</text>
      {ins.map((o, k) => {
        const y = y0 + k * step
        const d = `M478 ${y} C 410 ${y}, ${cx + 118} ${cy}, ${cx + 58} ${cy}`
        return (
          <g key={o.id}>
            <path d={d} className="base" stroke={BLUE} />
            <path d={d} className="run" stroke={BLUE} />
            <g className="tpill" onClick={onOpen}>
              <rect x={478} y={y - 13} width={150} height={26} rx={13} stroke={BLUE} />
              <circle cx={614} cy={y} r={3.5} fill={GREEN} />
              <text x={604} y={y + 4} textAnchor="end" className="tag">{short(o.tag, 11)}</text>
              <text x={488} y={y + 4} className="port" fill={BLUE}>{o.port ? ':' + o.port : ''}</text>
            </g>
          </g>
        )
      })}
      {more > 0 && <text x={564} y={H - 4} className="cap">+{more}</text>}
      {outs.map((o, k) => {
        const y = oy0 + k * oStep
        const d = `M${cx - 58} ${cy} C ${cx - 120} ${cy}, 200 ${y}, 140 ${y}`
        return (
          <g key={(o.tag ?? '') + k}>
            <path d={d} className="base" stroke={GREEN} />
            <path d={d} className="run" stroke={GREEN} />
            <rect x={16} y={y - 15} width={124} height={30} rx={15} className="opill" stroke={GREEN} />
            <text x={34} y={y + 4} className="otag">{short(o.tag ?? '—', 10)}</text>
            <text x={128} y={y + 4} textAnchor="end" className="port" fill={GREEN}>{o.protocol}</text>
          </g>
        )
      })}
      <rect x={160} y={cy - 30} width={92} height={18} rx={9} className="rpill" />
      <text x={206} y={cy - 18} className="rtext">{rulesLabel}</text>
      <rect x={cx - 58} y={cy - 30} width={116} height={60} rx={16} className="core" stroke={BLUE} />
      <rect x={cx - 58} y={cy - 30} width={116} height={60} rx={16} className="core-glow" stroke={BLUE} />
      <text x={cx} y={cy - 2} className="c1" fill={BLUE}>XRAY</text>
      <text x={cx} y={cy + 15} className="c2">{short(coreName, 16)}</text>
    </svg>
  )
}

// Phone layout: inbounds on top, Xray in the middle, outbounds below, so every
// label stays at a readable size instead of shrinking the wide 640-unit map.
function VerticalMap({ ins, outs, more, coreName, rulesLabel, short, onOpen }: MapProps) {
  const { t } = useLang()
  const c = t.ui.cores
  const W = 340
  const cx = W / 2
  const PW = 150
  const PH = 30
  const cols = (n: number) => (n === 1 ? [cx] : [cx + 82, cx - 82])
  const grid = <T,>(list: T[], y0: number) =>
    list.map((o, k) => ({ o, x: cols(Math.min(list.length, 2))[k % 2], y: y0 + Math.floor(k / 2) * (PH + 10) }))
  const gi = grid(ins, 28)
  const inBottom = 28 + Math.ceil(Math.max(ins.length, 1) / 2) * (PH + 10) - 10
  const coreTop = inBottom + 48
  const coreBot = coreTop + 62
  const go = grid(outs, coreBot + 62)
  const H = coreBot + 62 + Math.ceil(Math.max(outs.length, 1) / 2) * (PH + 10) + 4
  return (
    <svg className="tm-svg v" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={c.mapTitle}>
      <text x={cx} y={16} className="cap">{c.mapIn}</text>
      {more > 0 && <text x={W - 8} y={16} className="cap end">+{more}</text>}
      {gi.map(({ o, x, y }) => {
        const d = `M${x} ${y + PH} C ${x} ${y + PH + 30}, ${cx} ${coreTop - 30}, ${cx} ${coreTop}`
        return (
          <g key={o.id}>
            <path d={d} className="base" stroke={BLUE} />
            <path d={d} className="run" stroke={BLUE} />
          </g>
        )
      })}
      {go.map(({ o, x, y }, k) => {
        const d = `M${cx} ${coreBot} C ${cx} ${coreBot + 30}, ${x} ${y - 30}, ${x} ${y}`
        return (
          <g key={(o.tag ?? '') + k}>
            <path d={d} className="base" stroke={GREEN} />
            <path d={d} className="run" stroke={GREEN} />
          </g>
        )
      })}
      {gi.map(({ o, x, y }) => (
        <g key={o.id} className="tpill" onClick={onOpen}>
          <rect x={x - PW / 2} y={y} width={PW} height={PH} rx={15} stroke={BLUE} />
          <circle cx={x + PW / 2 - 14} cy={y + PH / 2} r={3.5} fill={GREEN} />
          <text x={x + PW / 2 - 24} y={y + PH / 2 + 4} textAnchor="end" className="tag">{short(o.tag, 10)}</text>
          <text x={x - PW / 2 + 12} y={y + PH / 2 + 4} className="port" fill={BLUE}>{o.port ? ':' + o.port : ''}</text>
        </g>
      ))}
      <rect x={cx - 80} y={coreTop} width={160} height={62} rx={16} className="core" stroke={BLUE} />
      <rect x={cx - 80} y={coreTop} width={160} height={62} rx={16} className="core-glow" stroke={BLUE} />
      <text x={cx} y={coreTop + 28} className="c1" fill={BLUE}>XRAY</text>
      <text x={cx} y={coreTop + 47} className="c2">{short(coreName, 18)}</text>
      <rect x={cx + 14} y={coreBot + 18} width={96} height={22} rx={11} className="rpill" />
      <text x={cx + 62} y={coreBot + 33} className="rtext">{rulesLabel}</text>
      <text x={cx - 130} y={coreBot + 33} className="cap">{c.mapOut}</text>
      {go.map(({ o, x, y }, k) => (
        <g key={(o.tag ?? '') + k}>
          <rect x={x - PW / 2} y={y} width={PW} height={PH} rx={15} className="opill" stroke={GREEN} />
          <text x={x + PW / 2 - 14} y={y + PH / 2 + 4} textAnchor="end" className="otag">{short(o.tag ?? '—', 11)}</text>
          <text x={x - PW / 2 + 12} y={y + PH / 2 + 4} className="port" fill={GREEN}>{o.protocol}</text>
        </g>
      ))}
    </svg>
  )
}
