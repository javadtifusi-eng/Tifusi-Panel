import { useEffect, useState, type FormEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createGroup,
  deleteGroup,
  listCores,
  listGroups,
  listHosts,
  listUsers,
  updateGroup,
  type Core,
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
  const { t } = useLang()
  const protocolLabels = t.coresPage.protocolLabels
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [hosts, setHosts] = useState<Host[]>([])
  const [cores, setCores] = useState<Core[]>([])
  const [users, setUsers] = useState<ProxyUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [submitting, setSubmitting] = useState(false)

  async function refresh() {
    try {
      const [groupsRes, hostsRes, usersRes, coresRes] = await Promise.all([
        listGroups(),
        listHosts(),
        listUsers(),
        listCores(),
      ])
      setGroups(groupsRes.groups)
      setHosts(hostsRes.hosts)
      setUsers(usersRes.users)
      setCores(coresRes.cores)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.groupsPage.fetchError)
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

  function toggleCoreHosts(coreHosts: Host[]) {
    setForm((f) => {
      const allSelected = coreHosts.every((h) => f.hostIds.has(h.id))
      const next = new Set(f.hostIds)
      for (const h of coreHosts) {
        if (allSelected) next.delete(h.id)
        else next.add(h.id)
      }
      return { ...f, hostIds: next }
    })
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
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(group: Group) {
    if (!window.confirm(t.groupsPage.confirmDelete(group.name))) return
    try {
      await deleteGroup(group.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  const hostsByCore = cores.map((core) => ({
    core,
    hosts: hosts.filter((h) => h.core_id === core.id),
  }))
  const orphanHosts = hosts.filter((h) => !cores.some((c) => c.id === h.core_id))

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-50">{t.groupsPage.title}</h1>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
        >
          {t.groupsPage.newBtn}
        </button>
      </div>
      <p className="mb-6 text-sm text-slate-400">{t.groupsPage.intro}</p>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={labelClass}>{t.groupsPage.nameLabel}</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t.groupsPage.noteLabel}</label>
              <input
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                className={`${inputClass} w-56`}
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className={labelClass}>{t.groupsPage.hostsInGroup}</div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2">
                {hosts.length === 0 && <div className="px-2 py-1 text-xs text-slate-500">{t.groupsPage.noHosts}</div>}
                {hostsByCore.map(({ core, hosts: coreHosts }) => {
                  if (coreHosts.length === 0) return null
                  const allSelected = coreHosts.every((h) => form.hostIds.has(h.id))
                  return (
                    <div key={core.id} className="mb-2 last:mb-0">
                      <div className="flex items-center justify-between px-2 py-1">
                        <span className="text-xs font-bold text-slate-300">
                          {core.name} <span className="text-slate-500">· {protocolLabels[core.protocol]}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleCoreHosts(coreHosts)}
                          className="text-[11px] hover:underline"
                          style={{ color: ACCENT }}
                        >
                          {allSelected ? t.groupsPage.deselectAllInCore : t.groupsPage.selectAllInCore}
                        </button>
                      </div>
                      {coreHosts.map((h) => (
                        <label
                          key={h.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/5"
                        >
                          <input
                            type="checkbox"
                            checked={form.hostIds.has(h.id)}
                            onChange={() => setForm((f) => ({ ...f, hostIds: toggle(f.hostIds, h.id) }))}
                          />
                          <span className="text-slate-200">{h.remark}</span>
                        </label>
                      ))}
                    </div>
                  )
                })}
                {orphanHosts.map((h) => (
                  <label key={h.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={form.hostIds.has(h.id)}
                      onChange={() => setForm((f) => ({ ...f, hostIds: toggle(f.hostIds, h.id) }))}
                    />
                    <span className="text-slate-200">{h.remark}</span>
                    <span className="text-xs text-slate-500">({protocolLabels[h.protocol]})</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className={labelClass}>{t.groupsPage.usersInGroup}</div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2">
                {users.length === 0 && <div className="px-2 py-1 text-xs text-slate-500">{t.groupsPage.noUsers}</div>}
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
            {editingId ? t.common.save : t.groupsPage.createGroupBtn}
          </button>
        </form>
      )}

      {!showForm && error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      {groups === null && <div className="py-8 text-center text-slate-500">{t.loading}</div>}
      {groups !== null && groups.length === 0 && (
        <div className="rounded-xl border border-white/10 py-8 text-center text-slate-500">
          {t.groupsPage.noGroupsYet}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups?.map((g) => (
          <div key={g.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
            <div className="mb-2 font-bold text-slate-100">{g.name}</div>
            <div className="mb-3 text-xs text-slate-400">{g.note ?? '—'}</div>
            <div className="mb-3 flex gap-4 text-xs text-slate-400">
              <span>
                {t.groupsPage.colHosts}: <span className="text-slate-200">{g.host_ids.length}</span>
              </span>
              <span>
                {t.groupsPage.colUsers}: <span className="text-slate-200">{g.user_ids.length}</span>
              </span>
            </div>
            <div className="flex gap-3 border-t border-white/5 pt-3">
              <button onClick={() => startEdit(g)} className="text-xs text-slate-400 hover:underline">
                {t.common.edit}
              </button>
              <button onClick={() => handleDelete(g)} className="text-xs text-red-400 hover:underline">
                {t.common.delete}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
