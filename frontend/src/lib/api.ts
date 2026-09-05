const API_BASE = '/api'

export class ApiError extends Error {}

async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const data = await res.json()
    return typeof data.detail === 'string' ? data.detail : `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}

export async function getSetupStatus(): Promise<{ has_admin: boolean }> {
  const res = await fetch(`${API_BASE}/setup/status`)
  if (!res.ok) throw new ApiError(await parseErrorDetail(res))
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
  if (!res.ok) throw new ApiError(await parseErrorDetail(res))
  return res.json()
}

export async function login(payload: { username: string; password: string }): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new ApiError(await parseErrorDetail(res))
  return res.json()
}
