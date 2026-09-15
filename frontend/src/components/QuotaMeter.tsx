import type { ReactNode } from 'react'

const GB = 1024 ** 3

export function formatGb(bytes: number): string {
  const v = bytes / GB
  return v >= 100 ? v.toFixed(0) : String(Number(v.toFixed(1)))
}

// One labelled usage bar against an optional cap: green, amber from 80%,
// red once full; hatched when there is no cap at all. Shared by the
// Resellers page and a reseller's own allowance on the Users page.
export default function QuotaMeter({
  label,
  used,
  cap,
  format = String,
  unit = '',
  sub,
  extra,
  noLimit,
  full,
  percent,
}: {
  label: ReactNode
  used: number
  cap: number | null
  format?: (n: number) => string
  unit?: string
  sub?: ReactNode
  extra?: string
  noLimit: string
  full: string
  percent: (p: number) => string
}) {
  const p = cap ? Math.round((used / cap) * 100) : 0
  const tone = cap == null ? '' : p >= 100 ? 'bad' : p >= 80 ? 'warn' : ''
  const state = cap == null ? noLimit : p >= 100 ? full : percent(p)
  return (
    <div className={`rs-meter ${cap == null ? 'free' : ''}`}>
      <div className="top">
        <span>{label}</span>
        <span className="num">
          {format(used)} / {cap == null ? '∞' : format(cap)}
          {unit}
        </span>
      </div>
      <div className={`bar ${tone}`}>{cap != null && <i style={{ width: `${Math.min(p, 100)}%` }} />}</div>
      <div className="sub">{sub ?? (extra ? `${state} · ${extra}` : state)}</div>
    </div>
  )
}
