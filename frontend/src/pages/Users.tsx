import { useEffect, useState, type FormEvent } from 'react'
import UserDevicesModal from '../components/UserDevicesModal'
import UserLinksModal from '../components/UserLinksModal'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  bulkCreateUsers,
  bulkDeleteUsers,
  bulkUpdateUsers,
  createUser,
  createUserTemplate,
  deleteUser,
  deleteUserTemplate,
  listGroups,
  listUserTemplates,
  listUsers,
  resetUserSecret,
  updateUser,
  type Group,
  type ProxyUser,
  type UserStatus,
  type UserTemplate,
} from '../lib/api'

const ACCENT = '#22D3EE'

const statusStyles: Record<UserStatus, string> = {
  active: 'bg-success-tint text-success border-success',
  disabled: 'bg-neutral-tint text-muted border-neutral',
  expired: 'bg-danger-tint text-danger border-danger',
  limited: 'bg-warning-tint text-warning border-warning',
  on_hold: 'bg-accent-tint text-accent border-cyan-400/40',
}

export default function UsersPage() {
  const { t, align } = useLang()
  const [users, setUsers] = useState<ProxyUser[] | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [username, setUsername] = useState('')
  const [dataLimitGb, setDataLimitGb] = useState('')
  const [dataLimitResetDays, setDataLimitResetDays] = useState('')
  const [expire, setExpire] = useState('')
  const [note, setNote] = useState('')
  const [groupIds, setGroupIds] = useState<Set<number>>(new Set())
  const [onHold, setOnHold] = useState(false)
  const [onHoldDays, setOnHoldDays] = useState('30')
  const [hwidLimit, setHwidLimit] = useState('')
  const [speedLimitMbps, setSpeedLimitMbps] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [linksUser, setLinksUser] = useState<ProxyUser | null>(null)
  const [devicesUser, setDevicesUser] = useState<ProxyUser | null>(null)
  const [resettingSecretId, setResettingSecretId] = useState<number | null>(null)

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkPanel, setBulkPanel] = useState<'limit' | 'expire' | 'group' | null>(null)
  const [bulkLimitGb, setBulkLimitGb] = useState('')
  const [bulkExpire, setBulkExpire] = useState('')
  const [bulkGroupId, setBulkGroupId] = useState<number | null>(null)

  const [showBulkCreate, setShowBulkCreate] = useState(false)
  const [bulkPrefix, setBulkPrefix] = useState('user')
  const [bulkCount, setBulkCount] = useState('10')
  const [bulkStartAt, setBulkStartAt] = useState('1')
  const [bulkCreateDataLimitGb, setBulkCreateDataLimitGb] = useState('')
  const [bulkCreateExpire, setBulkCreateExpire] = useState('')
  const [bulkCreateGroupIds, setBulkCreateGroupIds] = useState<Set<number>>(new Set())
  const [bulkCreateSubmitting, setBulkCreateSubmitting] = useState(false)
  const [bulkCreateMsg, setBulkCreateMsg] = useState<string | null>(null)

  const [templates, setTemplates] = useState<UserTemplate[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [tplName, setTplName] = useState('')
  const [tplDataLimitGb, setTplDataLimitGb] = useState('')
  const [tplExpireDays, setTplExpireDays] = useState('')
  const [tplNote, setTplNote] = useState('')
  const [tplGroupIds, setTplGroupIds] = useState<Set<number>>(new Set())
  const [tplSubmitting, setTplSubmitting] = useState(false)

  function formatLimit(bytes: number | null): string {
    if (!bytes) return t.usersPage.unlimited
    const gb = bytes / 1024 ** 3
    return `${gb.toFixed(gb >= 10 ? 0 : 1)} ${t.usersPage.gbSuffix}`
  }

  function formatUsed(bytes: number): string {
    const gb = bytes / 1024 ** 3
    if (gb < 0.1) return `0 ${t.usersPage.gbSuffix}`
    return `${gb.toFixed(1)} ${t.usersPage.gbSuffix}`
  }

  // "Online" within one traffic-sync cycle (30s server-side, see
  // app/traffic/sync.py) rather than a live push — anything within 90s
  // covers a slow/missed cycle without claiming a stale user is online.
  function formatLastSeen(iso: string | null): string {
    if (!iso) return t.usersPage.neverSeen
    const seconds = (Date.now() - new Date(iso).getTime()) / 1000
    if (seconds < 90) return t.usersPage.onlineNow
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return t.usersPage.minutesAgo(minutes)
    const hours = Math.round(minutes / 60)
    if (hours < 24) return t.usersPage.hoursAgo(hours)
    return t.usersPage.daysAgo(Math.round(hours / 24))
  }

  async function refresh() {
    try {
      const [usersRes, groupsRes, templatesRes] = await Promise.all([listUsers(), listGroups(), listUserTemplates()])
      setUsers(usersRes.users)
      setGroups(groupsRes.groups)
      setTemplates(templatesRes.templates)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.usersPage.fetchError)
    }
  }

  function daysFromNowIso(days: number): string {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString().slice(0, 10)
  }

  function applyTemplateToSingle(templateId: number | null) {
    if (templateId == null) return
    const tpl = templates.find((tp) => tp.id === templateId)
    if (!tpl) return
    setDataLimitGb(tpl.data_limit ? String(tpl.data_limit / 1024 ** 3) : '')
    setExpire(tpl.expire_days != null ? daysFromNowIso(tpl.expire_days) : '')
    setNote(tpl.note ?? '')
    setGroupIds(new Set(tpl.group_ids))
  }

  function applyTemplateToBulkCreate(templateId: number | null) {
    if (templateId == null) return
    const tpl = templates.find((tp) => tp.id === templateId)
    if (!tpl) return
    setBulkCreateDataLimitGb(tpl.data_limit ? String(tpl.data_limit / 1024 ** 3) : '')
    setBulkCreateExpire(tpl.expire_days != null ? daysFromNowIso(tpl.expire_days) : '')
    setBulkCreateGroupIds(new Set(tpl.group_ids))
  }

  function toggleTplGroup(id: number) {
    setTplGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function resetTplForm() {
    setTplName('')
    setTplDataLimitGb('')
    setTplExpireDays('')
    setTplNote('')
    setTplGroupIds(new Set())
  }

  async function handleCreateTemplate(e: FormEvent) {
    e.preventDefault()
    if (!tplName.trim()) return
    setTplSubmitting(true)
    setError(null)
    try {
      await createUserTemplate({
        name: tplName.trim(),
        data_limit: tplDataLimitGb ? Math.round(parseFloat(tplDataLimitGb) * 1024 ** 3) : null,
        expire_days: tplExpireDays ? parseInt(tplExpireDays, 10) : null,
        note: tplNote || null,
        group_ids: Array.from(tplGroupIds),
      })
      resetTplForm()
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setTplSubmitting(false)
    }
  }

  async function handleDeleteTemplate(tpl: UserTemplate) {
    if (!window.confirm(t.usersPage.confirmDeleteTemplate(tpl.name))) return
    try {
      await deleteUserTemplate(tpl.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  function resetForm() {
    setEditingId(null)
    setUsername('')
    setDataLimitGb('')
    setExpire('')
    setNote('')
    setGroupIds(new Set())
    setOnHold(false)
    setOnHoldDays('30')
    setHwidLimit('')
    setSpeedLimitMbps('')
    setDataLimitResetDays('')
    setShowForm(false)
  }

  function startEdit(user: ProxyUser) {
    setEditingId(user.id)
    setUsername(user.username)
    setDataLimitGb(user.data_limit ? String(user.data_limit / 1024 ** 3) : '')
    setDataLimitResetDays(user.data_limit_reset_days ? String(user.data_limit_reset_days) : '')
    setExpire(user.expire ? user.expire.slice(0, 10) : '')
    setNote(user.note ?? '')
    setGroupIds(new Set(user.group_ids))
    setOnHold(false)
    setHwidLimit(user.hwid_limit ? String(user.hwid_limit) : '')
    setSpeedLimitMbps(user.speed_limit_mbps ? String(user.speed_limit_mbps) : '')
    setShowForm(true)
  }

  function toggleGroup(id: number) {
    setGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const data_limit = dataLimitGb ? Math.round(parseFloat(dataLimitGb) * 1024 ** 3) : null
    const data_limit_reset_days = data_limit && dataLimitResetDays ? parseInt(dataLimitResetDays, 10) : null
    const expireIso = expire ? new Date(`${expire}T23:59:59`).toISOString() : null
    const group_ids = Array.from(groupIds)
    const hwid_limit = hwidLimit ? parseInt(hwidLimit, 10) : null
    const speed_limit_mbps = speedLimitMbps ? parseInt(speedLimitMbps, 10) : null
    try {
      if (editingId) {
        await updateUser(editingId, {
          data_limit,
          data_limit_reset_days,
          expire: expireIso,
          hwid_limit,
          speed_limit_mbps,
          note: note || null,
          group_ids,
        })
      } else if (onHold) {
        await createUser({
          username,
          status: 'on_hold',
          data_limit,
          data_limit_reset_days,
          on_hold_expire_days: onHoldDays ? parseInt(onHoldDays, 10) : null,
          hwid_limit,
          speed_limit_mbps,
          note: note || null,
          group_ids,
        })
      } else {
        await createUser({
          username,
          data_limit,
          data_limit_reset_days,
          expire: expireIso,
          hwid_limit,
          speed_limit_mbps,
          note: note || null,
          group_ids,
        })
      }
      resetForm()
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResetSecret(user: ProxyUser) {
    if (!window.confirm(t.usersPage.confirmResetSecret(user.username))) return
    setResettingSecretId(user.id)
    setError(null)
    try {
      await resetUserSecret(user.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setResettingSecretId(null)
    }
  }

  async function toggleStatus(user: ProxyUser) {
    const next: UserStatus = user.status === 'active' ? 'disabled' : 'active'
    try {
      await updateUser(user.id, { status: next })
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  async function handleDelete(user: ProxyUser) {
    if (!window.confirm(t.usersPage.confirmDelete(user.username))) return
    try {
      await deleteUser(user.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (!users) return
    setSelected((prev) => (prev.size === users.length ? new Set() : new Set(users.map((u) => u.id))))
  }

  function resetBulkPanel() {
    setBulkPanel(null)
    setBulkLimitGb('')
    setBulkExpire('')
    setBulkGroupId(null)
  }

  async function runBulkUpdate(payload: Omit<Parameters<typeof bulkUpdateUsers>[0], 'user_ids'>) {
    setBulkBusy(true)
    setError(null)
    try {
      await bulkUpdateUsers({ ...payload, user_ids: Array.from(selected) })
      resetBulkPanel()
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleBulkDelete() {
    if (!window.confirm(t.usersPage.confirmBulkDelete(selected.size))) return
    setBulkBusy(true)
    setError(null)
    try {
      await bulkDeleteUsers(Array.from(selected))
      setSelected(new Set())
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setBulkBusy(false)
    }
  }

  function toggleBulkCreateGroup(id: number) {
    setBulkCreateGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const bulkCreateUsernames: string[] = (() => {
    const count = Math.max(0, Math.min(500, parseInt(bulkCount, 10) || 0))
    const start = parseInt(bulkStartAt, 10) || 1
    const prefix = bulkPrefix.trim()
    if (!prefix || count === 0) return []
    return Array.from({ length: count }, (_, i) => `${prefix}${start + i}`)
  })()

  async function handleBulkCreateSubmit(e: FormEvent) {
    e.preventDefault()
    if (bulkCreateUsernames.length === 0) return
    setBulkCreateSubmitting(true)
    setError(null)
    setBulkCreateMsg(null)
    const data_limit = bulkCreateDataLimitGb ? Math.round(parseFloat(bulkCreateDataLimitGb) * 1024 ** 3) : null
    const expireIso = bulkCreateExpire ? new Date(`${bulkCreateExpire}T23:59:59`).toISOString() : null
    try {
      const res = await bulkCreateUsers({
        usernames: bulkCreateUsernames,
        data_limit,
        expire: expireIso,
        group_ids: Array.from(bulkCreateGroupIds),
      })
      setBulkCreateMsg(t.usersPage.bulkCreateResult(res.created.length, res.skipped.length))
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setBulkCreateSubmitting(false)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-heading">{t.usersPage.title}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTemplates((v) => !v)}
            className="rounded-lg border border-edge px-4 py-2 text-sm font-bold text-secondary hover:border-strong"
          >
            {t.usersPage.templatesBtn}
          </button>
          <button
            onClick={() => {
              setShowBulkCreate((v) => !v)
              setBulkCreateMsg(null)
            }}
            className="rounded-lg border px-4 py-2 text-sm font-bold"
            style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
          >
            {t.usersPage.bulkCreateBtn}
          </button>
          <button
            onClick={() => (showForm ? resetForm() : setShowForm(true))}
            className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
          >
            {t.usersPage.newBtn}
          </button>
        </div>
      </div>

      {showTemplates && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-edge bg-surface p-4">
          <div>
            <div className="text-sm font-bold text-body">{t.usersPage.templatesTitle}</div>
            <div className="mt-0.5 text-xs text-faint">{t.usersPage.templatesDesc}</div>
          </div>

          {templates.length === 0 && <div className="text-xs text-faint">{t.usersPage.noTemplatesYet}</div>}
          {templates.length > 0 && (
            <div className="flex flex-col gap-2">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-subtle bg-well px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-bold text-body">{tpl.name}</span>
                    <span className="text-faint">{formatLimit(tpl.data_limit)}</span>
                    <span className="text-faint">
                      {tpl.expire_days != null ? `${tpl.expire_days}d` : t.usersPage.unlimited}
                    </span>
                  </div>
                  <button onClick={() => handleDeleteTemplate(tpl)} className="text-xs text-danger hover:underline">
                    {t.common.delete}
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleCreateTemplate} className="flex flex-wrap items-end gap-3 border-t border-subtle pt-3">
            <div>
              <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.templateNameLabel}</label>
              <input
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                placeholder={t.usersPage.templateNamePlaceholder}
                required
                className="rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
              />
            </div>
            <div>
              <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.dataLimit}</label>
              <input
                value={tplDataLimitGb}
                onChange={(e) => setTplDataLimitGb(e.target.value)}
                type="number"
                min="0"
                step="0.5"
                className="w-40 rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
              />
            </div>
            <div>
              <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.expireDaysLabel}</label>
              <input
                value={tplExpireDays}
                onChange={(e) => setTplExpireDays(e.target.value)}
                type="number"
                min="0"
                className="w-56 rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
              />
            </div>
            <div>
              <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.note}</label>
              <input
                value={tplNote}
                onChange={(e) => setTplNote(e.target.value)}
                className="w-48 rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
              />
            </div>
            <div className="w-full">
              <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.groupsLabel}</label>
              <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-subtle bg-well p-2">
                {groups.length === 0 && <div className="px-1 py-1 text-xs text-faint">{t.usersPage.noGroups}</div>}
                {groups.map((g) => (
                  <label key={g.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={tplGroupIds.has(g.id)} onChange={() => toggleTplGroup(g.id)} />
                    <span className="text-body">{g.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <button
              type="submit"
              disabled={tplSubmitting}
              className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60"
              style={{ backgroundColor: ACCENT }}
            >
              {t.usersPage.saveTemplateBtn}
            </button>
          </form>
        </div>
      )}

      {showBulkCreate && (
        <form
          onSubmit={handleBulkCreateSubmit}
          className="mb-6 flex flex-col gap-3 rounded-xl border border-cyan-400/20 bg-surface p-4"
        >
          <div className="text-sm font-bold text-body">{t.usersPage.bulkCreateTitle}</div>
          <div className="flex flex-wrap items-end gap-3">
            {templates.length > 0 && (
              <div>
                <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.applyTemplateLabel}</label>
                <select
                  onChange={(e) => applyTemplateToBulkCreate(e.target.value ? Number(e.target.value) : null)}
                  defaultValue=""
                  className="rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
                >
                  <option value="">{t.usersPage.noTemplate}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.prefixLabel}</label>
              <input
                value={bulkPrefix}
                onChange={(e) => setBulkPrefix(e.target.value)}
                dir="ltr"
                className="rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
              />
            </div>
            <div>
              <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.countLabel}</label>
              <input
                value={bulkCount}
                onChange={(e) => setBulkCount(e.target.value)}
                type="number"
                min="1"
                max="500"
                className="w-24 rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
              />
            </div>
            <div>
              <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.startAtLabel}</label>
              <input
                value={bulkStartAt}
                onChange={(e) => setBulkStartAt(e.target.value)}
                type="number"
                min="1"
                className="w-24 rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
              />
            </div>
            <div>
              <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.dataLimit}</label>
              <input
                value={bulkCreateDataLimitGb}
                onChange={(e) => setBulkCreateDataLimitGb(e.target.value)}
                type="number"
                min="0"
                step="0.5"
                className="w-44 rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
              />
            </div>
            <div>
              <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.expire}</label>
              <input
                value={bulkCreateExpire}
                onChange={(e) => setBulkCreateExpire(e.target.value)}
                type="date"
                className="rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
              />
            </div>
          </div>
          <div>
            <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.groupsLabel}</label>
            <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-subtle bg-well p-2">
              {groups.length === 0 && <div className="px-1 py-1 text-xs text-faint">{t.usersPage.noGroups}</div>}
              {groups.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={bulkCreateGroupIds.has(g.id)}
                    onChange={() => toggleBulkCreateGroup(g.id)}
                  />
                  <span className="text-body">{g.name}</span>
                </label>
              ))}
            </div>
          </div>
          {bulkCreateUsernames.length > 0 && (
            <div dir="ltr" className="rounded-lg border border-subtle bg-well p-2 text-left font-mono text-[11px] text-muted">
              {t.usersPage.previewLabel}: {bulkCreateUsernames.slice(0, 8).join(', ')}
              {bulkCreateUsernames.length > 8 && ` … (+${bulkCreateUsernames.length - 8})`}
            </div>
          )}
          {bulkCreateMsg && <div className="text-xs text-success">{bulkCreateMsg}</div>}
          <div>
            <button
              type="submit"
              disabled={bulkCreateSubmitting || bulkCreateUsernames.length === 0}
              className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60"
              style={{ backgroundColor: ACCENT }}
            >
              {t.usersPage.bulkCreateSubmit(bulkCreateUsernames.length)}
            </button>
          </div>
        </form>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-cyan-400/20 bg-surface p-4"
        >
          {!editingId && templates.length > 0 && (
            <div>
              <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.applyTemplateLabel}</label>
              <select
                onChange={(e) => applyTemplateToSingle(e.target.value ? Number(e.target.value) : null)}
                defaultValue=""
                className="rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
              >
                <option value="">{t.usersPage.noTemplate}</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.username}</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={editingId !== null}
              pattern="[a-zA-Z0-9_-]+"
              className="rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60 disabled:opacity-50"
            />
          </div>
          <div>
            <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.dataLimit}</label>
            <input
              value={dataLimitGb}
              onChange={(e) => setDataLimitGb(e.target.value)}
              type="number"
              min="0"
              step="0.5"
              className="w-44 rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
            />
          </div>
          {dataLimitGb && (
            <div>
              <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.dataLimitResetDaysLabel}</label>
              <input
                value={dataLimitResetDays}
                onChange={(e) => setDataLimitResetDays(e.target.value)}
                type="number"
                min="1"
                placeholder={t.usersPage.dataLimitResetDaysPlaceholder}
                className="w-44 rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
              />
            </div>
          )}
          {!editingId && onHold ? (
            <div>
              <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.onHoldDaysLabel}</label>
              <input
                value={onHoldDays}
                onChange={(e) => setOnHoldDays(e.target.value)}
                type="number"
                min="0"
                className="w-40 rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
              />
            </div>
          ) : (
            <div>
              <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.expire}</label>
              <input
                value={expire}
                onChange={(e) => setExpire(e.target.value)}
                type="date"
                className="rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
              />
            </div>
          )}
          <div>
            <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.hwidLimitLabel}</label>
            <input
              value={hwidLimit}
              onChange={(e) => setHwidLimit(e.target.value)}
              type="number"
              min="0"
              className="w-44 rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
            />
          </div>
          <div>
            <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.speedLimitLabel}</label>
            <input
              value={speedLimitMbps}
              onChange={(e) => setSpeedLimitMbps(e.target.value)}
              type="number"
              min="1"
              placeholder={t.usersPage.speedLimitPlaceholder}
              className="w-44 rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
            />
          </div>
          <div>
            <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.note}</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-48 rounded-lg border border-edge bg-field px-3 py-2 text-sm text-primary outline-none focus:border-cyan-400/60"
            />
          </div>
          {!editingId && (
            <label className="mb-1.5 flex cursor-pointer items-center gap-1.5 text-sm text-secondary">
              <input type="checkbox" checked={onHold} onChange={(e) => setOnHold(e.target.checked)} />
              {t.usersPage.onHoldToggleLabel}
            </label>
          )}
          <div className="w-full">
            <label className={`mb-1.5 block text-xs text-muted ${align}`}>{t.usersPage.groupsLabel}</label>
            <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-subtle bg-well p-2">
              {groups.length === 0 && <div className="px-1 py-1 text-xs text-faint">{t.usersPage.noGroups}</div>}
              {groups.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={groupIds.has(g.id)} onChange={() => toggleGroup(g.id)} />
                  <span className="text-body">{g.name}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60"
            style={{ backgroundColor: ACCENT }}
          >
            {editingId ? t.common.save : t.usersPage.createBtn}
          </button>
        </form>
      )}

      {error && <div className="mb-4 text-sm text-danger">{error}</div>}

      {users === null && <div className="py-8 text-center text-faint">{t.loading}</div>}
      {users !== null && users.length === 0 && (
        <div className="rounded-xl border border-subtle py-8 text-center text-faint">
          {t.usersPage.noUsersYet}
        </div>
      )}

      {users !== null && users.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-subtle bg-well p-3">
          <label className="flex items-center gap-1.5 text-xs text-secondary">
            <input type="checkbox" checked={selected.size === users.length} onChange={toggleSelectAll} />
            {t.usersPage.selectAll}
          </label>
          {selected.size > 0 && (
            <>
              <span className="text-xs text-muted">{t.usersPage.selectedCount(selected.size)}</span>
              <button
                disabled={bulkBusy}
                onClick={() => runBulkUpdate({ status: 'active' })}
                className="rounded-md border border-edge px-2.5 py-1 text-xs text-secondary hover:border-strong disabled:opacity-50"
              >
                {t.usersPage.bulkActivate}
              </button>
              <button
                disabled={bulkBusy}
                onClick={() => runBulkUpdate({ status: 'disabled' })}
                className="rounded-md border border-edge px-2.5 py-1 text-xs text-secondary hover:border-strong disabled:opacity-50"
              >
                {t.usersPage.bulkDisable}
              </button>
              <button
                disabled={bulkBusy}
                onClick={() => setBulkPanel((p) => (p === 'limit' ? null : 'limit'))}
                className="rounded-md border border-edge px-2.5 py-1 text-xs text-secondary hover:border-strong disabled:opacity-50"
              >
                {t.usersPage.bulkSetLimit}
              </button>
              <button
                disabled={bulkBusy}
                onClick={() => setBulkPanel((p) => (p === 'expire' ? null : 'expire'))}
                className="rounded-md border border-edge px-2.5 py-1 text-xs text-secondary hover:border-strong disabled:opacity-50"
              >
                {t.usersPage.bulkSetExpire}
              </button>
              <button
                disabled={bulkBusy}
                onClick={() => setBulkPanel((p) => (p === 'group' ? null : 'group'))}
                className="rounded-md border border-edge px-2.5 py-1 text-xs text-secondary hover:border-strong disabled:opacity-50"
              >
                {t.usersPage.groupsLabel}
              </button>
              <button
                disabled={bulkBusy}
                onClick={handleBulkDelete}
                className="rounded-md border border-danger px-2.5 py-1 text-xs text-danger hover:bg-danger-tint disabled:opacity-50"
              >
                {t.usersPage.bulkDeleteBtn}
              </button>
            </>
          )}

          {bulkPanel === 'limit' && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.5"
                value={bulkLimitGb}
                onChange={(e) => setBulkLimitGb(e.target.value)}
                placeholder={t.usersPage.gbSuffix}
                className="w-32 rounded-lg border border-edge bg-field px-3 py-1.5 text-sm text-primary outline-none focus:border-cyan-400/60"
              />
              <button
                disabled={bulkBusy}
                onClick={() =>
                  runBulkUpdate({ data_limit: bulkLimitGb ? Math.round(parseFloat(bulkLimitGb) * 1024 ** 3) : null })
                }
                className="text-xs font-bold"
                style={{ color: ACCENT }}
              >
                {t.usersPage.apply}
              </button>
              <button onClick={resetBulkPanel} className="text-xs text-faint">
                {t.usersPage.cancelAction}
              </button>
            </div>
          )}
          {bulkPanel === 'expire' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={bulkExpire}
                onChange={(e) => setBulkExpire(e.target.value)}
                className="rounded-lg border border-edge bg-field px-3 py-1.5 text-sm text-primary outline-none focus:border-cyan-400/60"
              />
              <button
                disabled={bulkBusy}
                onClick={() =>
                  runBulkUpdate({ expire: bulkExpire ? new Date(`${bulkExpire}T23:59:59`).toISOString() : null })
                }
                className="text-xs font-bold"
                style={{ color: ACCENT }}
              >
                {t.usersPage.apply}
              </button>
              <button onClick={resetBulkPanel} className="text-xs text-faint">
                {t.usersPage.cancelAction}
              </button>
            </div>
          )}
          {bulkPanel === 'group' && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={bulkGroupId ?? ''}
                onChange={(e) => setBulkGroupId(e.target.value ? Number(e.target.value) : null)}
                className="rounded-lg border border-edge bg-field px-3 py-1.5 text-sm text-primary outline-none focus:border-cyan-400/60"
              >
                <option value="">—</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <button
                disabled={bulkBusy || bulkGroupId == null}
                onClick={() => runBulkUpdate({ add_group_ids: bulkGroupId != null ? [bulkGroupId] : [] })}
                className="text-xs font-bold disabled:opacity-50"
                style={{ color: ACCENT }}
              >
                {t.usersPage.bulkAddGroup}
              </button>
              <button
                disabled={bulkBusy || bulkGroupId == null}
                onClick={() => runBulkUpdate({ remove_group_ids: bulkGroupId != null ? [bulkGroupId] : [] })}
                className="text-xs text-danger disabled:opacity-50"
              >
                {t.usersPage.bulkRemoveGroup}
              </button>
              <button onClick={resetBulkPanel} className="text-xs text-faint">
                {t.usersPage.cancelAction}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {users?.map((u) => (
          <div key={u.id} className="rounded-xl border border-subtle bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 font-bold text-primary">
                <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSelect(u.id)} />
                {u.username}
              </span>
              <button
                onClick={() => toggleStatus(u)}
                className={`rounded-full border px-2.5 py-1 text-[11px] ${statusStyles[u.status]}`}
              >
                {t.usersPage.status[u.status]}
              </button>
            </div>
            <div dir="ltr" className="mb-1 text-left text-xs text-muted">
              {formatUsed(u.used_traffic)} / {formatLimit(u.data_limit)}
              {u.data_limit_reset_days ? ` ↻${u.data_limit_reset_days}d` : ''}
              {u.speed_limit_mbps ? ` · ${u.speed_limit_mbps} Mbps` : ''}
            </div>
            <div className={`mb-3 text-xs text-faint ${align}`}>{formatLastSeen(u.last_seen)}</div>
            <div className="flex flex-wrap gap-3 border-t border-hair pt-3">
              <button onClick={() => setLinksUser(u)} className="text-xs hover:underline" style={{ color: ACCENT }}>
                {t.usersPage.linksBtn}
              </button>
              <button onClick={() => setDevicesUser(u)} className="text-xs text-muted hover:underline">
                {t.usersPage.devicesBtn}
                {u.hwid_limit ? ` (${u.hwid_limit})` : ''}
              </button>
              <button
                onClick={() => handleResetSecret(u)}
                disabled={resettingSecretId === u.id}
                className="text-xs text-muted hover:underline disabled:opacity-50"
              >
                {resettingSecretId === u.id ? t.common.saving : t.usersPage.resetSecretBtn}
              </button>
              <button onClick={() => startEdit(u)} className="text-xs text-muted hover:underline">
                {t.common.edit}
              </button>
              <button onClick={() => handleDelete(u)} className="text-xs text-danger hover:underline">
                {t.common.delete}
              </button>
            </div>
          </div>
        ))}
      </div>

      {linksUser && (
        <UserLinksModal userId={linksUser.id} username={linksUser.username} onClose={() => setLinksUser(null)} />
      )}
      {devicesUser && (
        <UserDevicesModal userId={devicesUser.id} username={devicesUser.username} onClose={() => setDevicesUser(null)} />
      )}
    </div>
  )
}
