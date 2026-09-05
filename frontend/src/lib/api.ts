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
    return typeof data.detail === 'string' ? data.detail : `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}

async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
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
}): Promise<ProxyUser> {
  const res = await authorizedFetch('/users', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function updateUser(
  id: number,
  payload: Partial<Pick<ProxyUser, 'status' | 'data_limit' | 'expire' | 'note'>>,
): Promise<ProxyUser> {
  const res = await authorizedFetch(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteUser(id: number): Promise<void> {
  await authorizedFetch(`/users/${id}`, { method: 'DELETE' })
}

export interface UserLinks {
  subscription_url: string
  links: string[]
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

export async function getRealityTargetCount(): Promise<number> {
  const res = await authorizedFetch('/reality/targets')
  return (await res.json()).count
}

export async function scanReality(sampleSize?: number): Promise<RealityScanResponse> {
  const res = await authorizedFetch('/reality/scan', {
    method: 'POST',
    body: JSON.stringify(sampleSize ? { sample_size: sampleSize } : {}),
  })
  return res.json()
}

export type HostProtocol = 'vless' | 'trojan' | 'wireguard' | 'hysteria2'
export type HostNetwork = 'tcp' | 'ws' | 'grpc'
export type HostSecurity = 'none' | 'tls' | 'reality'

export interface Host {
  id: number
  remark: string
  protocol: HostProtocol
  address: string
  port: number
  network: HostNetwork | null
  security: HostSecurity | null
  sni: string | null
  reality_public_key: string | null
  reality_private_key: string | null
  reality_short_id: string | null
  created_at: string
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

export async function createHost(payload: Omit<Host, 'id' | 'created_at'>): Promise<Host> {
  const res = await authorizedFetch('/hosts', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function deleteHost(id: number): Promise<void> {
  await authorizedFetch(`/hosts/${id}`, { method: 'DELETE' })
}

export async function getRealityKeypair(): Promise<RealityKeypair> {
  const res = await authorizedFetch('/hosts/reality-keypair')
  return res.json()
}
