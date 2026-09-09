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

export type UserStatus = 'active' | 'disabled' | 'expired' | 'limited'

export interface ProxyUser {
  id: number
  username: string
  status: UserStatus
  secret: string
  data_limit: number | null
  used_traffic: number
  expire: string | null
  note: string | null
  created_at: string
  group_ids: number[]
}

export interface ProxyUserList {
  total: number
  users: ProxyUser[]
}

export async function listUsers(): Promise<ProxyUserList> {
  const res = await authorizedFetch('/users')
  return res.json()
}

export async function createUser(payload: {
  username: string
  data_limit?: number | null
  expire?: string | null
  note?: string | null
  group_ids?: number[]
}): Promise<ProxyUser> {
  const res = await authorizedFetch('/users', { method: 'POST', body: JSON.stringify(payload) })
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
  note?: string | null
  group_ids?: number[]
}): Promise<BulkCreateResult> {
  const res = await authorizedFetch('/users/bulk-create', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function bulkUpdateUsers(payload: {
  user_ids: number[]
  status?: UserStatus
  data_limit?: number | null
  expire?: string | null
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

export async function updateUser(
  id: number,
  payload: Partial<Pick<ProxyUser, 'status' | 'data_limit' | 'expire' | 'note' | 'group_ids'>>,
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
  links: string[]
  ikev2_configs: Ikev2Config[]
  l2tp_configs: L2tpConfig[]
}

export async function getUserLinks(id: number): Promise<UserLinks> {
  const res = await authorizedFetch(`/users/${id}/links`)
  return res.json()
}

export interface RealityScanResult {
  host: string
  reachable: boolean
  tls_version: string | null
  alpn: string | null
  latency_ms: number | null
  error: string | null
  recommended: boolean
}

export interface RealityScanResponse {
  scanned: number
  usable: number
  results: RealityScanResult[]
}

export async function scanReality(sampleSize?: number): Promise<RealityScanResponse> {
  const res = await authorizedFetch('/reality/scan', {
    method: 'POST',
    body: JSON.stringify(sampleSize ? { sample_size: sampleSize } : {}),
  })
  return res.json()
}

export type HostProtocol = 'vless' | 'vmess' | 'trojan' | 'shadowsocks' | 'hysteria2' | 'ikev2' | 'l2tp'
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

  core_id: number | null

  hysteria2_sni: string | null
  hysteria2_port: number | null

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

  core_id?: number | null

  hysteria2_sni?: string | null
  hysteria2_port?: number | null
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
    l2tp_egress_vless: string | null
  }>,
): Promise<Node> {
  const res = await authorizedFetch(`/nodes/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteNode(id: number): Promise<void> {
  await authorizedFetch(`/nodes/${id}`, { method: 'DELETE' })
}

export type TunnelTransport = 'tcp' | 'tls' | 'ws' | 'wss' | 'tcpmux' | 'wsmux' | 'wssmux' | 'udp'
export type TunnelStatus = 'pending' | 'connected' | 'error'

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
  transport: TunnelTransport
  token: string
  sni: string | null
  domain: string | null
  path: string | null
  connection_count: number
  forwards: TunnelForward[]
  status: TunnelStatus
  last_error: string | null
  last_checked_at: string | null
  created_at: string
}

export interface TunnelList {
  total: number
  tunnels: Tunnel[]
}

export interface TunnelTestResult {
  status: TunnelStatus
  iran_reachable: boolean
  iran_latency_ms: number | null
  foreign_reachable: boolean
  foreign_latency_ms: number | null
  error: string | null
}

export interface TunnelConfig {
  iran_config: Record<string, unknown>
  foreign_config: Record<string, unknown>
  iran_install_command: string
  foreign_install_command: string
}

export interface TunnelRankedTransport {
  transport: TunnelTransport
  reason: string
}

export interface TunnelRecommendResult {
  iran_reachable: boolean
  iran_latency_ms: number | null
  foreign_reachable: boolean
  foreign_latency_ms: number | null
  ranked: TunnelRankedTransport[]
}

export type TunnelPayload = {
  name: string
  iran_address: string
  iran_port: number
  foreign_node_id?: number | null
  foreign_address?: string | null
  transport: TunnelTransport
  sni?: string | null
  domain?: string | null
  path?: string | null
  connection_count?: number
  forwards?: TunnelForward[]
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
}): Promise<TunnelRecommendResult> {
  const res = await authorizedFetch('/tunnels/recommend', { method: 'POST', body: JSON.stringify(payload) })
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

export type CoreType = 'xray' | 'l2tp' | 'ikev2'

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

export interface PanelSettings {
  public_url: string | null
  telegram_bot_token: string | null
  telegram_chat_id: string | null
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

// Matches app/permissions.py PERMISSION_SCOPES — keep in sync.
export const PERMISSION_SCOPES = ['users', 'hosts', 'nodes', 'cores', 'groups', 'tunnels', 'settings'] as const
export type PermissionScope = (typeof PERMISSION_SCOPES)[number]

export interface AdminProfile {
  username: string
  is_owner: boolean
  permissions: PermissionScope[] | null
}

export async function getAdminProfile(): Promise<AdminProfile> {
  const res = await authorizedFetch('/admin/me')
  return res.json()
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

export async function getTlsStatus(): Promise<{ enabled: boolean }> {
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
