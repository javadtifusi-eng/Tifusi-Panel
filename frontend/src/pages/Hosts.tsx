import { useEffect, useState, type FormEvent } from 'react'
import { IconPlus } from '../components/icons'
import { CountUp, Empty, Field, Sheet, useToast } from '../components/ui'
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

const PROTOCOLS: HostProtocol[] = ['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2', 'wireguard', 'ikev2', 'l2tp', 'pptp']
const XRAY_PROTOCOLS: HostProtocol[] = ['vless', 'vmess', 'trojan', 'shadowsocks']
const PLACEHOLDER_KEYS = ['username', 'protocol', 'days_left', 'expire_date', 'data_limit_gb', 'data_left_gb'] as const

// Where each protocol sits around the hub, in percent of .c-orbit — a box inset from the stage
// by more than half a node's size, so nodes on its very edge (0 / 100) still show whole.
// Evenly round a circle (40° apart, VLESS at the top) inside a square stage, so
// no two protocols crowd each other however wide the page is.
const NODE_POS: Record<HostProtocol, [number, number]> = {
  vless: [50, 0],
  vmess: [82, 12],
  trojan: [99, 41],
  shadowsocks: [93, 75],
  hysteria2: [67, 97],
  wireguard: [33, 97],
  ikev2: [7, 75],
  l2tp: [1, 41],
  pptp: [18, 12],
}
const BADGE: Record<HostProtocol, string> = {
  vless: 'VLESS',
  vmess: 'VMESS',
  trojan: 'TRJ',
  shadowsocks: 'SS',
  hysteria2: 'HY2',
  wireguard: 'WG',
  ikev2: 'IKE',
  l2tp: 'L2TP',
  pptp: 'PPTP',
}
// Each protocol wears one colour everywhere on this page: its node on the map, its lines, its cards.
const PCOLOR: Record<HostProtocol, string> = {
  vless: '#4aa3ff',
  vmess: '#a78bfa',
  trojan: '#f472b6',
  shadowsocks: '#2dd4bf',
  hysteria2: '#f97316',
  wireguard: '#818cf8',
  ikev2: '#2fd26f',
  l2tp: '#ff4d4f',
  pptp: '#e8eaed',
}
const MONO: Record<HostProtocol, string> = { vless: 'VL', vmess: 'VM', trojan: 'TR', shadowsocks: 'SS', hysteria2: 'HY', wireguard: 'WG', ikev2: 'IK', l2tp: 'L2', pptp: 'PP' }

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

// Latency from the admin's own browser to each host address: a tiny no-cors
// request timed with performance.now(). It is what the device the panel is open
// on sees — not a number from the server, which would only ever measure itself.
const PING_EVERY = 3000
const PING_KEEP = 28
function useBrowserPing(addresses: string[]) {
  const [hist, setHist] = useState<Record<string, number[]>>({})
  const key = [...new Set(addresses)].sort().join('|')
  useEffect(() => {
    const list = key ? key.split('|') : []
    if (!list.length) return
    let alive = true
    const once = async (addr: string): Promise<number | null> => {
      const ctl = new AbortController()
      const timer = window.setTimeout(() => ctl.abort(), 4000)
      const t0 = performance.now()
      try {
        await fetch(`https://${addr}/favicon.ico?p=${Date.now()}`, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal })
        return Math.round(performance.now() - t0)
      } catch {
        return null
      } finally {
        window.clearTimeout(timer)
      }
    }
    const round = async () => {
      const results = await Promise.all(list.map(async (a) => [a, await once(a)] as const))
      if (!alive) return
      setHist((prev) => {
        const next = { ...prev }
        for (const [a, ms] of results) if (ms != null) next[a] = [...(prev[a] ?? []), ms].slice(-PING_KEEP)
        return next
      })
    }
    round()
    const id = window.setInterval(round, PING_EVERY)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [key])
  return hist
}

const pingBars = (ms: number | undefined) => (ms == null ? 0 : ms < 75 ? 4 : ms < 110 ? 3 : ms < 170 ? 2 : 1)

