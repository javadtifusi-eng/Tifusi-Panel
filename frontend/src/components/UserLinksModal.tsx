import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useLang } from '../i18n/LangContext'
import { ApiError, getUserLinks, type UserLinks } from '../lib/api'
import { copyToClipboard } from '../lib/clipboard'

const ACCENT = '#22D3EE'

function protocolLabel(link: string): string {
  return link.split('://')[0].toUpperCase()
}

export default function UserLinksModal({
  userId,
  username,
  onClose,
}: {
  userId: number
  username: string
  onClose: () => void
}) {
  const { t, dir } = useLang()
  const [data, setData] = useState<UserLinks | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    getUserLinks(userId)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : t.userLinksModal.fetchError))
  }, [userId])

  async function copy(text: string) {
    if (!(await copyToClipboard(text))) return
    setCopied(text)
    window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-well-strong p-4" onClick={onClose}>
      <div
        dir={dir}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-cyan-400/20 bg-surface p-6"
        style={{ boxShadow: '0 0 60px rgba(34,211,238,0.1)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-heading">{t.userLinksModal.title(username)}</h2>
          <button onClick={onClose} className="text-muted hover:text-body">
            ✕
          </button>
        </div>

        {error && <div className="text-sm text-danger">{error}</div>}
        {!data && !error && <div className="text-sm text-faint">{t.loading}</div>}

        {data && (
          <>
            <div className="mb-6 flex flex-col items-center gap-3 rounded-xl border border-cyan-400/20 bg-well p-4">
              {data.links.length > 0 && (
                <div className="rounded-lg bg-white p-3">
                  <QRCodeSVG value={data.subscription_url} size={160} />
                </div>
              )}
              <div className="text-xs text-muted">{t.userLinksModal.subscriptionLinkLabel}</div>
              <div
                dir="ltr"
                className="w-full break-all rounded-lg bg-field px-3 py-2 text-center font-mono text-[11px] text-accent"
              >
                {data.subscription_url}
              </div>
              <button
                onClick={() => copy(data.subscription_url)}
                className="rounded-lg px-4 py-1.5 text-xs font-bold text-slate-950"
                style={{ backgroundColor: ACCENT }}
              >
                {copied === data.subscription_url ? t.common.copiedCheck : t.userLinksModal.copySubLink}
              </button>
            </div>

            {data.links.length === 0 &&
            data.ikev2_configs.length === 0 &&
            data.l2tp_configs.length === 0 ? (
              <div className="text-sm text-faint">{t.userLinksModal.noHostsForLinks}</div>
            ) : (
              <div className="flex flex-col gap-2">
                {data.links.map((link) => (
                  <div
                    key={link}
                    className="flex items-center gap-2 rounded-lg border border-subtle bg-field p-2.5"
                  >
                    <span className="flex-shrink-0 rounded-full border border-edge px-2 py-1 text-[10px] text-secondary">
                      {protocolLabel(link)}
                    </span>
                    <span dir="ltr" className="flex-1 truncate text-left font-mono text-[11px] text-muted">
                      {link}
                    </span>
                    <button onClick={() => copy(link)} className="flex-shrink-0 text-xs" style={{ color: ACCENT }}>
                      {copied === link ? t.copied : t.copy}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {data.ikev2_configs.length > 0 && (
              <div className="mt-4 flex flex-col gap-3">
                {data.ikev2_configs.map((ike, idx) => {
                  const text = `Server: ${ike.server}\nRemote ID: ${ike.remote_id ?? ike.server}\nPSK: ${ike.psk ?? '—'}\nUsername: ${ike.username}\nPassword: ${ike.password}`
                  const fields: [string, string][] = [
                    ['Server', ike.server],
                    ...(ike.remote_id ? ([['Remote ID', ike.remote_id]] as [string, string][]) : []),
                    ...(ike.psk ? ([['PSK', ike.psk]] as [string, string][]) : []),
                    ['Username', ike.username],
                    ['Password', ike.password],
                  ]
                  return (
                    <div key={`${idx}-${ike.remark}`} className="rounded-lg border border-subtle bg-field p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="rounded-full border border-edge px-2 py-1 text-[10px] text-secondary">
                          IKEV2 · {ike.remark}
                        </span>
                        <button onClick={() => copy(text)} className="text-xs font-bold" style={{ color: ACCENT }}>
                          {copied === text ? t.copied : t.userLinksModal.copyConfig}
                        </button>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {fields.map(([label, value]) => (
                          <div key={label} className="flex items-center gap-2 rounded-lg bg-well px-2.5 py-1.5">
                            <span className="w-16 flex-shrink-0 text-[10px] text-faint">{label}</span>
                            <span dir="ltr" className="flex-1 truncate text-left font-mono text-[11px] text-muted">
                              {value}
                            </span>
                            <button
                              onClick={() => copy(value)}
                              className="flex-shrink-0 text-xs font-bold"
                              style={{ color: ACCENT }}
                            >
                              {copied === value ? t.copied : t.copy}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {data.l2tp_configs.length > 0 && (
              <div className="mt-4 flex flex-col gap-3">
                {data.l2tp_configs.map((l2tp, idx) => {
                  const text = `Server: ${l2tp.server}\nPSK: ${l2tp.psk ?? '—'}\nUsername: ${l2tp.username}\nPassword: ${l2tp.password}`
                  const fields: [string, string][] = [
                    ['Server', l2tp.server],
                    ...(l2tp.psk ? ([['PSK', l2tp.psk]] as [string, string][]) : []),
                    ['Username', l2tp.username],
                    ['Password', l2tp.password],
                  ]
                  return (
                    <div key={`${idx}-${l2tp.remark}`} className="rounded-lg border border-subtle bg-field p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="rounded-full border border-edge px-2 py-1 text-[10px] text-secondary">
                          L2TP · {l2tp.remark}
                        </span>
                        <button onClick={() => copy(text)} className="text-xs font-bold" style={{ color: ACCENT }}>
                          {copied === text ? t.copied : t.userLinksModal.copyConfig}
                        </button>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {fields.map(([label, value]) => (
                          <div key={label} className="flex items-center gap-2 rounded-lg bg-well px-2.5 py-1.5">
                            <span className="w-16 flex-shrink-0 text-[10px] text-faint">{label}</span>
                            <span dir="ltr" className="flex-1 truncate text-left font-mono text-[11px] text-muted">
                              {value}
                            </span>
                            <button
                              onClick={() => copy(value)}
                              className="flex-shrink-0 text-xs font-bold"
                              style={{ color: ACCENT }}
                            >
                              {copied === value ? t.copied : t.copy}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
