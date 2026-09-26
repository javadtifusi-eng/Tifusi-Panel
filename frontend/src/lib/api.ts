import { clearToken, getToken } from './auth'

const API_BASE = '/api'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const data = await res.json()
    if (typeof data.detail === 'string') return data.detail
    // FastAPI/Pydantic validation errors come back as a list of {msg, loc}.
    if (Array.isArray(data.detail) && data.detail.length > 0) {
      return data.detail.map((e: { msg?: string }) => e.msg).filter(Boolean).join('; ') || `Request failed (${res.status})`
    }
    return `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}

async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  // A FormData body (file uploads) must NOT get an explicit Content-Type —
  // the browser sets one itself with the multipart boundary baked in, and
  // overriding it here would break the boundary and the upload with it.
  const isFormData = init.body instanceof FormData
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (res.status === 401) {
    // The token is missing/expired/invalid — drop it and let App fall back to the login screen.
    clearToken()
    window.dispatchEvent(new Event('tifusi:unauthorized'))
  }
  if (!res.ok) throw new ApiError(await parseErrorDetail(res), res.status)
  return res
}

export async function getSetupStatus(): Promise<{ has_admin: boolean }> {
  const res = await fetch(`${API_BASE}/setup/status`)
  if (!res.ok) throw new ApiError(await parseErrorDetail(res), res.status)
  return res.json()
}

export interface TokenResponse {
  access_token: string
  token_type: string
}

export async function createAdmin(payload: {
  key: string
  username: string
  password: string
}): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE}/setup/create-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new ApiError(await parseErrorDetail(res), res.status)
  return res.json()
}

export async function login(payload: { username: string; password: string }): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new ApiError(await parseErrorDetail(res), res.status)
  return res.json()
}

export type UserStatus = 'active' | 'disabled' | 'expired' | 'limited' | 'on_hold'

export interface ProxyUser {
  id: number
  username: string
  status: UserStatus
  secret: string
  data_limit: number | null
  data_limit_reset_days: number | null
  data_limit_reset_at: string | null
  used_traffic: number
  expire: string | null
  on_hold_expire_days: number | null
  hwid_limit: number | null
  speed_limit_mbps: number | null
  last_seen: string | null
  note: string | null
  created_at: string
  group_ids: number[]
  // null = every protocol; always set for a reseller's users.
  protocols: string[] | null
  admin_id: number | null
}

export interface ProxyUserList {
  total: number
  users: ProxyUser[]
}

export async function listUsers(filters?: {
  q?: string
  status?: UserStatus
  group_id?: number
  offset?: number
  limit?: number
}): Promise<ProxyUserList> {
  const params = new URLSearchParams()
  if (filters?.q) params.set('q', filters.q)
  if (filters?.status) params.set('status', filters.status)
  if (filters?.group_id != null) params.set('group_id', String(filters.group_id))
  if (filters?.offset != null) params.set('offset', String(filters.offset))
  if (filters?.limit != null) params.set('limit', String(filters.limit))
  const qs = params.toString()
  const res = await authorizedFetch(`/users${qs ? `?${qs}` : ''}`)
  return res.json()
}

export async function createUser(payload: {
  username: string
  status?: 'active' | 'on_hold'
  data_limit?: number | null
  data_limit_reset_days?: number | null
  expire?: string | null
  on_hold_expire_days?: number | null
  hwid_limit?: number | null
  speed_limit_mbps?: number | null
  note?: string | null
  group_ids?: number[]
  protocols?: string[]
}): Promise<ProxyUser> {
  const res = await authorizedFetch('/users', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function resetUserSecret(id: number): Promise<ProxyUser> {
  const res = await authorizedFetch(`/users/${id}/reset-secret`, { method: 'POST' })
  return res.json()
}

export interface UserDevice {
  id: number
  identifier: string
  label: string | null
  first_seen: string
  last_seen: string
}

export async function listUserDevices(userId: number): Promise<UserDevice[]> {
  const res = await authorizedFetch(`/users/${userId}/devices`)
  return res.json()
}

export async function deleteUserDevice(userId: number, deviceId: number): Promise<void> {
  await authorizedFetch(`/users/${userId}/devices/${deviceId}`, { method: 'DELETE' })
}

export async function resetUserDevices(userId: number): Promise<void> {
  await authorizedFetch(`/users/${userId}/devices/reset`, { method: 'POST' })
}

// Self-reported by the Tifusi VPN Android app (POST /app/report); every
// field but received_at/client_ip comes from the phone and is display-only.
export interface AppReport {
  id: number
  received_at: string
  reported_at: string
  client_ip: string
  app_version: string | null
  android_sdk: number | null
  device: string | null
  event: string
  result: string
  detail: string | null
  protocol: string | null
  duration_ms: number | null
  network: string | null
  carrier: string | null
  sim_carrier: string | null
}

export async function listUserAppReports(userId: number, limit = 100): Promise<AppReport[]> {
  const res = await authorizedFetch(`/users/${userId}/app-reports?limit=${limit}`)
  return res.json()
}

// The newest app reports across every user this admin can see (the owner:
// all of them), for the dashboard's recent-activity feed.
export interface RecentAppReport extends AppReport {
  user_id: number
  username: string
}

export async function listRecentAppReports(limit = 20): Promise<RecentAppReport[]> {
  const res = await authorizedFetch(`/app-reports/recent?limit=${limit}`)
  return res.json()
}

export interface BulkCreateResult {
  created: ProxyUser[]
  skipped: string[]
}

export async function bulkCreateUsers(payload: {
  usernames: string[]
  data_limit?: number | null
  expire?: string | null
  hwid_limit?: number | null
  note?: string | null
  group_ids?: number[]
  protocols?: string[]
}): Promise<BulkCreateResult> {
  const res = await authorizedFetch('/users/bulk-create', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function bulkUpdateUsers(payload: {
  user_ids: number[]
  status?: UserStatus
  data_limit?: number | null
  expire?: string | null
  hwid_limit?: number | null
  note?: string | null
  add_group_ids?: number[]
  remove_group_ids?: number[]
}): Promise<{ updated: number }> {
  const res = await authorizedFetch('/users/bulk-update', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function bulkDeleteUsers(userIds: number[]): Promise<{ deleted: number }> {
  const res = await authorizedFetch('/users/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ user_ids: userIds }),
  })
  return res.json()
}

export interface UserTemplate {
  id: number
  name: string
  data_limit: number | null
  expire_days: number | null
  note: string | null
  created_at: string
  group_ids: number[]
}

export interface UserTemplateList {
  total: number
  templates: UserTemplate[]
}

export async function listUserTemplates(): Promise<UserTemplateList> {
  const res = await authorizedFetch('/user-templates')
  return res.json()
}

export async function createUserTemplate(payload: {
  name: string
  data_limit?: number | null
  expire_days?: number | null
  note?: string | null
  group_ids?: number[]
}): Promise<UserTemplate> {
  const res = await authorizedFetch('/user-templates', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteUserTemplate(id: number): Promise<void> {
  await authorizedFetch(`/user-templates/${id}`, { method: 'DELETE' })
}

export async function updateUser(
  id: number,
  payload: Partial<
    Pick<
      ProxyUser,
      | 'status'
      | 'data_limit'
      | 'data_limit_reset_days'
      | 'expire'
      | 'hwid_limit'
      | 'speed_limit_mbps'
      | 'note'
      | 'group_ids'
      | 'protocols'
    >
  >,
): Promise<ProxyUser> {
  const res = await authorizedFetch(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteUser(id: number): Promise<void> {
  await authorizedFetch(`/users/${id}`, { method: 'DELETE' })
}

export interface Ikev2Config {
  remark: string
  server: string
  remote_id: string | null
  psk: string | null
  username: string
  password: string
}

export interface L2tpConfig {
  remark: string
  server: string
  psk: string | null
  username: string
  password: string
}

export interface UserLinks {
  subscription_url: string
  app_code: string
  links: string[]
  ikev2_configs: Ikev2Config[]
  l2tp_configs: L2tpConfig[]
}

export async function getUserLinks(id: number): Promise<UserLinks> {
  const res = await authorizedFetch(`/users/${id}/links`)
  return res.json()
}

export type HostProtocol = 'vless' | 'vmess' | 'trojan' | 'shadowsocks' | 'hysteria2' | 'wireguard' | 'ikev2' | 'l2tp'
export type HostSecurity = 'none' | 'tls' | 'reality'

export const FINGERPRINTS = [
  'chrome',
  'firefox',
  'safari',
  'ios',
  'android',
  'edge',
  '360',
  'qq',
  'random',
  'randomized',
  'randomizednoalpn',
  'unsafe',
] as const

export interface Host {
  id: number
  remark: string
  address: string
  protocol: HostProtocol
  created_at: string
  group_ids: number[]

  inbound_id: number | null
  port_override: number | null
  sni_override: string | null
  alpn_override: string | null
  fingerprint_override: string | null
  path_override: string | null
  host_header_override: string | null
  security_override: HostSecurity | null
  allowinsecure: boolean

  fragment_length: string | null
  fragment_interval: string | null
  fragment_packets: string | null

  core_id: number | null

  hysteria2_sni: string | null
  hysteria2_port: number | null
  hysteria2_obfs: string | null

  network: string | null
  effective_security: string | null
  effective_port: number | null
  effective_sni: string | null
  effective_alpn: string | null
  effective_fingerprint: string | null
  effective_path: string | null
  effective_host_header: string | null
}

export interface HostList {
  total: number
  hosts: Host[]
}

export interface RealityKeypair {
  private_key: string
  public_key: string
  short_id: string
}

export async function listHosts(): Promise<HostList> {
  const res = await authorizedFetch('/hosts')
  return res.json()
}

export interface HostPayload {
  remark: string
  address: string
  protocol: HostProtocol
  group_ids?: number[]

  inbound_id?: number | null
  port_override?: number | null
  sni_override?: string | null
  alpn_override?: string | null
  fingerprint_override?: string | null
  path_override?: string | null
  host_header_override?: string | null
  security_override?: HostSecurity | null
  allowinsecure?: boolean

  fragment_length?: string | null
  fragment_interval?: string | null
  fragment_packets?: string | null

  core_id?: number | null

  hysteria2_sni?: string | null
  hysteria2_port?: number | null
  hysteria2_obfs?: string | null
}

export async function createHost(payload: HostPayload): Promise<Host> {
  const res = await authorizedFetch('/hosts', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function updateHost(id: number, payload: Partial<HostPayload>): Promise<Host> {
  const res = await authorizedFetch(`/hosts/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteHost(id: number): Promise<void> {
  await authorizedFetch(`/hosts/${id}`, { method: 'DELETE' })
}

