import { useEffect, useState } from 'react'
import { useLang } from '../i18n/LangContext'
import { getSystemStats, type SystemStats } from '../lib/api'

// Needle gauges for CPU, RAM and disk (0% on the left, 100% on the right),
// refreshed every 5 seconds from /api/system/stats.

const R = 72
const CX = 100
const CY = 100
const ARC_LENGTH = Math.PI * R
const ARC_PATH = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`
const EASE = 'cubic-bezier(.2,.8,.2,1)'

// The owner asked for orange rather than green: orange while healthy,
// yellow from 65%, red from 85%.
export function gaugeColor(percent: number): string {
  if (percent >= 85) return '#ef4444'
  if (percent >= 65) return '#facc15'
  return '#f97316'
}

function point(percent: number, radius: number): [number, number] {
  const angle = Math.PI * (1 - percent / 100)
  return [CX + radius * Math.cos(angle), CY - radius * Math.sin(angle)]
}

const TICKS = Array.from({ length: 11 }, (_, i) => {
  const p = i * 10
  const major = p % 50 === 0
  const [x1, y1] = point(p, R - 12)
  const [x2, y2] = point(p, R - (major ? 22 : 17))
  return { p, major, x1, y1, x2, y2 }
})

function formatGb(bytes: number): string {
  const gb = bytes / 1024 ** 3
  return gb >= 10 ? gb.toFixed(1) : gb.toFixed(2)
}

function GaugeFace({ value, label }: { value: number; label: string }) {
  return (
    <svg viewBox="0 0 200 112" role="img" aria-label={`${label} ${Math.round(value)}%`} className="h-auto w-full max-w-[170px]">
      <path d={ARC_PATH} fill="none" stroke="#1f1f1f" strokeWidth={9} strokeLinecap="round" />
      <path
        d={ARC_PATH}
        fill="none"
        stroke={gaugeColor(value)}
        strokeWidth={9}
        strokeLinecap="round"
        strokeDasharray={`${((ARC_LENGTH * value) / 100).toFixed(1)} ${ARC_LENGTH.toFixed(1)}`}
        style={{ transition: `stroke-dasharray 1.1s ${EASE}, stroke 0.6s ease` }}
      />
      {TICKS.map((tick) => (
        <line
          key={tick.p}
          x1={tick.x1.toFixed(1)}
          y1={tick.y1.toFixed(1)}
          x2={tick.x2.toFixed(1)}
          y2={tick.y2.toFixed(1)}
          stroke="#3a3a3a"
          strokeWidth={tick.major ? 2 : 1}
        />
      ))}
      <g style={{ transform: `rotate(${(-90 + value * 1.8).toFixed(1)}deg)`, transformOrigin: '100px 100px', transition: `transform 1.1s ${EASE}` }}>
        <line x1={CX} y1={CY} x2={CX} y2={CY - R + 20} stroke="#f5f5f5" strokeWidth={3} strokeLinecap="round" />
      </g>
      <circle cx={CX} cy={CY} r={6.5} fill="#f5f5f5" />
      <circle cx={CX} cy={CY} r={2.5} fill="#0a0a0a" />
    </svg>
  )
}

function NeedleGauge({ percent, label, sub }: { percent: number; label: string; sub: string }) {
  const value = Math.max(0, Math.min(100, percent))
  // Start at 0 and move to the real value after the first paint, so the
  // needle sweeps in instead of appearing already in place.
  const [shown, setShown] = useState(0)
  useEffect(() => {
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(value))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [value])

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-subtle bg-surface px-4 pb-3.5 pt-3">
      <GaugeFace value={shown} label={label} />
      <div>
        <div className="text-xs text-muted">{label}</div>
        <div className="text-[22px] font-semibold leading-snug text-heading">
          <span dir="ltr" className="inline-block font-en tabular">
            {Number(value.toFixed(1))}%
          </span>
        </div>
        <div className="text-[11px] text-faint">
          <span dir="ltr" className="inline-block font-en">
            {sub}
          </span>
        </div>
      </div>
    </div>
  )
}

function GaugeSkeleton({ label, failed, failedText }: { label: string; failed: boolean; failedText: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-subtle bg-surface px-4 pb-3.5 pt-3">
      <svg viewBox="0 0 200 112" aria-hidden="true" className="h-auto w-full max-w-[170px]">
        <path d={ARC_PATH} fill="none" stroke="#1f1f1f" strokeWidth={9} strokeLinecap="round" />
      </svg>
      <div>
        <div className="text-xs text-muted">{label}</div>
        {failed ? (
          <div className="mt-1 max-w-[7rem] text-[11px] leading-snug text-faint">{failedText}</div>
        ) : (
          <>
            <div className="my-1.5 h-5 w-14 animate-pulse rounded bg-raised" />
            <div className="h-2.5 w-20 animate-pulse rounded bg-raised/70" />
          </>
        )}
      </div>
    </div>
  )
}

export default function ServerGauges() {
  const { t } = useLang()
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    function refresh() {
      getSystemStats()
        .then((s) => {
          if (cancelled) return
          setStats(s)
          setFailed(false)
        })
        .catch(() => {
          if (!cancelled) setFailed(true)
        })
    }
    refresh()
    const id = window.setInterval(refresh, 5000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const labels = [t.dashboardStats.cpu, t.dashboardStats.ram, t.dashboardStats.disk]

  return (
    <section aria-label={t.overviewPage.serverTitle} className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
      {stats ? (
        <>
          <NeedleGauge percent={stats.cpu_percent} label={labels[0]} sub={`${stats.cpu_count} ${t.dashboardStats.cores}`} />
          <NeedleGauge
            percent={stats.memory_percent}
            label={labels[1]}
            sub={`${formatGb(stats.memory_used)} / ${formatGb(stats.memory_total)} GB`}
          />
          <NeedleGauge
            percent={stats.disk_percent}
            label={labels[2]}
            sub={`${formatGb(stats.disk_used)} / ${formatGb(stats.disk_total)} GB`}
          />
        </>
      ) : (
        labels.map((label) => (
          <GaugeSkeleton key={label} label={label} failed={failed} failedText={t.overviewPage.statsUnavailable} />
        ))
      )}
    </section>
  )
}
