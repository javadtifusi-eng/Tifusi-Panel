import { useEffect, useState } from 'react'
import { useLang } from '../i18n/LangContext'
import { getSystemStats, type SystemStats } from '../lib/api'

const ACCENT = '#22D3EE'
const SIZE = 52
const STROKE = 5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function gaugeColor(percent: number): string {
  if (percent >= 90) return '#f87171'
  if (percent >= 70) return '#f59e0b'
  return ACCENT
}

function formatGb(bytes: number): string {
  const gb = bytes / 1024 ** 3
  return gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)
}

function Gauge({ percent, label, sublabel }: { percent: number; label: string; sublabel: string }) {
  const clamped = Math.max(0, Math.min(100, percent))
  const color = gaugeColor(clamped)
  const offset = CIRCUMFERENCE * (1 - clamped / 100)

  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex-shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={STROKE} />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] font-bold text-slate-100">
          {Math.round(clamped)}%
        </div>
      </div>
      <div className="text-left">
        <div className="text-[11px] font-bold text-slate-300">{label}</div>
        <div dir="ltr" className="font-mono text-[10px] text-slate-500">
          {sublabel}
        </div>
      </div>
    </div>
  )
}

export default function SystemStatsBar() {
  const { t } = useLang()
  const [stats, setStats] = useState<SystemStats | null>(null)

  useEffect(() => {
    let cancelled = false
    function refresh() {
      getSystemStats()
        .then((s) => {
          if (!cancelled) setStats(s)
        })
        .catch(() => undefined)
    }
    refresh()
    const id = window.setInterval(refresh, 5000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  if (!stats) return null

  return (
    <div className="flex items-center gap-6 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5">
      <Gauge
        percent={stats.cpu_percent}
        label={t.dashboardStats.cpu}
        sublabel={`${stats.cpu_count} ${t.dashboardStats.cores}`}
      />
      <Gauge
        percent={stats.memory_percent}
        label={t.dashboardStats.ram}
        sublabel={`${formatGb(stats.memory_used)}/${formatGb(stats.memory_total)} GB`}
      />
      <Gauge
        percent={stats.disk_percent}
        label={t.dashboardStats.disk}
        sublabel={`${formatGb(stats.disk_used)}/${formatGb(stats.disk_total)} GB`}
      />
    </div>
  )
}