export async function getRealityKeypair(): Promise<RealityKeypair> {
  const res = await authorizedFetch('/hosts/reality-keypair')
  return res.json()
}

export type NodeStatus = 'pending' | 'connected' | 'error'

export interface Node {
  id: number
  name: string
  address: string
  port: number
  api_key: string
  core_id: number | null
  ipsec_core_id: number | null
  hysteria_core_id: number | null
  wireguard_core_id?: number | null
  l2tp_egress_vless: string | null
  status: NodeStatus
  xray_version: string | null
  last_error: string | null
  last_synced_at: string | null
  created_at: string
}

export interface NodeList {
  total: number
  nodes: Node[]
}

export interface NodeSyncResult {
  status: NodeStatus
  xray_version: string | null
  error: string | null
  inbound_count: number
}

export type IranVerdict = 'open' | 'blocked' | 'partial' | 'unknown' | 'checking'

export interface IranCheck {
  verdict: IranVerdict
  /** How the probes that failed mostly failed: blockpage (the name resolved
   *  to Iran's 10.10.34.x filter page), dns, refused, timeout, tls, reset,
   *  forbidden. A red verdict can then say what kind of red it is. */
  reason?: string | null
  ok?: number
  checked?: number
  /** Median time the Iranian probes took to reach it — the speed signal a
   *  scan has before a real phone measures throughput. */
  ms?: number | null
  cities?: { node: string; ok: boolean | null; ms: number | null; error: string | null; reason?: string | null; ip?: string | null; status?: string | null }[]
  error?: string
}

