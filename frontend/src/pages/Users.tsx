import { useEffect, useState, type FormEvent } from 'react'
import UserLinksModal from '../components/UserLinksModal'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  bulkCreateUsers,
  bulkDeleteUsers,
  bulkUpdateUsers,
  createUser,
  deleteUser,
  listGroups,
  listUsers,
  updateUser,
  type Group,
  type ProxyUser,
  type UserStatus,
} from '../lib/api'

const ACCENT = '#22D3EE'

const statusStyles: Record<UserStatus, string> = {
  active: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/30',
  disabled: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  expired: 'bg-red-400/10 text-red-300 border-red-400/30',
  limited: 'bg-amber-400/10 text-amber-300 border-amber-400/30',
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
  const [expire, setExpire] = useState('')
  const [note, setNote] = useState('')
  const [groupIds, setGroupIds] = useState<Set<number>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [linksUser, setLinksUser] = useState<ProxyUser | null>(null)

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

  async function refresh() {
    try {
      const [usersRes, groupsRes] = await Promise.all([listUsers(), listGroups()])
      setUsers(usersRes.users)
      setGroups(groupsRes.groups)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.usersPage.fetchError)
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
    setShowForm(false)
  }

  function startEdit(user: ProxyUser) {
    setEditingId(user.id)
    setUsername(user.username)
    setDataLimitGb(user.data_limit ? String(user.data_limit / 1024 ** 3) : '')
    setExpire(user.expire ? user.expire.slice(0, 10) : '')
    setNote(user.note ?? '')
    setGroupIds(new Set(user.group_ids))
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
    const expireIso = expire ? new Date(`${expire}T23:59:59`).toISOString() : null
    const group_ids = Array.from(groupIds)
    try {
      if (editingId) {
        await updateUser(editingId, { data_limit, expire: expireIso, note: note || null, group_ids })
      } else {
        await createUser({ username, data_limit, expire: expireIso, note: note || null, group_ids })
      }
      resetForm()
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSubmitting(false)
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
        <h1 className="text-xl font-bold text-slate-50">{t.usersPage.title}</h1>
        <div className="flex items-center gap-2">
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

      {showBulkCreate && (
        <form
          onSubmit={handleBulkCreateSubmit}
          className="mb-6 flex flex-col gap-3 rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4"
        >
          <div className="text-sm font-bold text-slate-200">{t.usersPage.bulkCreateTitle}</div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={`mb-1.5 block text-xs text-slate-400 ${align}`}>{t.usersPage.prefixLabel}</label>
              <input
                value={bulkPrefix}
                onChange={(e) => setBulkPrefix(e.target.value)}
                dir="ltr"
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
              />
            </div>
            <div>
              <label className={`mb-1.5 block text-xs text-slate-400 ${align}`}>{t.usersPage.countLabel}</label>
              <input
                value={bulkCount}
                onChange={(e) => setBulkCount(e.target.value)}
                type="number"
                min="1"
                max="500"
                className="w-24 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
              />
            </div>
            <div>
              <label className={`mb-1.5 block text-xs text-slate-400 ${align}`}>{t.usersPage.startAtLabel}</label>
              <input
                value={bulkStartAt}
                onChange={(e) => setBulkStartAt(e.target.value)}
                type="number"
                min="1"
                className="w-24 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
              />
            </div>
            <div>
              <label className={`mb-1.5 block text-xs text-slate-400 ${align}`}>{t.usersPage.dataLimit}</label>
              <input
                value={bulkCreateDataLimitGb}
                onChange={(e) => setBulkCreateDataLimitGb(e.target.value)}
                type="number"
                min="0"
                step="0.5"
                className="w-44 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
              />
            </div>
            <div>
              <label className={`mb-1.5 block text-xs text-slate-400 ${align}`}>{t.usersPage.expire}</label>
              <input
                value={bulkCreateExpire}
                onChange={(e) => setBulkCreateExpire(e.target.value)}
                type="date"
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
              />
            </div>
          </div>
          <div>
            <label className={`mb-1.5 block text-xs text-slate-400 ${align}`}>{t.usersPage.groupsLabel}</label>
            <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2">
              {groups.length === 0 && <div className="px-1 py-1 text-xs text-slate-500">{t.usersPage.noGroups}</div>}
              {groups.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={bulkCreateGroupIds.has(g.id)}
                    onChange={() => toggleBulkCreateGroup(g.id)}
                  />
                  <span className="text-slate-200">{g.name}</span>
                </label>
              ))}
            </div>
          </div>
          {bulkCreateUsernames.length > 0 && (
            <div dir="ltr" className="rounded-lg border border-white/10 bg-black/20 p-2 text-left font-mono text-[11px] text-slate-400">
              {t.usersPage.previewLabel}: {bulkCreateUsernames.slice(0, 8).join(', ')}
              {bulkCreateUsernames.length > 8 && ` … (+${bulkCreateUsernames.length - 8})`}
            </div>
          )}
          {bulkCreateMsg && <div className="text-xs text-emerald-300">{bulkCreateMsg}</div>}
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
          className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4"
        >
          <div>
            <label className={`mb-1.5 block text-xs text-slate-400 ${align}`}>{t.usersPage.username}</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={editingId !== null}
              pattern="[a-zA-Z0-9_-]+"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 disabled:opacity-50"
            />
          </div>
          <div>
            <label className={`mb-1.5 block text-xs text-slate-400 ${align}`}>{t.usersPage.dataLimit}</label>
            <input
              value={dataLimitGb}
              onChange={(e) => setDataLimitGb(e.target.value)}
              type="number"
              min="0"
              step="0.5"
              className="w-44 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
            />
          </div>
          <div>
            <label className={`mb-1.5 block text-xs text-slate-400 ${align}`}>{t.usersPage.expire}</label>
            <input
              value={expire}
              onChange={(e) => setExpire(e.target.value)}
              type="date"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
            />
          </div>
          <div>
            <label className={`mb-1.5 block text-xs text-slate-400 ${align}`}>{t.usersPage.note}</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-48 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
            />
          </div>
          <div className="w-full">
            <label className={`mb-1.5 block text-xs text-slate-400 ${align}`}>{t.usersPage.groupsLabel}</label>
            <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2">
              {groups.length === 0 && <div className="px-1 py-1 text-xs text-slate-500">{t.usersPage.noGroups}</div>}
              {groups.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={groupIds.has(g.id)} onChange={() => toggleGroup(g.id)} />
                  <span className="text-slate-200">{g.name}</span>
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

      {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      {users === null && <div className="py-8 text-center text-slate-500">{t.loading}</div>}
      {users !== null && users.length === 0 && (
        <div className="rounded-xl border border-white/10 py-8 text-center text-slate-500">
          {t.usersPage.noUsersYet}
        </div>
      )}

      {users !== null && users.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-300">
            <input type="checkbox" checked={selected.size === users.length} onChange={toggleSelectAll} />
            {t.usersPage.selectAll}
          </label>
          {selected.size > 0 && (
            <>
              <span className="text-xs text-slate-400">{t.usersPage.selectedCount(selected.size)}</span>
              <button
                disabled={bulkBusy}
                onClick={() => runBulkUpdate({ status: 'active' })}
                className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-white/30 disabled:opacity-50"
              >
                {t.usersPage.bulkActivate}
              </button>
              <button
                disabled={bulkBusy}
                onClick={() => runBulkUpdate({ status: 'disabled' })}
                className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-white/30 disabled:opacity-50"
              >
                {t.usersPage.bulkDisable}
              </button>
              <button
                disabled={bulkBusy}
                onClick={() => setBulkPanel((p) => (p === 'limit' ? null : 'limit'))}
                className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-white/30 disabled:opacity-50"
              >
                {t.usersPage.bulkSetLimit}
              </button>
              <button
                disabled={bulkBusy}
                onClick={() => setBulkPanel((p) => (p === 'expire' ? null : 'expire'))}
                className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-white/30 disabled:opacity-50"
              >
                {t.usersPage.bulkSetExpire}
              </button>
              <button
                disabled={bulkBusy}
                onClick={() => setBulkPanel((p) => (p === 'group' ? null : 'group'))}
                className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-white/30 disabled:opacity-50"
              >
                {t.usersPage.groupsLabel}
              </button>
              <button
                disabled={bulkBusy}
                onClick={handleBulkDelete}
                className="rounded-md border border-red-400/30 px-2.5 py-1 text-xs text-red-400 hover:bg-red-400/10 disabled:opacity-50"
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
                className="w-32 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
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
              <button onClick={resetBulkPanel} className="text-xs text-slate-500">
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
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
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
              <button onClick={resetBulkPanel} className="text-xs text-slate-500">
                {t.usersPage.cancelAction}
              </button>
            </div>
          )}
          {bulkPanel === 'group' && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={bulkGroupId ?? ''}
                onChange={(e) => setBulkGroupId(e.target.value ? Number(e.target.value) : null)}
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
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
                className="text-xs text-red-400 disabled:opacity-50"
              >
                {t.usersPage.bulkRemoveGroup}
              </button>
              <button onClick={resetBulkPanel} className="text-xs text-slate-500">
                {t.usersPage.cancelAction}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {users?.map((u) => (
          <div key={u.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 font-bold text-slate-100">
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
            <div dir="ltr" className="mb-3 text-left text-xs text-slate-400">
              {formatUsed(u.used_traffic)} / {formatLimit(u.data_limit)}
            </div>
            <div className="flex gap-3 border-t border-white/5 pt-3">
              <button onClick={() => setLinksUser(u)} className="text-xs hover:underline" style={{ color: ACCENT }}>
                {t.usersPage.linksBtn}
              </button>
              <button onClick={() => startEdit(u)} className="text-xs text-slate-400 hover:underline">
                {t.common.edit}
              </button>
              <button onClick={() => handleDelete(u)} className="text-xs text-red-400 hover:underline">
                {t.common.delete}
              </button>
            </div>
          </div>
        ))}
      </div>

      {linksUser && (
        <UserLinksModal userId={linksUser.id} username={linksUser.username} onClose={() => setLinksUser(null)} />
      )}
    </div>
  )
}
