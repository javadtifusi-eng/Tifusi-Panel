import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLang } from '../i18n/LangContext'
import {
  ApiError,
  createCore,
  deleteCore,
  FINGERPRINTS,
  getRealityKeypair,
  getWireGuardKeypair,
  listCores,
  listNodes,
  scanReality,
  updateCore,
  updateNode,
  type Core,
  type CoreType,
  type Node,
  type RealityScanResult,
} from '../lib/api'

const ACCENT = '#22D3EE'

const inputClass =
  'rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60'
const labelClass = 'mb-1.5 block text-xs text-slate-400'
const monoTextarea =
  'w-full rounded-lg border border-white/15 bg-black/30 p-3 font-mono text-xs text-cyan-100 outline-none focus:border-cyan-400/60'

const CORE_TYPES: CoreType[] = ['xray', 'wireguard', 'l2tp', 'ikev2']

function emptyForm() {
  return {
    coreType: '' as CoreType | '',
    name: '',
    note: '',
    configText: '',
    wireguardPublicKey: '',
    wireguardPrivateKey: '',
    wireguardPort: '',
    wireguardSubnet: '',
    l2tpPsk: '',
    ikev2Psk: '',
    ikev2RemoteId: '',
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
  outboundTag?: string
}

// RoutingEditor edits config.routing.rules directly on the same raw JSON
// string the rest of the form (and the inbound wizard above it) already
// treats as the single source of truth - no separate state to drift out
// of sync with a manual edit to the JSON textarea below.
function RoutingEditor({
  configText,
  setConfigText,
  t,
}: {
  configText: string
  setConfigText: (text: string) => void
  t: ReturnType<typeof useLang>['t']
}) {
  const config = parseConfig(configText)
  const routing = (config.routing as { rules?: RoutingRule[] } | undefined) ?? {}
  const rules = Array.isArray(routing.rules) ? routing.rules : []
  const outbounds = Array.isArray(config.outbounds) ? (config.outbounds as { tag?: string }[]) : []
  const outboundTags = outbounds.map((o) => o.tag).filter((tag): tag is string => !!tag)
  const tagOptions = outboundTags.length > 0 ? outboundTags : ['direct']

  function commit(nextRules: RoutingRule[]) {
    setConfigText(JSON.stringify({ ...config, routing: { ...routing, rules: nextRules } }, null, 2))
  }
  function addRule() {
    commit([...rules, { type: 'field', domain: [], ip: [], outboundTag: tagOptions[0] }])
  }
  function updateRule(i: number, patch: Partial<RoutingRule>) {
    commit(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function removeRule(i: number) {
    commit(rules.filter((_, idx) => idx !== i))
  }
  function moveRule(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= rules.length) return
    const next = [...rules]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }

  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-xs font-bold text-slate-300">{t.coresPage.routingTitle}</div>
        <button type="button" onClick={addRule} className="text-xs font-bold" style={{ color: ACCENT }}>
          {t.coresPage.addRuleBtn}
        </button>
      </div>
      <div className="mb-3 text-[11px] text-slate-500">{t.coresPage.routingHint}</div>
      {rules.length === 0 && <div className="text-xs text-slate-500">{t.coresPage.noRulesYet}</div>}
      <div className="flex flex-col gap-2">
        {rules.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-white/10 p-2">
            <div>
              <label className="mb-1 block text-[10px] text-slate-500">{t.coresPage.ruleDomainLabel}</label>
              <input
                dir="ltr"
                value={(r.domain ?? []).join(', ')}
                onChange={(e) => updateRule(i, { domain: csvToList(e.target.value) })}
                placeholder="geosite:category-ads-all, example.com"
                className={`${inputClass} w-64 text-left`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-slate-500">{t.coresPage.ruleIpLabel}</label>
              <input
                dir="ltr"
                value={(r.ip ?? []).join(', ')}
                onChange={(e) => updateRule(i, { ip: csvToList(e.target.value) })}
                placeholder="geoip:private, geoip:ir"
                className={`${inputClass} w-52 text-left`}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-slate-500">{t.coresPage.ruleOutboundLabel}</label>
              <select
                dir="ltr"
                value={r.outboundTag ?? tagOptions[0]}
                onChange={(e) => updateRule(i, { outboundTag: e.target.value })}
                className={inputClass}
              >
                {tagOptions.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => moveRule(i, -1)} className="text-xs text-slate-400 hover:text-slate-200">
                ↑
              </button>
              <button type="button" onClick={() => moveRule(i, 1)} className="text-xs text-slate-400 hover:text-slate-200">
                ↓
              </button>
              <button type="button" onClick={() => removeRule(i)} className="text-xs text-red-400 hover:underline">
                {t.common.delete}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const OUTBOUND_PROTOCOLS = ['freedom', 'blackhole', 'vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http'] as const
type OutboundProtocol = (typeof OUTBOUND_PROTOCOLS)[number]

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
      return { address: (server?.address as string) ?? '', port: server?.port != null ? String(server.port) : '', secret: (server?.password as string) ?? '' }
    case 'shadowsocks':
      return { address: (server?.address as string) ?? '', port: server?.port != null ? String(server.port) : '', secret: (server?.password as string) ?? '' }
    case 'socks':
    case 'http':
      return { address: (server?.address as string) ?? '', port: server?.port != null ? String(server.port) : '', secret: '' }
    default:
      return { address: '', port: '', secret: '' }
  }
}

function buildOutboundSettings(
  protocol: string | undefined,
  fields: { address: string; port: string; secret: string },
): Record<string, unknown> {
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
function OutboundsEditor({
  configText,
  setConfigText,
  t,
}: {
  configText: string
  setConfigText: (text: string) => void
  t: ReturnType<typeof useLang>['t']
}) {
  const config = parseConfig(configText)
  const outbounds = Array.isArray(config.outbounds) ? (config.outbounds as OutboundEntry[]) : []

  function commit(next: OutboundEntry[]) {
    setConfigText(JSON.stringify({ ...config, outbounds: next }, null, 2))
  }
  function addOutbound() {
    commit([...outbounds, { tag: `outbound-${outbounds.length + 1}`, protocol: 'freedom', settings: {} }])
  }
  function updateOutbound(i: number, patch: Partial<OutboundEntry>) {
    commit(outbounds.map((o, idx) => (idx === i ? { ...o, ...patch } : o)))
  }
  function removeOutbound(i: number) {
    commit(outbounds.filter((_, idx) => idx !== i))
  }
  function moveOutbound(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= outbounds.length) return
    const next = [...outbounds]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }

  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-xs font-bold text-slate-300">{t.coresPage.outboundsTitle}</div>
        <button type="button" onClick={addOutbound} className="text-xs font-bold" style={{ color: ACCENT }}>
          {t.coresPage.addOutboundBtn}
        </button>
      </div>
      <div className="mb-3 text-[11px] text-slate-500">{t.coresPage.outboundsHint}</div>
      {outbounds.length === 0 && <div className="text-xs text-slate-500">{t.coresPage.noOutboundsYet}</div>}
      <div className="flex flex-col gap-2">
        {outbounds.map((o, i) => {
          const needsServer = o.protocol !== 'freedom' && o.protocol !== 'blackhole'
          const fields = outboundServerFields(o.protocol, o.settings ?? {})
          return (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-white/10 p-2">
              <div>
                <label className="mb-1 block text-[10px] text-slate-500">{t.coresPage.outboundTagLabel}</label>
                <input
                  dir="ltr"
                  value={o.tag ?? ''}
                  onChange={(e) => updateOutbound(i, { tag: e.target.value })}
                  className={`${inputClass} w-32 text-left`}
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-slate-500">{t.coresPage.outboundProtocolLabel}</label>
                <select
                  dir="ltr"
                  value={o.protocol ?? 'freedom'}
                  onChange={(e) => updateOutbound(i, { protocol: e.target.value, settings: {} })}
                  className={inputClass}
                >
                  {OUTBOUND_PROTOCOLS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              {needsServer && (
                <>
                  <div>
                    <label className="mb-1 block text-[10px] text-slate-500">{t.coresPage.outboundAddressLabel}</label>
                    <input
                      dir="ltr"
                      value={fields.address}
                      onChange={(e) =>
                        updateOutbound(i, { settings: buildOutboundSettings(o.protocol, { ...fields, address: e.target.value }) })
                      }
                      className={`${inputClass} w-40 text-left`}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] text-slate-500">{t.coresPage.outboundPortLabel}</label>
                    <input
                      dir="ltr"
                      type="number"
                      value={fields.port}
                      onChange={(e) =>
                        updateOutbound(i, { settings: buildOutboundSettings(o.protocol, { ...fields, port: e.target.value }) })
                      }
                      className={`${inputClass} w-20 text-left`}
                    />
                  </div>
                  {(o.protocol === 'vless' || o.protocol === 'vmess' || o.protocol === 'trojan' || o.protocol === 'shadowsocks') && (
                    <div>
                      <label className="mb-1 block text-[10px] text-slate-500">{t.coresPage.outboundSecretLabel}</label>
                      <input
                        dir="ltr"
                        value={fields.secret}
                        onChange={(e) =>
                          updateOutbound(i, { settings: buildOutboundSettings(o.protocol, { ...fields, secret: e.target.value }) })
                        }
                        className={`${inputClass} w-40 text-left font-mono`}
                      />
                    </div>
                  )}
                </>
              )}
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => moveOutbound(i, -1)} className="text-xs text-slate-400 hover:text-slate-200">
                  ↑
                </button>
                <button type="button" onClick={() => moveOutbound(i, 1)} className="text-xs text-slate-400 hover:text-slate-200">
                  ↓
                </button>
                <button type="button" onClick={() => removeOutbound(i)} className="text-xs text-red-400 hover:underline">
                  {t.common.delete}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// DnsLogEditor edits config.dns.servers and config.log.loglevel - the two
// general settings actually worth exposing (everything else the builder
// already defaults sensibly, see app/xray_config/builder.py).
function DnsLogEditor({
  configText,
  setConfigText,
  t,
}: {
  configText: string
  setConfigText: (text: string) => void
  t: ReturnType<typeof useLang>['t']
}) {
  const config = parseConfig(configText)
  const dns = (config.dns as { servers?: string[] } | undefined) ?? {}
  const log = (config.log as { loglevel?: string } | undefined) ?? {}
  const dnsServers = Array.isArray(dns.servers) ? dns.servers : []

  function patch(next: Record<string, unknown>) {
    setConfigText(JSON.stringify({ ...config, ...next }, null, 2))
  }

  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-3 text-xs font-bold text-slate-300">{t.coresPage.generalSettingsTitle}</div>
      <div className="flex flex-wrap gap-3">
        <div>
          <label className={labelClass}>{t.coresPage.dnsServersLabel}</label>
          <input
            dir="ltr"
            value={dnsServers.join(', ')}
            onChange={(e) => patch({ dns: { ...dns, servers: csvToList(e.target.value) } })}
            placeholder="1.1.1.1, 8.8.8.8"
            className={`${inputClass} w-64 text-left`}
          />
        </div>
        <div>
          <label className={labelClass}>{t.coresPage.logLevelLabel}</label>
          <select
            dir="ltr"
            value={log.loglevel ?? 'warning'}
            onChange={(e) => patch({ log: { ...log, loglevel: e.target.value } })}
            className={inputClass}
          >
            {['debug', 'info', 'warning', 'error', 'none'].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}

// NodeAssignmentEditor is how "which node runs this core" actually gets
// set now — moved here from the Node form (which only owned repeating a
// core_id/ipsec_core_id dropdown) so the core/node relationship lives in
// exactly one place instead of two forms that could disagree.
function NodeAssignmentEditor({
  core,
  nodes,
  onChanged,
  t,
}: {
  core: Core
  nodes: Node[]
  onChanged: () => void
  t: ReturnType<typeof useLang>['t']
}) {
  const [busyId, setBusyId] = useState<number | null>(null)
  const [egressDrafts, setEgressDrafts] = useState<Record<number, string>>({})
  const isIpsec = core.core_type === 'l2tp' || core.core_type === 'ikev2'

  async function toggle(node: Node, assign: boolean) {
    setBusyId(node.id)
    try {
      if (isIpsec) await updateNode(node.id, { ipsec_core_id: assign ? core.id : null })
      else await updateNode(node.id, { core_id: assign ? core.id : null })
      onChanged()
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
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mt-3 border-t border-white/5 pt-3">
      <div className="mb-2 text-xs font-bold text-slate-300">{t.coresPage.assignedNodesTitle}</div>
      {nodes.length === 0 && <div className="text-xs text-slate-500">{t.nodesPage.noNodesYet}</div>}
      <div className="flex flex-col gap-1.5">
        {nodes.map((n) => {
          const assignedHere = isIpsec ? n.ipsec_core_id === core.id : n.core_id === core.id
          const assignedElsewhere = !assignedHere && (isIpsec ? n.ipsec_core_id != null : n.core_id != null)
          return (
            <div key={n.id} className="rounded-lg border border-white/10 p-2">
              <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={assignedHere}
                    disabled={busyId === n.id}
                    onChange={(e) => toggle(n, e.target.checked)}
                  />
                  <span className="text-slate-200">{n.name}</span>
                  <span dir="ltr" className="font-mono text-[10px] text-slate-500">
                    {n.address}
                  </span>
                </span>
                {assignedElsewhere && <span className="text-[10px] text-amber-400">{t.coresPage.assignedElsewhere}</span>}
              </label>
              {core.core_type === 'l2tp' && assignedHere && (
                <div className="mt-2">
                  <label className="mb-1 block text-[10px] text-slate-500" title={t.nodesPage.l2tpEgressHint}>
                    {t.nodesPage.l2tpEgressLabel}
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      dir="ltr"
                      value={egressDrafts[n.id] ?? n.l2tp_egress_vless ?? ''}
                      onChange={(e) => setEgressDrafts((d) => ({ ...d, [n.id]: e.target.value }))}
                      placeholder="vless://..."
                      className={`${inputClass} flex-1 text-left font-mono text-[11px]`}
                    />
                    <button
                      type="button"
                      onClick={() => saveEgress(n)}
                      disabled={busyId === n.id}
                      className="rounded-lg px-2.5 text-xs font-bold disabled:opacity-60"
                      style={{ color: ACCENT }}
                    >
                      {t.common.save}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function CoresPage() {
  const { t } = useLang()
  const protocolLabels = t.coresPage.protocolLabels
  const [cores, setCores] = useState<Core[] | null>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [lastWarnings, setLastWarnings] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [wizard, setWizard] = useState(emptyWizard())
  const [addedFlash, setAddedFlash] = useState(false)
  const isTransportProtocol = wizard.protocol !== '' && wizard.protocol !== 'shadowsocks'

  const wizardCanAdd =
    !!wizard.tag &&
    !!wizard.port &&
    !!wizard.protocol &&
    (!isTransportProtocol ||
      (!!wizard.network &&
        !!wizard.security &&
        (wizard.security !== 'reality' || (!!wizard.sni && !!wizard.realityPrivateKey && !!wizard.realityShortId))))

  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<RealityScanResult[] | null>(null)
  const [generatingKeys, setGeneratingKeys] = useState(false)
  const [generatedKey, setGeneratedKey] = useState<{ private_key: string; public_key: string; short_id: string } | null>(
    null,
  )
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const [generatingWgKeys, setGeneratingWgKeys] = useState(false)
  const [showWgPrivateKey, setShowWgPrivateKey] = useState(false)

  function updateWizard<K extends keyof ReturnType<typeof emptyWizard>>(
    key: K,
    value: ReturnType<typeof emptyWizard>[K],
  ) {
    setWizard((w) => ({ ...w, [key]: value }))
  }

  function addWizardToJson() {
    if (!wizardCanAdd) return
    let config: Record<string, unknown>
    try {
      config = form.configText.trim() ? JSON.parse(form.configText) : { inbounds: [] }
    } catch {
      setError(t.coresPage.invalidJson)
      return
    }
    if (!Array.isArray(config.inbounds)) config.inbounds = []
    const inbounds = config.inbounds as Record<string, unknown>[]
    const newInbound = buildInboundJson(wizard)
    const idx = inbounds.findIndex((i) => i.tag === wizard.tag)
    if (idx >= 0) inbounds[idx] = newInbound
    else inbounds.push(newInbound)
    setForm((f) => ({ ...f, configText: JSON.stringify(config, null, 2) }))
    setError(null)
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
      // The node-assignment list is a convenience next to each core; a
      // failed fetch here shouldn't block the rest of the Cores page.
    }
  }

  useEffect(() => {
    refresh()
    refreshNodes()
  }, [])

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm())
    setWizard(emptyWizard())
    setScanResults(null)
    setGeneratedKey(null)
    setShowForm(false)
    setLastWarnings([])
    setError(null)
  }

  function startEdit(core: Core) {
    setEditingId(core.id)
    setForm({
      coreType: core.core_type,
      name: core.name,
      note: core.note ?? '',
      configText: core.config ? JSON.stringify(core.config, null, 2) : '',
      wireguardPublicKey: core.wireguard_public_key ?? '',
      wireguardPrivateKey: core.wireguard_private_key ?? '',
      wireguardPort: core.wireguard_port != null ? String(core.wireguard_port) : '',
      wireguardSubnet: core.wireguard_subnet ?? '',
      l2tpPsk: core.l2tp_psk ?? '',
      ikev2Psk: core.ikev2_psk ?? '',
      ikev2RemoteId: core.ikev2_remote_id ?? '',
    })
    setWizard(emptyWizard())
    setLastWarnings([])
    setShowForm(true)
  }

  async function generateWgKeys() {
    setGeneratingWgKeys(true)
    setError(null)
    try {
      const keys = await getWireGuardKeypair()
      setForm((f) => ({ ...f, wireguardPublicKey: keys.public_key, wireguardPrivateKey: keys.private_key }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.hostsPage.keyGenFailed)
    } finally {
      setGeneratingWgKeys(false)
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setForm((f) => ({ ...f, configText: text }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function copy(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard API unavailable — value stays visible to select by hand.
    }
    setCopiedField(field)
    window.setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 1200)
  }

  async function runScan() {
    setScanning(true)
    setError(null)
    setScanResults(null)
    try {
      const res = await scanReality()
      setScanResults(res.results)
      if (!res.results.some((r) => r.recommended)) setError(t.coresPage.noTargetFound)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.coresPage.scanFailed)
    } finally {
      setScanning(false)
    }
  }

  async function generateKeys() {
    setGeneratingKeys(true)
    setError(null)
    try {
      const keys = await getRealityKeypair()
      setGeneratedKey(keys)
      setWizard((w) => ({ ...w, realityPrivateKey: keys.private_key, realityShortId: keys.short_id }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.coresPage.keyGenFailed)
    } finally {
      setGeneratingKeys(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLastWarnings([])
    if (!form.coreType) return

    let config: Record<string, unknown> | undefined
    if (form.coreType === 'xray') {
      try {
        config = JSON.parse(form.configText)
      } catch {
        setError(t.coresPage.invalidJson)
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
        wireguard_public_key: form.coreType === 'wireguard' ? form.wireguardPublicKey || null : null,
        wireguard_private_key: form.coreType === 'wireguard' ? form.wireguardPrivateKey || null : null,
        wireguard_port: form.coreType === 'wireguard' && form.wireguardPort ? parseInt(form.wireguardPort, 10) : null,
        wireguard_subnet: form.coreType === 'wireguard' ? form.wireguardSubnet || null : null,
        l2tp_psk: form.coreType === 'l2tp' ? form.l2tpPsk || null : null,
        ikev2_psk: form.coreType === 'ikev2' ? form.ikev2Psk || null : null,
        ikev2_remote_id: form.coreType === 'ikev2' ? form.ikev2RemoteId || null : null,
      }
      const result = editingId ? await updateCore(editingId, payload) : await createCore(payload)
      setLastWarnings(result.warnings)
      if (result.warnings.length === 0) resetForm()
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
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

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-50">{t.coresPage.title}</h1>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="rounded-lg px-4 py-2 text-sm font-bold text-slate-950"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #0891b2)` }}
        >
          {t.coresPage.newBtn}
        </button>
      </div>
      <p className="mb-6 text-sm text-slate-400">{t.coresPage.intro}</p>

      {showForm && (
        <div className="mb-6 rounded-xl border border-cyan-400/20 bg-slate-950/60 p-4">
          <div className="mb-4">
            <label className={labelClass}>{t.coresPage.coreTypeLabel}</label>
            <div className="flex flex-wrap gap-2">
              {CORE_TYPES.map((ct) => (
                <button
                  key={ct}
                  type="button"
                  disabled={!!editingId}
                  onClick={() => setForm((f) => ({ ...emptyForm(), coreType: ct, name: f.name, note: f.note }))}
                  className="rounded-lg border px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                  style={
                    form.coreType === ct
                      ? { borderColor: ACCENT, color: ACCENT, backgroundColor: 'rgba(34,211,238,0.1)' }
                      : { borderColor: 'rgba(255,255,255,0.15)', color: '#cbd5e1' }
                  }
                >
                  {t.coresPage.coreTypeLabels[ct]}
                </button>
              ))}
            </div>
            {editingId && <div className="mt-1.5 text-[11px] text-slate-500">{t.coresPage.coreTypeHint}</div>}
          </div>

          {form.coreType === 'xray' && (
          <div className="mb-4 rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="mb-1 text-xs font-bold text-slate-300">{t.coresPage.wizardTitle}</div>
            <div className="mb-3 text-[11px] text-slate-500">{t.coresPage.wizardHint}</div>

            <div className="flex flex-wrap gap-3">
              <div>
                <label className={labelClass}>{t.coresPage.tagLabel}</label>
                <input
                  dir="ltr"
                  value={wizard.tag}
                  onChange={(e) => updateWizard('tag', e.target.value)}
                  placeholder="vless-reality-1"
                  className={`${inputClass} w-40 text-left`}
                />
              </div>
              <div>
                <label className={labelClass}>{t.coresPage.protocolLabel}</label>
                <select
                  value={wizard.protocol}
                  onChange={(e) => updateWizard('protocol', e.target.value as WizardProtocol)}
                  className={inputClass}
                >
                  <option value="" disabled>
                    {t.coresPage.selectPlaceholder}
                  </option>
                  <option value="vless">{protocolLabels.vless}</option>
                  <option value="vmess">{protocolLabels.vmess}</option>
                  <option value="trojan">{protocolLabels.trojan}</option>
                  <option value="shadowsocks">{protocolLabels.shadowsocks}</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>{t.coresPage.portLabel}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={wizard.port}
                    onChange={(e) => updateWizard('port', e.target.value)}
                    className={`${inputClass} w-24`}
                  />
                  <button
                    type="button"
                    onClick={() => updateWizard('port', randomPort())}
                    className="rounded-lg border px-2.5 py-2 text-xs font-bold"
                    style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                  >
                    🎲
                  </button>
                </div>
              </div>

              {isTransportProtocol && (
                <>
                  <div>
                    <label className={labelClass}>{t.coresPage.networkLabel}</label>
                    <select
                      value={wizard.network}
                      onChange={(e) => updateWizard('network', e.target.value as typeof wizard.network)}
                      className={inputClass}
                    >
                      <option value="" disabled>
                        {t.coresPage.selectPlaceholder}
                      </option>
                      <option value="tcp">{t.coresPage.networkTcp}</option>
                      <option value="ws">{t.coresPage.networkWs}</option>
                      <option value="grpc">{t.coresPage.networkGrpc}</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>{t.coresPage.securityLabel}</label>
                    <select
                      value={wizard.security}
                      onChange={(e) => updateWizard('security', e.target.value as typeof wizard.security)}
                      className={inputClass}
                    >
                      <option value="" disabled>
                        {t.coresPage.selectPlaceholder}
                      </option>
                      <option value="none">{t.coresPage.securityNone}</option>
                      <option value="tls">{t.coresPage.securityTls}</option>
                      <option value="reality">{t.coresPage.securityReality}</option>
                    </select>
                  </div>
                </>
              )}
              {wizard.protocol === 'shadowsocks' && (
                <div>
                  <label className={labelClass}>{t.coresPage.methodLabel}</label>
                  <input
                    dir="ltr"
                    value={wizard.method}
                    onChange={(e) => updateWizard('method', e.target.value)}
                    placeholder="2022-blake3-aes-128-gcm"
                    className={`${inputClass} w-52 text-left`}
                  />
                </div>
              )}
            </div>

            {isTransportProtocol && (wizard.security === 'tls' || wizard.security === 'reality') && (
              <div className="mt-3 flex flex-wrap gap-3">
                <div>
                  <label className={labelClass}>{t.coresPage.sniLabel}</label>
                  <input
                    dir="ltr"
                    value={wizard.sni}
                    onChange={(e) => updateWizard('sni', e.target.value)}
                    placeholder="www.example.com"
                    className={`${inputClass} text-left`}
                  />
                </div>
                <div>
                  <label className={labelClass}>{t.coresPage.fingerprintLabel}</label>
                  <select
                    dir="ltr"
                    value={wizard.fingerprint}
                    onChange={(e) => updateWizard('fingerprint', e.target.value)}
                    className={`${inputClass} w-36 text-left`}
                  >
                    <option value="">{t.coresPage.selectPlaceholder}</option>
                    {FINGERPRINTS.map((fp) => (
                      <option key={fp} value={fp}>
                        {fp}
                      </option>
                    ))}
                  </select>
                </div>
                {wizard.security === 'tls' && (
                  <div>
                    <label className={labelClass}>{t.coresPage.alpnLabel}</label>
                    <input
                      dir="ltr"
                      value={wizard.alpn}
                      onChange={(e) => updateWizard('alpn', e.target.value)}
                      placeholder="h2,http/1.1"
                      className={`${inputClass} text-left`}
                    />
                  </div>
                )}
              </div>
            )}

            {isTransportProtocol && wizard.security === 'reality' && (
              <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="mb-2 text-xs font-bold text-slate-300">{t.coresPage.realityToolsTitle}</div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={generateKeys}
                    disabled={generatingKeys}
                    className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-60"
                    style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                  >
                    {generatingKeys ? t.coresPage.generatingKeys : t.coresPage.generateNewKey}
                  </button>
                  <button
                    type="button"
                    onClick={runScan}
                    disabled={scanning}
                    className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-60"
                    style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                  >
                    {scanning ? t.coresPage.scanning : t.coresPage.suggestTarget}
                  </button>
                  <div className="text-[11px] text-slate-500">
                    <span dir="ltr" className="font-mono">
                      privateKey: {wizard.realityPrivateKey ? '••••••••' : '—'} · shortId:{' '}
                      {wizard.realityShortId || '—'}
                    </span>
                  </div>
                </div>

                {generatedKey && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(['private_key', 'public_key', 'short_id'] as const).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => copy(generatedKey[key], key)}
                        dir="ltr"
                        className="truncate rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-left font-mono text-[11px] text-cyan-200 hover:border-cyan-400/40"
                        title={generatedKey[key]}
                      >
                        {copiedField === key ? t.coresPage.copied : `${key}: ${generatedKey[key]}`}
                      </button>
                    ))}
                  </div>
                )}

                {scanResults !== null && scanResults.length > 0 && (
                  <div className="mt-3 max-h-64 overflow-y-auto overflow-x-auto rounded-lg border border-white/10">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-slate-400">
                          <th className="px-3 py-2 text-left font-medium" dir="ltr">
                            {t.coresPage.scanColHost}
                          </th>
                          <th className="px-3 py-2 font-medium">{t.coresPage.scanColStatus}</th>
                          <th className="px-3 py-2 font-medium">{t.coresPage.scanColTls}</th>
                          <th className="px-3 py-2 font-medium">{t.coresPage.scanColLatency}</th>
                          <th className="px-3 py-2 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {scanResults.map((r) => (
                          <tr key={r.host} className="border-b border-white/5 last:border-0">
                            <td dir="ltr" className="px-3 py-2 text-left font-mono text-slate-200">
                              {r.host}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {r.recommended ? (
                                <span className="font-bold" style={{ color: ACCENT }}>
                                  {t.coresPage.scanStatusRecommended}
                                </span>
                              ) : r.reachable ? (
                                <span className="text-slate-300">{t.coresPage.scanStatusUsable}</span>
                              ) : (
                                <span className="text-red-400">{t.coresPage.scanStatusUnreachable}</span>
                              )}
                            </td>
                            <td dir="ltr" className="px-3 py-2 text-center font-mono text-slate-400">
                              {r.tls_version ?? '—'}
                            </td>
                            <td dir="ltr" className="px-3 py-2 text-center font-mono text-slate-400">
                              {r.latency_ms != null ? `${r.latency_ms}ms` : '—'}
                            </td>
                            <td className="px-3 py-2 text-left">
                              {r.reachable && (
                                <button
                                  type="button"
                                  onClick={() => updateWizard('sni', r.host)}
                                  className="text-[11px] hover:underline"
                                  style={{ color: ACCENT }}
                                >
                                  {wizard.sni === r.host ? t.coresPage.copied : t.coresPage.useAsTarget}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {isTransportProtocol && (wizard.network === 'ws' || wizard.network === 'grpc') && (
              <div className="mt-3 flex flex-wrap gap-3">
                <div>
                  <label className={labelClass}>
                    {wizard.network === 'ws' ? t.coresPage.wsPathLabel : t.coresPage.grpcServiceLabel}
                  </label>
                  <input
                    dir="ltr"
                    value={wizard.path}
                    onChange={(e) => updateWizard('path', e.target.value)}
                    className={`${inputClass} w-40 text-left`}
                  />
                </div>
                {wizard.network === 'ws' && (
                  <div>
                    <label className={labelClass}>{t.coresPage.hostHeaderLabel}</label>
                    <input
                      dir="ltr"
                      value={wizard.hostHeader}
                      onChange={(e) => updateWizard('hostHeader', e.target.value)}
                      className={`${inputClass} w-40 text-left`}
                    />
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={addWizardToJson}
              disabled={!wizardCanAdd}
              className="mt-3 rounded-lg px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-40"
              style={{ backgroundColor: ACCENT }}
            >
              {addedFlash ? t.coresPage.addedToJson : t.coresPage.addToJsonBtn}
            </button>
          </div>
          )}

          {form.coreType && (
          <form onSubmit={handleSubmit}>
            <div className="flex flex-wrap gap-3">
              <div>
                <label className={labelClass}>{t.coresPage.nameLabel}</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{t.coresPage.noteLabel}</label>
                <input
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  className={`${inputClass} w-56`}
                />
              </div>
            </div>

            {form.coreType === 'xray' && (
            <>
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <label className={labelClass}>{t.coresPage.configLabel}</label>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="core-json-upload"
                  />
                  <label
                    htmlFor="core-json-upload"
                    className="cursor-pointer rounded-lg border px-3 py-1 text-xs font-bold"
                    style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                  >
                    {t.coresPage.uploadJsonBtn}
                  </label>
                </div>
              </div>
              <textarea
                dir="ltr"
                value={form.configText}
                onChange={(e) => setForm((f) => ({ ...f, configText: e.target.value }))}
                placeholder={t.coresPage.configPlaceholder}
                required
                rows={14}
                className={monoTextarea}
              />
            </div>

            <RoutingEditor
              configText={form.configText}
              setConfigText={(text) => setForm((f) => ({ ...f, configText: text }))}
              t={t}
            />
            <OutboundsEditor
              configText={form.configText}
              setConfigText={(text) => setForm((f) => ({ ...f, configText: text }))}
              t={t}
            />
            <DnsLogEditor
              configText={form.configText}
              setConfigText={(text) => setForm((f) => ({ ...f, configText: text }))}
              t={t}
            />
            </>
            )}

            {form.coreType === 'wireguard' && (
              <div className="mt-4 rounded-lg border border-cyan-400/15 bg-black/25 p-3">
                <div className="mb-3 flex flex-wrap gap-3">
                  <div>
                    <label className={labelClass}>{t.hostsPage.wgPortLabel}</label>
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      value={form.wireguardPort}
                      onChange={(e) => setForm((f) => ({ ...f, wireguardPort: e.target.value }))}
                      required
                      className={`${inputClass} w-28`}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>{t.hostsPage.wgSubnetLabel}</label>
                    <input
                      dir="ltr"
                      value={form.wireguardSubnet}
                      onChange={(e) => setForm((f) => ({ ...f, wireguardSubnet: e.target.value }))}
                      placeholder="10.66.66.0/24"
                      required
                      className={`${inputClass} w-48 text-left font-mono text-xs`}
                    />
                  </div>
                </div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-slate-400">{t.hostsPage.wgServerKeyLabel}</span>
                  <button
                    type="button"
                    onClick={generateWgKeys}
                    disabled={generatingWgKeys}
                    className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-60"
                    style={{ borderColor: 'rgba(34,211,238,0.35)', color: ACCENT }}
                  >
                    {generatingWgKeys ? t.hostsPage.generatingKeys : t.hostsPage.generateNewKey}
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    dir="ltr"
                    readOnly
                    value={form.wireguardPublicKey}
                    placeholder="Public Key"
                    className={`${inputClass} text-left font-mono text-xs`}
                  />
                  <div className="relative">
                    <input
                      dir="ltr"
                      readOnly
                      type={showWgPrivateKey ? 'text' : 'password'}
                      value={form.wireguardPrivateKey}
                      placeholder="Private Key"
                      className={`${inputClass} w-full pr-12 text-left font-mono text-xs`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowWgPrivateKey((v) => !v)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400"
                    >
                      {showWgPrivateKey ? t.hostsPage.hide : t.hostsPage.show}
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-slate-500">{t.hostsPage.wgHint}</div>
              </div>
            )}

            {form.coreType === 'l2tp' && (
              <div className="mt-3 flex flex-wrap gap-3">
                <div>
                  <label className={labelClass}>{t.hostsPage.l2tpPskLabel}</label>
                  <input
                    dir="ltr"
                    value={form.l2tpPsk}
                    onChange={(e) => setForm((f) => ({ ...f, l2tpPsk: e.target.value }))}
                    required
                    className={`${inputClass} w-64 font-mono text-xs`}
                  />
                </div>
                <div className="self-end pb-2 text-[10px] text-slate-500">{t.hostsPage.l2tpHint}</div>
              </div>
            )}

            {form.coreType === 'ikev2' && (
              <div className="mt-3 flex flex-wrap gap-3">
                <div>
                  <label className={labelClass}>{t.hostsPage.ikev2PskLabel}</label>
                  <input
                    dir="ltr"
                    value={form.ikev2Psk}
                    onChange={(e) => setForm((f) => ({ ...f, ikev2Psk: e.target.value }))}
                    required
                    className={`${inputClass} w-64 font-mono text-xs`}
                  />
                </div>
                <div>
                  <label className={labelClass}>{t.coresPage.ikev2RemoteIdLabel}</label>
                  <input
                    dir="ltr"
                    value={form.ikev2RemoteId}
                    onChange={(e) => setForm((f) => ({ ...f, ikev2RemoteId: e.target.value }))}
                    className={`${inputClass} w-56 text-left`}
                  />
                </div>
                <div className="self-end pb-2 text-[10px] text-slate-500">{t.hostsPage.ikev2PortsHint}</div>
              </div>
            )}

            {lastWarnings.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
                <div className="mb-1 font-bold">{t.coresPage.warningsTitle}</div>
                <ul className="list-inside list-disc">
                  {lastWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {error && <div className="mt-3 text-xs text-red-400">{error}</div>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-4 rounded-lg px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60"
              style={{ backgroundColor: ACCENT }}
            >
              {editingId ? t.common.save : t.coresPage.createCoreBtn}
            </button>
          </form>
          )}
        </div>
      )}

      {!showForm && error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      {cores === null && <div className="py-8 text-center text-slate-500">{t.loading}</div>}
      {cores !== null && cores.length === 0 && (
        <div className="rounded-xl border border-white/10 py-8 text-center text-slate-500">
          {t.coresPage.noCoresYet}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {cores?.map((c) => (
          <div key={c.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-100">{c.name}</span>
                  <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                    {t.coresPage.coreTypeLabels[c.core_type]}
                  </span>
                </div>
                {c.note && <div className="text-xs text-slate-500">{c.note}</div>}
              </div>
              <div className="flex items-center gap-4">
                {c.core_type === 'xray' ? (
                  <span className="text-xs text-slate-400">
                    {t.coresPage.colNodes}: <span className="text-slate-200">{c.node_count}</span>
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">
                    {t.coresPage.colHosts}: <span className="text-slate-200">{c.host_count}</span>
                  </span>
                )}
                <button onClick={() => startEdit(c)} className="text-xs text-slate-400 hover:underline">
                  {t.common.edit}
                </button>
                <button onClick={() => handleDelete(c)} className="text-xs text-red-400 hover:underline">
                  {t.common.delete}
                </button>
              </div>
            </div>

            {c.core_type === 'wireguard' && (
              <div dir="ltr" className="font-mono text-xs text-slate-400">
                {c.wireguard_subnet} · port {c.wireguard_port}
              </div>
            )}
            {c.core_type === 'l2tp' && (
              <div className="text-xs text-slate-400">PSK: {c.l2tp_psk ? '••••••••' : '—'}</div>
            )}
            {c.core_type === 'ikev2' && (
              <div className="text-xs text-slate-400">
                PSK: {c.ikev2_psk ? '••••••••' : '—'}
                {c.ikev2_remote_id && (
                  <span dir="ltr" className="font-mono">
                    {' '}
                    · {c.ikev2_remote_id}
                  </span>
                )}
              </div>
            )}

            {c.core_type === 'xray' && c.inbounds.length === 0 ? (
              <div className="text-xs text-slate-500">{t.coresPage.noInbounds}</div>
            ) : c.core_type === 'xray' ? (
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400">
                      <th className="px-3 py-2 text-left font-medium" dir="ltr">
                        {t.coresPage.inboundColTag}
                      </th>
                      <th className="px-3 py-2 font-medium">{t.coresPage.inboundColProtocol}</th>
                      <th className="px-3 py-2 font-medium">{t.coresPage.inboundColNetwork}</th>
                      <th className="px-3 py-2 font-medium">{t.coresPage.inboundColSecurity}</th>
                      <th className="px-3 py-2 font-medium">{t.coresPage.inboundColPort}</th>
                      <th className="px-3 py-2 font-medium">{t.coresPage.inboundColHosts}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.inbounds.map((i) => (
                      <tr key={i.id} className="border-b border-white/5 last:border-0">
                        <td dir="ltr" className="px-3 py-2 text-left font-mono text-slate-200">
                          {i.tag}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-300">
                          {protocolLabels[i.protocol as keyof typeof protocolLabels] ?? i.protocol}
                        </td>
                        <td dir="ltr" className="px-3 py-2 text-center font-mono text-slate-400">
                          {i.network}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-400">
                          {i.security === 'reality' ? (
                            <span style={{ color: ACCENT }}>REALITY</span>
                          ) : (
                            i.security
                          )}
                        </td>
                        <td dir="ltr" className="px-3 py-2 text-center font-mono text-slate-400">
                          {i.port ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-400">{i.host_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {(c.core_type === 'xray' || c.core_type === 'l2tp' || c.core_type === 'ikev2') && (
              <NodeAssignmentEditor
                core={c}
                nodes={nodes}
                onChanged={() => {
                  refreshNodes()
                  refresh()
                }}
                t={t}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
