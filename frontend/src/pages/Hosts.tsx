import { useEffect, useState, type FormEvent } from 'react'
import { IconPlus } from '../components/icons'
import { CountUp, Empty, Field, Sheet, useReducedMotion, useToast } from '../components/ui'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createHost,
  deleteHost,
  FINGERPRINTS,
  listCores,
  listGroups,
  listHosts,
  listNodes,
  updateHost,
  type Core,
  type Group,
  type Host,
  type HostProtocol,
  type HostSecurity,
  type Inbound,
  type Node,
} from '../lib/api'
import { copyToClipboard } from '../lib/clipboard'

const PROTOCOLS: HostProtocol[] = ['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2', 'ikev2', 'l2tp']
const XRAY_PROTOCOLS: HostProtocol[] = ['vless', 'vmess', 'trojan', 'shadowsocks']
const PLACEHOLDER_KEYS = ['username', 'protocol', 'days_left', 'expire_date', 'data_limit_gb', 'data_left_gb'] as const

// Where each protocol sits around the hub, in percent of .c-orbit — a box inset from the stage
// by more than half a node's size, so nodes on its very edge (0 / 100) still show whole.
const NODE_POS: Record<HostProtocol, [number, number]> = {
  vless: [14, 14],
  vmess: [50, 0],
  trojan: [86, 14],
  shadowsocks: [100, 62],
  hysteria2: [70, 100],
  ikev2: [30, 100],
  l2tp: [0, 62],
}
const BADGE: Record<HostProtocol, string> = {
  vless: 'VLESS',
  vmess: 'VMESS',
  trojan: 'TRJ',
  shadowsocks: 'SS',
  hysteria2: 'HY2',
  ikev2: 'IKE',
  l2tp: 'L2TP',
}
const MONO: Record<HostProtocol, string> = { vless: 'VL', vmess: 'VM', trojan: 'TR', shadowsocks: 'SS', hysteria2: 'HY', ikev2: 'IK', l2tp: 'L2' }

function emptyForm() {
  return {
    remark: '',
    address: '',
    protocol: '' as HostProtocol | '',
    inbound_id: null as number | null,
    port_override: '',
    sni_override: '',
    alpn_override: '',
    fingerprint_override: '',
    path_override: '',
    host_header_override: '',
    security_override: '' as HostSecurity | '',
    allowinsecure: false,
    fragment_length: '',
    fragment_interval: '',
    fragment_packets: '',
    core_id: null as number | null,
    hysteria2_sni: '',
    hysteria2_port: '',
    hysteria2_obfs: '',
  }
}

type Form = ReturnType<typeof emptyForm>