function sparkPaths(h: number[]): [string, string] {
  if (h.length < 2) return ['', '']
  const max = Math.max(...h) + 8
  const min = Math.max(0, Math.min(...h) - 8)
  const pts = h.map((v, k) => [(k / (h.length - 1)) * 120, 28 - ((v - min) / (max - min || 1)) * 26])
  const line = 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')
  return [line, `${line} L120 30 L0 30 Z`]
}

export default function HostsPage({ createSignal = 0 }: { createSignal?: number } = {}) {
  const { t } = useLang()
  const h = t.ui.hosts
  const say = useToast()
  const [armed, setArmed] = useState<number | null>(null)
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
  // Hysteria2 is built on a core too now: the core carries the port and obfuscation password,
  // so the host only says where clients connect and which name they present.
  const isCoreLinked =
    form.protocol === 'l2tp' || form.protocol === 'ikev2' || form.protocol === 'pptp' || form.protocol === 'hysteria2' || form.protocol === 'wireguard'
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
      hysteria2_port: null,
      hysteria2_obfs: null,
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
    setArmed(null)
    try {
      await deleteHost(host.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    }
  }

  const pings = useBrowserPing((hosts ?? []).map((x) => x.address))
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
      .flatMap((n) => [n.core_id, n.ipsec_core_id, n.l2tp_core_id, n.pptp_core_id, n.hysteria_core_id, n.wireguard_core_id])
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

  // The address(es) a protocol is served on, shown under its node so the map
  // says where each service lives, not just that it exists.
  function domainsOf(p: HostProtocol): string {
    const addrs = [...new Set((hosts ?? []).filter((x) => x.protocol === p).map((x) => x.address))]
    return addrs.length ? addrs[0] + (addrs.length > 1 ? ` +${addrs.length - 1}` : '') : ''
  }

  // Which groups gate a host: xray hosts through their inbound, the rest directly.
  function hostGroups(host: Host): string[] {
    if (host.inbound_id != null) {
      const inb = inboundById.get(host.inbound_id)
      return (inb?.group_ids ?? []).map((id) => groups.find((g) => g.id === id)?.name ?? `#${id}`)
    }
    return groups.filter((g) => g.host_ids.includes(host.id)).map((g) => g.name)
  }

  function passDetails(host: Host) {
    const groupsList = hostGroups(host)
    const groupText = groupsList.length ? groupsList.join('، ') : h.everyone
    if (host.protocol === 'pptp') {
      const core = host.core_id != null ? coreById.get(host.core_id) : undefined
      return {
        kind: protocolLabels.pptp,
        pill: core ? { cls: 'ok', text: core.name } : { cls: 'warn', text: h.noCore },
        route: host.address,
        port: 'TCP 1723',
        meta: [
          [h.core, core?.name ?? '—'],
          [h.groups, groupText],
        ] as [string, string][],
      }
    }
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
    if (host.protocol === 'wireguard') {
      const core = host.core_id != null ? coreById.get(host.core_id) : undefined
      const port = host.port_override ?? core?.wireguard_port
      return {
        kind: 'WireGuard',
        pill: core ? { cls: 'ok', text: core.name } : { cls: 'warn', text: h.noCore },
        route: `${host.address}${port ? ` : ${port}` : ''}`,
        port: port ? `UDP ${port}` : '—',
        meta: [
          ['MTU', String(core?.wireguard_mtu ?? '—')],
          [h.network, 'UDP'],
          [h.groups, groupText],
        ] as [string, string][],
      }
    }
    if (host.protocol === 'hysteria2') {
      const core = host.core_id != null ? coreById.get(host.core_id) : undefined
      const port = core?.hysteria2_port ?? host.hysteria2_port
      return {
        kind: 'QUIC',
        pill: core ? { cls: 'ok', text: core.name } : { cls: 'warn', text: h.noCore },
        route: `${host.address}${port ? ` : ${port}` : ''}`,
        port: port ? `UDP ${port}` : '—',
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
          {hosts && hosts.length > 0 && (
            <div className="c-mix" dir="ltr" aria-hidden="true">
              {PROTOCOLS.filter((p) => counts[p] > 0).map((p) => (
                <i key={p} style={{ flexGrow: counts[p], background: PCOLOR[p], opacity: protoFilter && protoFilter !== p ? 0.25 : 1 }} />
              ))}
            </div>
          )}
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
                <g key={p} style={{ ['--pc' as string]: PCOLOR[p] }}>
                  <line
                    className={`c-line ${counts[p] > 0 ? 'has' : ''} ${lit === p ? 'hot' : lit && protoFilter ? 'dim' : ''}`}
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
                style={{ left: `${NODE_POS[p][0]}%`, top: `${NODE_POS[p][1]}%`, ['--pc' as string]: PCOLOR[p] }}
                onClick={() => setProtoFilter((f) => (f === p ? null : p))}
                onPointerEnter={() => setProtoHover(p)}
                onPointerLeave={() => setProtoHover(null)}
              >
                <span className="badge">
                  {BADGE[p]}
                  <span className="cnt">{counts[p]}</span>
                </span>
                <small>{protocolLabels[p]}</small>
                {domainsOf(p) && <em className="dom">{domainsOf(p)}</em>}
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
        <div className="hcards">
          {shown.map((host) => {
            const dt = passDetails(host)
            const isLive = hostIsLive(host)
            const hist = pings[host.address] ?? []
            const ms = hist[hist.length - 1]
            const bars = isLive ? pingBars(ms) : 0
            const [line, area] = sparkPaths(hist)
            return (
              <article
                key={host.id}
                className={`hc ${host.protocol === 'pptp' ? 'dark' : ''}`}
                style={{ ['--c' as string]: PCOLOR[host.protocol] }}
              >
                <span className="hc-code">{MONO[host.protocol]}</span>
                <div className="hc-mid">
                  <b title={host.remark}>{host.remark}</b>
                  <span dir="ltr">{dt.route.replace(' : ', ':')}{dt.port !== '—' && !dt.route.includes(':') ? `:${dt.port.split(' ').pop()}` : ''}</span>
                </div>
                <div className="hc-r">
                  <span className="hc-sig" title={isLive ? h.live : h.notLive} aria-label={isLive ? h.live : h.notLive}>
                    {[0, 1, 2, 3].map((k) => (
                      <i key={k} className={k < bars ? 'on' : ''} />
                    ))}
                  </span>
                  <span className="hc-ms" dir="ltr" title={h.pingTitle}>
                    {ms != null ? ms : '–'}
                    <small> ms</small>
                  </span>
                </div>
                <svg className="hc-spark" viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true">
                  <path className="a" d={area} />
                  <path className="l" d={line} />
                </svg>
                <div className="hc-acts">
                  <button
                    type="button"
                    className="hc-ab"
                    title={h.copyAddress}
                    aria-label={h.copyAddress}
                    onClick={async () => {
                      if (await copyToClipboard(host.address)) say(h.addressCopied)
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
                  </button>
                  <button type="button" className="hc-ab" title={t.common.edit} aria-label={t.common.edit} onClick={() => startEdit(host)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>
                  </button>
                  <button
                    type="button"
                    className={`hc-ab del ${armed === host.id ? 'armed' : ''}`}
                    title={t.common.delete}
                    aria-label={armed === host.id ? t.hostsPage.confirmDelete(host.remark) : t.common.delete}
                    onClick={() => (armed === host.id ? handleDelete(host) : setArmed(host.id))}
                    onBlur={() => setArmed((a) => (a === host.id ? null : a))}
                  >
                    {armed === host.id ? (
                      h.sure
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
                    )}
                  </button>
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
                <Field label={t.hostsPage.hysteria2SniLabel} hint={t.hostsPage.hysteria2SniHint}>
                  <input
                    className="input ltr"
                    value={form.hysteria2_sni}
                    placeholder={form.address || undefined}
                    onChange={(e) => update('hysteria2_sni', e.target.value)}
                  />
                </Field>
                {(() => {
                  const core = form.core_id != null ? coreById.get(form.core_id) : undefined
                  return core ? (
                    <Field label={t.hostsPage.hysteria2PortLabel} hint={t.hostsPage.hysteria2FromCore}>
                      <input className="input ltr mono" value={`UDP ${core.hysteria2_port ?? '—'}`} readOnly />
                    </Field>
                  ) : null
                })()}
              </div>
            )}

            {formError && <div className="tf-alert">{formError}</div>}
          </form>
        </Sheet>
      )}
    </div>
  )
}
