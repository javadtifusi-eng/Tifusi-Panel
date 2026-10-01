// The inbound wizard's state and the JSON it produces — shared by the inline
// "new inbound" builder and the full core editor so both write the same thing.

export type WizardProtocol = 'vless' | 'vmess' | 'trojan' | 'shadowsocks'

export type Wizard = ReturnType<typeof emptyWizard>

export function emptyWizard() {
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

export function buildInboundJson(w: Wizard): Record<string, unknown> {
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
