import { useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  createGroup,
  deleteGroup,
  listGroups,
  listHosts,
  listUsers,
  updateGroup,
  type Group,
  type Host,
  type ProxyUser,
} from '../lib/api'

const ACCENT = '#22D3EE'

const inputClass =
  'rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60'
const labelClass = 'mb-1.5 block text-xs text-slate-400'

function emptyForm() {
  return { name: '', note: '', hostIds: new Set<number>(), userIds: new Set<number>() }
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [hosts, setHosts] = useState<Host[]>([])
  const [users, setUsers] = useState<ProxyUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [submitting, setSubmitting] = useState(false)

  async function refresh() {
    try {
      const [groupsRes, hostsRes, usersRes] = await Promise.all([listGroups(), listHosts(), listUsers()])
      setGroups(groupsRes.groups)
      setHosts(hostsRes.hosts)
      setUsers(usersRes.users)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در دریافت اطلاعات')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(false)
  }

  function startEdit(group: Group) {
    setEditingId(group.id)
    setForm({
      name: group.name,
      note: group.note ?? '',
      hostIds: new Set(group.host_ids),
      userIds: new Set(group.user_ids),
    })
    setShowForm(true)
  }

  function toggle(set: Set<number>, id: number): Set<number> {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const payload = {
      name: form.name,
      note: form.note || null,
      host_ids: Array.from(form.hostIds),
      user_ids: Array.from(form.userIds),
    }
    try {
      if (editingId) await updateGroup(editingId, payload)
      else await createGroup(payload)
      resetForm()
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'مشکلی پیش اومد')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(group: Group) {
    if (!window.confirm(`گروه «${group.name}» حذف بشه؟`)) return
    try {
      await deleteGroup(group.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'مشکلی پیش اومد')
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-50">گروه‌ها</h1>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
        >
          + گروه جدید
        </button>
      </div>
      <p className="mb-6 text-sm text-slate-400">
        هاستی که تو هیچ گروهی نباشه برای همه‌ی کاربرها آزاده. وقتی یه هاست رو وارد یه گروه کنی، فقط
        کاربرهای همون گروه بهش دسترسی دارن — هم تو لینک‌هاشون، هم واقعاً رو کانفیگی که به نود فرستاده می‌شه.
      </p>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={labelClass}>نام گروه</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>یادداشت</label>
              <input
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                className={`${inputClass} w-56`}
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className={labelClass}>هاست‌های این گروه</div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2">
                {hosts.length === 0 && <div className="px-2 py-1 text-xs text-slate-500">هاستی وجود نداره</div>}
                {hosts.map((h) => (
                  <label key={h.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={form.hostIds.has(h.id)}
                      onChange={() => setForm((f) => ({ ...f, hostIds: toggle(f.hostIds, h.id) }))}
                    />
                    <span className="text-slate-200">{h.remark}</span>
                    <span className="text-xs text-slate-500">({h.protocol})</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className={labelClass}>کاربرهای این گروه</div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2">
                {users.length === 0 && <div className="px-2 py-1 text-xs text-slate-500">کاربری وجود نداره</div>}
                {users.map((u) => (
                  <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={form.userIds.has(u.id)}
                      onChange={() => setForm((f) => ({ ...f, userIds: toggle(f.userIds, u.id) }))}
                    />
                    <span className="text-slate-200">{u.username}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {error && <div className="mt-3 text-xs text-red-400">{error}</div>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-4 rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60"
            style={{ backgroundColor: ACCENT }}
          >
            {editingId ? 'ذخیره تغییرات' : 'ساخت گروه'}
          </button>
        </form>
      )}

      {!showForm && error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-right text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs text-slate-400">
              <th className="px-4 py-3 font-medium">نام</th>
              <th className="px-4 py-3 font-medium">یادداشت</th>
              <th className="px-4 py-3 font-medium">هاست‌ها</th>
              <th className="px-4 py-3 font-medium">کاربرها</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {groups === null && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  در حال بارگذاری…
                </td>
              </tr>
            )}
            {groups !== null && groups.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  هنوز گروهی ساخته نشده
                </td>
              </tr>
            )}
            {groups?.map((g) => (
              <tr key={g.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-slate-100">{g.name}</td>
                <td className="px-4 py-3 text-slate-400">{g.note ?? '—'}</td>
                <td className="px-4 py-3 text-slate-400">{g.host_ids.length}</td>
                <td className="px-4 py-3 text-slate-400">{g.user_ids.length}</td>
                <td className="px-4 py-3 text-left">
                  <button onClick={() => startEdit(g)} className="ml-3 text-xs text-slate-400 hover:underline">
                    ویرایش
                  </button>
                  <button onClick={() => handleDelete(g)} className="text-xs text-red-400 hover:underline">
                    حذف
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
