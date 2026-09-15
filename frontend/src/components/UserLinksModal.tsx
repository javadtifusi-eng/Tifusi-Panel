import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useLang } from '../i18n/LangContext'
import { ApiError, getUserLinks, listUserAppReports, type AppReport, type UserLinks } from '../lib/api'
import { copyToClipboard } from '../lib/clipboard'
import { parseServerDate } from '../lib/format'
import { Modal } from './ui'

function protocolLabel(link: string): string {
  return link.split('://')[0].toUpperCase()
}

// Anything the app reports that isn't a known success/soft-failure is
// shown as a failure — an unfamiliar result from a newer app is more
// likely a new way to fail than a new way to succeed.
function reportPill(result: string): string {
  if (result === 'connected' || result === 'ok') return 'ok'
  if (result === 'disconnected_early') return 'warn'
  return 'bad'
}

function ConfigCard({
  title,
  fields,
  text,
  copied,
  onCopy,
}: {
  title: string
  fields: [string, string][]
  text: string
  copied: string | null
  onCopy: (v: string) => void
}) {
  const { t } = useLang()
  return (
    <div className="form-section">
      <div className="flex items-center justify-between gap-2">
        <span className="chip en">{title}</span>
        <button onClick={() => onCopy(text)} className="btn">
          {copied === text ? t.copied : t.userLinksModal.copyConfig}
        </button>
      </div>
      {fields.map(([label, value]) => (
        <div key={label} className="tf-linkrow">
          <span className="hint" style={{ margin: 0, width: 64, flex: 'none' }}>
            {label}
          </span>
          <span className="mono">{value}</span>
          <button onClick={() => onCopy(value)} className="btn">
            {copied === value ? t.copied : t.copy}
          </button>
        </div>
      ))}
    </div>
  )
}

export default function UserLinksModal({ userId, username, onClose }: { userId: number; username: string; onClose: () => void }) {
  const { t } = useLang()
  const [data, setData] = useState<UserLinks | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [reports, setReports] = useState<AppReport[] | null>(null)
  const [reportsError, setReportsError] = useState<string | null>(null)
  const resultLabels: Record<string, string> = t.userLinksModal.appReportResults

  useEffect(() => {
    getUserLinks(userId)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : t.userLinksModal.fetchError))
    // Fetched separately so a failure here never hides the links themselves.
    listUserAppReports(userId, 50)
      .then(setReports)
      .catch((err) => setReportsError(err instanceof ApiError ? err.message : t.userLinksModal.appReportsFetchError))
  }, [userId])

  async function copy(text: string) {
    if (!(await copyToClipboard(text))) return
    setCopied(text)
    window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500)
  }

  return (
    <Modal title={t.userLinksModal.title(username)} onClose={onClose} width={560}>
      {error && <div className="tf-alert">{error}</div>}
      {!data && !error && <div className="hint">{t.loading}</div>}

      {data && (
        <>
          <div className="form-section" style={{ alignItems: 'center', textAlign: 'center' }}>
            {data.links.length > 0 && (
              <div className="tf-qr">
                <QRCodeSVG value={data.subscription_url} size={160} />
              </div>
            )}
            <div className="hint">{t.userLinksModal.subscriptionLinkLabel}</div>
            <div className="tf-linkrow" style={{ width: '100%' }}>
              <span className="mono">{data.subscription_url}</span>
              <button onClick={() => copy(data.subscription_url)} className="btn">
                {copied === data.subscription_url ? t.common.copiedCheck : t.userLinksModal.copySubLink}
              </button>
            </div>
            <div className="hint">{t.userLinksModal.appCodeLabel}</div>
            <div className="tf-linkrow" style={{ width: '100%' }}>
              <span className="mono" style={{ fontSize: '1rem', color: 'var(--amber)', textAlign: 'center', letterSpacing: '.08em' }}>
                {data.app_code}
              </span>
              <button onClick={() => copy(data.app_code)} className="btn">
                {copied === data.app_code ? t.common.copiedCheck : t.userLinksModal.copyAppCode}
              </button>
            </div>
          </div>

          {data.links.length === 0 && data.ikev2_configs.length === 0 && data.l2tp_configs.length === 0 ? (
            <div className="hint">{t.userLinksModal.noHostsForLinks}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {data.links.map((link) => (
                <div key={link} className="tf-linkrow">
                  <span className="chip en">{protocolLabel(link)}</span>
                  <span className="mono">{link}</span>
                  <button onClick={() => copy(link)} className="btn">
                    {copied === link ? t.copied : t.copy}
                  </button>
                </div>
              ))}
            </div>
          )}

          {data.ikev2_configs.map((ike, idx) => {
            const text = `Server: ${ike.server}\nRemote ID: ${ike.remote_id ?? ike.server}\nPSK: ${ike.psk ?? '—'}\nUsername: ${ike.username}\nPassword: ${ike.password}`
            const fields: [string, string][] = [
              ['Server', ike.server],
              ...(ike.remote_id ? ([['Remote ID', ike.remote_id]] as [string, string][]) : []),
              ...(ike.psk ? ([['PSK', ike.psk]] as [string, string][]) : []),
              ['Username', ike.username],
              ['Password', ike.password],
            ]
            return <ConfigCard key={`ike-${idx}`} title={`IKEV2 · ${ike.remark}`} fields={fields} text={text} copied={copied} onCopy={copy} />
          })}

          {data.l2tp_configs.map((l2tp, idx) => {
            const text = `Server: ${l2tp.server}\nPSK: ${l2tp.psk ?? '—'}\nUsername: ${l2tp.username}\nPassword: ${l2tp.password}`
            const fields: [string, string][] = [
              ['Server', l2tp.server],
              ...(l2tp.psk ? ([['PSK', l2tp.psk]] as [string, string][]) : []),
              ['Username', l2tp.username],
              ['Password', l2tp.password],
            ]
            return <ConfigCard key={`l2tp-${idx}`} title={`L2TP · ${l2tp.remark}`} fields={fields} text={text} copied={copied} onCopy={copy} />
          })}
        </>
      )}

      <div className="form-section">
        <h4>{t.userLinksModal.appReportsTitle}</h4>
        {reportsError && <div className="err-text">{reportsError}</div>}
        {!reports && !reportsError && <div className="hint">{t.loading}</div>}
        {reports && reports.length === 0 && <div className="hint">{t.userLinksModal.appReportsEmpty}</div>}
        {reports && reports.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {reports.map((r) => (
              <div key={r.id} className="tf-linkrow" style={{ flexWrap: 'wrap' }}>
                <span className={`pill ${reportPill(r.result)}`}>
                  <i />
                  {resultLabels[r.result] ?? r.result}
                </span>
                <span className="mono">{[r.protocol, r.network, r.carrier].filter(Boolean).join(' · ')}</span>
                <span className="hint en" style={{ margin: 0 }} dir="ltr">
                  {parseServerDate(r.reported_at).toLocaleString()}
                </span>
                {r.detail && (
                  <span className="mono" title={r.detail} style={{ flexBasis: '100%', fontSize: '.66rem', color: 'var(--faint)' }}>
                    {r.detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
