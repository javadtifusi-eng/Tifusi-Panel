import { useEffect, useState, type FormEvent } from 'react'
import UserLinksModal from '../components/UserLinksModal'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-50">{t.usersPage.title}</h1>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
        >
          {t.usersPage.newBtn}
        </button>
      </div>

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

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className={`w-full text-sm ${align}`}>
          <thead>
            <tr className="border-b border-white/10 text-xs text-slate-400">
              <th className="px-4 py-3 font-medium">{t.usersPage.colUsername}</th>
              <th className="px-4 py-3 font-medium">{t.usersPage.colStatus}</th>
              <th className="px-4 py-3 font-medium">{t.usersPage.colTraffic}</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {users === null && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  {t.loading}
                </td>
              </tr>
            )}
            {users !== null && users.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  {t.usersPage.noUsersYet}
                </td>
              </tr>
            )}
            {users?.map((u) => (
              <tr key={u.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-slate-100">{u.username}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleStatus(u)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${statusStyles[u.status]}`}
                  >
                    {t.usersPage.status[u.status]}
                  </button>
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {formatUsed(u.used_traffic)} / {formatLimit(u.data_limit)}
                </td>
                <td className="px-4 py-3 text-left">
                  <button
                    onClick={() => setLinksUser(u)}
                    className="ml-3 text-xs hover:underline"
                    style={{ color: ACCENT }}
                  >
                    {t.usersPage.linksBtn}
                  </button>
                  <button onClick={() => startEdit(u)} className="ml-3 text-xs text-slate-400 hover:underline">
                    {t.common.edit}
                  </button>
                  <button onClick={() => handleDelete(u)} className="text-xs text-red-400 hover:underline">
                    {t.common.delete}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {linksUser && (
        <UserLinksModal userId={linksUser.id} username={linksUser.username} onClose={() => setLinksUser(null)} />
      )}
    </div>
  )
}
