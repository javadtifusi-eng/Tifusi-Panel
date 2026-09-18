import { useEffect, useState, type FormEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  checkShieldGroup,
  createShieldGroup,
  deleteShieldGroup,
  listShieldGroups,
  listTunnels,
  switchShieldGroup,
  updateShieldGroup,
  type ShieldEvent,
  type ShieldGroup,
  type ShieldGroupList,
  type ShieldMode,
  type Tunnel,
} from '../lib/api'
import { parseServerDate } from '../lib/format'
import { IconPlus } from './icons'
import { Field, Sheet, useToast } from './ui'

export type ShieldSummary = { tone: 'ok' | 'bad' | 'idle'; text: string }

const REFRESH_MS = 20_000
const EVENTS_SHOWN = 6
const STATE_PILL: Record<string, string> = { active: 'ok live', standby: 'idle', burnt: 'bad' }

export default function ShieldPanel({ onSummary }: { onSummary?: (s: ShieldSummary) => void }) {
  const { t, lang } = useLang()
  const sh = t.ui.shield
  const say = useToast()
  const [data, setData] = useState<ShieldGroupList | null>(null)
  const [tunnels, setTunnels] = useState<Tunnel[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ShieldGroup | null>(null)
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [mode, setMode] = useState<ShieldMode>('dns')
  const [record, setRecord] = useState('')
  const [token, setToken] = useState('')
  const [threshold, setThreshold] = useState('3')
  const [relayIds, setRelayIds] = useState<number[]>([])
  const [pick, setPick] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function refresh() {
    try {
      setData(await listShieldGroups())
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  useEffect(() => {
    refresh()
    listTunnels()
      .then((res) => setTunnels(res.tunnels))
      .catch(() => undefined)
    const timer = window.setInterval(refresh, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!data || !onSummary) return
    const alert = data.groups.some((g) => g.enabled && (g.stranded || g.last_error || g.members.some((m) => m.state === 'burnt')))
    onSummary(
      data.groups.length === 0
        ? { tone: 'idle', text: sh.pillNone }
        : alert
          ? { tone: 'bad', text: sh.pillAlert }
          : { tone: 'ok', text: sh.pillGroups(data.groups.length) },
    )
  }, [data])

  const usedElsewhere = new Set(
    (data?.groups ?? []).filter((g) => g.id !== editing?.id).flatMap((g) => g.members.map((m) => m.tunnel_id)),
  )
  const candidates = tunnels.filter((tu) => tu.transport !== 'udp' && !usedElsewhere.has(tu.id))
  const tunnelById = new Map(tunnels.map((tu) => [tu.id, tu]))

  function ago(iso: string | null): string {
    if (!iso) return sh.never
    const minutes = Math.round((Date.now() - parseServerDate(iso).getTime()) / 60000)
    if (minutes < 60) return t.usersPage.minutesAgo(Math.max(1, minutes))
    const hours = Math.round(minutes / 60)
    return hours < 24 ? t.usersPage.hoursAgo(hours) : t.usersPage.daysAgo(Math.round(hours / 24))
  }

  function clock(iso: string): string {
    return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }).format(parseServerDate(iso))
  }

  function eventText(e: ShieldEvent): { tone: string; text: string } {
    const d = e.data
    switch (e.kind) {
      case 'burnt':
        return { tone: 'bad', text: sh.ev.burnt(d.tunnel ?? '') }
      case 'switched': {
        const main = d.reason === 'manual' ? sh.ev.switchedManual(d.to ?? '') : sh.ev.switched(d.from, d.to ?? '')
        return { tone: 'info', text: typeof d.hosts === 'number' ? `${main} · ${sh.ev.hosts(d.hosts)}` : main }
      }
      case 'no_spare':
        return { tone: 'warn', text: sh.ev.noSpare }
      case 'recovered':
        return { tone: 'ok', text: sh.ev.recovered(d.tunnel ?? '') }
      case 'error':
        return { tone: 'bad', text: sh.ev.error(d.error ?? '') }
      default:
        return { tone: 'idle', text: e.kind }
    }
  }

  function openNew() {
    setEditing(null)
    setName('')
    setEnabled(true)
    setMode('dns')
    setRecord('')
    setToken('')
    setThreshold('3')
    setRelayIds([])
    setPick('')
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(g: ShieldGroup) {
    setEditing(g)
    setName(g.name)
    setEnabled(g.enabled)
    setMode(g.mode)
    setRecord(g.dns_record ?? '')
    setToken('')
    setThreshold(String(g.fail_threshold))
    setRelayIds(g.members.map((m) => m.tunnel_id))
    setPick('')
    setFormError(null)
    setFormOpen(true)
  }

  function moveRelay(index: number, delta: number) {
    setRelayIds((ids) => {
      const next = [...ids]
      const target = index + delta
      if (target < 0 || target >= next.length) return ids
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (relayIds.length === 0) {
      setFormError(sh.relaysHint)
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        name,
        enabled,
        mode,
        dns_record: mode === 'dns' ? record.trim() || null : null,
        fail_threshold: Math.max(1, parseInt(threshold, 10) || 3),
        tunnel_ids: relayIds,
        ...(token.trim() ? { cloudflare_token: token.trim() } : {}),
      }
      if (editing) await updateShieldGroup(editing.id, payload)
      else await createShieldGroup(payload)
      setFormOpen(false)
      say(editing ? sh.saved : sh.created)
      await refresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSaving(false)
    }
  }

  async function run(id: number, action: () => Promise<ShieldGroup>, done: string) {
    setBusyId(id)
    setError(null)
    try {
      const updated = await action()
      setData((d) => (d ? { ...d, groups: d.groups.map((g) => (g.id === updated.id ? updated : g)) } : d))
      say(done)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(g: ShieldGroup) {
    if (!window.confirm(sh.confirmDelete(g.name))) return
    try {
      await deleteShieldGroup(g.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  const canCreate = candidates.length > 0

  return (
    <div className="shield">
      <div className="hint" style={{ margin: 0 }}>
        {sh.intro}
      </div>
      <div className="sh-bar">
        <span className="sh-every">{data ? sh.checkEvery(data.check_interval_seconds) : ''}</span>
        <button type="button" className="btn solid" onClick={openNew} disabled={!canCreate}>
          <IconPlus size={14} />
          {sh.newGroup}
        </button>
      </div>
      {!canCreate && tunnels.length < 2 && <div className="tf-note">{sh.needTunnels}</div>}
      {error && <div className="err-text">{error}</div>}
      {data && data.groups.length === 0 && canCreate && <div className="sh-empty">{sh.noGroups}</div>}

      {data?.groups.map((g) => {
        const busy = busyId === g.id
        return (
          <article key={g.id} className={`sh-group ${g.enabled ? '' : 'off'}`}>
            <header className="sh-head">
              <div className="sh-title">
                <b>{g.name}</b>
                <span className="chip">{sh.mode[g.mode]}</span>
                {g.mode === 'dns' && g.dns_record && <span className="mono sh-rec">{g.dns_record}</span>}
                {!g.enabled && <span className="pill idle"><i />{sh.off}</span>}
              </div>
              <div className="sh-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => run(g.id, () => checkShieldGroup(g.id), sh.checked)}>
                  {busy ? sh.checking : sh.checkNow}
                </button>
                <button type="button" className="btn" onClick={() => openEdit(g)}>
                  {t.common.edit}
                </button>
                <button type="button" className="btn danger" onClick={() => handleDelete(g)}>
                  {t.common.delete}
                </button>
              </div>
            </header>

            {g.enabled && g.stranded && <div className="tf-alert">{sh.stranded}</div>}
            {g.enabled && g.last_error && <div className="tf-alert">{sh.ev.error(g.last_error)}</div>}

            <ol className="sh-chain">
              {g.members.map((m) => (
                <li key={m.tunnel_id} className={`sh-relay ${m.state}`}>
                  <span className="sh-pos en">{m.position + 1}</span>
                  <span className="sh-name">
                    <b>{m.name}</b>
                    <small className="mono">
                      {m.iran_address}:{m.iran_port}
                    </small>
                  </span>
                  <span className="sh-meta">
                    {m.last_latency_ms != null && m.last_ok && <span className="en" dir="ltr">{m.last_latency_ms} ms</span>}
                    {m.fail_streak > 0 && m.state !== 'burnt' && <span className="warn-text">{sh.failStreak(m.fail_streak)}</span>}
                  </span>
                  <span className={`pill ${STATE_PILL[m.state]}`}>
                    <i />
                    {sh.state[m.state]}
                  </span>
                  {m.state !== 'active' ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => window.confirm(sh.confirmSwitch(m.name)) && run(g.id, () => switchShieldGroup(g.id, m.tunnel_id), sh.switched)}
                    >
                      {sh.switchHere}
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ol>

            <div className="sh-foot">
              <span>
                {sh.lastCheck}: <b>{ago(g.last_checked_at)}</b>
              </span>
            </div>

            <div className="sh-events">
              <h4>{sh.eventsTitle}</h4>
              {g.events.length === 0 ? (
                <p className="sh-none">{sh.noEvents}</p>
              ) : (
                <ul>
                  {g.events.slice(0, EVENTS_SHOWN).map((e) => {
                    const { tone, text } = eventText(e)
                    return (
                      <li key={e.id}>
                        <span className={`dot ${tone}`} />
                        <span className="txt">{text}</span>
                        <time className="en">{clock(e.created_at)}</time>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </article>
        )
      })}

      {formOpen && (
        <Sheet
          title={editing ? sh.editGroup(editing.name) : sh.newGroup}
          sub={sh.sub}
          onClose={() => setFormOpen(false)}
          width={600}
          footer={
            <>
              <button type="submit" form="shield-form" className="btn primary lg" disabled={saving}>
                {saving ? t.common.saving : editing ? t.common.save : sh.createBtn}
              </button>
              <button type="button" className="btn lg" onClick={() => setFormOpen(false)}>
                {t.usersPage.cancelAction}
              </button>
            </>
          }
        >
          <form id="shield-form" onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <div className="form-grid">
              <Field label={sh.nameLabel} htmlFor="shield-name">
                <input id="shield-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoFocus />
              </Field>
              <Field label={sh.thresholdLabel} htmlFor="shield-threshold">
                <input id="shield-threshold" className="input" type="number" min="1" max="20" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
              </Field>
            </div>
            <label className="sh-check">
              <input id="shield-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              {sh.enabledLabel}
            </label>

            <div className="form-section">
              <h4>{sh.modeLabel}</h4>
              <div className="tf-seg" style={{ alignSelf: 'flex-start' }}>
                {(['dns', 'hosts'] as ShieldMode[]).map((m) => (
                  <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                    {sh.mode[m]}
                  </button>
                ))}
              </div>
              <div className="hint" style={{ margin: 0 }}>
                {sh.modeHint[mode]}
              </div>
              {mode === 'dns' && (
                <div className="form-grid">
                  <Field label={sh.recordLabel} htmlFor="shield-record" wide>
                    <input id="shield-record" className="input ltr" value={record} onChange={(e) => setRecord(e.target.value)} placeholder="relay.example.com" required />
                  </Field>
                  <Field label={sh.tokenLabel} htmlFor="shield-token" hint={sh.tokenHint} wide>
                    <input
                      id="shield-token"
                      className="input ltr"
                      type="password"
                      autoComplete="off"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder={editing?.has_cloudflare_token ? sh.tokenKeep : ''}
                      required={!editing?.has_cloudflare_token}
                    />
                  </Field>
                </div>
              )}
            </div>

            <div className="form-section">
              <h4>{sh.relaysLabel}</h4>
              <div className="hint" style={{ margin: 0 }}>
                {sh.relaysHint}
              </div>
              <ol className="sh-order">
                {relayIds.map((id, i) => {
                  const tu = tunnelById.get(id)
                  return (
                    <li key={id}>
                      <span className="sh-pos en">{i + 1}</span>
                      <span className="sh-name">
                        <b>{tu?.name ?? `#${id}`}</b>
                        <small className="mono">{tu ? `${tu.iran_address}:${tu.iran_port}` : ''}</small>
                      </span>
                      <button type="button" className="btn" onClick={() => moveRelay(i, -1)} disabled={i === 0} aria-label={sh.moveUp}>
                        ↑
                      </button>
                      <button type="button" className="btn" onClick={() => moveRelay(i, 1)} disabled={i === relayIds.length - 1} aria-label={sh.moveDown}>
                        ↓
                      </button>
                      <button type="button" className="btn danger" onClick={() => setRelayIds((ids) => ids.filter((x) => x !== id))}>
                        {sh.remove}
                      </button>
                    </li>
                  )
                })}
              </ol>
              <div className="flex flex-wrap gap-2">
                <select id="shield-pick" className="input" style={{ flex: '1 1 220px', width: 'auto' }} value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">{sh.pickRelay}</option>
                  {candidates
                    .filter((tu) => !relayIds.includes(tu.id))
                    .map((tu) => (
                      <option key={tu.id} value={tu.id}>
                        {tu.name} — {tu.iran_address}:{tu.iran_port}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  disabled={!pick}
                  onClick={() => {
                    setRelayIds((ids) => [...ids, Number(pick)])
                    setPick('')
                  }}
                >
                  {sh.addRelay}
                </button>
              </div>
            </div>

            {formError && <div className="tf-alert">{formError}</div>}
          </form>
        </Sheet>
      )}
    </div>
  )
}
