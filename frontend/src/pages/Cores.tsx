import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { IconCopy, IconPlus } from '../components/icons'
import { Empty, Field, Sheet, highlightJsonLines, useToast } from '../components/ui'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createCore,
  deleteCore,
  FINGERPRINTS,
  generateIkev2Cert,
  getPanelCertForIkev2,
  getRealityKeypair,
  listCores,
  listNodes,
  updateCore,
  updateNode,
  type Core,
  type CoreType,
  type Node,
  type RealityCandidate,
} from '../lib/api'
import RealityScanner from '../components/RealityScanner'
import { copyToClipboard } from '../lib/clipboard'

const CORE_TYPES: CoreType[] = ['xray', 'ikev2', 'hysteria2', 'l2tp']

// Where node_agent/ipsec.py actually writes these two fields once synced to
// a node (IKEV2_LEAF_CERT / IKEV2_LEAF_KEY) — shown read-only so the admin
// knows where to look on the node, not an admin-configurable path.
const IKEV2_CERT_NODE_PATH = '/etc/swanctl/x509/ikev2-server.pem'
const IKEV2_CERT_KEY_NODE_PATH = '/etc/swanctl/private/ikev2-server.key'

function emptyForm() {
  return {
    coreType: '' as CoreType | '',
    name: '',
    note: '',
    configText: '',
    l2tpPsk: '',
    ikev2Psk: '',
    ikev2RemoteId: '',
    ikev2Certificate: '',
    ikev2CertificateKey: '',
    ikev2EgressVless: '',
    ikev2AuthMode: 'eap' as 'eap' | 'psk',
    hysteria2Port: '',
    hysteria2Obfs: '',
    hysteria2RateMbps: '',
  }
}

type WizardProtocol = 'vless' | 'vmess' | 'trojan' | 'shadowsocks'

function emptyWizard() {
  return {
    protocol: '' as WizardProtocol | '',
    network: '' as 'tcp' | 'ws' | 'grpc' | '',
    security: '' as 'none' | 'tls' | 'reality' | '',
    tag: '',
    port: '',
    sni: '',
    fingerprint: '',
    alpn: '',
    path: '',
    hostHeader: '',
    method: '',
    realityPrivateKey: '',
    realityShortId: '',
  }
}

function randomPort(): string {
  return String(10000 + Math.floor(Math.random() * 50000))
}

// Applies `patch` to every REALITY inbound already in the JSON. Returns the new text, or null when
// the JSON doesn't parse or has no REALITY inbound yet (then the wizard's "add to JSON" adds one).
function patchRealityInJson(text: string, patch: (reality: Record<string, unknown>) => void): string | null {
  try {
    const config = JSON.parse(text) as { inbounds?: { streamSettings?: { realitySettings?: Record<string, unknown> } }[] }
    let found = false
    for (const inbound of config.inbounds ?? []) {
      const reality = inbound?.streamSettings?.realitySettings
      if (reality && typeof reality === 'object') {
        patch(reality)
        found = true
      }
    }
    return found ? JSON.stringify(config, null, 2) : null
  } catch {
    return null
  }
}

function buildInboundJson(w: ReturnType<typeof emptyWizard>): Record<string, unknown> {
  const isTransport = w.protocol !== 'shadowsocks'
  const settings: Record<string, unknown> = { clients: [] }
  if (w.protocol === 'vless') {
    settings.decryption = 'none'
    if (w.security === 'reality' && w.network === 'tcp') settings.flow = 'xtls-rprx-vision'
  } else if (w.protocol === 'shadowsocks') {
    settings.method = w.method
  }

  const streamSettings: Record<string, unknown> = isTransport ? { network: w.network, security: w.security } : {}

  if (isTransport && w.security === 'reality') {
    const realitySettings: Record<string, unknown> = {
      show: false,
      dest: `${w.sni}:443`,
      serverNames: [w.sni],
      privateKey: w.realityPrivateKey,
      shortIds: [w.realityShortId],
    }
    if (w.fingerprint) realitySettings.fingerprint = w.fingerprint
    streamSettings.realitySettings = realitySettings
  } else if (isTransport && w.security === 'tls') {
    const tlsSettings: Record<string, unknown> = {}
    if (w.sni) tlsSettings.serverName = w.sni
    if (w.alpn) tlsSettings.alpn = w.alpn.split(',').map((s) => s.trim()).filter(Boolean)
    if (w.fingerprint) tlsSettings.fingerprint = w.fingerprint
    streamSettings.tlsSettings = tlsSettings
  }

  if (isTransport && w.network === 'ws') {
    const wsSettings: Record<string, unknown> = {}
    if (w.path) wsSettings.path = w.path
    if (w.hostHeader) wsSettings.headers = { Host: w.hostHeader }
    streamSettings.wsSettings = wsSettings
  } else if (isTransport && w.network === 'grpc') {
    streamSettings.grpcSettings = { serviceName: w.path || '' }
  }

  const inbound: Record<string, unknown> = {
    tag: w.tag,
    listen: '0.0.0.0',
    port: Number(w.port),
    protocol: w.protocol,
    settings,
  }
  if (isTransport) inbound.streamSettings = streamSettings
  return inbound
}