export interface RealityCandidate {
  host: string
  ip: string | null
  source: 'traffic' | 'feed'
  tls: string | null
  alpn: string | null
  /** Warm, from the node, by IP: median TCP connect and median TLS handshake to the target. */
  rtt_ms?: number | null
  latency_ms: number | null
  usable: boolean
  error: string | null
  dest: string | null
  fingerprints: Record<string, { ok: boolean | null; ms: number | null }> | null
  iran: IranCheck | null
  /** What the dest did under the load REALITY really puts on it: a burst,
   *  a steady trickle, then a few handshakes after a pause (node_agent
   *  reality_scan.stress). after_ok 0 means it shut the node out. */
  stress?: RealityStress | null
}

export interface RealityStress {
  burst_ok: number
  burst_total: number
  steady_ok: number
  steady_total: number
  after_ok: number
  after_total: number
}

export interface RealityNodeScan {
  /** checking: validated and timed on the node, waiting for Iran's verdicts
   *  before the per-fingerprint test runs on the names that are open there. */
  state: 'idle' | 'discovering' | 'validating' | 'checking' | 'testing' | 'done' | 'error'
  phase_total: number
  phase_done: number
  error: string | null
  results: RealityCandidate[]
  node_iran: IranCheck
  /** Page into the live top-domains feed: page 0 is the top of today's list,
   *  each "scan more" walks to the next page. */
  ring?: number
}

export async function startNodeRealityScan(nodeId: number, page?: number): Promise<RealityNodeScan> {
  const q = page != null ? `?page=${page}` : ''
  const res = await authorizedFetch(`/reality/nodes/${nodeId}/scan${q}`, { method: 'POST' })
  return res.json()
}

export async function stopNodeRealityScan(nodeId: number): Promise<RealityNodeScan> {
  const res = await authorizedFetch(`/reality/nodes/${nodeId}/scan`, { method: 'DELETE' })
  return res.json()
}

/** The network the admin's own browser is on: its IP as the panel sees it,
 *  and the Iranian operator that IP belongs to (null: not a known Iranian
 *  operator — usually a VPN, which would make a from-this-device test lie). */
export async function getRealityWhoami(): Promise<{ ip: string; operator: string | null }> {
  const res = await authorizedFetch('/reality/whoami')
  return res.json()
}

export async function getNodeRealityScan(nodeId: number): Promise<RealityNodeScan> {
  const res = await authorizedFetch(`/reality/nodes/${nodeId}/scan`)
  return res.json()
}

