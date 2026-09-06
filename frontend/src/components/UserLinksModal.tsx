import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useLang } from '../i18n/LangContext'
import { ApiError, getUserLinks, type UserLinks } from '../lib/api'

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
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard API unavailable; the text stays visible to select by hand.
    }
    setCopied(text)
    window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        dir={dir}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-cyan-400/20 bg-slate-950 p-6"
        style={{ boxShadow: '0 0 60px rgba(34,211,238,0.1)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-50">{t.userLinksModal.title(username)}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        {error && <div className="text-sm text-red-400">{error}</div>}
        {!data && !error && <div className="text-sm text-slate-500">{t.loading}</div>}

        {data && (
          <>
            <div className="mb-6 flex flex-col items-center gap-3 rounded-xl border border-cyan-400/20 bg-black/25 p-4">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={data.subscription_url} size={160} />
              </div>
              <div className="text-xs text-slate-400">{t.userLinksModal.subscriptionLinkLabel}</div>
              <div
                dir="ltr"
                className="w-full break-all rounded-lg bg-white/5 px-3 py-2 text-center font-mono text-[11px] text-cyan-200"
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
            data.wireguard_configs.length === 0 &&
            data.ikev2_configs.length === 0 &&
            data.l2tp_configs.length === 0 ? (
              <div className="text-sm text-slate-500">{t.userLinksModal.noHostsForLinks}</div>
            ) : (
              <div className="flex flex-col gap-2">
                {data.links.map((link) => (
                  <div
                    key={link}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2.5"
                  >
                    <span className="flex-shrink-0 rounded-full border border-white/15 px-2 py-1 text-[10px] text-slate-300">
                      {protocolLabel(link)}
                    </span>
                    <span dir="ltr" className="flex-1 truncate text-left font-mono text-[11px] text-slate-400">
                      {link}
                    </span>
                    <button onClick={() => copy(link)} className="flex-shrink-0 text-xs" style={{ color: ACCENT }}>
                      {copied === link ? t.copied : t.copy}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {data.wireguard_configs.length > 0 && (
              <div className="mt-4 flex flex-col gap-3">
                {data.wireguard_configs.map((wg) => (
                  <div key={wg.remark} className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="rounded-full border border-white/15 px-2 py-1 text-[10px] text-slate-300">
                        WIREGUARD · {wg.remark}
                      </span>
                      <button
                        onClick={() => copy(wg.config)}
                        className="text-xs font-bold"
                        style={{ color: ACCENT }}
                      >
                        {copied === wg.config ? t.copied : t.userLinksModal.copyConfig}
                      </button>
                    </div>
                    <pre
                      dir="ltr"
                      className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-black/30 p-2 text-left font-mono text-[10px] text-slate-400"
                    >
                      {wg.config}
                    </pre>
                  </div>
                ))}
              </div>
            )}

            {data.ikev2_configs.length > 0 && (
              <div className="mt-4 flex flex-col gap-3">
                {data.ikev2_configs.map((ike, idx) => {
                  const text = `Server: ${ike.server}\nPSK: ${ike.psk ?? '—'}\nUsername: ${ike.username}\nPassword: ${ike.password}`
                  return (
                    <div key={`${idx}-${ike.remark}`} className="rounded-lg border border-white/10 bg-white/5 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="rounded-full border border-white/15 px-2 py-1 text-[10px] text-slate-300">
                          IKEV2 · {ike.remark}
                        </span>
                        <button onClick={() => copy(text)} className="text-xs font-bold" style={{ color: ACCENT }}>
                          {copied === text ? t.copied : t.userLinksModal.copyConfig}
                        </button>
                      </div>
                      <pre
                        dir="ltr"
                        className="whitespace-pre-wrap break-all rounded-lg bg-black/30 p-2 text-left font-mono text-[10px] text-slate-400"
                      >
                        {text}
                      </pre>
                    </div>
                  )
                })}
              </div>
            )}

            {data.l2tp_configs.length > 0 && (
              <div className="mt-4 flex flex-col gap-3">
                {data.l2tp_configs.map((l2tp, idx) => {
                  const text = `Server: ${l2tp.server}\nPSK: ${l2tp.psk ?? '—'}\nUsername: ${l2tp.username}\nPassword: ${l2tp.password}`
                  return (
                    <div key={`${idx}-${l2tp.remark}`} className="rounded-lg border border-white/10 bg-white/5 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="rounded-full border border-white/15 px-2 py-1 text-[10px] text-slate-300">
                          L2TP · {l2tp.remark}
                        </span>
                        <button onClick={() => copy(text)} className="text-xs font-bold" style={{ color: ACCENT }}>
                          {copied === text ? t.copied : t.userLinksModal.copyConfig}
                        </button>
                      </div>
                      <pre
                        dir="ltr"
                        className="whitespace-pre-wrap break-all rounded-lg bg-black/30 p-2 text-left font-mono text-[10px] text-slate-400"
                      >
                        {text}
                      </pre>
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
