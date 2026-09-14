import { useEffect, useState } from 'react'
import { useLang } from '../i18n/LangContext'

const faDateFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  weekday: 'long',
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
    <div className="text-end leading-tight">
      <div className="font-en text-[13px] font-medium text-body tabular">{timeFormatter.format(now)}</div>
      <div className="mt-0.5 whitespace-nowrap text-[11px] text-faint">{dateFormatter.format(now)}</div>
    </div>
  )
}
