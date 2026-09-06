import { useEffect, useState } from 'react'
import { useLang } from '../i18n/LangContext'

const faDateFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})
const faTimeFormatter = new Intl.DateTimeFormat('fa-IR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})
const enDateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})
const enTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

export default function LiveClock() {
  const { lang } = useLang()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const timeFormatter = lang === 'fa' ? faTimeFormatter : enTimeFormatter
  const dateFormatter = lang === 'fa' ? faDateFormatter : enDateFormatter

  return (
    <div className="text-left">
      <div className="font-mono text-sm tabular-nums text-slate-200">{timeFormatter.format(now)}</div>
      <div className="text-[11px] text-slate-500">{dateFormatter.format(now)}</div>
    </div>
  )
}
