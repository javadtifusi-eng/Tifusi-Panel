import { useEffect, useState } from 'react'

import {
  addBackupDomain,
  ApiError,
  checkBackupDomains,
  failoverBackupDomain,
  getBackupDomains,
  removeBackupDomain,
  setBackupAutoFailover,
  type BackupDomainsState,
} from '../lib/api'
import { useLang } from '../i18n/LangContext'
import { Modal, useToast } from './ui'

/** Settings > Subscription domains: the live one, its health from Iran, and the
 *  backups the Tifusi app falls over to (backend/app/subscription/backup_domains.py). */
export default function BackupDomains() {
  const { t } = useLang()
  const b = t.ui.set.backupDomains
  const say = useToast()
  const [state, setState] = useState<BackupDomainsState | null>(null)
  const [newDomain, setNewDomain] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    getBackupDomains().then(setState).catch(() => undefined)
  }, [])

  async function run(key: string, fn: () => Promise<BackupDomainsState>, done?: string) {
    setBusy(key)
    setError(null)
    try {
      setState(await fn())
      if (done) say(done)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setBusy(null)
    }
  }

  if (!state) return <div className="hint">…</div>

  const down = state.live_ok === false
  const next = state.backups.find((d) => d.has_cert)

  return (
    <div className="bkd">
      <div className={`bkd-live ${down ? 'down' : ''}`}>
        <span className="orb" data-ok={state.live_ok === null ? 'unknown' : String(state.live_ok)} />
        <div className="grow">
          <div className="mono dom">{state.live ?? '—'}</div>
          <div className="meta">
            {state.live_ok === null ? b.notChecked : down ? b.blocked : b.open}
          </div>
        </div>
        <button type="button" className="btn" disabled={busy === 'check'} onClick={() => run('check', checkBackupDomains)}>
          {busy === 'check' ? b.checking : b.checkNow}
        </button>
      </div>

      {down && <div className="bkd-alert">{b.blockedHint}</div>}

      <div className="bkd-head">
        <b>{b.backupsTitle}</b>
        <button type="button" className={`btn ${down ? 'bad-solid' : ''}`} disabled={!next || busy === 'jump'} onClick={() => setConfirm(true)}>
          {b.jump}
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {b.backupsHint}
      </p>

      <div className="bkd-list">
        {state.backups.length === 0 && <div className="hint">{b.none}</div>}
        {state.backups.map((d, i) => (
          <div key={d.domain} className="bkd-row">
            <div className="grow">
              <div className="n">{b.nth(i + 1)}</div>
              <div className="mono dom">{d.domain}</div>
            </div>
            <span className={`pill ${d.has_cert ? 'ok' : 'idle'}`}>
              <i />
              {d.has_cert ? b.ready : b.noCert}
            </span>
            <button type="button" className="btn" disabled={busy === d.domain} onClick={() => run(d.domain, () => removeBackupDomain(d.domain))}>
              {b.remove}
            </button>
          </div>
        ))}
      </div>

      <form
        className="bkd-add"
        onSubmit={(e) => {
          e.preventDefault()
          const domain = newDomain.trim()
          if (!domain) return
          run('add', () => addBackupDomain(domain), b.added).then(() => setNewDomain(''))
        }}
      >
        <input
          id="set-backup-domain"
          className="input ltr mono"
          placeholder="sub.example.xyz"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          aria-label={b.addLabel}
        />
        <button type="submit" className="btn solid" disabled={busy === 'add'}>
          {busy === 'add' ? b.adding : b.add}
        </button>
      </form>
      <p className="hint" style={{ margin: 0 }}>
        {b.addHint}
      </p>

      <label className="bkd-auto">
        <span>
          <b>{b.autoTitle}</b>
          <small>{b.autoHint}</small>
        </span>
        <input
          type="checkbox"
          id="set-backup-auto"
          checked={state.auto_failover}
          onChange={async (e) => {
            const on = e.target.checked
            setState({ ...state, auto_failover: on })
            try {
              await setBackupAutoFailover(on)
            } catch {
              setState({ ...state, auto_failover: !on })
            }
          }}
        />
      </label>

      {error && <div className="msg err-text">{error}</div>}

      {confirm && next && (
        <Modal title={b.jumpTitle(next.domain)} onClose={() => setConfirm(false)} width={460}>
          <p style={{ margin: 0, lineHeight: 1.9 }}>{b.jumpBody}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn bad-solid"
              disabled={busy === 'jump'}
              onClick={() => run('jump', failoverBackupDomain, b.jumped(next.domain)).then(() => setConfirm(false))}
            >
              {b.jump}
            </button>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>
              {b.cancel}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
