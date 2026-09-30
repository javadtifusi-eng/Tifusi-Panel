// Turns a client share link (vless://, vmess://, trojan://, ss://) into a
// complete Xray outbound — transport, TLS/REALITY and all — so an outbound to
// another server can be added by pasting the link its panel hands out, rather
// than by writing streamSettings by hand.

export type Outbound = {
  tag: string
  protocol: 'vless' | 'vmess' | 'trojan' | 'shadowsocks'
  settings: Record<string, unknown>
  streamSettings?: Record<string, unknown>
}

export class ShareLinkError extends Error {}

function b64decode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// Tags end up in routing rules and balancer selectors, so keep them to
// characters that read the same everywhere.
function tagFrom(name: string, fallback: string): string {
  const cleaned = name
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return cleaned || fallback
}

type Transport = {
  network: string
  security: string
  sni?: string
  fp?: string
  alpn?: string
  allowInsecure?: boolean
  pbk?: string
  sid?: string
  spx?: string
  path?: string
  host?: string
  serviceName?: string
  mode?: string
  headerType?: string
}

function streamSettings(t: Transport): Record<string, unknown> {
  const network = t.network === 'h2' ? 'http' : t.network || 'tcp'
  const stream: Record<string, unknown> = { network, security: t.security || 'none' }

  if (t.security === 'tls') {
    stream.tlsSettings = {
      ...(t.sni ? { serverName: t.sni } : {}),
      ...(t.fp ? { fingerprint: t.fp } : {}),
      ...(t.alpn ? { alpn: t.alpn.split(',').filter(Boolean) } : {}),
      ...(t.allowInsecure ? { allowInsecure: true } : {}),
    }
  } else if (t.security === 'reality') {
    if (!t.pbk) throw new ShareLinkError('missing_reality_key')
    stream.realitySettings = {
      serverName: t.sni ?? '',
      fingerprint: t.fp || 'chrome',
      publicKey: t.pbk,
      shortId: t.sid ?? '',
      ...(t.spx ? { spiderX: t.spx } : {}),
    }
  }

  switch (network) {
    case 'ws':
      stream.wsSettings = { path: t.path || '/', ...(t.host ? { host: t.host } : {}) }
      break
    case 'grpc':
      stream.grpcSettings = { serviceName: t.serviceName ?? '', ...(t.mode === 'multi' ? { multiMode: true } : {}) }
      break
    case 'httpupgrade':
      stream.httpupgradeSettings = { path: t.path || '/', ...(t.host ? { host: t.host } : {}) }
      break
    case 'xhttp':
    case 'splithttp':
      stream.network = 'xhttp'
      stream.xhttpSettings = { path: t.path || '/', ...(t.host ? { host: t.host } : {}), ...(t.mode ? { mode: t.mode } : {}) }
      break
    case 'http':
      stream.httpSettings = { path: t.path || '/', ...(t.host ? { host: t.host.split(',').filter(Boolean) } : {}) }
      break
    case 'tcp':
      if (t.headerType === 'http') {
        stream.tcpSettings = {
          header: { type: 'http', request: { path: [t.path || '/'], headers: t.host ? { Host: t.host.split(',') } : {} } },
        }
      }
      break
  }
  return stream
}

function transportFromQuery(q: URLSearchParams, defaultSecurity: string): Transport {
  const get = (k: string) => q.get(k) ?? undefined
  return {
    network: get('type') ?? 'tcp',
    security: get('security') ?? defaultSecurity,
    sni: get('sni') ?? get('peer'),
    fp: get('fp'),
    alpn: get('alpn'),
    allowInsecure: q.get('allowInsecure') === '1' || q.get('insecure') === '1',
    pbk: get('pbk'),
    sid: get('sid'),
    spx: get('spx'),
    path: get('path'),
    host: get('host'),
    serviceName: get('serviceName'),
    mode: get('mode'),
    headerType: get('headerType'),
  }
}

function hostPort(url: URL): { address: string; port: number } {
  const address = url.hostname.replace(/^\[|\]$/g, '')
  const port = parseInt(url.port, 10)
  if (!address || !port) throw new ShareLinkError('missing_address')
  return { address, port }
}

function parseVless(link: string, index: number): Outbound {
  const url = new URL(link)
  const id = decodeURIComponent(url.username)
  if (!id) throw new ShareLinkError('missing_id')
  const { address, port } = hostPort(url)
  const flow = url.searchParams.get('flow')
  return {
    tag: tagFrom(decodeURIComponent(url.hash.slice(1)), `vless-${index}`),
    protocol: 'vless',
    settings: {
      vnext: [{ address, port, users: [{ id, encryption: url.searchParams.get('encryption') || 'none', ...(flow ? { flow } : {}) }] }],
    },
    streamSettings: streamSettings(transportFromQuery(url.searchParams, 'none')),
  }
}