export interface FieldTestItem {
  host: string
  dest: string
  port: number
  clients: number
  down: number
  up: number
  ok: boolean
  /** Best two-second rate seen through this config, bytes per second — an
   *  operator's opening burst lands here, so it flatters a config. */
  down_bps: number
  up_bps: number
  /** Everything that moved over the time it took: what a user lives with. */
  down_avg_bps?: number
  up_avg_bps?: number
  /** Seconds the transfer covered, for the sustained rate above. */
  seconds?: number
  link: string
  /** Set by the operator-pattern test: "<sni>:<random|std>:<tcp|xhttp>". */
  label?: string | null
  /** How this config carries REALITY: raw TCP with vision, or XHTTP. */
  transport?: 'tcp' | 'xhttp'
  /** Iranian operators the connections through this config came from. */
  operators?: string[]
}

export interface FieldTest {
  active: boolean
  started_at: number | null
  expires_at: number | null
  items: FieldTestItem[]
  sub_url: string | null
}

/** Throwaway inbounds on the node, one per SNI, tested from a phone in Iran. */
export type FieldTarget = { host: string; dest: string | null; port?: number | null; label?: string; transport?: 'tcp' | 'xhttp' }

/** Names of the admin's own that resolve to this node and are served there
 *  with a real certificate — the one SNI with no IP/SNI mismatch. */
export async function getOwnNames(nodeId: number): Promise<{ host: string; dest: string }[]> {
  const res = await authorizedFetch(`/reality/nodes/${nodeId}/own-names`)
  return (await res.json()).names
}

export async function startFieldTest(nodeId: number, targets: FieldTarget[]): Promise<FieldTest> {
  const res = await authorizedFetch(`/reality/nodes/${nodeId}/field-test`, { method: 'POST', body: JSON.stringify({ targets }) })
  return res.json()
}

export async function getFieldTest(nodeId: number): Promise<FieldTest> {
  const res = await authorizedFetch(`/reality/nodes/${nodeId}/field-test`)
  return res.json()
}

export async function stopFieldTest(nodeId: number): Promise<FieldTest> {
  const res = await authorizedFetch(`/reality/nodes/${nodeId}/field-test`, { method: 'DELETE' })
  return res.json()
}

export async function listNodes(): Promise<NodeList> {
  const res = await authorizedFetch('/nodes')
  return res.json()
}

