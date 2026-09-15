import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { IconPlus } from '../components/icons'
import { CheckChips, Empty, Field, Sheet, toggleInSet, useToast } from '../components/ui'
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
  type Inbound,
  type ProxyUser,
} from '../lib/api'
import { initials } from '../lib/format'

function emptyForm() {
  return { name: '', note: '', inboundIds: new Set<number>(), hostIds: new Set<number>(), userIds: new Set<number>() }
}

// An access item is either a whole Inbound (VLESS/VMess/Trojan/Shadowsocks) or a
// standalone host (L2TP/IKEv2/Hysteria2) — the two things a group can grant.
interface Item {
  key: string
  kind: 'inbound' | 'host'
  id: number
  tag: string
  proto: string
}

type Focus = { type: 'group' | 'user'; id: number } | null

const MAP_USERS = 8
const MAP_ITEMS = 10

export default function GroupsPage({ createSignal = 0 }: { createSignal?: number } = {}) {
  const { t, dir } = useLang()
  const g = t.ui.groups
  const say = useToast()
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
  const [formError, setFormError] = useState<string | null>(null)
  const [userQuery, setUserQuery] = useState('')
  const [focus, setFocus] = useState<Focus>(null)
  const [pickedUser, setPickedUser] = useState<number | null>(null)
  const [busyCell, setBusyCell] = useState<string | null>(null)

  async function refresh() {
    try {
      const [groupsRes, hostsRes, usersRes, coresRes] = await Promise.all([listGroups(), listHosts(), listUsers({ limit: 200 }), listCores()])
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

  useEffect(() => {
    if (createSignal > 0) openNew()
  }, [createSignal])

  function openNew() {
    setEditingId(null)
    setForm(emptyForm())
    setFormError(null)
    setUserQuery('')
    setShowForm(true)
  }

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
      inboundIds: new Set(group.inbound_ids),
      hostIds: new Set(group.host_ids),
      userIds: new Set(group.user_ids),
    })
    setFormError(null)
    setUserQuery('')
    setShowForm(true)
  }

  function toggleCoreInbounds(coreInbounds: Inbound[]) {
    setForm((f) => {
      const allSelected = coreInbounds.every((i) => f.inboundIds.has(i.id))
      const next = new Set(f.inboundIds)
      for (const i of coreInbounds) {
        if (allSelected) next.delete(i.id)
        else next.add(i.id)
      }
      return { ...f, inboundIds: next }
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    const payload = {
      name: form.name,
      note: form.note || null,
      inbound_ids: Array.from(form.inboundIds),
      host_ids: Array.from(form.hostIds),
      user_ids: Array.from(form.userIds),
    }
    try {
      if (editingId) await updateGroup(editingId, payload)
      else await createGroup(payload)
      const wasEdit = !!editingId
      resetForm()
      await refresh()
      say(wasEdit ? g.saved : g.created)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(group: Group) {
    if (!window.confirm(t.groupsPage.confirmDelete(group.name))) return
    try {
      await deleteGroup(group.id)
      if (focus?.type === 'group' && focus.id === group.id) setFocus(null)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  // xray-protocol hosts are gated through their Inbound's groups, so only
  // standalone (l2tp/ikev2/hysteria2) hosts get a direct Group<->Host checklist.
  const standaloneHosts = hosts.filter((h) => h.inbound_id == null)
  const items: Item[] = [
    ...cores.flatMap((c) => c.inbounds.map((i) => ({ key: `i${i.id}`, kind: 'inbound' as const, id: i.id, tag: i.tag, proto: i.protocol }))),
    ...standaloneHosts.map((h) => ({ key: `h${h.id}`, kind: 'host' as const, id: h.id, tag: h.remark, proto: h.protocol })),
  ]
  const list = groups ?? []
  const grantsOf = (it: Item) => list.filter((gr) => (it.kind === 'inbound' ? gr.inbound_ids : gr.host_ids).includes(it.id))
  const userGets = (u: ProxyUser, it: Item) => {
    const granting = grantsOf(it)
    return granting.length === 0 || granting.some((gr) => u.group_ids.includes(gr.id))
  }
  const protoName = (p: string) => protocolLabels[p as keyof typeof protocolLabels] ?? p
  const kindLabel = (it: Item) => (it.kind === 'inbound' ? g.kindInbound(protoName(it.proto)) : g.kindHost(protoName(it.proto)))
  const userName = (id: number) => users.find((u) => u.id === id)?.username ?? `#${id}`

  async function toggleCell(it: Item, group: Group) {
    const key = `${it.key}-${group.id}`
    setBusyCell(key)
    const field = it.kind === 'inbound' ? 'inbound_ids' : 'host_ids'
    const current = new Set(group[field])
    const on = !current.has(it.id)
    if (on) current.add(it.id)
    else current.delete(it.id)
    try {
      await updateGroup(group.id, { [field]: Array.from(current) })
      await refresh()
      say(on ? g.toastOn(it.tag, group.name) : g.toastOff(it.tag, group.name))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setBusyCell(null)
    }
  }

  // ── Access map columns (capped so a big panel stays readable).
  const groupedUsers = users.filter((u) => u.group_ids.length > 0)
  let mapUsers = groupedUsers.slice(0, MAP_USERS)
  if (focus?.type === 'user' && !mapUsers.some((u) => u.id === focus.id)) {
    const fu = users.find((u) => u.id === focus.id)
    if (fu) mapUsers = [...mapUsers.slice(0, MAP_USERS - 1), fu]
  }
  const mapItems = items.slice(0, MAP_ITEMS)

  const focusedUser = focus?.type === 'user' ? users.find((u) => u.id === focus.id) : undefined
  const hotUsers = new Set<number>()
  const hotGroups = new Set<number>()
  const hotItems = new Set<string>()
  if (focus?.type === 'group') {
    hotGroups.add(focus.id)
    users.filter((u) => u.group_ids.includes(focus.id)).forEach((u) => hotUsers.add(u.id))
    items.filter((it) => grantsOf(it).some((gr) => gr.id === focus.id) || grantsOf(it).length === 0).forEach((it) => hotItems.add(it.key))
  } else if (focusedUser) {
    hotUsers.add(focusedUser.id)
    focusedUser.group_ids.forEach((id) => hotGroups.add(id))
    items.filter((it) => userGets(focusedUser, it)).forEach((it) => hotItems.add(it.key))
  }
  const nodeState = (on: boolean) => (focus ? (on ? 'hot' : 'dim') : '')

  const graphRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const groupsColRef = useRef<HTMLDivElement>(null)
  const [paths, setPaths] = useState<{ d: string; cls: string }[]>([])

  useLayoutEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    function draw() {
      if (!graph || graph.offsetParent === null) return
      const box = graph.getBoundingClientRect()
      svgRef.current?.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`)
      const rect = (id: string) => graph.querySelector<HTMLElement>(`[data-node="${id}"]`)?.getBoundingClientRect()
      // Reading order decides which edge of a node a line leaves from.
      const curve = (a: DOMRect, b: DOMRect) => {
        const x1 = (dir === 'rtl' ? a.left : a.right) - box.left
        const x2 = (dir === 'rtl' ? b.right : b.left) - box.left
        const y1 = a.top + a.height / 2 - box.top
        const y2 = b.top + b.height / 2 - box.top
        const mx = (x1 + x2) / 2
        return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`
      }
      const out: { d: string; cls: string }[] = []
      for (const u of mapUsers)
        for (const gid of u.group_ids) {
          const a = rect(`u${u.id}`)
          const b = rect(`g${gid}`)
          if (!a || !b) continue
          const hot = focus?.type === 'group' ? gid === focus.id : focusedUser ? u.id === focusedUser.id : false
          out.push({ d: curve(a, b), cls: focus ? (hot ? 'hot' : 'dim') : '' })
        }
      const gcol = groupsColRef.current?.getBoundingClientRect()
      for (const it of mapItems) {
        const b = rect(it.key)
        if (!b) continue
        const granting = grantsOf(it)
        if (granting.length === 0) {
          if (gcol) out.push({ d: curve(gcol, b), cls: `global ${focus && hotItems.has(it.key) ? 'hot' : ''}` })
          continue
        }
        for (const gr of granting) {
          const a = rect(`g${gr.id}`)
          if (!a) continue
          const hot = focus?.type === 'group' ? gr.id === focus.id : focusedUser ? focusedUser.group_ids.includes(gr.id) : false
          out.push({ d: curve(a, b), cls: focus ? (hot ? 'hot' : 'dim') : '' })
        }
      }
      setPaths(out)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(graph)
    return () => ro.disconnect()
    // Redraw whenever the data, the focus or the reading direction changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, users, cores, hosts, focus, dir])

  const lookupUser = users.find((u) => u.id === pickedUser) ?? null
  const globalItems = items.filter((it) => grantsOf(it).length === 0)
  const filteredUsers = users.filter((u) => !userQuery.trim() || u.username.toLowerCase().includes(userQuery.trim().toLowerCase()))

  return (
    <div className="pg-groups">
      <h1 className="sr-only">{t.groupsPage.title}</h1>
      <div className="rule-banner">
        <span>{g.ruleLead}</span>
        <span>
          <b>{g.ruleBold}</b>
          {g.ruleTail}
        </span>
      </div>

      {error && <div className="tf-alert">{error}</div>}

      {groups === null ? (
        <div className="groups" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel" style={{ height: 120, borderRadius: 18 }} />
          ))}
        </div>
      ) : (
        <div className="groups">
          {groups.map((gr) => {
            const members = users.filter((u) => gr.user_ids.includes(u.id) || u.group_ids.includes(gr.id))
            const memberCount = Math.max(gr.user_ids.length, members.length)
            const pressed = focus?.type === 'group' && focus.id === gr.id
            return (
              <div
                key={gr.id}
                className="gcard"
                role="button"
                tabIndex={0}
                aria-pressed={pressed}
                onClick={() => setFocus(pressed ? null : { type: 'group', id: gr.id })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setFocus(pressed ? null : { type: 'group', id: gr.id })
                }}
              >
                <span className="gp-top">
                  <span className="g-mark">{initials(gr.name).slice(0, 3)}</span>
                  <span className="t">
                    <b>{gr.name}</b>
                    <small>{gr.note || '—'}</small>
                  </span>
                  <span className="gp-stack">
                    {members.slice(0, 3).map((u) => (
                      <span key={u.id}>{initials(u.username)}</span>
                    ))}
                    {memberCount > 3 && <span>+{memberCount - 3}</span>}
                  </span>
                </span>
                <span className="g-stats">
                  <span className="chip">{g.members(memberCount)}</span>
                  <span className="chip">{g.grants(gr.inbound_ids.length + gr.host_ids.length)}</span>
                </span>
                <span className="g-acts">
                  <button
                    type="button"
                    className="btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      startEdit(gr)
                    }}
                  >
                    {t.common.edit}
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(gr)
                    }}
                  >
                    {t.common.delete}
                  </button>
                </span>
              </div>
            )
          })}
          <div className="gcard global">
            <span className="gp-top">
              <span className="g-mark">∗</span>
              <span className="t">
                <b>{g.noGroup}</b>
                <small>{g.forEveryone}</small>
              </span>
            </span>
            <span className="g-stats">
              {globalItems.length ? (
                globalItems.slice(0, 6).map((it) => (
                  <span key={it.key} className="chip en">
                    {it.tag}
                  </span>
                ))
              ) : (
                <span className="chip">{g.noGlobal}</span>
              )}
              {globalItems.length > 6 && <span className="chip">+{globalItems.length - 6}</span>}
            </span>
          </div>
          <button type="button" className="gcard add" onClick={openNew}>
            <IconPlus size={16} />
            {t.groupsPage.newBtn.replace(/^\+\s*/, '')}
          </button>
        </div>
      )}

      {groups !== null && groups.length === 0 && items.length === 0 ? (
        <Empty title={t.groupsPage.noGroupsYet} text={t.groupsPage.intro} />
      ) : (
        groups !== null && (
          <>
            <div className="tf-card pad">
              <div className="tf-card-head">
                <h3>{g.mapTitle}</h3>
                <small>
                  {focus?.type === 'group'
                    ? g.mapFocusGroup(list.find((x) => x.id === focus.id)?.name ?? '')
                    : focusedUser
                      ? g.mapFocusUser(focusedUser.username)
                      : g.mapHint}
                </small>
              </div>
              <div className="graph" ref={graphRef}>
                <svg ref={svgRef} aria-hidden="true">
                  {paths.map((p, i) => (
                    <path key={i} className={`g-line ${p.cls}`} d={p.d} />
                  ))}
                </svg>
                <div className="gcol">
                  <span className="gcol-title">{g.colUsers}</span>
                  {mapUsers.length === 0 && <span className="gp-more">{g.noGroupedUsers}</span>}
                  {mapUsers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      data-node={`u${u.id}`}
                      className={`gp-node ${nodeState(hotUsers.has(u.id))}`}
                      onClick={() => {
                        const same = focus?.type === 'user' && focus.id === u.id
                        setFocus(same ? null : { type: 'user', id: u.id })
                        setPickedUser(u.id)
                      }}
                    >
                      <span className="av">{initials(u.username)}</span>
                      <span className="nm">{u.username}</span>
                      <span className="kind">{u.group_ids.map((id) => list.find((x) => x.id === id)?.name ?? '').join('، ')}</span>
                    </button>
                  ))}
                  {groupedUsers.length > mapUsers.length && <span className="gp-more">{g.more(groupedUsers.length - mapUsers.length)}</span>}
                </div>
                <div className="gcol" ref={groupsColRef}>
                  <span className="gcol-title">{g.colGroups}</span>
                  {list.map((gr) => (
                    <button
                      key={gr.id}
                      type="button"
                      data-node={`g${gr.id}`}
                      className={`gp-node ${nodeState(hotGroups.has(gr.id))}`}
                      onClick={() => setFocus(focus?.type === 'group' && focus.id === gr.id ? null : { type: 'group', id: gr.id })}
                    >
                      <span className="sq">{initials(gr.name).slice(0, 2)}</span>
                      <span className="nm">{gr.name}</span>
                      <span className="kind">{g.members(users.filter((u) => u.group_ids.includes(gr.id)).length)}</span>
                    </button>
                  ))}
                </div>
                <div className="gcol">
                  <span className="gcol-title">{g.colItems}</span>
                  {mapItems.length === 0 && <span className="gp-more">{g.noItems}</span>}
                  {mapItems.map((it) => {
                    const global = grantsOf(it).length === 0
                    return (
                      <div key={it.key} data-node={it.key} className={`gp-node ${nodeState(hotItems.has(it.key))}`} style={{ cursor: 'default' }}>
                        <span className="sq">{it.tag.slice(0, 2).toUpperCase()}</span>
                        <span className="nm">{it.tag}</span>
                        <span className={`kind ${global ? 'all' : ''}`}>{global ? g.forEveryone : kindLabel(it)}</span>
                      </div>
                    )
                  })}
                  {items.length > mapItems.length && <span className="gp-more">{g.more(items.length - mapItems.length)}</span>}
                </div>
              </div>
              <p className="note">{g.globalNote}</p>
            </div>

            <div className="two">
              <div className="tf-card pad">
                <div className="tf-card-head">
                  <h3>{g.matrixTitle}</h3>
                  <small>{g.matrixHint}</small>
                </div>
                {items.length === 0 || list.length === 0 ? (
                  <div className="hint">{items.length === 0 ? g.noItems : t.groupsPage.noGroupsYet}</div>
                ) : (
                  <div className="matrix-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>{g.matrixItem}</th>
                          {list.map((gr) => (
                            <th key={gr.id}>{gr.name}</th>
                          ))}
                          <th>{g.matrixWho}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it) => {
                          const granting = grantsOf(it)
                          const count = users.filter((u) => userGets(u, it)).length
                          return (
                            <tr key={it.key}>
                              <td>
                                <span className="item">
                                  <b>{it.tag}</b>
                                  <small>{kindLabel(it)}</small>
                                </span>
                              </td>
                              {list.map((gr) => {
                                const on = granting.some((x) => x.id === gr.id)
                                const key = `${it.key}-${gr.id}`
                                return (
                                  <td key={gr.id}>
                                    <button
                                      type="button"
                                      className="cell"
                                      aria-pressed={on}
                                      aria-label={`${it.tag} · ${gr.name}`}
                                      disabled={busyCell !== null}
                                      onClick={() => toggleCell(it, gr)}
                                    >
                                      {busyCell === key ? '…' : on ? '✓' : '—'}
                                    </button>
                                  </td>
                                )
                              })}
                              <td>{granting.length ? <span className="who-some">{g.whoSome(count)}</span> : <span className="who-all">{g.whoAll(count)}</span>}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="note">{g.matrixNote}</p>
              </div>

              <div className="tf-card pad lookup">
                <div className="tf-card-head">
                  <h3>{g.lookupTitle}</h3>
                </div>
                <select className="input" value={pickedUser ?? ''} onChange={(e) => setPickedUser(e.target.value ? Number(e.target.value) : null)} aria-label={g.pickUser}>
                  <option value="">{g.pickUser}</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username}
                    </option>
                  ))}
                </select>
                {lookupUser && (
                  <ul className="sees">
                    {items.length === 0 && <li className="off">{g.noItems}</li>}
                    {items.map((it) => {
                      const granting = grantsOf(it)
                      const gets = userGets(lookupUser, it)
                      const why =
                        granting.length === 0
                          ? g.whyGlobal
                          : gets
                            ? g.whyFrom(granting.filter((x) => lookupUser.group_ids.includes(x.id)).map((x) => x.name).join('، '))
                            : g.whyOnly(granting.map((x) => x.name).join('، '))
                      return (
                        <li key={it.key} className={gets ? '' : 'off'}>
                          <span className={gets ? 'yes' : 'no'}>{gets ? '✓' : '✕'}</span>
                          <b>{it.tag}</b>
                          <small>{why}</small>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </>
        )
      )}

      {showForm && (
        <Sheet
          title={editingId ? g.formEdit(form.name) : g.formNew}
          sub={t.groupsPage.intro}
          onClose={resetForm}
          width={560}
          footer={
            <>
              <button type="submit" form="group-form" disabled={submitting} className="btn primary lg">
                {submitting ? t.common.saving : editingId ? t.common.save : t.groupsPage.createGroupBtn}
              </button>
              <button type="button" className="btn lg" onClick={resetForm}>
                {t.usersPage.cancelAction}
              </button>
            </>
          }
        >
          <form id="group-form" onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <div className="form-grid">
              <Field label={t.groupsPage.nameLabel}>
                <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required autoFocus />
              </Field>
              <Field label={t.groupsPage.noteLabel}>
                <input className="input" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
              </Field>
            </div>

            <div className="form-section">
              <h4>{t.groupsPage.inboundsInGroup}</h4>
              {cores.every((c) => c.inbounds.length === 0) && <div className="hint">{t.groupsPage.noInboundsInList}</div>}
              {cores.map((core) => {
                if (core.inbounds.length === 0) return null
                const allSelected = core.inbounds.every((i) => form.inboundIds.has(i.id))
                return (
                  <div key={core.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="chip">{core.name}</span>
                      <button type="button" onClick={() => toggleCoreInbounds(core.inbounds)} className="btn">
                        {allSelected ? t.groupsPage.deselectAllInCore : t.groupsPage.selectAllInCore}
                      </button>
                    </div>
                    <CheckChips
                      options={core.inbounds.map((i) => ({ id: i.id, label: <span className="en">{`${i.tag} · ${protoName(i.protocol)}`}</span> }))}
                      selected={form.inboundIds}
                      onToggle={(id) => setForm((f) => ({ ...f, inboundIds: toggleInSet(f.inboundIds, id) }))}
                    />
                  </div>
                )
              })}
            </div>

            <div className="form-section">
              <h4>{t.groupsPage.hostsInGroup}</h4>
              <CheckChips
                options={standaloneHosts.map((h) => ({ id: h.id, label: `${h.remark} · ${protocolLabels[h.protocol]}` }))}
                selected={form.hostIds}
                onToggle={(id) => setForm((f) => ({ ...f, hostIds: toggleInSet(f.hostIds, id) }))}
                empty={t.groupsPage.noHosts}
              />
            </div>

            <div className="form-section">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 style={{ margin: 0 }}>{t.groupsPage.usersInGroup}</h4>
                <span className="chip">{g.members(form.userIds.size)}</span>
              </div>
              <input className="input" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder={g.searchUsers} aria-label={g.searchUsers} />
              <CheckChips
                options={filteredUsers.map((u) => ({ id: u.id, label: <span className="en">{u.username}</span> }))}
                selected={form.userIds}
                onToggle={(id) => setForm((f) => ({ ...f, userIds: toggleInSet(f.userIds, id) }))}
                empty={t.groupsPage.noUsers}
              />
              {form.userIds.size > 0 && (
                <div className="hint" style={{ margin: 0 }}>
                  {Array.from(form.userIds).slice(0, 12).map(userName).join('، ')}
                  {form.userIds.size > 12 ? ' …' : ''}
                </div>
              )}
            </div>

            {formError && <div className="tf-alert">{formError}</div>}
          </form>
        </Sheet>
      )}
    </div>
  )
}
