import { useEffect, useState, type FormEvent } from 'react'
import { IconCheck, IconPlus, IconX } from '../components/icons'
import QuotaMeter, { formatGb } from '../components/QuotaMeter'
import { Empty, Field, Modal, Sheet, toggleInSet, useToast } from '../components/ui'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createReseller,
  deleteReseller,
  listResellers,
  updateReseller,
  type ProtocolOption,
  type Reseller,
} from '../lib/api'
import { initials, parseServerDate } from '../lib/format'

const GB = 1024 ** 3

interface FormState {
  username: string
  password: string
  usersOn: boolean
  maxUsers: string
  volumeOn: boolean
  quotaGb: string
  protocols: Set<string>
}

function emptyForm(catalog: ProtocolOption[]): FormState {
  return {
    username: '',
    password: generatePassword(),
    usersOn: true,
    maxUsers: '50',
    volumeOn: true,
    quotaGb: '500',
    protocols: new Set(catalog.map((p) => p.protocol)),
  }
}

function generatePassword(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const pick = (n: number) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => abc[x % abc.length]).join('')
  return `${pick(4)}-${pick(4)}-${pick(4)}`
}

function nearLimit(r: Reseller): boolean {
  return (r.max_users != null && r.users_count >= r.max_users * 0.8) || (r.data_quota != null && r.data_allocated >= r.data_quota * 0.8)
}