export async function createNode(
  payload: {
    name: string
    address: string
    port: number
    core_id?: number | null
    ipsec_core_id?: number | null
    hysteria_core_id?: number | null
    wireguard_core_id?: number | null
    l2tp_egress_vless?: string | null
  },
): Promise<Node> {
  const res = await authorizedFetch('/nodes', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function updateNode(
  id: number,
  payload: Partial<{
    name: string
    address: string
    port: number
    core_id: number | null
    ipsec_core_id: number | null
    hysteria_core_id: number | null
    wireguard_core_id: number | null
    l2tp_egress_vless: string | null
  }>,
): Promise<Node> {
  const res = await authorizedFetch(`/nodes/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteNode(id: number): Promise<void> {
  await authorizedFetch(`/nodes/${id}`, { method: 'DELETE' })
}

export type TunnelTransport = 'tcp' | 'tls' | 'ws' | 'wss' | 'tcpmux' | 'wsmux' | 'wssmux' | 'udp' | 'spoof'
export type TunnelStatus = 'pending' | 'connected' | 'error'
export type CdnProvider = 'arvan' | 'cloudflare'
/** L4 protocol the spoof transport's forged packets ride on. */
export type SpoofCarrier = 'auto' | 'udp' | 'icmp' | 'tcp'

export interface TunnelForward {
  name: string
  listen_port: number
  net: 'tcp' | 'udp'
  target_port: number
}

export interface Tunnel {
  id: number
  name: string
  iran_address: string
  iran_port: number
  foreign_node_id: number | null
  foreign_address: string | null
  foreign_port: number | null
  transport: TunnelTransport
  token: string
  sni: string | null
  domain: string | null
  path: string | null
  spoof_source: string | null
  spoof_carrier: SpoofCarrier | null
  spoof_stealth: boolean | null
  connection_count: number
  forwards: TunnelForward[]
  cdn_provider: CdnProvider | null
  cdn_host: string | null
  cdn_port: number | null
  /** CDN edge IPs the foreign side dials, best first; empty = let DNS pick. */
  cdn_ips: string[]
  /** Domain-fronting SNI (another site on the same CDN); null = the CDN domain. */
  cdn_front: string | null
  status: TunnelStatus
  last_error: string | null
  last_checked_at: string | null
  created_at: string
}

export interface TunnelList {
  total: number
  tunnels: Tunnel[]
}

/** A `null` side was skipped, not failed — a udp tunnel's KCP listener
 *  can't be reached or disproved by the TCP connect this check makes. */
export interface TunnelTestResult {
  status: TunnelStatus
  iran_reachable: boolean | null
  iran_latency_ms: number | null
  foreign_reachable: boolean | null
  foreign_latency_ms: number | null
  cdn_reachable?: boolean | null
  cdn_latency_ms?: number | null
  error: string | null
}

export interface TunnelConfig {
  iran_config: Record<string, unknown>
  foreign_config: Record<string, unknown>
  iran_install_command: string
  foreign_install_command: string
}

export interface TunnelRecommendResult {
  iran_reachable: boolean
  iran_latency_ms: number | null
  foreign_reachable: boolean
  foreign_latency_ms: number | null
  /** Why the list came out in this order — a property of the link, not of
   *  any one transport, so it reads once above the whole ranking. */
  link: 'fast' | 'slow'
  ranked: TunnelTransport[]
}

export type TunnelPayload = {
  name: string
  iran_address: string
  iran_port: number
  foreign_node_id?: number | null
  foreign_address?: string | null
  foreign_port?: number | null
  transport: TunnelTransport
  sni?: string | null
  domain?: string | null
  path?: string | null
  spoof_source?: string | null
  spoof_carrier?: SpoofCarrier | null
  spoof_stealth?: boolean | null
  connection_count?: number
  forwards?: TunnelForward[]
  cdn_provider?: CdnProvider | null
  cdn_host?: string | null
  cdn_port?: number | null
  cdn_ips?: string[]
  cdn_front?: string | null
}

export async function listTunnels(): Promise<TunnelList> {
  const res = await authorizedFetch('/tunnels')
  return res.json()
}

export async function createTunnel(payload: TunnelPayload): Promise<Tunnel> {
  const res = await authorizedFetch('/tunnels', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function updateTunnel(id: number, payload: Partial<TunnelPayload>): Promise<Tunnel> {
  const res = await authorizedFetch(`/tunnels/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteTunnel(id: number): Promise<void> {
  await authorizedFetch(`/tunnels/${id}`, { method: 'DELETE' })
}

export async function getTunnelConfig(id: number): Promise<TunnelConfig> {
  const res = await authorizedFetch(`/tunnels/${id}/config`)
  return res.json()
}

export async function testTunnel(id: number): Promise<TunnelTestResult> {
  const res = await authorizedFetch(`/tunnels/${id}/test`, { method: 'POST' })
  return res.json()
}

export async function recommendTunnelTransport(payload: {
  iran_address: string
  iran_port: number
  foreign_node_id?: number | null
  foreign_address?: string | null
  foreign_port?: number | null
}): Promise<TunnelRecommendResult> {
  const res = await authorizedFetch('/tunnels/recommend', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

/** Where a CDN check actually ran: the tunnel's foreign node, or the panel
 *  server when the foreign side isn't a node (or its agent is too old). */
export interface CdnRanOn {
  ran_on: 'node' | 'panel'
  ran_on_name: string
}

export interface CdnEdge {
  ip: string
  ms: number | null
  jitter: number | null
  ok: number
  tries: number
}

export interface CdnEdgeScan extends CdnRanOn {
  ranges: number
  tested: number
  answered: number
  edges: CdnEdge[]
}

export interface CdnFront {
  domain: string
  works: boolean
  ms: number | null
  error: string | null
}

export interface CdnFrontScan extends CdnRanOn {
  checked: number
  on_cdn: number
  fronts: CdnFront[]
}

export interface CdnSpeed extends CdnRanOn {
  ok: boolean
  mbps: number | null
  ping_ms: number | null
  bytes: number
  seconds: number | null
  via: string
  error: string | null
}

export async function scanCdnEdges(id: number): Promise<CdnEdgeScan> {
  const res = await authorizedFetch(`/tunnels/${id}/cdn/edges`, { method: 'POST' })
  return res.json()
}

export async function scanCdnFronts(id: number): Promise<CdnFrontScan> {
  const res = await authorizedFetch(`/tunnels/${id}/cdn/fronts`, { method: 'POST' })
  return res.json()
}

export async function cdnSpeedTest(id: number): Promise<CdnSpeed> {
  const res = await authorizedFetch(`/tunnels/${id}/cdn/speed`, { method: 'POST' })
  return res.json()
}

export type SpoofTestDirection = 'iran_to_foreign' | 'foreign_to_iran'

export interface SpoofTestCommands {
  recv_command: string
  send_command: string
  recv_on: 'iran' | 'foreign'
  send_on: 'iran' | 'foreign'
}

export interface DiscoverCandidate {
  ip: string
  label: string | null
}

export interface DiscoverCommands extends SpoofTestCommands {
  candidates: DiscoverCandidate[]
  seconds: number
}

export interface DiscoveryResult {
  sources: DiscoverCandidate[]
  spoof_source: string
}

export async function discoverSourcesCommands(payload: {
  foreign_node_id?: number | null
  foreign_address?: string | null
  iran_address?: string | null
  port: number
  direction?: SpoofTestDirection
}): Promise<DiscoverCommands> {
  const res = await authorizedFetch('/tunnels/discover-sources', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function parseDiscoveredSources(output: string): Promise<DiscoveryResult> {
  const res = await authorizedFetch('/tunnels/discover-sources/parse', {
    method: 'POST',
    body: JSON.stringify({ output }),
  })
  return res.json()
}

export async function spoofTestCommands(payload: {
  foreign_node_id?: number | null
  foreign_address?: string | null
  iran_address?: string | null
  port: number
  spoof_ip: string
  direction?: SpoofTestDirection
}): Promise<SpoofTestCommands> {
  const res = await authorizedFetch('/tunnels/spooftest', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export type ShieldMode = 'dns' | 'hosts'
export type ShieldMemberState = 'active' | 'standby' | 'burnt'

export interface ShieldMember {
  tunnel_id: number
  name: string
  iran_address: string
  iran_port: number
  position: number
  state: ShieldMemberState
  last_ok: boolean | null
  last_latency_ms: number | null
  fail_streak: number
  last_checked_at: string | null
  burnt_at: string | null
}

export interface ShieldEvent {
  id: number
  kind: string
  data: { tunnel?: string; from?: string; to?: string; reason?: 'auto' | 'manual'; hosts?: number | null; error?: string }
  created_at: string
}

export interface ShieldGroup {
  id: number
  name: string
  enabled: boolean
  mode: ShieldMode
  dns_record: string | null
  has_cloudflare_token: boolean
  fail_threshold: number
  active_tunnel_id: number | null
  stranded: boolean
  last_error: string | null
  last_checked_at: string | null
  members: ShieldMember[]
  events: ShieldEvent[]
}

export interface ShieldGroupList {
  check_interval_seconds: number
  groups: ShieldGroup[]
}

export interface ShieldGroupPayload {
  name: string
  enabled: boolean
  mode: ShieldMode
  dns_record: string | null
  /** Omit to keep the stored token when editing. */
  cloudflare_token?: string
  fail_threshold: number
  tunnel_ids: number[]
}

export async function listShieldGroups(): Promise<ShieldGroupList> {
  const res = await authorizedFetch('/shield')
  return res.json()
}

export async function createShieldGroup(payload: ShieldGroupPayload): Promise<ShieldGroup> {
  const res = await authorizedFetch('/shield', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function updateShieldGroup(id: number, payload: Partial<ShieldGroupPayload>): Promise<ShieldGroup> {
  const res = await authorizedFetch(`/shield/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteShieldGroup(id: number): Promise<void> {
  await authorizedFetch(`/shield/${id}`, { method: 'DELETE' })
}

export async function checkShieldGroup(id: number): Promise<ShieldGroup> {
  const res = await authorizedFetch(`/shield/${id}/check`, { method: 'POST' })
  return res.json()
}

export async function switchShieldGroup(id: number, tunnelId: number): Promise<ShieldGroup> {
  const res = await authorizedFetch(`/shield/${id}/switch`, { method: 'POST', body: JSON.stringify({ tunnel_id: tunnelId }) })
  return res.json()
}

export async function syncNode(id: number): Promise<NodeSyncResult> {
  const res = await authorizedFetch(`/nodes/${id}/sync`, { method: 'POST' })
  return res.json()
}

export interface Group {
  id: number
  name: string
  note: string | null
  created_at: string
  inbound_ids: number[]
  host_ids: number[]
  user_ids: number[]
}

export interface GroupList {
  total: number
  groups: Group[]
}

export async function listGroups(): Promise<GroupList> {
  const res = await authorizedFetch('/groups')
  return res.json()
}

export async function createGroup(payload: {
  name: string
  note?: string | null
  inbound_ids?: number[]
  host_ids?: number[]
  user_ids?: number[]
}): Promise<Group> {
  const res = await authorizedFetch('/groups', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function updateGroup(
  id: number,
  payload: Partial<{
    name: string
    note: string | null
    inbound_ids: number[]
    host_ids: number[]
    user_ids: number[]
  }>,
): Promise<Group> {
  const res = await authorizedFetch(`/groups/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteGroup(id: number): Promise<void> {
  await authorizedFetch(`/groups/${id}`, { method: 'DELETE' })
}

export interface Inbound {
  id: number
  tag: string
  protocol: string
  network: string
  security: string
  port: number | null
  encryption: string | null
  flow: string | null
  header_type: string | null
  path: string | null
  host_header: string | null
  sni: string | null
  alpn: string | null
  fingerprint: string | null
  reality_public_key: string | null
  reality_short_id: string | null
  host_count: number
  group_ids: number[]
}

export type CoreType = 'xray' | 'l2tp' | 'ikev2' | 'hysteria2' | 'wireguard'

export interface Core {
  id: number
  name: string
  note: string | null
  core_type: CoreType
  config: Record<string, unknown> | null
  created_at: string
  inbounds: Inbound[]
  node_count: number
  host_count: number
  warnings: string[]

  l2tp_psk: string | null

  ikev2_psk: string | null
  ikev2_remote_id: string | null
  ikev2_certificate: string | null
  ikev2_certificate_key: string | null
  ikev2_egress_vless: string | null
  ikev2_auth_mode: string

  hysteria2_port: number | null
  hysteria2_obfs: string | null
  hysteria2_rate_mbps: number | null

  wireguard_port?: number | null
  wireguard_mtu?: number | null
  wireguard_public_key?: string | null
}

export interface CoreList {
  total: number
  cores: Core[]
}

export interface CorePayload {
  name: string
  note?: string | null
  core_type: CoreType
  config?: Record<string, unknown> | null

  l2tp_psk?: string | null

  ikev2_psk?: string | null
  ikev2_remote_id?: string | null
  ikev2_certificate?: string | null
  ikev2_certificate_key?: string | null
  ikev2_egress_vless?: string | null
  ikev2_auth_mode?: string

  hysteria2_port?: number | null
  hysteria2_obfs?: string | null
  hysteria2_rate_mbps?: number | null

  wireguard_port?: number | null
  wireguard_mtu?: number | null
}

export interface Ikev2CertKeypair {
  certificate: string
  key: string
}

export async function generateIkev2Cert(host: string): Promise<Ikev2CertKeypair> {
  const res = await authorizedFetch('/cores/generate-ikev2-cert', {
    method: 'POST',
    body: JSON.stringify({ host }),
  })
  return res.json()
}

export async function getPanelCertForIkev2(): Promise<Ikev2CertKeypair> {
  const res = await authorizedFetch('/cores/panel-cert')
  return res.json()
}

export async function listCores(): Promise<CoreList> {
  const res = await authorizedFetch('/cores')
  return res.json()
}

export async function createCore(payload: CorePayload): Promise<Core> {
  const res = await authorizedFetch('/cores', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function updateCore(id: number, payload: Partial<CorePayload>): Promise<Core> {
  const res = await authorizedFetch(`/cores/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteCore(id: number): Promise<void> {
  await authorizedFetch(`/cores/${id}`, { method: 'DELETE' })
}

export interface TrafficHistoryPoint {
  date: string
  total_bytes: number
}

export interface TrafficHistory {
  points: TrafficHistoryPoint[]
}

export async function getTrafficHistory(days = 14, nodeId?: number | null): Promise<TrafficHistory> {
  const suffix = nodeId != null ? `&node_id=${nodeId}` : ''
  const res = await authorizedFetch(`/stats/traffic-history?days=${days}${suffix}`)
  return res.json()
}

export interface PanelSettings {
  public_url: string | null
  telegram_bot_token: string | null
  telegram_chat_id: string | null
  webhook_url: string | null
  webhook_secret: string | null
  discord_webhook_url: string | null
}

export async function getSettings(): Promise<PanelSettings> {
  const res = await authorizedFetch('/settings')
  return res.json()
}

export async function updateSettings(payload: Partial<PanelSettings>): Promise<PanelSettings> {
  const res = await authorizedFetch('/settings', { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function testTelegram(): Promise<void> {
  await authorizedFetch('/settings/telegram/test', { method: 'POST' })
}

export async function testWebhook(): Promise<void> {
  await authorizedFetch('/settings/webhook/test', { method: 'POST' })
}

export async function testDiscord(): Promise<void> {
  await authorizedFetch('/settings/discord/test', { method: 'POST' })
}

// Matches app/permissions.py PERMISSION_SCOPES — keep in sync.
export const PERMISSION_SCOPES = ['users', 'hosts', 'nodes', 'cores', 'groups', 'tunnels', 'settings'] as const
export type PermissionScope = (typeof PERMISSION_SCOPES)[number]

// A protocol that has hosts, with those hosts' remarks.
export interface ProtocolOption {
  protocol: string
  hosts: string[]
}

export interface ResellerQuota {
  max_users: number | null
  users_count: number
  data_quota: number | null
  // Sum of the data limits of the reseller's current users, in bytes.
  data_allocated: number
  used_traffic: number
  protocols: ProtocolOption[]
}

export interface AdminProfile {
  username: string
  is_owner: boolean
  permissions: PermissionScope[] | null
  is_reseller?: boolean
  reseller?: ResellerQuota | null
  /** Profile picture as a data: URL, or null when none is set. */
  avatar?: string | null
}

export interface Reseller {
  id: number
  username: string
  disabled: boolean
  max_users: number | null
  data_quota: number | null
  protocols: string[]
  users_count: number
  data_allocated: number
  used_traffic: number
  created_at: string
}

export async function listResellers(): Promise<{ resellers: Reseller[]; protocols: ProtocolOption[] }> {
  const res = await authorizedFetch('/resellers')
  return res.json()
}

export async function createReseller(payload: {
  username: string
  password: string
  max_users: number | null
  data_quota: number | null
  protocols: string[]
}): Promise<Reseller> {
  const res = await authorizedFetch('/resellers', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

// Only the keys sent change; null on max_users or data_quota removes that limit.
export async function updateReseller(
  id: number,
  payload: Partial<{ password: string; max_users: number | null; data_quota: number | null; protocols: string[]; disabled: boolean }>,
): Promise<Reseller> {
  const res = await authorizedFetch(`/resellers/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteReseller(id: number): Promise<void> {
  await authorizedFetch(`/resellers/${id}`, { method: 'DELETE' })
}

export async function getAdminProfile(): Promise<AdminProfile> {
  const res = await authorizedFetch('/admin/me')
  return res.json()
}

/** null removes the picture. */
export async function setAdminAvatar(avatar: string | null): Promise<void> {
  await authorizedFetch('/admin/me/avatar', { method: 'PUT', body: JSON.stringify({ avatar }) })
}

export async function changePassword(payload: { current_password: string; new_password: string }): Promise<void> {
  await authorizedFetch('/admin/password', { method: 'PUT', body: JSON.stringify(payload) })
}

export interface AdminListItem {
  id: number
  username: string
  is_owner: boolean
  permissions: PermissionScope[] | null
  created_at: string
}

export interface AdminListResponse {
  total: number
  admins: AdminListItem[]
}

export async function listAdmins(): Promise<AdminListResponse> {
  const res = await authorizedFetch('/admin')
  return res.json()
}

export async function createAdminAccount(payload: {
  username: string
  password: string
  permissions?: PermissionScope[] | null
}): Promise<AdminListItem> {
  const res = await authorizedFetch('/admin', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function updateAdminPermissions(
  id: number,
  permissions: PermissionScope[] | null,
): Promise<AdminListItem> {
  const res = await authorizedFetch(`/admin/${id}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissions }),
  })
  return res.json()
}

export async function deleteAdminAccount(id: number): Promise<void> {
  await authorizedFetch(`/admin/${id}`, { method: 'DELETE' })
}

export interface ApiKeyListItem {
  id: number
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
}

export interface ApiKeyListResponse {
  total: number
  keys: ApiKeyListItem[]
}

export interface ApiKeyCreateResponse extends ApiKeyListItem {
  key: string
}

export async function listApiKeys(): Promise<ApiKeyListResponse> {
  const res = await authorizedFetch('/api-keys')
  return res.json()
}

export async function createApiKey(name: string): Promise<ApiKeyCreateResponse> {
  const res = await authorizedFetch('/api-keys', { method: 'POST', body: JSON.stringify({ name }) })
  return res.json()
}

export async function deleteApiKey(id: number): Promise<void> {
  await authorizedFetch(`/api-keys/${id}`, { method: 'DELETE' })
}

export async function downloadBackup(): Promise<void> {
  const res = await authorizedFetch('/settings/backup')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'tifusi-panel-backup.db'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function restoreBackup(file: File): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  await authorizedFetch('/settings/restore', { method: 'POST', body: form })
}

export interface TlsStatus {
  enabled: boolean
  domain?: string | null
  issuer?: string | null
  expires_at?: string | null
  self_signed?: boolean
}

export async function getTlsStatus(): Promise<TlsStatus> {
  const res = await authorizedFetch('/settings/tls')
  return res.json()
}

export async function uploadTls(cert: File, key: File): Promise<void> {
  const form = new FormData()
  form.append('cert', cert)
  form.append('key', key)
  await authorizedFetch('/settings/tls', { method: 'POST', body: form })
}

export async function removeTls(): Promise<void> {
  await authorizedFetch('/settings/tls', { method: 'DELETE' })
}

export async function requestSsl(domain: string): Promise<PanelSettings> {
  const res = await authorizedFetch('/settings/ssl/request', {
    method: 'POST',
    body: JSON.stringify({ domain }),
  })
  return res.json()
}

export interface SystemStats {
  cpu_percent: number
  cpu_count: number
  memory_percent: number
  memory_used: number
  memory_total: number
  disk_percent: number
  disk_used: number
  disk_total: number
  uptime_seconds: number
}

export async function getSystemStats(): Promise<SystemStats> {
  const res = await authorizedFetch('/system/stats')
  return res.json()
}

export interface VersionInfo {
  current: string
  latest: string | null
  update_available: boolean
}

export async function getVersion(): Promise<VersionInfo> {
  const res = await authorizedFetch('/system/version')
  return res.json()
}

export interface BackupDomainsState {
  live: string | null
  live_ok: boolean | null
  live_reachable: number
  live_total: number
  backups: { domain: string; has_cert: boolean }[]
  auto_failover: boolean
}

export async function getBackupDomains(): Promise<BackupDomainsState> {
  const res = await authorizedFetch('/settings/backup-domains')
  return res.json()
}

export async function addBackupDomain(domain: string): Promise<BackupDomainsState> {
  const res = await authorizedFetch('/settings/backup-domains', { method: 'POST', body: JSON.stringify({ domain }) })
  return res.json()
}

export async function removeBackupDomain(domain: string): Promise<BackupDomainsState> {
  const res = await authorizedFetch(`/settings/backup-domains/${encodeURIComponent(domain)}`, { method: 'DELETE' })
  return res.json()
}

export async function checkBackupDomains(): Promise<BackupDomainsState> {
  const res = await authorizedFetch('/settings/backup-domains/check', { method: 'POST' })
  return res.json()
}

export async function failoverBackupDomain(): Promise<BackupDomainsState> {
  const res = await authorizedFetch('/settings/backup-domains/failover', { method: 'POST' })
  return res.json()
}

export async function setBackupAutoFailover(on: boolean): Promise<PanelSettings> {
  const res = await authorizedFetch('/settings', { method: 'PUT', body: JSON.stringify({ backup_auto_failover: on }) })
  return res.json()
}
