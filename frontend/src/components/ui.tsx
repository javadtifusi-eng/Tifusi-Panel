import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLang } from '../i18n/LangContext'
import { IconX } from './icons'

// Shared building blocks of the approved panel design (styles in design.css).

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduce(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduce
}

// ── Toast: one short confirmation line at the bottom of the screen.
const ToastContext = createContext<(text: string) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState<string | null>(null)
  const timer = useRef<number>()
  const say = useCallback((next: string) => {
    setText(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setText(null), 2200)
  }, [])
  return (
    <ToastContext.Provider value={say}>
      {children}
      {text && (
        <div className="tf-toast" role="status">
          {text}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

// ── Escape closes the top-most sheet/modal.
function useEscape(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
}

export function Sheet({
  title,
  sub,
  onClose,
  children,
  footer,
  width = 460,
  className = '',
}: {
  title: ReactNode
  sub?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  className?: string
}) {
  const { dir } = useLang()
  useEscape(onClose)
  return (
    <>
      <div className="tf-scrim" onClick={onClose} />
      <aside
        dir={dir}
        role="dialog"
        aria-modal="true"
        className={`tf-sheet ${className}`}
        style={{ ['--w' as string]: `${width}px` }}
      >
        <div className="tf-sheet-head">
          <span className="t">
            <b>{title}</b>
            {sub && <small>{sub}</small>}
          </span>
          <button type="button" className="tf-close" onClick={onClose} aria-label="✕">
            <IconX size={15} />
          </button>
        </div>
        <div className="tf-sheet-body">{children}</div>
        {footer && <div className="tf-sheet-foot">{footer}</div>}
      </aside>
    </>
  )
}

export function Modal({
  title,
  sub,
  onClose,
  children,
  width = 520,
}: {
  title: ReactNode
  sub?: ReactNode
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  const { dir } = useLang()
  useEscape(onClose)
  return (
    <>
      <div className="tf-scrim" onClick={onClose} />
      <div className="tf-modal-wrap" onClick={onClose}>
        <div
          dir={dir}
          role="dialog"
          aria-modal="true"
          className="tf-modal"
          style={{ ['--w' as string]: `${width}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="tf-sheet-head">
            <span className="t">
              <b>{title}</b>
              {sub && <small>{sub}</small>}
            </span>
            <button type="button" className="tf-close" onClick={onClose} aria-label="✕">
              <IconX size={15} />
            </button>
          </div>
          <div className="tf-sheet-body">{children}</div>
        </div>
      </div>
    </>
  )
}

export function Field({
  label,
  hint,
  wide,
  children,
  htmlFor,
}: {
  label: ReactNode
  hint?: ReactNode
  wide?: boolean
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className={wide ? 'wide' : undefined}>
      <label className="lbl" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function CheckChips<T extends string | number>({
  options,
  selected,
  onToggle,
  empty,
}: {
  options: { id: T; label: ReactNode }[]
  selected: Set<T>
  onToggle: (id: T) => void
  empty?: ReactNode
}) {
  return (
    <div className="checklist">
      {options.length === 0 && <span className="hint" style={{ margin: 0 }}>{empty}</span>}
      {options.map((o) => (
        <label key={String(o.id)} className="check-chip">
          <input type="checkbox" checked={selected.has(o.id)} onChange={() => onToggle(o.id)} />
          {o.label}
        </label>
      ))}
    </div>
  )
}

export function toggleInSet<T>(set: Set<T>, id: T): Set<T> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function Empty({ title, text, action }: { title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="tf-empty">
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}

// Counts from the previous value to the new one; proportional figures, no rounding jitter.
export function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(reduce ? value : 0)
  const from = useRef(reduce ? value : 0)
  useEffect(() => {
    if (reduce) {
      setShown(value)
      return
    }
    const start = performance.now()
    const origin = from.current
    let frame = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 1100)
      const v = origin + (value - origin) * (1 - Math.pow(1 - t, 3))
      setShown(v)
      if (t < 1) frame = requestAnimationFrame(step)
      else from.current = value
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, reduce])
  return <>{shown.toFixed(decimals)}</>
}

export interface TabItem<T extends string> {
  id: T
  label: ReactNode
  count?: number
}

// Tabs with an indicator that slides to the selected one.
export function SlidingTabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  label: string
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    function place() {
      const el = wrap.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      // Keep the same object when nothing moved: `items` is a fresh array on
      // every parent render, and a new object here would re-render forever.
      if (el)
        setInd((prev) =>
          prev && prev.left === el.offsetLeft && prev.width === el.offsetWidth ? prev : { left: el.offsetLeft, width: el.offsetWidth },
        )
    }
    place()
    window.addEventListener('resize', place)
    document.fonts?.ready.then(place).catch(() => undefined)
    return () => window.removeEventListener('resize', place)
  }, [value, items])
  return (
    <div ref={wrap} className="tf-tabs" role="tablist" aria-label={label}>
      {ind && <span className="ind" aria-hidden="true" style={{ left: ind.left, width: ind.width }} />}
      {items.map((it) => (
        <button key={it.id} type="button" role="tab" aria-selected={it.id === value} onClick={() => onChange(it.id)}>
          {it.label}
          {it.count !== undefined && <small>{it.count}</small>}
        </button>
      ))}
    </div>
  )
}

export function Sparkline({ values, dot = '#f97316' }: { values: number[]; dot?: string }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 96 28" aria-hidden="true" />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const px = (i: number) => (i / (values.length - 1)) * 96
  const py = (v: number) => 24 - ((v - min) / span) * 20
  return (
    <svg className="spark" viewBox="0 0 96 28" aria-hidden="true">
      <polyline
        points={values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ')}
        fill="none"
        stroke="#5c5c5c"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={96} cy={py(values[values.length - 1])} r={4} fill={dot} stroke="#141414" strokeWidth={2} />
    </svg>
  )
}

const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|\b(true|false|null)\b/g

// One pass per line so a later token never re-matches markup an earlier one inserted.
export function highlightJsonLines(json: string): string[] {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return json.split('\n').map((line) =>
    esc(line).replace(JSON_TOKEN, (_m, str, colon, num, bool) => {
      if (str && colon) return `<span class="tok-k">${str}</span><span class="tok-p">${colon}</span>`
      if (str) return `<span class="tok-s">${str}</span>`
      if (num) return `<span class="tok-n">${num}</span>`
      return `<span class="tok-b">${bool}</span>`
    }),
  )
}

// Pointer-driven CSS variables (--x/--y) for spotlight and glare effects.
export function trackPointer(e: React.PointerEvent<HTMLElement>) {
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  el.style.setProperty('--x', `${e.clientX - r.left}px`)
  el.style.setProperty('--y', `${e.clientY - r.top}px`)
}

export function passwordScore(p: string): number {
  let s = 0
  if (p.length >= 8) s++
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++
  if (/\d/.test(p)) s++
  if (/[^A-Za-z0-9]/.test(p) || p.length >= 14) s++
  return s
}

export const STRENGTH_COLORS = ['#ef4444', '#f59e0b', '#fbbf24', '#22c55e']

export function StrengthBars({ password }: { password: string }) {
  const lvl = Math.max(0, passwordScore(password) - 1)
  return (
    <div className="strength" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <i key={i} style={{ background: password && i <= lvl ? STRENGTH_COLORS[lvl] : undefined }} />
      ))}
    </div>
  )
}