export default function ResellersPage({ createSignal = 0 }: { createSignal?: number } = {}) {
  const { t, lang } = useLang()
  const r = t.ui.resellers
  const protocolLabels = t.coresPage.protocolLabels as Record<string, string>
  const say = useToast()
  // The address the reseller signs in at is the one this dashboard is open on.
  const panelUrl = window.location.origin
  const [resellers, setResellers] = useState<Reseller[] | null>(null)
  const [catalog, setCatalog] = useState<ProtocolOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Reseller | null>(null)
  const [form, setForm] = useState<FormState>(() => emptyForm([]))
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [creds, setCreds] = useState<{ username: string; password: string } | null>(null)

  async function refresh() {
    try {
      const res = await listResellers()
      setResellers(res.resellers)
      setCatalog(res.protocols)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (createSignal > 0) openNew()
  }, [createSignal])

  function openNew() {
    setEditing(null)
    setForm(emptyForm(catalog))
    setFormError(null)
    setShowForm(true)
  }

  function startEdit(x: Reseller) {
    setEditing(x)
    setForm({
      username: x.username,
      password: '',
      usersOn: x.max_users != null,
      maxUsers: String(x.max_users ?? 50),
      volumeOn: x.data_quota != null,
      quotaGb: x.data_quota != null ? String(Number((x.data_quota / GB).toFixed(1))) : '500',
      protocols: new Set(x.protocols),
    })
    setFormError(null)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      say(r.copied)
    } catch {
      // Clipboard blocked (plain http): the values stay on screen to copy by hand.
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (form.protocols.size === 0) {
      setFormError(r.pickProtocol)
      return
    }
    setSubmitting(true)
    setFormError(null)
    const limits = {
      max_users: form.usersOn ? parseInt(form.maxUsers, 10) : null,
      data_quota: form.volumeOn ? Math.round(parseFloat(form.quotaGb) * GB) : null,
      protocols: Array.from(form.protocols),
    }
    try {
      if (editing) {
        await updateReseller(editing.id, form.password ? { ...limits, password: form.password } : limits)
        if (form.password) setCreds({ username: editing.username, password: form.password })
        say(r.saved)
      } else {
        await createReseller({ username: form.username, password: form.password, ...limits })
        setCreds({ username: form.username, password: form.password })
        say(r.created(form.username))
      }
      closeForm()
      await refresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleDisabled(x: Reseller) {
    setError(null)
    try {
      await updateReseller(x.id, { disabled: !x.disabled })
      await refresh()
      say(x.disabled ? r.enabledToast : r.disabledToast)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  async function handleDelete(x: Reseller) {
    if (!window.confirm(r.confirmDelete(x.username))) return
    setError(null)
    try {
      await deleteReseller(x.id)
      await refresh()
      say(r.deletedToast)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  const dateFmt = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })
  const list = resellers ?? []
  const totalUsers = list.reduce((sum, x) => sum + x.users_count, 0)
  const totalAllocated = list.reduce((sum, x) => sum + x.data_allocated, 0)
  const totalUsed = list.reduce((sum, x) => sum + x.used_traffic, 0)
  const attention = list.filter((x) => !x.disabled && nearLimit(x)).length
  const protoLabel = (p: string) => protocolLabels[p] ?? p

  const ruleParts: string[] = []
  if (form.usersOn) ruleParts.push(r.ruleUsers(parseInt(form.maxUsers, 10) || 0))
  if (form.volumeOn) ruleParts.push(r.ruleVolume(form.quotaGb || '0'))
  const rule = ruleParts.length ? `${r.rulePrefix}${ruleParts.join(r.ruleJoin)}${r.ruleSuffix}` : r.ruleNone

  const newButton = (
    <button type="button" className="btn solid" onClick={openNew}>
      <IconPlus size={14} />
      {r.newBtn.replace(/^\+\s*/, '')}
    </button>
  )

  return (
    <div className="pg-resellers">
      <h1 className="sr-only">{t.nav.resellers}</h1>

      <div className="head">
        {resellers && (
          <span className="pill ok">
            <i />
            {r.countPill(list.length)}
          </span>
        )}
        <div className="actions">{newButton}</div>
      </div>

      {error && (
        <div className="tf-alert" role="alert">
          {error}
        </div>
      )}

      <div className="strip">
        <div className="tile">
          <small>{r.tileUsers}</small>
          <b>{totalUsers}</b>
          <span>{r.tileUsersSub}</span>
        </div>
        <div className="tile">
          <small>{r.tileVolume}</small>
          <b>{formatGb(totalAllocated)} GB</b>
          <span>{r.tileVolumeSub(`${formatGb(totalUsed)} GB`)}</span>
        </div>
        <div className="tile">
          <small>{r.tileAttention}</small>
          <b style={attention ? { color: 'var(--warn)' } : undefined}>{attention}</b>
          <span>{attention ? r.tileAttentionSub : r.tileAttentionNone}</span>
        </div>
      </div>

      {resellers === null ? (
        <div className="list" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rrow">
              <span className="skel h-8 w-32" />
              <span className="skel h-3 w-full" />
              <span className="skel h-3 w-full" />
              <span className="skel h-3 w-20" />
              <span />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <Empty title={r.emptyTitle} text={r.emptyText} action={newButton} />
      ) : (
        <div className="list">
          <div className="rhead" aria-hidden="true">
            <span>{r.colReseller}</span>
            <span>{r.colUsers}</span>
            <span>{r.colVolume}</span>
            <span>{r.colProtocols}</span>
            <span />
          </div>
          {list.map((x) => (
            <div key={x.id} className={`rrow ${x.disabled ? 'off' : ''}`}>
              <div className="who">
                <span className="av">{initials(x.username)}</span>
                <span className="n">
                  <b dir="ltr">{x.username}</b>
                  <small>{x.disabled ? r.disabledSub : r.since(dateFmt.format(parseServerDate(x.created_at)))}</small>
                </span>
              </div>
              <QuotaMeter label={r.users} used={x.users_count} cap={x.max_users} noLimit={r.noLimit} full={r.full} percent={r.percentUsed} />
              <QuotaMeter
                label={r.volume}
                used={x.data_allocated}
                cap={x.data_quota}
                format={formatGb}
                unit=" GB"
                extra={r.realUsage(`${formatGb(x.used_traffic)} GB`)}
                noLimit={r.noLimit}
                full={r.full}
                percent={r.percentUsed}
              />
              <div className="protos">
                {x.protocols.map((p) => (
                  <span key={p} className="chip">
                    {protoLabel(p)}
                  </span>
                ))}
                {x.disabled && (
                  <span className="pill idle">
                    <i />
                    {r.disabledPill}
                  </span>
                )}
              </div>
              <div className="acts">
                <button type="button" className="btn" onClick={() => startEdit(x)}>
                  {r.edit}
                </button>
                <button type="button" className="btn" onClick={() => toggleDisabled(x)}>
                  {x.disabled ? r.enable : r.disable}
                </button>
                <button type="button" className="btn danger" onClick={() => handleDelete(x)}>
                  {r.delete}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Sheet
          title={editing ? r.formEdit(editing.username) : r.formNew}
          sub={r.formSub}
          onClose={closeForm}
          width={620}
          footer={
            <>
              <button type="submit" form="reseller-form" disabled={submitting} className="btn primary lg">
                {submitting ? t.common.saving : editing ? t.common.save : r.createBtn}
              </button>
              <button type="button" className="btn lg" onClick={closeForm}>
                {t.usersPage.cancelAction}
              </button>
            </>
          }
        >
          <form id="reseller-form" onSubmit={handleSubmit} className="rs-form">
            <Field label={r.panelAddress} htmlFor="rs-url">
              <div className="rs-line">
                <input id="rs-url" className="input ltr" readOnly value={panelUrl} />
                <button type="button" className="btn" onClick={() => copy(panelUrl)}>
                  {r.copy}
                </button>
              </div>
            </Field>
            <div className="row2">
              <Field label={r.username} htmlFor="rs-user">
                <input
                  id="rs-user"
                  className="input ltr"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  required
                  minLength={3}
                  maxLength={64}
                  pattern="[a-zA-Z0-9_-]+"
                  disabled={!!editing}
                  autoFocus={!editing}
                />
              </Field>
              <Field label={editing ? r.newPassword : r.password} htmlFor="rs-pass">
                <div className="rs-line">
                  <input
                    id="rs-pass"
                    className="input ltr"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required={!editing}
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                  <button type="button" className="btn" onClick={() => setForm({ ...form, password: generatePassword() })}>
                    {r.generate}
                  </button>
                </div>
              </Field>
            </div>
            <div className="hint" style={{ marginTop: -8 }}>
              {editing ? r.newPasswordHint : r.usernameHint}
            </div>

            <div>
              <div className="lbl">{r.limitsLabel}</div>
              <div className="rs-limits">
                <div className={`rs-limit ${form.usersOn ? 'on' : ''}`}>
                  <div className="lt">
                    <span>
                      <b>{r.limitUsers}</b>
                      <small>{r.limitUsersSub}</small>
                    </span>
                    <label className="tf-switch">
                      <input type="checkbox" checked={form.usersOn} onChange={(e) => setForm({ ...form, usersOn: e.target.checked })} aria-label={r.limitUsers} />
                    </label>
                  </div>
                  <div className="rs-unit">
                    <input
                      className="input en"
                      type="number"
                      min={1}
                      step={1}
                      value={form.maxUsers}
                      onChange={(e) => setForm({ ...form, maxUsers: e.target.value })}
                      disabled={!form.usersOn}
                      required={form.usersOn}
                      aria-label={r.limitUsers}
                    />
                    <span>{r.usersUnit}</span>
                  </div>
                </div>
                <div className={`rs-limit ${form.volumeOn ? 'on' : ''}`}>
                  <div className="lt">
                    <span>
                      <b>{r.limitVolume}</b>
                      <small>{r.limitVolumeSub}</small>
                    </span>
                    <label className="tf-switch">
                      <input type="checkbox" checked={form.volumeOn} onChange={(e) => setForm({ ...form, volumeOn: e.target.checked })} aria-label={r.limitVolume} />
                    </label>
                  </div>
                  <div className="rs-unit">
                    <input
                      className="input en"
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={form.quotaGb}
                      onChange={(e) => setForm({ ...form, quotaGb: e.target.value })}
                      disabled={!form.volumeOn}
                      required={form.volumeOn}
                      aria-label={r.limitVolume}
                    />
                    <span>GB</span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="lbl">{r.protocolsLabel}</div>
              <div className="rs-scopes">
                {catalog.length === 0 && (
                  <span className="hint" style={{ margin: 0 }}>
                    {r.noProtocols}
                  </span>
                )}
                {catalog.map((p) => (
                  <button
                    key={p.protocol}
                    type="button"
                    className="rs-scope"
                    aria-pressed={form.protocols.has(p.protocol)}
                    onClick={() => setForm({ ...form, protocols: toggleInSet(form.protocols, p.protocol) })}
                  >
                    {protoLabel(p.protocol)}
                    <small>{p.hosts.join(', ')}</small>
                  </button>
                ))}
              </div>
              <div className="hint">{r.protocolsHint}</div>
            </div>

            <div className="rs-rule">{rule}</div>

            <div className="rs-rights">
              <h4>{r.rightsTitle}</h4>
              {r.rightsYes.map((text) => (
                <div key={text} className="rs-right yes">
                  <span className="ic">
                    <IconCheck size={11} strokeWidth={2.4} />
                  </span>
                  <span>{text}</span>
                </div>
              ))}
              {r.rightsNo.map((text) => (
                <div key={text} className="rs-right no">
                  <span className="ic">
                    <IconX size={11} strokeWidth={2.4} />
                  </span>
                  <span>{text}</span>
                </div>
              ))}
            </div>

            {formError && (
              <div className="tf-alert" role="alert">
                {formError}
              </div>
            )}
          </form>
        </Sheet>
      )}

      {creds && (
        <Modal title={r.credsTitle} sub={r.credsSub} onClose={() => setCreds(null)} width={520}>
          <div className="rs-creds">
            {(
              [
                [r.panelAddress, panelUrl],
                [r.username, creds.username],
                [r.password, creds.password],
              ] as [string, string][]
            ).map(([label, value]) => (
              <div key={label} className="rs-cred">
                <span>{label}</span>
                <code>{value}</code>
                <button type="button" className="btn" onClick={() => copy(value)}>
                  {r.copy}
                </button>
              </div>
            ))}
            <button type="button" className="btn primary lg" onClick={() => copy(r.credsText(panelUrl, creds.username, creds.password))}>
              {r.copyAll}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