function parseConfig(text: string): Record<string, unknown> {
  try {
    return text.trim() ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

function csvToList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

type RoutingRule = {
  type: 'field'
  domain?: string[]
  ip?: string[]
  inboundTag?: string[]
  port?: string | number
  network?: string
  outboundTag?: string
  balancerTag?: string
}

// A standard, admin-agnostic starting point — nothing here ever contains a
// real address/key, so it's safe to ship as a one-click option rather than
// a value someone has to type in. Order matters (first match wins): block
// leaks/ads before the two "route locally, don't tunnel" rules.
const RECOMMENDED_RULES: RoutingRule[] = [
  { type: 'field', ip: ['geoip:private'], outboundTag: 'block' },
  { type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' },
  { type: 'field', ip: ['geoip:ir'], outboundTag: 'direct' },
  { type: 'field', domain: ['geosite:ir'], outboundTag: 'direct' },
]
const RECOMMENDED_DNS_SERVERS = ['1.1.1.1', '8.8.8.8']

function ruleSignature(r: RoutingRule): string {
  return JSON.stringify({ domain: r.domain ?? [], ip: r.ip ?? [], outboundTag: r.outboundTag ?? '' })
}

// Merges the recommended rules/outbounds/DNS into whatever's already there
// instead of replacing it — existing custom rules, outbounds and DNS
// servers are left exactly as the admin set them; only what's missing gets
// added (and rule order among the recommended ones is preserved).
function applyRecommendedRouting(configText: string): string {
  const config = parseConfig(configText)

  const outbounds = Array.isArray(config.outbounds) ? [...(config.outbounds as OutboundEntry[])] : []
  const existingTags = new Set(outbounds.map((o) => o.tag))
  if (!existingTags.has('direct')) outbounds.push({ tag: 'direct', protocol: 'freedom', settings: {} })
  if (!existingTags.has('block')) outbounds.push({ tag: 'block', protocol: 'blackhole', settings: {} })

  const routing = (config.routing as { rules?: RoutingRule[] } | undefined) ?? {}
  const existingRules = Array.isArray(routing.rules) ? routing.rules : []
  const existingSignatures = new Set(existingRules.map(ruleSignature))
  const missingRules = RECOMMENDED_RULES.filter((r) => !existingSignatures.has(ruleSignature(r)))
  const rules = [...existingRules, ...missingRules]

  const dns = (config.dns as { servers?: string[] } | undefined) ?? {}
  const dnsServers = Array.isArray(dns.servers) && dns.servers.length > 0 ? dns.servers : RECOMMENDED_DNS_SERVERS

  return JSON.stringify({ ...config, outbounds, routing: { ...routing, rules }, dns: { ...dns, servers: dnsServers } }, null, 2)
}

// RoutingEditor edits config.routing.rules directly on the same raw JSON
// string the rest of the form (and the inbound wizard above it) already
// treats as the single source of truth - no separate state to drift out
// of sync with a manual edit to the JSON textarea below.
function RoutingEditor({ configText, setConfigText, t }: { configText: string; setConfigText: (text: string) => void; t: ReturnType<typeof useLang>['t'] }) {
  const config = parseConfig(configText)
  const routing = (config.routing as { rules?: RoutingRule[] } | undefined) ?? {}
  const rules = Array.isArray(routing.rules) ? routing.rules : []
  const outbounds = Array.isArray(config.outbounds) ? (config.outbounds as { tag?: string }[]) : []
  const outboundTags = outbounds.map((o) => o.tag).filter((tag): tag is string => !!tag)
  const tagOptions = outboundTags.length > 0 ? outboundTags : ['direct']

  function commit(nextRules: RoutingRule[]) {
    setConfigText(JSON.stringify({ ...config, routing: { ...routing, rules: nextRules } }, null, 2))
  }
  function updateRule(i: number, patch: Partial<RoutingRule>) {
    commit(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function moveRule(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= rules.length) return
    const next = [...rules]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }

  return (
    <div className="form-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 style={{ margin: 0 }}>{t.coresPage.routingTitle}</h4>
        <span className="flex gap-1.5">
          <button type="button" onClick={() => setConfigText(applyRecommendedRouting(configText))} title={t.coresPage.applyRecommendedHint} className="btn">
            {t.coresPage.applyRecommendedBtn}
          </button>
          <button type="button" onClick={() => commit([...rules, { type: 'field', domain: [], ip: [], outboundTag: tagOptions[0] }])} className="btn">
            {t.coresPage.addRuleBtn}
          </button>
        </span>
      </div>
      <div className="hint" style={{ margin: 0 }}>
        {t.coresPage.routingHint}
      </div>
      {rules.length === 0 && <div className="hint">{t.coresPage.noRulesYet}</div>}
      {rules.map((r, i) => (
        <div key={i} className="rule-edit">
          <div style={{ flex: '1 1 200px' }}>
            <label className="lbl">{t.coresPage.ruleDomainLabel}</label>
            <input
              className="input ltr"
              value={(r.domain ?? []).join(', ')}
              onChange={(e) => updateRule(i, { domain: csvToList(e.target.value) })}
              placeholder="geosite:category-ads-all, example.com"
            />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label className="lbl">{t.coresPage.ruleIpLabel}</label>
            <input className="input ltr" value={(r.ip ?? []).join(', ')} onChange={(e) => updateRule(i, { ip: csvToList(e.target.value) })} placeholder="geoip:private, geoip:ir" />
          </div>
          <div style={{ flex: '0 1 120px' }}>
            <label className="lbl">{t.coresPage.ruleOutboundLabel}</label>
            <select className="input ltr" value={r.outboundTag ?? tagOptions[0]} onChange={(e) => updateRule(i, { outboundTag: e.target.value })}>
              {tagOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>
          <span className="flex gap-1">
            <button type="button" onClick={() => moveRule(i, -1)} className="btn" aria-label="↑">
              ↑
            </button>
            <button type="button" onClick={() => moveRule(i, 1)} className="btn" aria-label="↓">
              ↓
            </button>
            <button type="button" onClick={() => commit(rules.filter((_, idx) => idx !== i))} className="btn danger">
              {t.common.delete}
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}

const OUTBOUND_PROTOCOLS = ['freedom', 'blackhole', 'vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http'] as const

type OutboundEntry = {
  tag?: string
  protocol?: string
  settings?: Record<string, unknown>
}

// Structured single-server fields for the protocols that actually need
// settings (freedom/blackhole need none) - kept deliberately simple
// (one upstream server per outbound) rather than a raw JSON textarea, so
// typing here can never leave the surrounding config.routing/outbounds
// JSON momentarily invalid the way a nested free-form JSON field would.
function outboundServerFields(protocol: string | undefined, settings: Record<string, unknown>) {
  const vnext = (settings.vnext as Record<string, unknown>[] | undefined)?.[0]
  const server = (settings.servers as Record<string, unknown>[] | undefined)?.[0]
  const users = (vnext?.users as Record<string, unknown>[] | undefined)?.[0]
  switch (protocol) {
    case 'vless':
    case 'vmess':
      return { address: (vnext?.address as string) ?? '', port: vnext?.port != null ? String(vnext.port) : '', secret: (users?.id as string) ?? '' }
    case 'trojan':
    case 'shadowsocks':
      return { address: (server?.address as string) ?? '', port: server?.port != null ? String(server.port) : '', secret: (server?.password as string) ?? '' }
    case 'socks':
    case 'http':
      return { address: (server?.address as string) ?? '', port: server?.port != null ? String(server.port) : '', secret: '' }
    default:
      return { address: '', port: '', secret: '' }
  }
}

function buildOutboundSettings(protocol: string | undefined, fields: { address: string; port: string; secret: string }): Record<string, unknown> {
  const port = parseInt(fields.port, 10) || 0
  switch (protocol) {
    case 'vless':
      return { vnext: [{ address: fields.address, port, users: [{ id: fields.secret, encryption: 'none' }] }] }
    case 'vmess':
      return { vnext: [{ address: fields.address, port, users: [{ id: fields.secret, alterId: 0 }] }] }
    case 'trojan':
      return { servers: [{ address: fields.address, port, password: fields.secret }] }
    case 'shadowsocks':
      return { servers: [{ address: fields.address, port, password: fields.secret, method: 'aes-256-gcm' }] }
    case 'socks':
    case 'http':
      return { servers: [{ address: fields.address, port }] }
    default:
      return {}
  }
}

// OutboundsEditor edits config.outbounds the same way RoutingEditor edits
// config.routing.rules - reads/writes the same raw configText string.
function OutboundsEditor({ configText, setConfigText, t }: { configText: string; setConfigText: (text: string) => void; t: ReturnType<typeof useLang>['t'] }) {
  const config = parseConfig(configText)
  const outbounds = Array.isArray(config.outbounds) ? (config.outbounds as OutboundEntry[]) : []

  function commit(next: OutboundEntry[]) {
    setConfigText(JSON.stringify({ ...config, outbounds: next }, null, 2))
  }
  function updateOutbound(i: number, patch: Partial<OutboundEntry>) {
    commit(outbounds.map((o, idx) => (idx === i ? { ...o, ...patch } : o)))
  }
  function moveOutbound(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= outbounds.length) return
    const next = [...outbounds]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }

  return (
    <div className="form-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 style={{ margin: 0 }}>{t.coresPage.outboundsTitle}</h4>
        <button type="button" onClick={() => commit([...outbounds, { tag: `outbound-${outbounds.length + 1}`, protocol: 'freedom', settings: {} }])} className="btn">
          {t.coresPage.addOutboundBtn}
        </button>
      </div>
      <div className="hint" style={{ margin: 0 }}>
        {t.coresPage.outboundsHint}
      </div>
      {outbounds.length === 0 && <div className="hint">{t.coresPage.noOutboundsYet}</div>}
      {outbounds.map((o, i) => {
        const needsServer = o.protocol !== 'freedom' && o.protocol !== 'blackhole'
        const fields = outboundServerFields(o.protocol, o.settings ?? {})
        return (
          <div key={i} className="rule-edit">
            <div style={{ flex: '0 1 120px' }}>
              <label className="lbl">{t.coresPage.outboundTagLabel}</label>
              <input className="input ltr" value={o.tag ?? ''} onChange={(e) => updateOutbound(i, { tag: e.target.value })} />
            </div>
            <div style={{ flex: '0 1 120px' }}>
              <label className="lbl">{t.coresPage.outboundProtocolLabel}</label>
              <select className="input ltr" value={o.protocol ?? 'freedom'} onChange={(e) => updateOutbound(i, { protocol: e.target.value, settings: {} })}>
                {OUTBOUND_PROTOCOLS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            {needsServer && (
              <>
                <div style={{ flex: '1 1 140px' }}>
                  <label className="lbl">{t.coresPage.outboundAddressLabel}</label>
                  <input
                    className="input ltr"
                    value={fields.address}
                    onChange={(e) => updateOutbound(i, { settings: buildOutboundSettings(o.protocol, { ...fields, address: e.target.value }) })}
                  />
                </div>
                <div style={{ flex: '0 1 90px' }}>
                  <label className="lbl">{t.coresPage.outboundPortLabel}</label>
                  <input
                    className="input ltr"
                    type="number"
                    value={fields.port}
                    onChange={(e) => updateOutbound(i, { settings: buildOutboundSettings(o.protocol, { ...fields, port: e.target.value }) })}
                  />
                </div>
                {(o.protocol === 'vless' || o.protocol === 'vmess' || o.protocol === 'trojan' || o.protocol === 'shadowsocks') && (
                  <div style={{ flex: '1 1 160px' }}>
                    <label className="lbl">{t.coresPage.outboundSecretLabel}</label>
                    <input
                      className="input ltr mono"
                      value={fields.secret}
                      onChange={(e) => updateOutbound(i, { settings: buildOutboundSettings(o.protocol, { ...fields, secret: e.target.value }) })}
                    />
                  </div>
                )}
              </>
            )}
            <span className="flex gap-1">
              <button type="button" onClick={() => moveOutbound(i, -1)} className="btn" aria-label="↑">
                ↑
              </button>
              <button type="button" onClick={() => moveOutbound(i, 1)} className="btn" aria-label="↓">
                ↓
              </button>
              <button type="button" onClick={() => commit(outbounds.filter((_, idx) => idx !== i))} className="btn danger">
                {t.common.delete}
              </button>
            </span>
          </div>
        )
      })}
    </div>
  )
}

// A node runs at most one core of each kind at once, in three independent slots:
// its Xray process, its IPsec stack, and its Hysteria2 process. Which slot a core
// occupies follows from its type, so every place that assigns or counts asks here
// rather than re-deriving it.
const CORE_SLOT = {
  xray: 'core_id',
  ikev2: 'ipsec_core_id',
  l2tp: 'ipsec_core_id',
  hysteria2: 'hysteria_core_id',
} as const satisfies Record<CoreType, 'core_id' | 'ipsec_core_id' | 'hysteria_core_id'>

const slotOf = (type: CoreType) => CORE_SLOT[type]
const coreInSlot = (node: Node, type: CoreType) => node[slotOf(type)]

// Node chips on a core card are how "which node runs this core" gets set —
// the core/node relationship lives here and nowhere else.
function NodeAssignment({ core, nodes, onChanged }: { core: Core; nodes: Node[]; onChanged: () => void }) {
  const { t } = useLang()
  const say = useToast()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [egressDrafts, setEgressDrafts] = useState<Record<number, string>>({})
  const isIpsec = core.core_type === 'l2tp' || core.core_type === 'ikev2'
  const slot = slotOf(core.core_type)

  async function toggle(node: Node, assign: boolean) {
    setBusyId(node.id)
    try {
      await updateNode(node.id, { [slot]: assign ? core.id : null })
      onChanged()
      say(assign ? t.ui.cores.assigned(node.name) : t.ui.cores.unassigned(node.name))
    } finally {
      setBusyId(null)
    }
  }

  async function saveEgress(node: Node) {
    const value = egressDrafts[node.id] ?? node.l2tp_egress_vless ?? ''
    setBusyId(node.id)
    try {
      await updateNode(node.id, { l2tp_egress_vless: value || null })
      onChanged()
      say(t.common.saved)
    } finally {
      setBusyId(null)
    }
  }

  const assigned = nodes.filter((n) => coreInSlot(n, core.core_type) === core.id)

  return (
    <>
      <div className="node-row">
        <span className="hint" style={{ margin: 0, alignSelf: 'center' }}>
          {t.coresPage.assignedNodesTitle}:
        </span>
        {nodes.length === 0 && <span className="hint">{t.nodesPage.noNodesYet}</span>}
        {nodes.map((n) => {
          const here = coreInSlot(n, core.core_type) === core.id
          const elsewhere = !here && coreInSlot(n, core.core_type) != null
          return (
            <button
              key={n.id}
              type="button"
              className="node-chip"
              aria-pressed={here}
              disabled={busyId === n.id}
              onClick={() => toggle(n, !here)}
              title={elsewhere ? t.coresPage.assignedElsewhere : undefined}
            >
              <span className={`tf-led ${here ? (n.status === 'connected' ? 'on' : n.status === 'error' ? 'err' : 'wait') : ''}`} />
              <b>{n.name}</b>
              {elsewhere && <span className="elsewhere">{t.ui.cores.elsewhere}</span>}
            </button>
          )
        })}
      </div>
      {core.core_type === 'l2tp' &&
        assigned.map((n) => (
          <div key={n.id} className="egress">
            <span className="chip en" title={t.nodesPage.l2tpEgressHint}>
              {n.name} · {t.nodesPage.l2tpEgressLabel}
            </span>
            <input
              className="input ltr"
              value={egressDrafts[n.id] ?? n.l2tp_egress_vless ?? ''}
              onChange={(e) => setEgressDrafts((d) => ({ ...d, [n.id]: e.target.value }))}
              placeholder="vless://..."
            />
            <button type="button" onClick={() => saveEgress(n)} disabled={busyId === n.id} className="btn">
              {t.common.save}
            </button>
          </div>
        ))}
    </>
  )
}

interface FlowRule {
  n: string
  match: string
  to: string
  inboundTags: string[]
  def?: boolean
}

// Inbounds → routing rules → outbounds, read straight from the stored config.
// `live`: a node running this core is connected; only then does traffic animate along the beams.
function XrayFlow({ core, live, onOpen }: { core: Core; live: boolean; onOpen: (part: string) => void }) {
  const { t, dir } = useLang()
  const c = t.ui.cores
  const config = (core.config ?? {}) as Record<string, unknown>
  const rawInbounds = Array.isArray(config.inbounds) ? (config.inbounds as Record<string, unknown>[]) : []
  const configOutbounds = Array.isArray(config.outbounds) ? (config.outbounds as Record<string, unknown>[]) : []
  // A config without outbounds still runs: the node adds a freedom "direct" outbound itself. Showing
  // it keeps the flow complete (inbound → rule → outbound) instead of ending at the rules column.
  const implicitOutbound = configOutbounds.length === 0
  const rawOutbounds = implicitOutbound ? [{ tag: 'direct', protocol: 'freedom' }] : configOutbounds
  const rawRules = Array.isArray((config.routing as { rules?: unknown })?.rules) ? ((config.routing as { rules: RoutingRule[] }).rules as RoutingRule[]) : []
  const parsed = new Map(core.inbounds.map((i) => [i.tag, i]))
  const firstOutbound = (rawOutbounds[0]?.tag as string | undefined) ?? 'direct'
  const outProto = new Map(rawOutbounds.map((o) => [String(o.tag ?? ''), String(o.protocol ?? '')]))

  const rules: FlowRule[] = rawRules.map((r, i) => ({
    n: String(i + 1),
    match:
      [...(r.inboundTag ?? []).map((x) => `inbound:${x}`), ...(r.domain ?? []), ...(r.ip ?? []), r.port != null ? `port:${r.port}` : '', r.network ?? '']
        .filter(Boolean)
        .join(' · ') || '*',
    to: r.outboundTag ?? r.balancerTag ?? '—',
    inboundTags: r.inboundTag ?? [],
  }))
  rules.push({ n: '—', match: c.restOfTraffic, to: firstOutbound, inboundTags: [], def: true })

  const kindOf = (tag: string) => {
    const p = outProto.get(tag)
    if (p === 'blackhole') return 'block'
    if (p === 'freedom') return 'direct'
    return ''
  }

  const flowRef = useRef<HTMLDivElement>(null)
  const [beams, setBeams] = useState<{ d: string; kind: string }[]>([])

  useLayoutEffect(() => {
    const flow = flowRef.current
    if (!flow) return
    function draw() {
      if (!flow || flow.offsetParent === null) return
      const box = flow.getBoundingClientRect()
      const rect = (id: string) => flow.querySelector<HTMLElement>(`[data-flow="${id}"]`)?.getBoundingClientRect()
      const curve = (a: DOMRect, b: DOMRect) => {
        const x1 = (dir === 'rtl' ? a.left : a.right) - box.left
        const x2 = (dir === 'rtl' ? b.right : b.left) - box.left
        const y1 = a.top + a.height / 2 - box.top
        const y2 = b.top + b.height / 2 - box.top
        const mx = (x1 + x2) / 2
        return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`
      }
      const out: { d: string; kind: string }[] = []
      rawInbounds.forEach((inb, i) => {
        const tag = String(inb.tag ?? i)
        const a = rect(`in${i}`)
        if (!a) return
        const targeted = rules.findIndex((r) => r.inboundTags.includes(tag))
        const b = rect(targeted >= 0 ? `r${targeted}` : 'rules')
        const internal = inb.protocol === 'dokodemo-door'
        if (b) out.push({ d: curve(a, b), kind: internal ? 'quiet' : '' })
      })
      rules.forEach((r, i) => {
        const a = rect(`r${i}`)
        const oi = rawOutbounds.findIndex((o) => o.tag === r.to)
        const b = rect(oi >= 0 ? `out${oi}` : '')
        if (a && b) out.push({ d: curve(a, b), kind: kindOf(r.to) === 'block' ? 'block' : r.inboundTags.length && !r.def ? 'quiet' : '' })
      })
      setBeams(out)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(flow)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, dir])

  return (
    <div className="tf-card flow-card">
      <div className="tf-card-head">
        <h3>{c.flowTitle}</h3>
        <span className="flex flex-wrap items-center gap-2.5">
          <small>{c.flowHint}</small>
          <button type="button" className="btn" onClick={() => onOpen('all')}>
            {c.jsonFile}
          </button>
        </span>
      </div>
      <div className="flow" ref={flowRef}>
        <svg className="beams" aria-hidden="true">
          {beams.map((b, i) => (
            <g key={i}>
              <path className="beam-base" d={b.d} />
              {live && <path className={`beam-run ${b.kind}`} d={b.d} />}
            </g>
          ))}
        </svg>
        <div className="col">
          <span className="col-title">{c.colInbounds}</span>
          {rawInbounds.length === 0 && <span className="hint">{t.coresPage.noInbounds}</span>}
          {rawInbounds.map((inb, i) => {
            const tag = String(inb.tag ?? `#${i + 1}`)
            const p = parsed.get(tag)
            const internal = inb.protocol === 'dokodemo-door'
            return (
              <button key={i} type="button" data-flow={`in${i}`} className={`blk ${internal ? 'dim' : ''}`} onClick={() => onOpen(`inbounds.${i}`)}>
                <span className="top">
                  <span className="tag">{tag}</span>
                  {inb.port != null && <span className="chip en">:{String(inb.port)}</span>}
                </span>
                <span className="sub">
                  {internal
                    ? c.internalInbound
                    : [String(inb.protocol ?? '').toUpperCase(), p?.security && p.security !== 'none' ? p.security.toUpperCase() : '', p ? c.hostsCount(p.host_count) : '']
                        .filter(Boolean)
                        .join(' · ')}
                </span>
              </button>
            )
          })}
        </div>
        <div className="col">
          <span className="col-title">{c.colRules}</span>
          <button type="button" data-flow="rules" className="blk rules" onClick={() => onOpen('routing')}>
            {rules.map((r, i) => (
              <span key={i} data-flow={`r${i}`} className={`rule ${r.def ? 'def' : ''}`}>
                <span className="n">{r.n}</span>
                <span className="m" title={r.match}>
                  {r.match}
                </span>
                <span className={`to ${kindOf(r.to)}`}>{r.to}</span>
              </span>
            ))}
          </button>
        </div>
        <div className="col">
          <span className="col-title">{c.colOutbounds}</span>
          {rawOutbounds.map((o, i) => (
            <button
              key={i}
              type="button"
              data-flow={`out${i}`}
              className="blk"
              onClick={() => (implicitOutbound ? onOpen('all') : onOpen(`outbounds.${i}`))}
            >
              <span className="top">
                <span className="tag">{String(o.tag ?? `#${i + 1}`)}</span>
                <span className="chip en">{String(o.protocol ?? '')}</span>
              </span>
              {i === 0 && <span className="sub">{implicitOutbound ? c.implicitOutbound : c.defaultOutbound}</span>}
            </button>
          ))}
        </div>
      </div>
      <p className="flow-note">{c.flowNote}</p>
    </div>
  )
}

function CodeSheet({ core, part, onPart, onClose }: { core: Core; part: string; onPart: (p: string) => void; onClose: () => void }) {
  const { t } = useLang()
  const say = useToast()
  const config = (core.config ?? {}) as Record<string, unknown>
  const pick = (p: string): unknown => (p === 'all' ? config : p.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], config))
  const text = JSON.stringify(pick(part) ?? null, null, 2)
  const tree: { part: string; label: string; lvl: number }[] = [{ part: 'all', label: 'config.json', lvl: 0 }]
  for (const key of Object.keys(config)) {
    const val = config[key]
    if (Array.isArray(val)) {
      tree.push({ part: key, label: key, lvl: 0 })
      val.forEach((item, i) => tree.push({ part: `${key}.${i}`, label: String((item as { tag?: string })?.tag ?? `${key}[${i}]`), lvl: 1 }))
    } else tree.push({ part: key, label: key, lvl: 1 })
  }

  return (
    <Sheet title={core.name} sub={t.ui.cores.jsonFile} onClose={onClose} width={720} className="tf-code-sheet">
      <div style={{ margin: '-16px -18px', display: 'flex', flexDirection: 'column', minHeight: 'calc(100% + 32px)' }}>
        <div className="code-head">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          <span className="file">{part === 'all' ? 'config.json' : `config.json › ${part.replace(/\./g, ' › ')}`}</span>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              if (await copyToClipboard(text)) say(t.common.copiedCheck)
            }}
          >
            <IconCopy size={13} />
            {t.copy}
          </button>
        </div>
        <div className="code-body">
          <nav className="tree" aria-label="config">
            {tree.map((n) => (
              <button key={n.part} type="button" className={n.lvl ? 'lvl1' : ''} aria-current={n.part === part} onClick={() => onPart(n.part)}>
                {n.label}
              </button>
            ))}
          </nav>
          <pre className="code">
            {highlightJsonLines(text).map((html, i) => (
              <span key={i} className="ln" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
            ))}
          </pre>
        </div>
      </div>
    </Sheet>
  )
}

export default function CoresPage({ createSignal = 0 }: { createSignal?: number } = {}) {
  const { t } = useLang()
  const c = t.ui.cores
  const say = useToast()
  const protocolLabels = t.coresPage.protocolLabels
  const [cores, setCores] = useState<Core[] | null>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<CoreType>('xray')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [lastWarnings, setLastWarnings] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState<{ coreId: number; part: string } | null>(null)

  const [wizard, setWizard] = useState(emptyWizard())
  const [addedFlash, setAddedFlash] = useState(false)
  const isTransportProtocol = wizard.protocol !== '' && wizard.protocol !== 'shadowsocks'

  const wizardCanAdd =
    !!wizard.tag &&
    !!wizard.port &&
    !!wizard.protocol &&
    (!isTransportProtocol ||
      (!!wizard.network && !!wizard.security && (wizard.security !== 'reality' || (!!wizard.sni && !!wizard.realityPrivateKey && !!wizard.realityShortId))))

  const [scannerOpen, setScannerOpen] = useState(false)
  const [generatingKeys, setGeneratingKeys] = useState(false)
  const [generatedKey, setGeneratedKey] = useState<{ private_key: string; public_key: string; short_id: string } | null>(null)
  const [generatingIkev2Cert, setGeneratingIkev2Cert] = useState(false)
  const [usingPanelCert, setUsingPanelCert] = useState(false)

  function updateWizard<K extends keyof ReturnType<typeof emptyWizard>>(key: K, value: ReturnType<typeof emptyWizard>[K]) {
    setWizard((w) => ({ ...w, [key]: value }))
  }

  function addWizardToJson() {
    if (!wizardCanAdd) return
    let config: Record<string, unknown>
    try {
      config = form.configText.trim() ? JSON.parse(form.configText) : { inbounds: [] }
    } catch {
      setFormError(t.coresPage.invalidJson)
      return
    }
    if (!Array.isArray(config.inbounds)) config.inbounds = []
    const inbounds = config.inbounds as Record<string, unknown>[]
    const newInbound = buildInboundJson(wizard)
    const idx = inbounds.findIndex((i) => i.tag === wizard.tag)
    if (idx >= 0) inbounds[idx] = newInbound
    else inbounds.push(newInbound)
    setForm((f) => ({ ...f, configText: JSON.stringify(config, null, 2) }))
    setFormError(null)
    setAddedFlash(true)
    window.setTimeout(() => setAddedFlash(false), 1500)
  }

  async function refresh() {
    try {
      const res = await listCores()
      setCores(res.cores)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.coresPage.fetchError)
    }
  }

  async function refreshNodes() {
    try {
      const res = await listNodes()
      setNodes(res.nodes)
    } catch {
      // The node-assignment chips are a convenience next to each core; a
      // failed fetch here shouldn't block the rest of the Cores page.
    }
  }

  useEffect(() => {
    refresh()
    refreshNodes()
  }, [])

  useEffect(() => {
    if (createSignal > 0) openNew(engine)
  }, [createSignal])

  function openNew(type: CoreType | '') {
    setEditingId(null)
    setForm({ ...emptyForm(), coreType: type })
    setWizard(emptyWizard())
    setGeneratedKey(null)
    setLastWarnings([])
    setFormError(null)
    setShowForm(true)
  }

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm())
    setWizard(emptyWizard())
    setGeneratedKey(null)
    setShowForm(false)
    setLastWarnings([])
    setFormError(null)
  }

  function startEdit(core: Core) {
    setEditingId(core.id)
    setForm({
      coreType: core.core_type,
      name: core.name,
      note: core.note ?? '',
      configText: core.config ? JSON.stringify(core.config, null, 2) : '',
      l2tpPsk: core.l2tp_psk ?? '',
      ikev2Psk: core.ikev2_psk ?? '',
      ikev2RemoteId: core.ikev2_remote_id ?? '',
      ikev2Certificate: core.ikev2_certificate ?? '',
      ikev2CertificateKey: core.ikev2_certificate_key ?? '',
      ikev2EgressVless: core.ikev2_egress_vless ?? '',
      ikev2AuthMode: core.ikev2_auth_mode === 'psk' ? 'psk' : 'eap',
      hysteria2Port: core.hysteria2_port?.toString() ?? '',
      hysteria2Obfs: core.hysteria2_obfs ?? '',
      hysteria2RateMbps: core.hysteria2_rate_mbps?.toString() ?? '',
    })
    setWizard(emptyWizard())
    setLastWarnings([])
    setFormError(null)
    setShowForm(true)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setForm((f) => ({ ...f, configText: text }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function applyScannedTarget(c: RealityCandidate) {
    updateWizard('sni', c.host)
    const next = patchRealityInJson(form.configText, (reality) => {
      reality.dest = c.dest ?? `${c.host}:443`
      reality.serverNames = [c.host]
    })
    if (next !== null) setForm((f) => ({ ...f, configText: next }))
    say(t.ui.realityScan.applied(c.host))
  }

  async function generateKeys() {
    setGeneratingKeys(true)
    setFormError(null)
    try {
      const keys = await getRealityKeypair()
      setGeneratedKey(keys)
      setWizard((w) => ({ ...w, realityPrivateKey: keys.private_key, realityShortId: keys.short_id }))
      const next = patchRealityInJson(form.configText, (reality) => {
        reality.privateKey = keys.private_key
        reality.shortIds = [keys.short_id]
      })
      if (next !== null) {
        setForm((f) => ({ ...f, configText: next }))
        say(t.coresPage.realityKeysApplied)
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.coresPage.keyGenFailed)
    } finally {
      setGeneratingKeys(false)
    }
  }

  async function generateIkev2ServerCert() {
    setGeneratingIkev2Cert(true)
    setFormError(null)
    try {
      const pair = await generateIkev2Cert(form.ikev2RemoteId)
      setForm((f) => ({ ...f, ikev2Certificate: pair.certificate, ikev2CertificateKey: pair.key }))
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.coresPage.keyGenFailed)
    } finally {
      setGeneratingIkev2Cert(false)
    }
  }

  async function usePanelCertForIkev2() {
    setUsingPanelCert(true)
    setFormError(null)
    try {
      const pair = await getPanelCertForIkev2()
      setForm((f) => ({ ...f, ikev2Certificate: pair.certificate, ikev2CertificateKey: pair.key }))
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.coresPage.keyGenFailed)
    } finally {
      setUsingPanelCert(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setLastWarnings([])
    if (!form.coreType) return

    let config: Record<string, unknown> | undefined
    if (form.coreType === 'xray') {
      try {
        config = JSON.parse(form.configText)
      } catch {
        setFormError(t.coresPage.invalidJson)
        return
      }
    }

    setSubmitting(true)
    try {
      const payload = {
        name: form.name,
        note: form.note || null,
        core_type: form.coreType,
        config,
        l2tp_psk: form.coreType === 'l2tp' ? form.l2tpPsk || null : null,
        ikev2_psk: form.coreType === 'ikev2' ? form.ikev2Psk || null : null,
        ikev2_remote_id: form.coreType === 'ikev2' ? form.ikev2RemoteId || null : null,
        ikev2_certificate: form.coreType === 'ikev2' ? form.ikev2Certificate || null : null,
        ikev2_certificate_key: form.coreType === 'ikev2' ? form.ikev2CertificateKey || null : null,
        ikev2_egress_vless: form.coreType === 'ikev2' ? form.ikev2EgressVless || null : null,
        ikev2_auth_mode: form.coreType === 'ikev2' ? form.ikev2AuthMode : undefined,
        hysteria2_port: form.coreType === 'hysteria2' ? Number(form.hysteria2Port) || null : null,
        hysteria2_obfs: form.coreType === 'hysteria2' ? form.hysteria2Obfs || null : null,
        // Blank means no cap at all, which is different from zero.
        hysteria2_rate_mbps:
          form.coreType === 'hysteria2' ? (form.hysteria2RateMbps.trim() === '' ? null : Number(form.hysteria2RateMbps) || null) : null,
      }
      const result = editingId ? await updateCore(editingId, payload) : await createCore(payload)
      setLastWarnings(result.warnings)
      setEngine(result.core_type)
      if (result.warnings.length === 0) {
        resetForm()
        say(editingId ? c.saved : c.created)
      }
      await refresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(core: Core) {
    if (!window.confirm(t.coresPage.confirmDelete(core.name))) return
    try {
      await deleteCore(core.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.coresPage.inUseError)
    }
  }

  const byType = (type: CoreType) => (cores ?? []).filter((x) => x.core_type === type)
  const nodesRunning = (type: CoreType) => nodes.filter((n) => byType(type).some((x) => coreInSlot(n, type) === x.id))
  const shown = byType(engine)
  const codeCore = code ? cores?.find((x) => x.id === code.coreId) : undefined
  const engineSub: Record<CoreType, string> = { xray: c.xraySub, ikev2: c.ikev2Sub, hysteria2: c.hysteria2Sub, l2tp: c.l2tpSub }

  return (
    <div className="pg-cores">
      <h1 className="sr-only">{t.coresPage.title}</h1>

      <div className="engines" role="tablist" aria-label={t.coresPage.coreTypeLabel}>
        {CORE_TYPES.map((type) => {
          const count = byType(type).length
          const running = nodesRunning(type)
          return (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={engine === type}
              className={`engine ${count === 0 ? 'empty-engine' : ''}`}
              onClick={() => setEngine(type)}
            >
              <span className="mark">{type === 'xray' ? 'XRAY' : type === 'ikev2' ? 'IKEv2' : 'L2TP'}</span>
              <span className="t">
                <b>{t.coresPage.coreTypeLabels[type]}</b>
                <small>{engineSub[type]}</small>
                <span className="nodes">
                  {count === 0 ? (
                    c.notCreated
                  ) : (
                    <>
                      {running.slice(0, 4).map((n) => (
                        <span key={n.id} className={`tf-led ${n.status === 'connected' ? 'on' : n.status === 'error' ? 'err' : 'wait'}`} />
                      ))}
                      {c.engineCount(count, running.length)}
                    </>
                  )}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="sub-head">
        <p className="tf-note" style={{ margin: 0, maxWidth: '80ch' }}>
          {engine === 'xray' ? t.coresPage.intro : engineSub[engine]}
        </p>
        <button type="button" className="btn solid" onClick={() => openNew(engine)}>
          <IconPlus size={14} />
          {c.newOfType(t.coresPage.coreTypeLabels[engine])}
        </button>
      </div>

      {error && <div className="tf-alert">{error}</div>}

      {cores === null ? (
        <div className="skel" style={{ height: 260, borderRadius: 18 }} />
      ) : shown.length === 0 ? (
        <Empty
          title={c.emptyTitle(t.coresPage.coreTypeLabels[engine])}
          text={engine === 'l2tp' ? t.hostsPage.l2tpHint : engine === 'ikev2' ? t.coresPage.ikev2CertHint : t.coresPage.intro}
          action={
            <button type="button" className="btn solid" onClick={() => openNew(engine)}>
              <IconPlus size={14} />
              {c.newOfType(t.coresPage.coreTypeLabels[engine])}
            </button>
          }
        />
      ) : (
        shown.map((core) => {
          const config = (core.config ?? {}) as Record<string, unknown>
          const ruleCount = Array.isArray((config.routing as { rules?: unknown[] })?.rules) ? ((config.routing as { rules: unknown[] }).rules.length as number) : 0
          const outCount = Array.isArray(config.outbounds) ? (config.outbounds as unknown[]).length : 0
          const runningNodes = nodes.filter((n) => coreInSlot(n, core.core_type) === core.id)
          const coreLive = runningNodes.some((n) => n.status === 'connected')
          return (
            <div key={core.id} className="flex flex-col gap-3.5">
              <div className="tf-card">
                <div className="core-head">
                  <span className="t">
                    <b>{core.name}</b>
                    <small>{core.note || t.coresPage.coreTypeLabels[core.core_type]}</small>
                  </span>
                  {core.core_type === 'xray' &&
                    (core.warnings.length === 0 ? <span className="valid">✓ {c.validJson}</span> : <span className="pill warn">{c.warnings(core.warnings.length)}</span>)}
                  <span className="chips">
                    {core.core_type === 'xray' ? (
                      <>
                        <span className="chip">{c.inboundsCount(core.inbounds.length)}</span>
                        <span className="chip">{c.rulesCount(ruleCount)}</span>
                        <span className="chip">{c.outboundsCount(outCount)}</span>
                      </>
                    ) : (
                      <span className="chip">{c.hostsCount(core.host_count)}</span>
                    )}
                    <span className="chip">{c.nodesCount(runningNodes.length)}</span>
                  </span>
                  <span className="acts">
                    {core.core_type === 'xray' && (
                      <button type="button" className="btn" onClick={() => setCode({ coreId: core.id, part: 'all' })}>
                        {c.jsonFile}
                      </button>
                    )}
                    <button type="button" className="btn solid" onClick={() => startEdit(core)}>
                      {t.common.edit}
                    </button>
                    <button type="button" className="btn danger" onClick={() => handleDelete(core)}>
                      {t.common.delete}
                    </button>
                  </span>
                </div>
                {core.warnings.length > 0 && (
                  <div className="warn-box">
                    {core.warnings.map((w, i) => (
                      <div key={i}>• {w}</div>
                    ))}
                  </div>
                )}
                <NodeAssignment
                  core={core}
                  nodes={nodes}
                  onChanged={() => {
                    refreshNodes()
                    refresh()
                  }}
                />
              </div>

              {core.core_type === 'xray' && (
                <XrayFlow core={core} live={coreLive} onOpen={(part) => setCode({ coreId: core.id, part })} />
              )}

              {core.core_type === 'ikev2' && (
                <div className="ike-grid">
                  <div className="cert">
                    <div className="cert-top">
                      <small>SERVER CERTIFICATE</small>
                      <b>{core.ikev2_remote_id ?? '—'}</b>
                      <span style={{ fontSize: '.74rem', color: '#a08b6a' }}>
                        {core.ikev2_certificate ? t.coresPage.ikev2CertStatusCustom : t.coresPage.ikev2CertStatusAuto}
                      </span>
                    </div>
                    <div className="cert-kv">
                      <div>
                        <span>Remote ID</span>
                        <b className="mono">{core.ikev2_remote_id ?? '—'}</b>
                      </div>
                      <div>
                        <span>{t.coresPage.ikev2AuthModeLabel}</span>
                        <b>{core.ikev2_auth_mode === 'psk' ? t.coresPage.ikev2AuthModePsk : t.coresPage.ikev2AuthModeEap}</b>
                      </div>
                      <div>
                        <span>PSK</span>
                        <b className="en">{core.ikev2_psk ? '••••••••' : '—'}</b>
                      </div>
                      <div>
                        <span>{t.coresPage.colHosts}</span>
                        <b className="en">{core.host_count}</b>
                      </div>
                    </div>
                    <p className="hint" style={{ marginTop: 12 }}>
                      {core.ikev2_auth_mode === 'psk' ? t.coresPage.ikev2AuthModePskHint : t.coresPage.ikev2AuthModeEapHint}
                    </p>
                  </div>
                  <div className="tf-card chain-card">
                    <div className="tf-card-head">
                      <h3>{c.chainTitle}</h3>
                    </div>
                    <div className="chain">
                      <div className="hop">
                        <span className="box">{c.hopDevice}</span>
                        <small>{c.hopDeviceSub}</small>
                      </div>
                      <div className={`chain-wire ${coreLive ? '' : 'idle'}`} />
                      <div className="hop">
                        <span className="box">IKEv2</span>
                        <small className="en">{runningNodes.map((n) => n.name).join(', ') || '—'}</small>
                      </div>
                      {core.ikev2_egress_vless && (
                        <>
                          <div className={`chain-wire ${coreLive ? '' : 'idle'}`} />
                          <div className="hop extra">
                            <span className="box">VLESS</span>
                            <small>{c.hopEgress}</small>
                          </div>
                        </>
                      )}
                      <div className={`chain-wire ${coreLive ? '' : 'idle'}`} />
                      <div className="hop">
                        <span className="box">WWW</span>
                        <small>{c.hopInternet}</small>
                      </div>
                    </div>
                    <p className="chain-note">{core.ikev2_egress_vless ? c.chainEgress : c.chainDirect}</p>
                  </div>
                </div>
              )}

              {core.core_type === 'l2tp' && (
                <div className="tf-card" style={{ padding: 16 }}>
                  <div className="flex flex-wrap gap-2">
                    <span className="chip">PSK {core.l2tp_psk ? '••••••••' : '—'}</span>
                    <span className="chip en">UDP 500 · 1701 · 4500</span>
                    <span className="chip">{c.hostsCount(core.host_count)}</span>
                  </div>
                  <p className="hint">{t.hostsPage.l2tpHint}</p>
                </div>
              )}
            </div>
          )
        })
      )}

      {code && codeCore && <CodeSheet core={codeCore} part={code.part} onPart={(part) => setCode({ coreId: codeCore.id, part })} onClose={() => setCode(null)} />}

      {showForm && (
        <Sheet
          title={editingId ? c.formEdit(form.name) : c.formNew}
          sub={form.coreType ? t.coresPage.coreTypeLabels[form.coreType] : t.coresPage.coreTypeLabel}
          onClose={resetForm}
          full
          footer={
            form.coreType ? (
              <>
                <button type="submit" form="core-form" disabled={submitting} className="btn primary lg">
                  {submitting ? t.common.saving : editingId ? t.common.save : t.coresPage.createCoreBtn}
                </button>
                <button type="button" className="btn lg" onClick={resetForm}>
                  {t.usersPage.cancelAction}
                </button>
              </>
            ) : undefined
          }
        >
          <div>
            <div className="lbl">{t.coresPage.coreTypeLabel}</div>
            <div className="tf-seg">
              {CORE_TYPES.map((ct) => (
                <button
                  key={ct}
                  type="button"
                  aria-pressed={form.coreType === ct}
                  disabled={!!editingId}
                  onClick={() => setForm((f) => ({ ...emptyForm(), coreType: ct, name: f.name, note: f.note }))}
                >
                  {t.coresPage.coreTypeLabels[ct]}
                </button>
              ))}
            </div>
            {editingId && <div className="hint">{t.coresPage.coreTypeHint}</div>}
          </div>

          {form.coreType === 'xray' && (
            <div className="form-section">
              <h4>{t.coresPage.wizardTitle}</h4>
              <div className="hint" style={{ marginTop: -4 }}>
                {t.coresPage.wizardHint}
              </div>
              <div className="form-grid">
                <Field label={t.coresPage.tagLabel}>
                  <input className="input ltr" value={wizard.tag} onChange={(e) => updateWizard('tag', e.target.value)} placeholder="vless-reality-1" />
                </Field>
                <Field label={t.coresPage.protocolLabel}>
                  <select className="input" value={wizard.protocol} onChange={(e) => updateWizard('protocol', e.target.value as WizardProtocol)}>
                    <option value="" disabled>
                      {t.coresPage.selectPlaceholder}
                    </option>
                    <option value="vless">{protocolLabels.vless}</option>
                    <option value="vmess">{protocolLabels.vmess}</option>
                    <option value="trojan">{protocolLabels.trojan}</option>
                    <option value="shadowsocks">{protocolLabels.shadowsocks}</option>
                  </select>
                </Field>
                <Field label={t.coresPage.portLabel}>
                  <span className="flex gap-1.5">
                    <input className="input" type="number" min="1" max="65535" value={wizard.port} onChange={(e) => updateWizard('port', e.target.value)} />
                    <button type="button" onClick={() => updateWizard('port', randomPort())} className="btn" title="random">
                      🎲
                    </button>
                  </span>
                </Field>
                {isTransportProtocol && (
                  <>
                    <Field label={t.coresPage.networkLabel}>
                      <select className="input" value={wizard.network} onChange={(e) => updateWizard('network', e.target.value as typeof wizard.network)}>
                        <option value="" disabled>
                          {t.coresPage.selectPlaceholder}
                        </option>
                        <option value="tcp">{t.coresPage.networkTcp}</option>
                        <option value="ws">{t.coresPage.networkWs}</option>
                        <option value="grpc">{t.coresPage.networkGrpc}</option>
                      </select>
                    </Field>
                    <Field label={t.coresPage.securityLabel}>
                      <select className="input" value={wizard.security} onChange={(e) => updateWizard('security', e.target.value as typeof wizard.security)}>
                        <option value="" disabled>
                          {t.coresPage.selectPlaceholder}
                        </option>
                        <option value="none">{t.coresPage.securityNone}</option>
                        <option value="tls">{t.coresPage.securityTls}</option>
                        <option value="reality">{t.coresPage.securityReality}</option>
                      </select>
                    </Field>
                  </>
                )}
                {wizard.protocol === 'shadowsocks' && (
                  <Field label={t.coresPage.methodLabel}>
                    <input className="input ltr" value={wizard.method} onChange={(e) => updateWizard('method', e.target.value)} placeholder="2022-blake3-aes-128-gcm" />
                  </Field>
                )}
                {isTransportProtocol && (wizard.security === 'tls' || wizard.security === 'reality') && (
                  <>
                    <Field label={t.coresPage.sniLabel}>
                      <input className="input ltr" value={wizard.sni} onChange={(e) => updateWizard('sni', e.target.value)} placeholder="www.example.com" />
                    </Field>
                    <Field label={t.coresPage.fingerprintLabel}>
                      <select className="input ltr" value={wizard.fingerprint} onChange={(e) => updateWizard('fingerprint', e.target.value)}>
                        <option value="">{t.coresPage.selectPlaceholder}</option>
                        {FINGERPRINTS.map((fp) => (
                          <option key={fp} value={fp}>
                            {fp}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {wizard.security === 'tls' && (
                      <Field label={t.coresPage.alpnLabel}>
                        <input className="input ltr" value={wizard.alpn} onChange={(e) => updateWizard('alpn', e.target.value)} placeholder="h2,http/1.1" />
                      </Field>
                    )}
                  </>
                )}
                {isTransportProtocol && (wizard.network === 'ws' || wizard.network === 'grpc') && (
                  <>
                    <Field label={wizard.network === 'ws' ? t.coresPage.wsPathLabel : t.coresPage.grpcServiceLabel}>
                      <input className="input ltr" value={wizard.path} onChange={(e) => updateWizard('path', e.target.value)} />
                    </Field>
                    {wizard.network === 'ws' && (
                      <Field label={t.coresPage.hostHeaderLabel}>
                        <input className="input ltr" value={wizard.hostHeader} onChange={(e) => updateWizard('hostHeader', e.target.value)} />
                      </Field>
                    )}
                  </>
                )}
              </div>

              {isTransportProtocol && wizard.security === 'reality' && (
                <div className="form-section">
                  <h4>{t.coresPage.realityToolsTitle}</h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={generateKeys} disabled={generatingKeys} className="btn">
                      {generatingKeys ? t.coresPage.generatingKeys : t.coresPage.generateNewKey}
                    </button>
                    <button type="button" onClick={() => setScannerOpen(true)} className="btn">
                      {t.coresPage.suggestTarget}
                    </button>
                    <span className="hint mono" style={{ margin: 0 }}>
                      privateKey: {wizard.realityPrivateKey ? '••••••••' : '—'} · shortId: {wizard.realityShortId || '—'}
                    </span>
                  </div>
                  {generatedKey && (
                    <div className="hint" style={{ margin: 0 }}>
                      ✓ {t.coresPage.realityKeysInfo} <span className="mono">publicKey: {generatedKey.public_key}</span>
                    </div>
                  )}
                </div>
              )}

              {scannerOpen && <RealityScanner onPick={applyScannedTarget} onClose={() => setScannerOpen(false)} picked={wizard.sni} />}

              <div>
                <button type="button" onClick={addWizardToJson} disabled={!wizardCanAdd} className="btn solid">
                  {addedFlash ? t.coresPage.addedToJson : t.coresPage.addToJsonBtn}
                </button>
              </div>
            </div>
          )}

          {form.coreType && (
            <form id="core-form" onSubmit={handleSubmit} className="flex flex-col gap-3.5">
              <div className="form-grid">
                <Field label={t.coresPage.nameLabel}>
                  <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                </Field>
                <Field label={t.coresPage.noteLabel}>
                  <input className="input" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
                </Field>
              </div>

              {form.coreType === 'xray' && (
                <>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <label className="lbl" htmlFor="core-json">
                        {t.coresPage.configLabel}
                      </label>
                      <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={handleFileUpload} className="hidden" id="core-json-upload" />
                      <label htmlFor="core-json-upload" className="btn" style={{ marginBottom: 5 }}>
                        {t.coresPage.uploadJsonBtn}
                      </label>
                    </div>
                    <textarea
                      id="core-json"
                      className="input"
                      value={form.configText}
                      onChange={(e) => setForm((f) => ({ ...f, configText: e.target.value }))}
                      placeholder={t.coresPage.configPlaceholder}
                      required
                      rows={14}
                    />
                  </div>
                  <RoutingEditor configText={form.configText} setConfigText={(text) => setForm((f) => ({ ...f, configText: text }))} t={t} />
                  <OutboundsEditor configText={form.configText} setConfigText={(text) => setForm((f) => ({ ...f, configText: text }))} t={t} />
                </>
              )}

              {form.coreType === 'l2tp' && (
                <Field label={t.hostsPage.l2tpPskLabel} hint={t.hostsPage.l2tpHint}>
                  <input className="input ltr mono" value={form.l2tpPsk} onChange={(e) => setForm((f) => ({ ...f, l2tpPsk: e.target.value }))} required />
                </Field>
              )}

              {form.coreType === 'hysteria2' && (
                <>
                  <Field label={t.coresPage.hysteria2PortLabel} hint={t.coresPage.hysteria2PortHint}>
                    <input
                      className="input ltr mono"
                      type="number"
                      min={1}
                      max={65535}
                      value={form.hysteria2Port}
                      onChange={(e) => setForm((f) => ({ ...f, hysteria2Port: e.target.value }))}
                      required
                    />
                  </Field>
                  <Field label={t.coresPage.hysteria2ObfsLabel} hint={t.coresPage.hysteria2ObfsHint}>
                    <input
                      className="input ltr mono"
                      value={form.hysteria2Obfs}
                      onChange={(e) => setForm((f) => ({ ...f, hysteria2Obfs: e.target.value }))}
                      required
                    />
                  </Field>
                  <Field label={t.coresPage.hysteria2RateLabel} hint={t.coresPage.hysteria2RateHint}>
                    <input
                      className="input ltr mono"
                      type="number"
                      min={1}
                      max={10000}
                      placeholder={t.coresPage.hysteria2RatePlaceholder}
                      value={form.hysteria2RateMbps}
                      onChange={(e) => setForm((f) => ({ ...f, hysteria2RateMbps: e.target.value }))}
                    />
                  </Field>
                </>
              )}

              {form.coreType === 'ikev2' && (
                <>
                  <div>
                    <div className="lbl">{t.coresPage.ikev2AuthModeLabel}</div>
                    <div className="tf-seg">
                      {(['eap', 'psk'] as const).map((mode) => (
                        <button key={mode} type="button" aria-pressed={form.ikev2AuthMode === mode} onClick={() => setForm((f) => ({ ...f, ikev2AuthMode: mode }))}>
                          {mode === 'eap' ? t.coresPage.ikev2AuthModeEap : t.coresPage.ikev2AuthModePsk}
                        </button>
                      ))}
                    </div>
                    <div className="hint">{form.ikev2AuthMode === 'eap' ? t.coresPage.ikev2AuthModeEapHint : t.coresPage.ikev2AuthModePskHint}</div>
                  </div>
                  <div className="form-grid">
                    <Field label={t.coresPage.ikev2RemoteIdLabel}>
                      <input className="input ltr" value={form.ikev2RemoteId} onChange={(e) => setForm((f) => ({ ...f, ikev2RemoteId: e.target.value }))} required />
                    </Field>
                    <Field label={t.hostsPage.ikev2PskLabel} hint={t.hostsPage.ikev2PortsHint}>
                      <input
                        className="input ltr mono"
                        value={form.ikev2Psk}
                        onChange={(e) => setForm((f) => ({ ...f, ikev2Psk: e.target.value }))}
                        required={form.ikev2AuthMode === 'psk'}
                      />
                    </Field>
                    <Field label={t.coresPage.ikev2EgressVlessLabel} hint={t.coresPage.ikev2EgressVlessHint} wide>
                      <input
                        className="input ltr mono"
                        value={form.ikev2EgressVless}
                        onChange={(e) => setForm((f) => ({ ...f, ikev2EgressVless: e.target.value }))}
                        placeholder="vless://..."
                      />
                    </Field>
                  </div>
                  {form.ikev2AuthMode === 'eap' && (
                    <div className="form-section">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 style={{ margin: 0 }}>{t.coresPage.ikev2CertSourceLabel}</h4>
                        <span className="flex gap-1.5">
                          <button type="button" onClick={usePanelCertForIkev2} disabled={usingPanelCert} className="btn">
                            {usingPanelCert ? '…' : t.coresPage.ikev2UsePanelCertButton}
                          </button>
                          <button type="button" onClick={generateIkev2ServerCert} disabled={generatingIkev2Cert} className="btn">
                            {generatingIkev2Cert ? '…' : t.coresPage.ikev2GenerateCertButton}
                          </button>
                        </span>
                      </div>
                      <div className="form-grid">
                        <Field label={t.coresPage.ikev2CertificateLabel}>
                          <textarea
                            className="input"
                            rows={4}
                            value={form.ikev2Certificate}
                            onChange={(e) => setForm((f) => ({ ...f, ikev2Certificate: e.target.value }))}
                            placeholder="-----BEGIN CERTIFICATE-----"
                          />
                        </Field>
                        <Field label={t.coresPage.ikev2CertificateKeyLabel}>
                          <textarea
                            className="input"
                            rows={4}
                            value={form.ikev2CertificateKey}
                            onChange={(e) => setForm((f) => ({ ...f, ikev2CertificateKey: e.target.value }))}
                            placeholder="-----BEGIN PRIVATE KEY-----"
                          />
                        </Field>
                        <Field label={t.coresPage.ikev2CertPathLabel}>
                          <input className="input ltr mono" readOnly disabled value={IKEV2_CERT_NODE_PATH} />
                        </Field>
                        <Field label={t.coresPage.ikev2CertKeyPathLabel}>
                          <input className="input ltr mono" readOnly disabled value={IKEV2_CERT_KEY_NODE_PATH} />
                        </Field>
                      </div>
                      <div className="hint" style={{ margin: 0 }}>
                        {t.coresPage.ikev2CertHint}
                      </div>
                      <div className="hint" style={{ margin: 0 }}>
                        {t.coresPage.ikev2CertPathHint}
                      </div>
                    </div>
                  )}
                </>
              )}

              {lastWarnings.length > 0 && (
                <div className="tf-alert" style={{ color: 'var(--warn)', background: 'rgb(245 158 11 / .08)', borderColor: 'rgb(245 158 11 / .3)', flexDirection: 'column' }}>
                  <b>{t.coresPage.warningsTitle}</b>
                  {lastWarnings.map((w, i) => (
                    <span key={i}>• {w}</span>
                  ))}
                </div>
              )}
              {formError && <div className="tf-alert">{formError}</div>}
            </form>
          )}
        </Sheet>
      )}
    </div>
  )
}