function parseTrojan(link: string, index: number): Outbound {
  const url = new URL(link)
  const password = decodeURIComponent(url.username)
  if (!password) throw new ShareLinkError('missing_id')
  const { address, port } = hostPort(url)
  return {
    tag: tagFrom(decodeURIComponent(url.hash.slice(1)), `trojan-${index}`),
    protocol: 'trojan',
    settings: { servers: [{ address, port, password }] },
    // Trojan is TLS unless the link says otherwise.
    streamSettings: streamSettings(transportFromQuery(url.searchParams, 'tls')),
  }
}

function parseVmess(link: string, index: number): Outbound {
  let v: Record<string, string | number | undefined>
  try {
    v = JSON.parse(b64decode(link.slice('vmess://'.length)))
  } catch {
    throw new ShareLinkError('bad_vmess')
  }
  const address = String(v.add ?? '')
  const port = parseInt(String(v.port ?? ''), 10)
  if (!address || !port || !v.id) throw new ShareLinkError('missing_address')
  const str = (k: string) => (v[k] != null && v[k] !== '' ? String(v[k]) : undefined)
  return {
    tag: tagFrom(str('ps') ?? '', `vmess-${index}`),
    protocol: 'vmess',
    settings: { vnext: [{ address, port, users: [{ id: String(v.id), alterId: Number(v.aid ?? 0), security: str('scy') ?? 'auto' }] }] },
    streamSettings: streamSettings({
      network: str('net') ?? 'tcp',
      security: str('tls') === 'tls' ? 'tls' : 'none',
      sni: str('sni'),
      fp: str('fp'),
      alpn: str('alpn'),
      path: str('path'),
      host: str('host'),
      serviceName: str('path'),
      headerType: str('type'),
    }),
  }
}

// SIP002 (ss://base64(method:password)@host:port#name) and the older form
// where everything before the # is one base64 blob.
function parseShadowsocks(link: string, index: number): Outbound {
  const body = link.slice('ss://'.length)
  const hashAt = body.indexOf('#')
  const name = hashAt >= 0 ? decodeURIComponent(body.slice(hashAt + 1)) : ''
  let main = hashAt >= 0 ? body.slice(0, hashAt) : body
  main = main.split('?')[0].replace(/\/$/, '')
  let userinfo: string
  let server: string
  if (main.includes('@')) {
    const at = main.lastIndexOf('@')
    const raw = decodeURIComponent(main.slice(0, at))
    userinfo = raw.includes(':') ? raw : b64decode(raw)
    server = main.slice(at + 1)
  } else {
    const decoded = b64decode(main)
    const at = decoded.lastIndexOf('@')
    if (at < 0) throw new ShareLinkError('missing_address')
    userinfo = decoded.slice(0, at)
    server = decoded.slice(at + 1)
  }
  const colon = userinfo.indexOf(':')
  const portAt = server.lastIndexOf(':')
  const address = server.slice(0, portAt).replace(/^\[|\]$/g, '')
  const port = parseInt(server.slice(portAt + 1), 10)
  if (colon < 0 || !address || !port) throw new ShareLinkError('missing_address')
  return {
    tag: tagFrom(name, `ss-${index}`),
    protocol: 'shadowsocks',
    settings: { servers: [{ address, port, method: userinfo.slice(0, colon), password: userinfo.slice(colon + 1) }] },
  }
}

// index keeps fallback tags distinct when several links have no name.
export function parseShareLink(input: string, index = 1): Outbound {
  const link = input.trim()
  const scheme = link.slice(0, link.indexOf('://')).toLowerCase()
  try {
    switch (scheme) {
      case 'vless':
        return parseVless(link, index)
      case 'trojan':
        return parseTrojan(link, index)
      case 'vmess':
        return parseVmess(link, index)
      case 'ss':
        return parseShadowsocks(link, index)
    }
  } catch (e) {
    if (e instanceof ShareLinkError) throw e
    throw new ShareLinkError('unreadable')
  }
  throw new ShareLinkError('unsupported')
}

// A one-line description of an outbound's transport for the list, since the
// form only edits address/port/secret.
export function describeStream(stream: Record<string, unknown> | undefined): string {
  if (!stream) return ''
  const parts = [String(stream.network ?? 'tcp')]
  const security = String(stream.security ?? 'none')
  if (security !== 'none') {
    const tls = (stream.realitySettings ?? stream.tlsSettings) as Record<string, unknown> | undefined
    parts.push(tls?.serverName ? `${security} · ${tls.serverName}` : security)
  }
  return parts.join(' · ')
}