export default function HostsPage({ createSignal = 0 }: { createSignal?: number } = {}) {
  const { t } = useLang()
  const h = t.ui.hosts
  const say = useToast()
  const reduce = useReducedMotion()
  const protocolLabels = t.coresPage.protocolLabels
  const [hosts, setHosts] = useState<Host[] | null>(null)
  const [cores, setCores] = useState<Core[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [nodes, setNodes] = useState<Node[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<Form>(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [showPlaceholders, setShowPlaceholders] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [protoFilter, setProtoFilter] = useState<HostProtocol | null>(null)
  const [protoHover, setProtoHover] = useState<HostProtocol | null>(null)

  const allInbounds: Inbound[] = cores.flatMap((c) => c.inbounds)
  const isXray = form.protocol !== '' && XRAY_PROTOCOLS.includes(form.protocol)
  const isCoreLinked = form.protocol === 'l2tp' || form.protocol === 'ikev2'
  const isHysteria2 = form.protocol === 'hysteria2'
  const inboundsForProtocol = allInbounds.filter((i) => i.protocol === form.protocol)
  const coresForProtocol = cores.filter((c) => c.core_type === form.protocol)

  async function refresh() {
    try {
      const res = await listHosts()
      setHosts(res.hosts)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.hostsPage.fetchError)
    }
  }

  useEffect(() => {
    refresh()
    // Both are context for the cards and the form; a scoped admin may not reach them.
    listCores()
      .then((res) => setCores(res.cores))
      .catch(() => undefined)
    listGroups()
      .then((res) => setGroups(res.groups))
      .catch(() => undefined)
    // Node status drives which protocols show live traffic on the map. The panel re-checks node
    // health in the background, so re-read it while the page is open.
    const loadNodes = () =>
      listNodes()
        .then((res) => setNodes(res.nodes))
        .catch(() => undefined)
    loadNodes()
    const timer = window.setInterval(loadNodes, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (createSignal > 0) openNew()
  }, [createSignal])

  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function insertPlaceholder(key: string) {
    const token = `{${key}}`
    update('remark', form.remark + token)
    await copyToClipboard(token)
    setCopiedToken(key)
    window.setTimeout(() => setCopiedToken((k) => (k === key ? null : k)), 1200)
  }

  function openNew() {
    setEditingId(null)
    setForm(emptyForm())
    setFormError(null)
    setShowForm(true)
  }

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(false)
    setFormError(null)
  }

  function startEdit(host: Host) {
    setEditingId(host.id)
    setForm({
      remark: host.remark,
      address: host.address,
      protocol: host.protocol,
      inbound_id: host.inbound_id,
      port_override: host.port_override != null ? String(host.port_override) : '',
      sni_override: host.sni_override ?? '',
      alpn_override: host.alpn_override ?? '',
      fingerprint_override: host.fingerprint_override ?? '',
      path_override: host.path_override ?? '',
      host_header_override: host.host_header_override ?? '',
      security_override: host.security_override ?? '',
      allowinsecure: host.allowinsecure,
      fragment_length: host.fragment_length ?? '',
      fragment_interval: host.fragment_interval ?? '',
      fragment_packets: host.fragment_packets ?? '',
      core_id: host.core_id,
      hysteria2_sni: host.hysteria2_sni ?? '',
      hysteria2_port: host.hysteria2_port != null ? String(host.hysteria2_port) : '',
      hysteria2_obfs: host.hysteria2_obfs ?? '',
    })
    setFormError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.protocol) return
    setSubmitting(true)
    const payload = {
      remark: form.remark,
      address: form.address,
      protocol: form.protocol,
      inbound_id: isXray ? form.inbound_id : null,
      port_override: isXray && form.port_override ? parseInt(form.port_override, 10) : null,
      sni_override: isXray ? form.sni_override || null : null,
      alpn_override: isXray ? form.alpn_override || null : null,
      fingerprint_override: isXray ? form.fingerprint_override || null : null,
      path_override: isXray ? form.path_override || null : null,
      host_header_override: isXray ? form.host_header_override || null : null,
      security_override: isXray && form.security_override ? form.security_override : null,
      allowinsecure: isXray ? form.allowinsecure : false,
      fragment_length: isXray ? form.fragment_length || null : null,
      fragment_interval: isXray ? form.fragment_interval || null : null,
      fragment_packets: isXray ? form.fragment_packets || null : null,
      core_id: isCoreLinked ? form.core_id : null,
      hysteria2_sni: isHysteria2 ? form.hysteria2_sni || null : null,
      hysteria2_port: isHysteria2 && form.hysteria2_port ? parseInt(form.hysteria2_port, 10) : null,
      hysteria2_obfs: isHysteria2 ? form.hysteria2_obfs || null : null,
    }
    try {
      if (editingId) await updateHost(editingId, payload)
      else await createHost({ ...payload, protocol: form.protocol })
      const wasEdit = !!editingId
      resetForm()
      await refresh()
      say(wasEdit ? h.saved : h.created)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(host: Host) {
    if (!window.confirm(t.hostsPage.confirmDelete(host.remark))) return
    try {
      await deleteHost(host.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  const inboundById = new Map(allInbounds.map((i) => [i.id, i]))
  const coreById = new Map(cores.map((c) => [c.id, c]))
  const counts = Object.fromEntries(PROTOCOLS.map((p) => [p, (hosts ?? []).filter((x) => x.protocol === p).length])) as Record<HostProtocol, number>
  const shown = (hosts ?? []).filter((x) => !protoFilter || x.protocol === protoFilter)
  const lit = protoFilter ?? protoHover

  // A protocol is live when one of its hosts is served by a node that is currently connected:
  // xray hosts through their inbound's core, IKEv2/L2TP/Hysteria2 hosts through their own. All
  // three of a node's core slots count, so a Hysteria2 host on a connected node lights up like
  // any other instead of staying dark because its protocol had no core to check against.
  const liveCoreIds = new Set(
    nodes
      .filter((n) => n.status === 'connected')
      .flatMap((n) => [n.core_id, n.ipsec_core_id, n.hysteria_core_id])
      .filter((id): id is number => id != null),
  )
  const coreOfInbound = new Map(cores.flatMap((c) => c.inbounds.map((i) => [i.id, c.id] as const)))
  const hostIsLive = (host: Host) => {
    const coreId = host.inbound_id != null ? coreOfInbound.get(host.inbound_id) : host.core_id
    return coreId != null && liveCoreIds.has(coreId)
  }
  const live = Object.fromEntries(PROTOCOLS.map((p) => [p, (hosts ?? []).some((x) => x.protocol === p && hostIsLive(x))])) as Record<
    HostProtocol,
    boolean
  >

  // Which groups gate a host: xray hosts through their inbound, the rest directly.
  function hostGroups(host: Host): string[] {
    if (host.inbound_id != null) {
      const inb = inboundById.get(host.inbound_id)
      return (inb?.group_ids ?? []).map((id) => groups.find((g) => g.id === id)?.name ?? `#${id}`)
    }
    return groups.filter((g) => g.host_ids.includes(host.id)).map((g) => g.name)
  }

  function onPassMove(e: React.PointerEvent<HTMLElement>) {
    const card = e.currentTarget
    const inner = card.firstElementChild as HTMLElement | null
    if (!inner) return
    const r = card.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    inner.style.setProperty('--gx', `${px * 100}%`)
    inner.style.setProperty('--gy', `${py * 100}%`)
    inner.style.setProperty('--gp', `${100 - px * 100}%`)
    if (reduce) return
    inner.style.setProperty('--rx', `${(0.5 - py) * 12}deg`)
    inner.style.setProperty('--ry', `${(px - 0.5) * 16}deg`)
  }
  function onPassEnter(e: React.PointerEvent<HTMLElement>) {
    const card = e.currentTarget
    const r = card.getBoundingClientRect()
    const d = { top: e.clientY - r.top, bottom: r.bottom - e.clientY, left: e.clientX - r.left, right: r.right - e.clientX }
    card.dataset.from = Object.entries(d).sort((a, b) => a[1] - b[1])[0][0]
  }
  function onPassLeave(e: React.PointerEvent<HTMLElement>) {
    const inner = e.currentTarget.firstElementChild as HTMLElement | null
    inner?.style.setProperty('--rx', '0deg')
    inner?.style.setProperty('--ry', '0deg')
  }

  function passDetails(host: Host) {
    const groupsList = hostGroups(host)
    const groupText = groupsList.length ? groupsList.join('، ') : h.everyone
    if (host.protocol === 'ikev2' || host.protocol === 'l2tp') {
      const core = host.core_id != null ? coreById.get(host.core_id) : undefined
      return {
        kind: core ? t.coresPage.coreTypeLabels[core.core_type] : protocolLabels[host.protocol],
        pill: core ? { cls: 'ok', text: core.name } : { cls: 'warn', text: h.noCore },
        route: host.address,
        port: host.protocol === 'ikev2' ? 'UDP 500' : 'UDP 1701',
        meta: [
          [h.core, core?.name ?? '—'],
          [host.protocol === 'ikev2' ? h.authMode : 'PSK', host.protocol === 'ikev2' ? (core?.ikev2_auth_mode ?? '—').toUpperCase() : core?.l2tp_psk ? '••••' : '—'],
          [h.groups, groupText],
        ] as [string, string][],
      }
    }
    if (host.protocol === 'hysteria2') {
      return {
        kind: 'QUIC',
        pill: { cls: 'info', text: 'Hysteria2' },
        route: `${host.address}${host.hysteria2_port ? ` : ${host.hysteria2_port}` : ''}`,
        port: host.hysteria2_port ? String(host.hysteria2_port) : '—',
        meta: [
          ['SNI', host.hysteria2_sni ?? '—'],
          [h.network, 'UDP'],
          [h.groups, groupText],
        ] as [string, string][],
      }
    }
    const sec = host.effective_security ?? 'none'
    const inb = host.inbound_id != null ? inboundById.get(host.inbound_id) : undefined
    return {
      kind: [sec === 'none' ? '' : sec.toUpperCase(), (host.network ?? '').toUpperCase()].filter(Boolean).join(' · ') || '—',
      pill:
        sec === 'reality'
          ? { cls: 'ok', text: 'REALITY' }
          : sec === 'tls'
            ? { cls: 'ok', text: 'TLS' }
            : { cls: 'idle', text: t.hostsPage.securityNone },
      route: `${host.address}${host.effective_port != null ? ` : ${host.effective_port}` : ''}`,
      port: host.effective_port != null ? String(host.effective_port) : '—',
      meta: [
        [host.effective_path ? h.path : 'SNI', host.effective_path ?? host.effective_sni ?? '—'],
        [h.inbound, inb?.tag ?? '—'],
        [h.groups, groupText],
      ] as [string, string][],
    }
  }

  return (
    <div className="pg-hosts">
      <h1 className="sr-only">{t.hostsPage.title}</h1>

      <div className="constellation">
        <div className="c-info">
          <span className="tl">{t.hostsPage.title}</span>
          <span className="big">{hosts ? <CountUp value={protoFilter ? shown.length : hosts.length} /> : '—'}</span>
          <p>{protoFilter ? h.filterState(shown.length, protocolLabels[protoFilter]) : h.filterHint}</p>
          {protoFilter && (
            <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setProtoFilter(null)}>
              {h.showAll}
            </button>
          )}
        </div>
        <div className="c-stage" dir="ltr">
          <div className="c-orbit">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {PROTOCOLS.map((p) => (
                <g key={p}>
                  <line
                    className={`c-line ${lit === p ? 'hot' : lit && protoFilter ? 'dim' : ''}`}
                    x1="50"
                    y1="50"
                    x2={NODE_POS[p][0]}
                    y2={NODE_POS[p][1]}
                  />
                  {/* Live protocols show traffic moving without being hovered or picked. */}
                  {live[p] && lit !== p && !(lit && protoFilter) && (
                    <line className="c-flow" x1="50" y1="50" x2={NODE_POS[p][0]} y2={NODE_POS[p][1]} />
                  )}
                </g>
              ))}
            </svg>
            <div className="c-hub">
              <i />
            </div>
            {PROTOCOLS.map((p) => (
              <button
                key={p}
                type="button"
                className={`p-node ${counts[p] === 0 ? 'zero' : live[p] ? 'live' : ''}`}
                aria-pressed={protoFilter === p}
                style={{ left: `${NODE_POS[p][0]}%`, top: `${NODE_POS[p][1]}%` }}
                onClick={() => setProtoFilter((f) => (f === p ? null : p))}
                onPointerEnter={() => setProtoHover(p)}
                onPointerLeave={() => setProtoHover(null)}
              >
                <span className="badge">
                  {BADGE[p]}
                  <span className="cnt">{counts[p]}</span>
                </span>
                <small>{protocolLabels[p]}</small>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sub-head">
        <h2>{h.cardsTitle}</h2>
        <button type="button" className="btn solid" onClick={openNew}>
          <IconPlus size={14} />
          {t.hostsPage.newBtn.replace(/^\+\s*/, '')}
        </button>
      </div>

      {error && <div className="tf-alert">{error}</div>}

      {hosts === null ? (
        <div className="passes" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel" style={{ height: 190, borderRadius: 20 }} />
          ))}
        </div>
      ) : hosts.length === 0 ? (
        <Empty
          title={t.hostsPage.noHostsYet}
          text={h.emptyHint}
          action={
            <button type="button" className="btn solid" onClick={openNew}>
              <IconPlus size={14} />
              {t.hostsPage.newBtn.replace(/^\+\s*/, '')}
            </button>
          }
        />
      ) : (
        <div className="passes">
          {shown.map((host) => {
            const dt = passDetails(host)
            return (
              <article
                key={host.id}
                className="pass"
                tabIndex={0}
                onPointerEnter={onPassEnter}
                onPointerMove={onPassMove}
                onPointerLeave={onPassLeave}
              >
                <div className="pass-inner">
                  <div className="glare" />
                  <div className="pass-main">
                    <div className="pass-top">
                      <span className="mono-badge">{MONO[host.protocol]}</span>
                      <span className="kind">
                        <b>{protocolLabels[host.protocol]}</b>
                        {/* An IKEv2/L2TP core's type label is the protocol name again. */}
                        {dt.kind.toLowerCase() !== protocolLabels[host.protocol].toLowerCase() && <small>{dt.kind}</small>}
                      </span>
                      <span className={`pill ${dt.pill.cls}`}>
                        <i />
                        {dt.pill.text}
                      </span>
                    </div>
                    <div className="pass-name" title={host.remark}>
                      {host.remark}
                    </div>
                    <div className="pass-route mono">{dt.route}</div>
                    <div className="pass-meta">
                      {dt.meta.map(([k, v]) => (
                        <div key={k}>
                          <span>{k}</span>
                          <b title={v} dir="auto">
                            {v}
                          </b>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="stub">
                    <span>{h.port}</span>
                    <b>{dt.port}</b>
                  </div>
                  <div className="tray">
                    <button
                      type="button"
                      className="btn"
                      onClick={async () => {
                        if (await copyToClipboard(host.address)) say(h.addressCopied)
                      }}
                    >
                      {h.copyAddress}
                    </button>
                    <button type="button" className="btn" onClick={() => startEdit(host)}>
                      {t.common.edit}
                    </button>
                    <button type="button" className="btn danger" onClick={() => handleDelete(host)}>
                      {t.common.delete}
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {showForm && (
        <Sheet
          title={editingId ? h.formEdit : h.formNew}
          sub={h.formSub}
          onClose={resetForm}
          width={560}
          footer={
            <>
              <button type="submit" form="host-form" disabled={submitting} className="btn primary lg">
                {submitting ? t.common.saving : editingId ? t.common.save : t.hostsPage.createHostBtn}
              </button>
              <button type="button" className="btn lg" onClick={resetForm}>
                {t.usersPage.cancelAction}
              </button>
            </>
          }
        >
          <form id="host-form" onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <div className="form-grid">
              <div className="wide">
                <div className="flex items-center justify-between gap-2">
                  <label className="lbl" htmlFor="host-remark">
                    {t.hostsPage.remark}
                  </label>
                  <button type="button" className="btn" style={{ padding: '0 8px', fontSize: '.7rem' }} onClick={() => setShowPlaceholders((v) => !v)}>
                    {t.hostsPage.remarkPlaceholdersTitle}
                  </button>
                </div>
                <input id="host-remark" className="input" value={form.remark} onChange={(e) => update('remark', e.target.value)} required />
                {showPlaceholders && (
                  <div className="placeholder-list" style={{ marginTop: 6 }}>
                    {PLACEHOLDER_KEYS.map((key) => (
                      <button key={key} type="button" onClick={() => insertPlaceholder(key)}>
                        <code>{`{${key}}`}</code>
                        <span>{copiedToken === key ? t.hostsPage.remarkPlaceholderCopied : t.hostsPage.placeholders[key]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Field label={t.hostsPage.address}>
                <input className="input ltr" value={form.address} onChange={(e) => update('address', e.target.value)} required placeholder="1.2.3.4" />
              </Field>
              <Field label={t.hostsPage.protocolLabel}>
                <select
                  className="input"
                  value={form.protocol}
                  onChange={(e) => {
                    update('protocol', e.target.value as HostProtocol)
                    update('inbound_id', null)
                    update('core_id', null)
                  }}
                  required
                >
                  <option value="" disabled>
                    {t.coresPage.selectPlaceholder}
                  </option>
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>
                      {protocolLabels[p]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {isXray && (
              <div className="form-section">
                <div className="form-grid">
                  <Field label={t.hostsPage.inboundLabel} wide hint={inboundsForProtocol.length === 0 ? t.hostsPage.noInboundsForProtocol : undefined}>
                    <select className="input" value={form.inbound_id ?? ''} onChange={(e) => update('inbound_id', e.target.value ? Number(e.target.value) : null)} required>
                      <option value="" disabled>
                        {t.coresPage.selectPlaceholder}
                      </option>
                      {inboundsForProtocol.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.tag} — {i.network}/{i.security}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t.hostsPage.portOverride}>
                    <input className="input" type="number" min="1" max="65535" value={form.port_override} onChange={(e) => update('port_override', e.target.value)} />
                  </Field>
                  <Field label={t.hostsPage.sniOverride}>
                    <input className="input ltr" value={form.sni_override} onChange={(e) => update('sni_override', e.target.value)} />
                  </Field>
                  <Field label={t.hostsPage.alpnOverride}>
                    <input className="input ltr" value={form.alpn_override} onChange={(e) => update('alpn_override', e.target.value)} />
                  </Field>
                  <Field label={t.hostsPage.fingerprintOverride}>
                    <select className="input ltr" value={form.fingerprint_override} onChange={(e) => update('fingerprint_override', e.target.value)}>
                      {/* Empty follows the core's JSON; say what that is, so an override isn't set by mistake. */}
                      <option value="">{t.hostsPage.fpFromCore(cores.flatMap((c) => c.inbounds).find((i) => i.id === form.inbound_id)?.fingerprint ?? null)}</option>
                      {FINGERPRINTS.map((fp) => (
                        <option key={fp} value={fp}>
                          {fp}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t.hostsPage.pathOverride}>
                    <input className="input ltr" value={form.path_override} onChange={(e) => update('path_override', e.target.value)} />
                  </Field>
                  <Field label={t.hostsPage.hostHeaderOverride}>
                    <input className="input ltr" value={form.host_header_override} onChange={(e) => update('host_header_override', e.target.value)} />
                  </Field>
                  <Field label={t.hostsPage.securityOverrideLabel}>
                    <select className="input" value={form.security_override} onChange={(e) => update('security_override', e.target.value as HostSecurity)}>
                      <option value="">{t.hostsPage.securityInherit}</option>
                      <option value="none">{t.hostsPage.securityNone}</option>
                      <option value="tls">{t.hostsPage.securityTls}</option>
                      <option value="reality">{t.hostsPage.securityReality}</option>
                    </select>
                  </Field>
                  <div className="wide">
                    <label className="tf-switch">
                      <input type="checkbox" checked={form.allowinsecure} onChange={(e) => update('allowinsecure', e.target.checked)} />
                      {t.hostsPage.allowinsecureLabel}
                    </label>
                  </div>
                </div>
              </div>
            )}

            {isXray && (
              <div className="form-section">
                <h4>{t.hostsPage.fragmentTitle}</h4>
                <div className="hint" style={{ marginTop: -4 }}>
                  {t.hostsPage.fragmentHint}
                </div>
                <div className="form-grid">
                  <Field label={t.hostsPage.fragmentLength}>
                    <input className="input ltr" placeholder="40-60" value={form.fragment_length} onChange={(e) => update('fragment_length', e.target.value)} />
                  </Field>
                  <Field label={t.hostsPage.fragmentInterval}>
                    <input className="input ltr" placeholder="10-20" value={form.fragment_interval} onChange={(e) => update('fragment_interval', e.target.value)} />
                  </Field>
                  <Field label={t.hostsPage.fragmentPackets}>
                    <input className="input ltr" placeholder="tlshello" value={form.fragment_packets} onChange={(e) => update('fragment_packets', e.target.value)} />
                  </Field>
                </div>
              </div>
            )}

            {isCoreLinked && (
              <Field label={t.hostsPage.selectCoreLabel} hint={coresForProtocol.length === 0 ? t.hostsPage.noCoresForProtocol : undefined}>
                <select className="input" value={form.core_id ?? ''} onChange={(e) => update('core_id', e.target.value ? Number(e.target.value) : null)} required>
                  <option value="" disabled>
                    {t.coresPage.selectPlaceholder}
                  </option>
                  {coresForProtocol.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {isHysteria2 && (
              <div className="form-grid">
                <Field label={t.hostsPage.hysteria2SniLabel}>
                  <input className="input ltr" value={form.hysteria2_sni} onChange={(e) => update('hysteria2_sni', e.target.value)} />
                </Field>
                {/* UDP 443 is where QUIC lives, and measured from Iran it answered
                    nothing at all — a host set to it is dead there with no error to
                    explain why. Warned rather than rejected: the port is only
                    hopeless from the networks this panel is aimed at. */}
                <Field
                  label={t.hostsPage.hysteria2PortLabel}
                  hint={
                    form.hysteria2_port === '443' ? (
                      <span style={{ color: 'var(--warn)' }}>{t.hostsPage.hysteria2Port443Warning}</span>
                    ) : undefined
                  }
                >
                  <input className="input" type="number" min="1" max="65535" value={form.hysteria2_port} onChange={(e) => update('hysteria2_port', e.target.value)} />
                </Field>
                <Field label={t.hostsPage.hysteria2ObfsLabel} hint={t.hostsPage.hysteria2ObfsHint}>
                  <input className="input ltr" value={form.hysteria2_obfs} onChange={(e) => update('hysteria2_obfs', e.target.value)} />
                </Field>
              </div>
            )}

            {formError && <div className="tf-alert">{formError}</div>}
          </form>
        </Sheet>
      )}
    </div>
  )
}
