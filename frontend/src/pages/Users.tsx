import { useEffect, useRef, useState, type FormEvent } from 'react'
import UserDevicesModal from '../components/UserDevicesModal'
import UserLinksModal from '../components/UserLinksModal'
import { IconCopy, IconPlus } from '../components/icons'
import QuotaMeter, { formatGb } from '../components/QuotaMeter'
import { CheckChips, CountUp, Empty, Field, Sheet, SlidingTabs, toggleInSet, useReducedMotion, useToast } from '../components/ui'
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
  getUserLinks,
  getAdminProfile,
  listGroups,
  listUserTemplates,
  listUsers,
  resetUserSecret,
  updateUser,
  type AdminProfile,
  type Group,
  type ProxyUser,
  type UserStatus,
  type UserTemplate,
} from '../lib/api'
import { copyToClipboard } from '../lib/clipboard'
import { avatarColor, initials, parseServerDate } from '../lib/format'

const STATUS_ORDER: UserStatus[] = ['active', 'limited', 'expired', 'on_hold', 'disabled']
const PILL: Record<UserStatus, string> = { active: 'ok', limited: 'warn', expired: 'bad', on_hold: 'idle', disabled: 'idle' }
const RING: Record<UserStatus, string> = {
  active: 'var(--accent)',
  limited: 'var(--warn)',
  expired: 'var(--bad)',
  on_hold: 'var(--accent)',
  disabled: 'var(--strong)',
}
const METER: Record<UserStatus, string> = {
  active: 'var(--ok)',
  limited: '#fb7a3c',
  expired: 'var(--bad)',
  on_hold: 'var(--strong)',
  disabled: '#2e2e2e',
}
const GB = 1024 ** 3
const DAY = 86400000

type Filter = UserStatus | 'all'

// "Online" within one traffic-sync cycle (30s server-side, see
// app/traffic/sync.py) rather than a live push — anything within 90s
// covers a slow/missed cycle without claiming a stale user is online.
function isOnline(u: ProxyUser): boolean {
  return !!u.last_seen && Date.now() - parseServerDate(u.last_seen).getTime() < 90000
}

function usagePct(u: ProxyUser): number {
  return u.data_limit ? Math.min(100, Math.round((u.used_traffic / u.data_limit) * 100)) : 0
}

function gb(bytes: number): string {
  const v = bytes / GB
  return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v < 0.05 ? '0' : v.toFixed(1)
}

