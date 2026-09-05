import { useEffect, useState, type FormEvent } from 'react'
import UserLinksModal from '../components/UserLinksModal'
import {
  ApiError,
  createUser,
  deleteUser,
  listUsers,
  updateUser,
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

const statusLabels: Record<UserStatus, string> = {
  active: 'فعال',
  disabled: 'غیرفعال',
  expired: 'منقضی',
  limited: 'محدود شده',
}

function formatLimit(bytes: number | null): string {
  if (!bytes) return 'نامحدود'
  const gb = bytes / 1024 ** 3
  return `${gb.toFixed(gb >= 10 ? 0 : 1)} گیگ`
}

function formatUsed(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb < 0.1) return '۰ گیگ'
  return `${gb.toFixed(1)} گیگ`
}

export default function UsersPage() {
  const [users, setUsers] = useState<ProxyUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [username, setUsername] = useState('')
  const [dataLimitGb, setDataLimitGb] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [linksUser, setLinksUser] = useState<ProxyUser | null>(null)

  async function refresh() {
    try {
      const res = await listUsers()
      setUsers(res.users)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در دریافت لیست کاربران')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const data_limit = dataLimitGb ? Math.round(parseFloat(dataLimitGb) * 1024 ** 3) : null
      await createUser({ username, data_limit })
      setUsername('')
      setDataLimitGb('')
      setShowForm(false)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'مشکلی پیش اومد')
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
      setError(err instanceof ApiError ? err.message : 'مشکلی پیش اومد')
    }
  }

  async function handleDelete(user: ProxyUser) {
    if (!window.confirm(`کاربر «${user.username}» حذف بشه؟`)) return
    try {
      await deleteUser(user.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'مشکلی پیش اومد')
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-50">کاربران</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
        >
          + کاربر جدید
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4"
        >
          <div>
            <label className="mb-1.5 block text-xs text-slate-400">نام کاربری</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              pattern="[a-zA-Z0-9_-]+"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-slate-400">حجم به گیگابایت (خالی = نامحدود)</label>
            <input
              value={dataLimitGb}
              onChange={(e) => setDataLimitGb(e.target.value)}
              type="number"
              min="0"
              step="0.5"
              className="w-44 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60"
            style={{ backgroundColor: ACCENT }}
          >
            ساخت
          </button>
        </form>
      )}

      {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-right text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs text-slate-400">
              <th className="px-4 py-3 font-medium">نام کاربری</th>
              <th className="px-4 py-3 font-medium">وضعیت</th>
              <th className="px-4 py-3 font-medium">ترافیک</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {users === null && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  در حال بارگذاری…
                </td>
              </tr>
            )}
            {users !== null && users.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  هنوز کاربری ساخته نشده
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
                    {statusLabels[u.status]}
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
                    لینک‌ها
                  </button>
                  <button onClick={() => handleDelete(u)} className="text-xs text-red-400 hover:underline">
                    حذف
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