// `search` comes from the search box in the dashboard header; typing there
// fills this page's own username filter.
export default function UsersPage({ search, createSignal = 0 }: { search?: string; createSignal?: number } = {}) {
  const { t, lang } = useLang()
  const u = t.ui.users
  const say = useToast()
  const [users, setUsers] = useState<ProxyUser[] | null>(null)
  const [allUsers, setAllUsers] = useState<ProxyUser[]>([])
  const [counts, setCounts] = useState<Record<Filter, number> | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  // A reseller works inside its allowance: no groups or templates, a protocol
  // pick per user instead, and its remaining quota on top of the page.
  const [me, setMe] = useState<AdminProfile | null>(null)
  const quota = me?.reseller ?? null
  const isReseller = !!me?.is_reseller
  const allowedProtocols = quota?.protocols.map((p) => p.protocol) ?? []
  const [protocols, setProtocols] = useState<Set<string>>(new Set())
  const rs = t.ui.resellers
  const protocolLabels = t.coresPage.protocolLabels as Record<string, string>
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
  const [formError, setFormError] = useState<string | null>(null)
  const [linksUser, setLinksUser] = useState<ProxyUser | null>(null)
  const [devicesUser, setDevicesUser] = useState<ProxyUser | null>(null)
  const [openUserId, setOpenUserId] = useState<number | null>(null)
  const [resettingSecretId, setResettingSecretId] = useState<number | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  useEffect(() => {
    if (search !== undefined) setSearchQuery(search)
  }, [search])
  const [statusFilter, setStatusFilter] = useState<Filter>('all')
  const [groupFilter, setGroupFilter] = useState<number | ''>('')

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
    const v = bytes / GB
    return `${v.toFixed(v >= 10 ? 0 : 1)} ${t.usersPage.gbSuffix}`
  }

  function formatLastSeen(iso: string | null): string {
    if (!iso) return t.usersPage.neverSeen
    const seconds = (Date.now() - parseServerDate(iso).getTime()) / 1000
    if (seconds < 90) return t.usersPage.onlineNow
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return t.usersPage.minutesAgo(minutes)
    const hours = Math.round(minutes / 60)
    if (hours < 24) return t.usersPage.hoursAgo(hours)
    return t.usersPage.daysAgo(Math.round(hours / 24))
  }

  function expiryText(x: ProxyUser): string {
    if (x.status === 'on_hold' && x.on_hold_expire_days) return u.startsOnFirst(x.on_hold_expire_days)
    if (!x.expire) return u.noExpiry
    const left = parseServerDate(x.expire).getTime() - Date.now()
    if (left <= 0) return u.expiredLabel
    return u.daysLeft(Math.ceil(left / DAY))
  }

  function formatDate(iso: string): string {
    return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' }).format(
      parseServerDate(iso),
    )
  }

  async function refresh() {
    try {
      const profile = await getAdminProfile().catch(() => null)
      const reseller = !!profile?.is_reseller
      const [usersRes, groupsRes, templatesRes, allRes, ...statusRes] = await Promise.all([
        listUsers({
          q: searchQuery || undefined,
          status: statusFilter === 'all' ? undefined : statusFilter,
          group_id: groupFilter === '' ? undefined : groupFilter,
          limit: 200,
        }),
        // An admin without the groups scope gets none rather than a failed page.
        reseller ? { groups: [] as Group[] } : listGroups().catch(() => ({ groups: [] as Group[] })),
        reseller ? { templates: [] as UserTemplate[] } : listUserTemplates().catch(() => ({ templates: [] as UserTemplate[] })),
        listUsers({ limit: 200 }),
        ...STATUS_ORDER.map((status) => listUsers({ status, limit: 1 })),
      ])
      setMe(profile)
      setUsers(usersRes.users)
      setGroups(groupsRes.groups)
      setTemplates(templatesRes.templates)
      setAllUsers(allRes.users)
      const next = { all: allRes.total } as Record<Filter, number>
      STATUS_ORDER.forEach((s, i) => (next[s] = statusRes[i].total))
      setCounts(next)
      setSelected((prev) => new Set([...prev].filter((id) => usersRes.users.some((x) => x.id === id))))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.usersPage.fetchError)
    }
  }

  useEffect(() => {
    // Debounce just the free-text query so every keystroke doesn't fire a
    // request — status/group filters are discrete picks, no debounce needed.
    const handle = setTimeout(() => {
      refresh()
    }, searchQuery ? 300 : 0)
    // Quietly re-read every 30s so online dots and usage bars stay current.
    const poll = window.setInterval(() => {
      if (!document.hidden) refresh()
    }, 30000)
    return () => {
      clearTimeout(handle)
      window.clearInterval(poll)
    }
  }, [searchQuery, statusFilter, groupFilter])

  useEffect(() => {
    if (createSignal > 0) {
      resetForm()
      setShowForm(true)
    }
  }, [createSignal])

  function daysFromNowIso(days: number): string {
    const dt = new Date()
    dt.setDate(dt.getDate() + days)
    return dt.toISOString().slice(0, 10)
  }

  function applyTemplateToSingle(templateId: number | null) {
    if (templateId == null) return
    const tpl = templates.find((tp) => tp.id === templateId)
    if (!tpl) return
    setDataLimitGb(tpl.data_limit ? String(tpl.data_limit / GB) : '')
    setExpire(tpl.expire_days != null ? daysFromNowIso(tpl.expire_days) : '')
    setNote(tpl.note ?? '')
    setGroupIds(new Set(tpl.group_ids))
  }

  function applyTemplateToBulkCreate(templateId: number | null) {
    if (templateId == null) return
    const tpl = templates.find((tp) => tp.id === templateId)
    if (!tpl) return
    setBulkCreateDataLimitGb(tpl.data_limit ? String(tpl.data_limit / GB) : '')
    setBulkCreateExpire(tpl.expire_days != null ? daysFromNowIso(tpl.expire_days) : '')
    setBulkCreateGroupIds(new Set(tpl.group_ids))
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
        data_limit: tplDataLimitGb ? Math.round(parseFloat(tplDataLimitGb) * GB) : null,
        expire_days: tplExpireDays ? parseInt(tplExpireDays, 10) : null,
        note: tplNote || null,
        group_ids: Array.from(tplGroupIds),
      })
      resetTplForm()
      await refresh()
      say(u.templateSaved)
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

  function resetForm() {
    setEditingId(null)
    setUsername('')
    setDataLimitGb('')
    setExpire('')
    setNote('')
    setGroupIds(new Set())
    setProtocols(new Set(allowedProtocols))
    setOnHold(false)
    setOnHoldDays('30')
    setHwidLimit('')
    setSpeedLimitMbps('')
    setDataLimitResetDays('')
    setFormError(null)
    setShowForm(false)
  }

  function startEdit(user: ProxyUser) {
    setEditingId(user.id)
    setUsername(user.username)
    setDataLimitGb(user.data_limit ? String(user.data_limit / GB) : '')
    setDataLimitResetDays(user.data_limit_reset_days ? String(user.data_limit_reset_days) : '')
    setExpire(user.expire ? user.expire.slice(0, 10) : '')
    setNote(user.note ?? '')
    setGroupIds(new Set(user.group_ids))
    setProtocols(new Set(user.protocols ?? allowedProtocols))
    setOnHold(false)
    setHwidLimit(user.hwid_limit ? String(user.hwid_limit) : '')
    setSpeedLimitMbps(user.speed_limit_mbps ? String(user.speed_limit_mbps) : '')
    setFormError(null)
    setOpenUserId(null)
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    const data_limit = dataLimitGb ? Math.round(parseFloat(dataLimitGb) * GB) : null
    const data_limit_reset_days = data_limit && dataLimitResetDays ? parseInt(dataLimitResetDays, 10) : null
    const expireIso = expire ? new Date(`${expire}T23:59:59`).toISOString() : null
    const group_ids = isReseller ? undefined : Array.from(groupIds)
    const protocolsPayload = isReseller ? Array.from(protocols) : undefined
    if (isReseller && protocols.size === 0) {
      setFormError(rs.pickProtocol)
      setSubmitting(false)
      return
    }
    const hwid_limit = hwidLimit ? parseInt(hwidLimit, 10) : null
    const speed_limit_mbps = speedLimitMbps ? parseInt(speedLimitMbps, 10) : null
    try {
      if (editingId) {
        await updateUser(editingId, { data_limit, data_limit_reset_days, expire: expireIso, hwid_limit, speed_limit_mbps, note: note || null, group_ids, protocols: protocolsPayload })
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
          protocols: protocolsPayload,
        })
      } else {
        await createUser({ username, data_limit, data_limit_reset_days, expire: expireIso, hwid_limit, speed_limit_mbps, note: note || null, group_ids, protocols: protocolsPayload })
      }
      const wasEdit = !!editingId
      resetForm()
      await refresh()
      say(wasEdit ? u.userSaved : u.userCreated(username))
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.common.genericError)
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
      say(u.linkReset)
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
      say(next === 'active' ? u.enabledToast : u.disabledToast)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  async function handleDelete(user: ProxyUser) {
    if (!window.confirm(t.usersPage.confirmDelete(user.username))) return
    try {
      await deleteUser(user.id)
      setOpenUserId(null)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  function toggleSelectAll() {
    if (!users) return
    setSelected((prev) => (prev.size === users.length ? new Set() : new Set(users.map((x) => x.id))))
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
      const res = await bulkUpdateUsers({ ...payload, user_ids: Array.from(selected) })
      resetBulkPanel()
      await refresh()
      say(u.bulkUpdated(res.updated))
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
    const data_limit = bulkCreateDataLimitGb ? Math.round(parseFloat(bulkCreateDataLimitGb) * GB) : null
    const expireIso = bulkCreateExpire ? new Date(`${bulkCreateExpire}T23:59:59`).toISOString() : null
    try {
      const res = await bulkCreateUsers({ usernames: bulkCreateUsernames, data_limit, expire: expireIso, group_ids: Array.from(bulkCreateGroupIds) })
      setBulkCreateMsg(t.usersPage.bulkCreateResult(res.created.length, res.skipped.length))
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setBulkCreateSubmitting(false)
    }
  }

  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? `#${id}`
  const newThisWeek = allUsers.filter((x) => Date.now() - parseServerDate(x.created_at).getTime() < 7 * DAY).length
  const top = [...allUsers].sort((a, b) => b.used_traffic - a.used_traffic).slice(0, 5)
  const topMax = top[0]?.used_traffic || 1
  const openUser = users?.find((x) => x.id === openUserId) ?? allUsers.find((x) => x.id === openUserId) ?? null
  const groupOptions = groups.map((g) => ({ id: g.id, label: g.name }))
  const onlineUsers = allUsers.filter(isOnline)
  const isNew = (x: ProxyUser) => Date.now() - parseServerDate(x.created_at).getTime() < 7 * DAY
  const daysLeft = (x: ProxyUser) => (x.expire ? (parseServerDate(x.expire).getTime() - Date.now()) / DAY : null)
  const endingSoon = allUsers
    .filter((x) => x.status === 'active' && (daysLeft(x) ?? 99) > 0 && (daysLeft(x) ?? 99) <= 7)
    .sort((a, b) => daysLeft(a)! - daysLeft(b)!)
    .slice(0, 5)
  // A users trend is only honest when every user is in the fetched list.
  const trend =
    counts && allUsers.length >= counts.all && counts.all > 0
      ? Array.from({ length: 14 }, (_, i) => {
          const end = Date.now() - (13 - i) * DAY
          return allUsers.filter((x) => parseServerDate(x.created_at).getTime() <= end).length
        })
      : null
  const share = (n: number) => (counts && counts.all ? Math.round((n / counts.all) * 100) : 0)
  const pickStatus = (s: UserStatus) => setStatusFilter((f) => (f === s ? 'all' : s))

  return (
    <div className="pg-users">
      <h1 className="sr-only">{t.usersPage.title}</h1>

      {quota && (
        <div className="rs-quota">
          <QuotaMeter
            label={rs.myQuotaUsers}
            used={quota.users_count}
            cap={quota.max_users}
            noLimit={rs.noLimit}
            full={rs.full}
            percent={rs.percentUsed}
            sub={
              quota.max_users == null
                ? rs.noLimit
                : quota.users_count >= quota.max_users
                  ? rs.usersFull
                  : rs.usersLeft(quota.max_users - quota.users_count)
            }
          />
          <QuotaMeter
            label={rs.myQuotaVolume}
            used={quota.data_allocated}
            cap={quota.data_quota}
            format={formatGb}
            unit=" GB"
            noLimit={rs.noLimit}
            full={rs.full}
            percent={rs.percentUsed}
            sub={
              quota.data_quota == null
                ? rs.unlimitedQuota(`${formatGb(quota.used_traffic)} GB`)
                : quota.data_allocated >= quota.data_quota
                  ? rs.volumeFull
                  : rs.volumeLeft(formatGb(quota.data_quota - quota.data_allocated), `${formatGb(quota.used_traffic)} GB`)
            }
          />
        </div>
      )}

      <div className="bento">
        <div className="tile hero">
          <div className="row">
            <span className="tl">{u.allUsers}</span>
            <span className={`pill ${onlineUsers.length > 0 ? 'ok live' : 'idle'}`}>
              <i />
              <span className="en">{onlineUsers.length}</span> {u.onlineWord}
            </span>
          </div>
          <div className="big">{counts ? <CountUp value={counts.all} /> : '—'}</div>
          {trend && <TrendLine values={trend} label={u.trendAria} />}
          <div className="row">
            <span className="tl">{u.newThisWeek(newThisWeek)}</span>
            {onlineUsers.length > 0 && (
              <span className="ostack" dir="ltr">
                {onlineUsers.slice(0, 6).map((x) => (
                  <span key={x.id} title={x.username} style={{ background: avatarColor(x.username) }}>
                    {initials(x.username)}
                  </span>
                ))}
                {onlineUsers.length > 6 && <span className="more">+{onlineUsers.length - 6}</span>}
              </span>
            )}
          </div>
        </div>
        {(
          [
            ['active', 'var(--ok)', counts ? u.shareOfAll(share(counts.active)) : ''],
            ['limited', '#fb7a3c', u.limitedHint],
            ['expired', 'var(--bad)', u.expiredHint],
          ] as [UserStatus, string, string][]
        ).map(([s, c, sub]) => (
          <button key={s} type="button" className="tile stat" style={{ ['--c' as string]: c }} aria-pressed={statusFilter === s} onClick={() => pickStatus(s)}>
            <span className="tl">{t.usersPage.status[s]}</span>
            <StatRing pct={counts ? share(counts[s]) : 0} of={u.ringOf(counts?.all ?? 0)} />
            <span className="v">{counts ? <CountUp value={counts[s]} /> : '—'}</span>
            <span className="s">{sub}</span>
          </button>
        ))}
        <div className="tile split">
          <div className="row">
            <span className="tl">{u.statusSplit}</span>
            <span className="tl en">{counts?.all ?? ''}</span>
          </div>
          {counts && counts.all > 0 ? (
            <>
              <div className="tf-meter grow-in" role="img" aria-label={STATUS_ORDER.map((s) => `${t.usersPage.status[s]} ${counts[s]}`).join('، ')}>
                {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
                  <i key={s} style={{ width: `${(counts[s] / counts.all) * 100}%`, background: METER[s] }} title={`${t.usersPage.status[s]}: ${counts[s]}`} />
                ))}
              </div>
              <div className="tf-legend">
                {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
                  <span key={s} style={{ ['--c' as string]: METER[s] }}>
                    {t.usersPage.status[s]} {counts[s]}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="tf-meter">
              <i style={{ width: '100%', background: 'var(--raised)' }} />
            </div>
          )}
        </div>
      </div>

      <div className="sub-head">
        <SlidingTabs
          label={u.filterLabel}
          value={statusFilter}
          onChange={setStatusFilter}
          items={[
            { id: 'all' as Filter, label: u.tabAll, count: counts?.all },
            ...STATUS_ORDER.map((s) => ({ id: s as Filter, label: t.usersPage.status[s], count: counts?.[s] })),
          ]}
        />
        <div className="toolbar">
          {!isReseller && (
            <button type="button" className="btn" onClick={() => setShowTemplates(true)}>
              {t.usersPage.templatesBtn}
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setShowBulkCreate(true)
              setBulkCreateMsg(null)
            }}
          >
            {t.usersPage.bulkCreateBtn}
          </button>
          <button
            type="button"
            className="btn solid"
            onClick={() => {
              resetForm()
              setShowForm(true)
            }}
          >
            <IconPlus size={14} />
            {t.usersPage.newBtn.replace(/^\+\s*/, '')}
          </button>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="input grow"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t.usersPage.searchPlaceholder}
          aria-label={t.usersPage.searchPlaceholder}
        />
        {!isReseller && (
        <select
          className="input"
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value ? Number(e.target.value) : '')}
          aria-label={t.usersPage.allGroups}
        >
          <option value="">{t.usersPage.allGroups}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        )}
      </div>

      {error && (
        <div className="tf-alert" role="alert">
          {error}
        </div>
      )}

      {selected.size > 0 && (
        <div className="bulkbar">
          <b style={{ fontSize: '.82rem' }}>{t.usersPage.selectedCount(selected.size)}</b>
          <button disabled={bulkBusy} onClick={() => runBulkUpdate({ status: 'active' })} className="btn">
            {t.usersPage.bulkActivate}
          </button>
          <button disabled={bulkBusy} onClick={() => runBulkUpdate({ status: 'disabled' })} className="btn">
            {t.usersPage.bulkDisable}
          </button>
          <button disabled={bulkBusy} onClick={() => setBulkPanel((p) => (p === 'limit' ? null : 'limit'))} className={`btn ${bulkPanel === 'limit' ? 'on' : ''}`}>
            {t.usersPage.bulkSetLimit}
          </button>
          <button disabled={bulkBusy} onClick={() => setBulkPanel((p) => (p === 'expire' ? null : 'expire'))} className={`btn ${bulkPanel === 'expire' ? 'on' : ''}`}>
            {t.usersPage.bulkSetExpire}
          </button>
          {!isReseller && (
            <button disabled={bulkBusy} onClick={() => setBulkPanel((p) => (p === 'group' ? null : 'group'))} className={`btn ${bulkPanel === 'group' ? 'on' : ''}`}>
              {t.usersPage.groupsLabel}
            </button>
          )}
          <button disabled={bulkBusy} onClick={handleBulkDelete} className="btn danger">
            {t.usersPage.bulkDeleteBtn}
          </button>
          <button onClick={() => setSelected(new Set())} className="btn">
            {t.usersPage.cancelAction}
          </button>

          {bulkPanel === 'limit' && (
            <span className="toolbar" style={{ flexBasis: '100%' }}>
              <input type="number" min="0" step="0.5" value={bulkLimitGb} onChange={(e) => setBulkLimitGb(e.target.value)} placeholder={t.usersPage.gbSuffix} className="input" />
              <button disabled={bulkBusy} onClick={() => runBulkUpdate({ data_limit: bulkLimitGb ? Math.round(parseFloat(bulkLimitGb) * GB) : null })} className="btn solid">
                {t.usersPage.apply}
              </button>
            </span>
          )}
          {bulkPanel === 'expire' && (
            <span className="toolbar" style={{ flexBasis: '100%' }}>
              <input type="date" value={bulkExpire} onChange={(e) => setBulkExpire(e.target.value)} className="input" />
              <button
                disabled={bulkBusy}
                onClick={() => runBulkUpdate({ expire: bulkExpire ? new Date(`${bulkExpire}T23:59:59`).toISOString() : null })}
                className="btn solid"
              >
                {t.usersPage.apply}
              </button>
            </span>
          )}
          {bulkPanel === 'group' && (
            <span className="toolbar" style={{ flexBasis: '100%' }}>
              <select value={bulkGroupId ?? ''} onChange={(e) => setBulkGroupId(e.target.value ? Number(e.target.value) : null)} className="input">
                <option value="">—</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <button disabled={bulkBusy || bulkGroupId == null} onClick={() => runBulkUpdate({ add_group_ids: bulkGroupId != null ? [bulkGroupId] : [] })} className="btn solid">
                {t.usersPage.bulkAddGroup}
              </button>
              <button
                disabled={bulkBusy || bulkGroupId == null}
                onClick={() => runBulkUpdate({ remove_group_ids: bulkGroupId != null ? [bulkGroupId] : [] })}
                className="btn danger"
              >
                {t.usersPage.bulkRemoveGroup}
              </button>
            </span>
          )}
        </div>
      )}

      <div className="main">
        <div className="min-w-0">
          {users === null ? (
            <div className="list" aria-hidden="true">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="srow" style={{ cursor: 'default' }}>
                  <span />
                  <span className="skel h-8 w-8 rounded-full" />
                  <span className="skel h-3 w-28" />
                  <span />
                  <span className="skel h-3 w-24" />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : users.length === 0 ? (
            <Empty
              title={t.usersPage.noUsersYet}
              text={u.emptyHint}
              action={
                <button
                  type="button"
                  className="btn solid"
                  onClick={() => {
                    resetForm()
                    setShowForm(true)
                  }}
                >
                  <IconPlus size={14} />
                  {t.usersPage.newBtn.replace(/^\+\s*/, '')}
                </button>
              }
            />
          ) : (
            <div className="list">
              <div className="srow head" style={{ cursor: 'default' }}>
                <input type="checkbox" checked={selected.size === users.length} onChange={toggleSelectAll} aria-label={t.usersPage.selectAll} />
                <span className="hint" style={{ margin: 0, gridColumn: '2 / -1' }}>
                  {t.usersPage.selectAll}
                </span>
              </div>
              {users.map((x, i) => {
                const on = isOnline(x)
                const pct = usagePct(x)
                const left = daysLeft(x)
                return (
                  <div
                    key={x.id}
                    className={`srow ${selected.has(x.id) ? 'sel' : ''}`}
                    style={{ ['--sc' as string]: STATUS_TONE[x.status], animationDelay: `${Math.min(i, 12) * 35}ms` }}
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenUserId(x.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setOpenUserId(x.id)
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(x.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => setSelected((prev) => toggleInSet(prev, x.id))}
                      aria-label={x.username}
                    />
                    <span className={`uav ${on ? 'on' : ''}`} style={{ background: avatarColor(x.username) }}>
                      {initials(x.username)}
                    </span>
                    <span className="who">
                      <span>
                        {x.username}
                        {isNew(x) && <em className="new">{u.newBadge}</em>}
                      </span>
                      <small className={on ? 'live' : ''}>{formatLastSeen(x.last_seen)}</small>
                    </span>
                    <span className={`pill ${PILL[x.status]} ${on ? 'live' : ''}`}>
                      <i />
                      {t.usersPage.status[x.status]}
                    </span>
                    <span className="meter-col">
                      <span className="top">
                        <span>{u.usage}</span>
                        <b dir="ltr">
                          {gb(x.used_traffic)} / {x.data_limit ? gb(x.data_limit) : '∞'} GB
                        </b>
                      </span>
                      <span className={`ubar ${x.data_limit ? '' : 'inf'}`}>
                        {x.data_limit ? <i style={{ width: `${Math.max(3, pct)}%`, background: usageFill(pct) }} /> : <i />}
                      </span>
                    </span>
                    <span className="meter-col">
                      <span className="top">
                        <span>{u.validity}</span>
                        <span>{expiryText(x)}</span>
                      </span>
                      <span className={`ubar ${left === null ? 'inf' : ''}`}>
                        {left === null ? <i /> : <i style={{ width: `${left <= 0 ? 100 : Math.max(3, Math.min(100, (left / 30) * 100))}%`, background: validityFill(left) }} />}
                      </span>
                    </span>
                  </div>
                )
              })}
              <div className="list-foot">{u.shownOf(users.length, counts?.all ?? users.length)}</div>
            </div>
          )}
        </div>

        <aside className="uside">
          <section className="board">
            <h3>
              {u.topUsage}
              <small>{u.topUsageSub}</small>
            </h3>
            {top.length === 0 || top[0].used_traffic === 0 ? (
              <div className="hint">{u.topEmpty}</div>
            ) : (
              <ol>
                {top.map((x, i) => (
                  <li key={x.id} title={`${x.username}: ${gb(x.used_traffic)} GB`} onClick={() => setOpenUserId(x.id)}>
                    <span className="rank">{i + 1}</span>
                    <span className="nm">{x.username}</span>
                    <span className="gb">{gb(x.used_traffic)} GB</span>
                    <span className="track">
                      <BoardBar pct={(x.used_traffic / topMax) * 100} />
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="board">
            <h3>
              {u.soonTitle}
              <small>{u.soonSub}</small>
            </h3>
            {endingSoon.length === 0 ? (
              <div className="hint">{u.soonEmpty}</div>
            ) : (
              <ul className="soon">
                {endingSoon.map((x) => (
                  <li key={x.id}>
                    <span className="uav sm" style={{ background: avatarColor(x.username) }}>
                      {initials(x.username)}
                    </span>
                    <b>{x.username}</b>
                    <span className={`left ${daysLeft(x)! <= 3 ? 'hot' : ''}`}>{expiryText(x)}</span>
                    <button type="button" onClick={() => startEdit(x)}>
                      {u.renew}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {openUser && (
        <UserSheet
          user={openUser}
          groupName={groupName}
          lastSeen={formatLastSeen(openUser.last_seen)}
          expiry={expiryText(openUser)}
          created={formatDate(openUser.created_at)}
          busyReset={resettingSecretId === openUser.id}
          onClose={() => setOpenUserId(null)}
          onLinks={() => setLinksUser(openUser)}
          onDevices={() => setDevicesUser(openUser)}
          onEdit={() => startEdit(openUser)}
          onReset={() => handleResetSecret(openUser)}
          onToggle={() => toggleStatus(openUser)}
          onDelete={() => handleDelete(openUser)}
        />
      )}

      {showForm && (
        <Sheet
          title={editingId ? u.formEdit(username) : u.formNew}
          sub={u.formSub}
          onClose={resetForm}
          width={520}
          footer={
            <>
              <button type="submit" form="user-form" disabled={submitting} className="btn primary lg">
                {submitting ? t.common.saving : editingId ? t.common.save : t.usersPage.createBtn}
              </button>
              <button type="button" className="btn lg" onClick={resetForm}>
                {t.usersPage.cancelAction}
              </button>
            </>
          }
        >
          <form id="user-form" onSubmit={handleSubmit} className="form-grid">
            {!editingId && templates.length > 0 && (
              <Field label={t.usersPage.applyTemplateLabel} wide>
                <select className="input" onChange={(e) => applyTemplateToSingle(e.target.value ? Number(e.target.value) : null)} defaultValue="">
                  <option value="">{t.usersPage.noTemplate}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={t.usersPage.username} wide>
              <input
                className="input ltr"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={editingId !== null}
                pattern="[a-zA-Z0-9_-]+"
                autoFocus={!editingId}
              />
            </Field>
            <Field
              label={t.usersPage.dataLimit}
              hint={quota?.data_quota != null ? rs.volumeLeftHint(formatGb(Math.max(0, quota.data_quota - quota.data_allocated))) : undefined}
            >
              <input
                className="input"
                value={dataLimitGb}
                onChange={(e) => setDataLimitGb(e.target.value)}
                type="number"
                min={quota?.data_quota != null ? '0.5' : '0'}
                step="0.5"
                required={quota?.data_quota != null}
              />
            </Field>
            {dataLimitGb && (
              <Field label={t.usersPage.dataLimitResetDaysLabel}>
                <input
                  className="input"
                  value={dataLimitResetDays}
                  onChange={(e) => setDataLimitResetDays(e.target.value)}
                  type="number"
                  min="1"
                  placeholder={t.usersPage.dataLimitResetDaysPlaceholder}
                />
              </Field>
            )}
            {!editingId && onHold ? (
              <Field label={t.usersPage.onHoldDaysLabel}>
                <input className="input" value={onHoldDays} onChange={(e) => setOnHoldDays(e.target.value)} type="number" min="0" />
              </Field>
            ) : (
              <Field label={t.usersPage.expire}>
                <input className="input" value={expire} onChange={(e) => setExpire(e.target.value)} type="date" />
              </Field>
            )}
            <Field label={t.usersPage.hwidLimitLabel}>
              <input className="input" value={hwidLimit} onChange={(e) => setHwidLimit(e.target.value)} type="number" min="0" />
            </Field>
            <Field label={t.usersPage.speedLimitLabel}>
              <input
                className="input"
                value={speedLimitMbps}
                onChange={(e) => setSpeedLimitMbps(e.target.value)}
                type="number"
                min="1"
                placeholder={t.usersPage.speedLimitPlaceholder}
              />
            </Field>
            <Field label={t.usersPage.note} wide>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {!editingId && (
              <div className="wide">
                <label className="tf-switch">
                  <input type="checkbox" checked={onHold} onChange={(e) => setOnHold(e.target.checked)} />
                  {t.usersPage.onHoldToggleLabel}
                </label>
              </div>
            )}
            {isReseller ? (
              <Field label={rs.protocolLabel} wide>
                <CheckChips
                  options={(quota?.protocols ?? []).map((p) => ({ id: p.protocol, label: `${protocolLabels[p.protocol] ?? p.protocol} · ${p.hosts.join(', ')}` }))}
                  selected={protocols}
                  onToggle={(id) => setProtocols((s) => toggleInSet(s, id))}
                  empty={rs.noProtocols}
                />
              </Field>
            ) : (
              <Field label={t.usersPage.groupsLabel} wide>
                <CheckChips options={groupOptions} selected={groupIds} onToggle={(id) => setGroupIds((s) => toggleInSet(s, id))} empty={t.usersPage.noGroups} />
              </Field>
            )}
            {formError && (
              <div className="wide tf-alert" role="alert">
                {formError}
              </div>
            )}
          </form>
        </Sheet>
      )}

      {showBulkCreate && (
        <Sheet
          title={t.usersPage.bulkCreateTitle}
          sub={u.bulkSub}
          onClose={() => setShowBulkCreate(false)}
          width={520}
          footer={
            <button type="submit" form="bulk-form" disabled={bulkCreateSubmitting || bulkCreateUsernames.length === 0} className="btn primary lg">
              {t.usersPage.bulkCreateSubmit(bulkCreateUsernames.length)}
            </button>
          }
        >
          <form id="bulk-form" onSubmit={handleBulkCreateSubmit} className="form-grid">
            {templates.length > 0 && (
              <Field label={t.usersPage.applyTemplateLabel} wide>
                <select className="input" onChange={(e) => applyTemplateToBulkCreate(e.target.value ? Number(e.target.value) : null)} defaultValue="">
                  <option value="">{t.usersPage.noTemplate}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={t.usersPage.prefixLabel}>
              <input className="input ltr" value={bulkPrefix} onChange={(e) => setBulkPrefix(e.target.value)} />
            </Field>
            <Field label={t.usersPage.countLabel}>
              <input className="input" value={bulkCount} onChange={(e) => setBulkCount(e.target.value)} type="number" min="1" max="500" />
            </Field>
            <Field label={t.usersPage.startAtLabel}>
              <input className="input" value={bulkStartAt} onChange={(e) => setBulkStartAt(e.target.value)} type="number" min="1" />
            </Field>
            <Field label={t.usersPage.dataLimit}>
              <input className="input" value={bulkCreateDataLimitGb} onChange={(e) => setBulkCreateDataLimitGb(e.target.value)} type="number" min="0" step="0.5" />
            </Field>
            <Field label={t.usersPage.expire} wide>
              <input className="input" value={bulkCreateExpire} onChange={(e) => setBulkCreateExpire(e.target.value)} type="date" />
            </Field>
            {!isReseller && (
              <Field label={t.usersPage.groupsLabel} wide>
                <CheckChips
                  options={groupOptions}
                  selected={bulkCreateGroupIds}
                  onToggle={(id) => setBulkCreateGroupIds((s) => toggleInSet(s, id))}
                  empty={t.usersPage.noGroups}
                />
              </Field>
            )}
            {bulkCreateUsernames.length > 0 && (
              <div className="wide tf-linkrow">
                <span className="mono">
                  {t.usersPage.previewLabel}: {bulkCreateUsernames.slice(0, 8).join(', ')}
                  {bulkCreateUsernames.length > 8 && ` … (+${bulkCreateUsernames.length - 8})`}
                </span>
              </div>
            )}
            {bulkCreateMsg && <div className="wide ok-text">{bulkCreateMsg}</div>}
            {error && <div className="wide err-text">{error}</div>}
          </form>
        </Sheet>
      )}

      {showTemplates && (
        <Sheet title={t.usersPage.templatesTitle} sub={t.usersPage.templatesDesc} onClose={() => setShowTemplates(false)} width={520}>
          {templates.length === 0 ? (
            <div className="hint">{t.usersPage.noTemplatesYet}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {templates.map((tpl) => (
                <div key={tpl.id} className="tpl-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <b style={{ fontSize: '.86rem' }}>{tpl.name}</b>
                    <span className="chip">{formatLimit(tpl.data_limit)}</span>
                    <span className="chip">{tpl.expire_days != null ? u.daysLeft(tpl.expire_days) : t.usersPage.unlimited}</span>
                    {tpl.group_ids.map((id) => (
                      <span key={id} className="chip">
                        {groupName(id)}
                      </span>
                    ))}
                  </div>
                  <button onClick={() => handleDeleteTemplate(tpl)} className="btn danger">
                    {t.common.delete}
                  </button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleCreateTemplate} className="form-section">
            <h4>{t.usersPage.saveTemplateBtn}</h4>
            <div className="form-grid">
              <Field label={t.usersPage.templateNameLabel} wide>
                <input className="input" value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder={t.usersPage.templateNamePlaceholder} required />
              </Field>
              <Field label={t.usersPage.dataLimit}>
                <input className="input" value={tplDataLimitGb} onChange={(e) => setTplDataLimitGb(e.target.value)} type="number" min="0" step="0.5" />
              </Field>
              <Field label={t.usersPage.expireDaysLabel}>
                <input className="input" value={tplExpireDays} onChange={(e) => setTplExpireDays(e.target.value)} type="number" min="0" />
              </Field>
              <Field label={t.usersPage.note} wide>
                <input className="input" value={tplNote} onChange={(e) => setTplNote(e.target.value)} />
              </Field>
              <Field label={t.usersPage.groupsLabel} wide>
                <CheckChips options={groupOptions} selected={tplGroupIds} onToggle={(id) => setTplGroupIds((s) => toggleInSet(s, id))} empty={t.usersPage.noGroups} />
              </Field>
            </div>
            <div>
              <button type="submit" disabled={tplSubmitting} className="btn solid">
                {t.usersPage.saveTemplateBtn}
              </button>
            </div>
          </form>
        </Sheet>
      )}

      {linksUser && <UserLinksModal userId={linksUser.id} username={linksUser.username} onClose={() => setLinksUser(null)} />}
      {devicesUser && <UserDevicesModal userId={devicesUser.id} username={devicesUser.username} onClose={() => setDevicesUser(null)} />}
    </div>
  )
}

const STATUS_TONE: Record<UserStatus, string> = {
  active: 'var(--ok)',
  limited: 'var(--warn)',
  expired: 'var(--bad)',
  on_hold: 'var(--info)',
  disabled: 'var(--strong)',
}

// Green while there's room, orange past 70%, red past 90%.
function usageFill(pct: number): string {
  if (pct >= 90) return 'linear-gradient(90deg, #f59e0b, #ef4444)'
  if (pct >= 70) return 'linear-gradient(90deg, #f97316, #f59e0b)'
  return 'linear-gradient(90deg, #22c55e, #84cc16)'
}

// Calm blue with a month or more left, warming as the end gets close.
function validityFill(days: number): string {
  if (days <= 0) return '#ef4444'
  if (days <= 3) return 'linear-gradient(90deg, #ef4444, #f97316)'
  if (days <= 7) return 'linear-gradient(90deg, #f97316, #fb923c)'
  return 'linear-gradient(90deg, #38bdf8, #a78bfa)'
}

function StatRing({ pct, of }: { pct: number; of: string }) {
  const C = 2 * Math.PI * 40
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(pct))
    return () => cancelAnimationFrame(id)
  }, [pct])
  // A few users still get a visible sliver, so a small share never reads as an empty ring.
  const arc = pct > 0 ? Math.max((C * shown) / 100, shown > 0 ? 4 : 0) : 0
  return (
    <span className="stat-ring" aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <circle className="tick" cx={50} cy={50} r={47} />
        <circle className="tr" cx={50} cy={50} r={40} />
        <circle className="fg" cx={50} cy={50} r={40} strokeDasharray={`${arc.toFixed(1)} ${C.toFixed(1)}`} />
      </svg>
      <span className="mid">
        <b>{Math.round(pct)}%</b>
        <small>{of}</small>
      </span>
    </span>
  )
}

// Users over the last 14 days, with a highlight that keeps running along the line.
function TrendLine({ values, label }: { values: number[]; label: string }) {
  const min = Math.min(...values)
  const span = Math.max(...values) - min
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 296 + 2).toFixed(1)},${(span ? 58 - ((v - min) / span) * 48 : 34).toFixed(1)}`)
  const d = `M${pts.join(' L')}`
  return (
    <svg className="trend" viewBox="0 0 300 64" preserveAspectRatio="none" role="img" aria-label={`${label}: ${values[values.length - 1]}`}>
      <defs>
        <linearGradient id="users-trend" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f97316" stopOpacity={0.35} />
          <stop offset="1" stopColor="#f97316" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${d} L298,64 L2,64 Z`} fill="url(#users-trend)" />
      <path d={d} fill="none" stroke="#f97316" strokeOpacity={0.6} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <path className="run" d={d} pathLength={100} fill="none" stroke="#fdba74" strokeWidth={3} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function BoardBar({ pct }: { pct: number }) {
  // Grow from zero after mount so the bars sweep in.
  const [w, setW] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(pct))
    return () => cancelAnimationFrame(id)
  }, [pct])
  return <i style={{ width: `${w}%` }} />
}

const VAULT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function UserSheet({
  user,
  groupName,
  lastSeen,
  expiry,
  created,
  busyReset,
  onClose,
  onLinks,
  onDevices,
  onEdit,
  onReset,
  onToggle,
  onDelete,
}: {
  user: ProxyUser
  groupName: (id: number) => string
  lastSeen: string
  expiry: string
  created: string
  busyReset: boolean
  onClose: () => void
  onLinks: () => void
  onDevices: () => void
  onEdit: () => void
  onReset: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const { t } = useLang()
  const u = t.ui.users
  const say = useToast()
  const reduce = useReducedMotion()
  const [appCode, setAppCode] = useState<string | null>(null)
  const [subUrl, setSubUrl] = useState<string | null>(null)
  const [chars, setChars] = useState('')
  const lastScramble = useRef(0)
  const vault = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setAppCode(null)
    setSubUrl(null)
    getUserLinks(user.id)
      .then((l) => {
        setAppCode(l.app_code)
        setSubUrl(l.subscription_url)
      })
      .catch(() => undefined)
  }, [user.id, user.secret])

  function scramble() {
    let s = ''
    for (let i = 0; i < 1200; i++) s += VAULT_CHARS[(Math.random() * VAULT_CHARS.length) | 0]
    setChars(s)
  }

  function onVaultMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = vault.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--x', `${e.clientX - r.left}px`)
    el.style.setProperty('--y', `${e.clientY - r.top}px`)
    const now = performance.now()
    if (!reduce && now - lastScramble.current > 60) {
      scramble()
      lastScramble.current = now
    }
  }

  async function copy(text: string | null, msg: string) {
    if (text && (await copyToClipboard(text))) say(msg)
  }

  const pct = usagePct(user)
  const on = isOnline(user)

  return (
    <Sheet
      className="tf-user-sheet"
      title={<bdi className="font-en">{user.username}</bdi>}
      sub={lastSeen}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onLinks}>
            {t.usersPage.linksBtn}
          </button>
          <button className="btn" onClick={onDevices}>
            {t.usersPage.devicesBtn}
            {user.hwid_limit ? ` (${user.hwid_limit})` : ''}
          </button>
          <button className="btn" onClick={onEdit}>
            {t.common.edit}
          </button>
          <button className="btn" onClick={onReset} disabled={busyReset}>
            {busyReset ? t.common.saving : t.usersPage.resetSecretBtn}
          </button>
          <button className="btn" onClick={onToggle}>
            {user.status === 'active' ? u.disable : u.enable}
          </button>
          <button className="btn danger" onClick={onDelete}>
            {t.common.delete}
          </button>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <span className={`tf-avatar ${on ? 'on' : ''}`}>{initials(user.username)}</span>
        <span className={`pill ${PILL[user.status]} ${on ? 'live' : ''}`}>
          <i />
          {t.usersPage.status[user.status]}
        </span>
      </div>
      <div className="d-usage">
        <span className="gauge-r" style={{ ['--p' as string]: pct, ['--gc' as string]: RING[user.status] }}>
          <b>{user.data_limit ? `${pct}%` : '∞'}</b>
        </span>
        <div className="txt">
          <span>{u.usage}</span>
          <b>
            {gb(user.used_traffic)} / {user.data_limit ? gb(user.data_limit) : '∞'} GB
          </b>
          <span>{expiry}</span>
        </div>
      </div>
      <div className="tf-facts">
        <div>
          <span>{u.devicesLimit}</span>
          <b>{user.hwid_limit ?? t.usersPage.unlimited}</b>
        </div>
        <div>
          <span>{u.speed}</span>
          <b>{user.speed_limit_mbps ? `${user.speed_limit_mbps} Mbps` : u.none}</b>
        </div>
        <div>
          <span>{u.created}</span>
          <b>{created}</b>
        </div>
        <div>
          <span>{t.usersPage.groupsLabel}</span>
          <b>{user.group_ids.length ? user.group_ids.map(groupName).join('، ') : u.noGroup}</b>
        </div>
        {user.data_limit_reset_days ? (
          <div>
            <span>{u.resetLabel}</span>
            <b>{u.resetEvery(user.data_limit_reset_days)}</b>
          </div>
        ) : null}
        {user.note ? (
          <div>
            <span>{t.usersPage.note}</span>
            <b title={user.note}>{user.note}</b>
          </div>
        ) : null}
      </div>

      <div
        ref={vault}
        className="tf-vault"
        role="button"
        tabIndex={0}
        aria-label={u.appCode}
        onPointerEnter={scramble}
        onPointerMove={onVaultMove}
        onClick={() => copy(appCode, u.appCodeCopied)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            copy(appCode, u.appCodeCopied)
          }
        }}
      >
        <div className="chars" aria-hidden="true">
          {chars}
        </div>
        <div className="core">
          <span className="orb">
            <b>{appCode ?? '••••••'}</b>
          </span>
          <span>{u.appCodeHint}</span>
        </div>
      </div>

      {subUrl && (
        <div className="tf-linkrow">
          <span className="mono">{subUrl}</span>
          <button className="btn" onClick={() => copy(subUrl, u.subCopied)}>
            <IconCopy size={13} />
            {t.copy}
          </button>
        </div>
      )}
    </Sheet>
  )
}
