import { useEffect, useState } from 'react'
import { useLang } from '../i18n/LangContext'
import { ApiError, deleteUserDevice, listUserDevices, resetUserDevices, type UserDevice } from '../lib/api'
import { parseServerDate } from '../lib/format'
import { Modal } from './ui'

export default function UserDevicesModal({ userId, username, onClose }: { userId: number; username: string; onClose: () => void }) {
  const { t } = useLang()
  const [devices, setDevices] = useState<UserDevice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [resetting, setResetting] = useState(false)

  async function refresh() {
    try {
      setDevices(await listUserDevices(userId))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.userDevicesModal.fetchError)
    }
  }

  useEffect(() => {
    refresh()
  }, [userId])

  async function handleDelete(device: UserDevice) {
    setBusyId(device.id)
    setError(null)
    try {
      await deleteUserDevice(userId, device.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setBusyId(null)
    }
  }

  async function handleResetAll() {
    if (!window.confirm(t.userDevicesModal.confirmResetAll)) return
    setResetting(true)
    setError(null)
    try {
      await resetUserDevices(userId)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.genericError)
    } finally {
      setResetting(false)
    }
  }

  return (
    <Modal title={t.userDevicesModal.title(username)} sub={t.userDevicesModal.desc} onClose={onClose}>
      {error && <div className="tf-alert">{error}</div>}
      {!devices && !error && <div className="hint">{t.loading}</div>}
      {devices && devices.length === 0 && <div className="hint">{t.userDevicesModal.noDevicesYet}</div>}
      {devices && devices.length > 0 && (
        <>
          <div className="flex flex-col gap-2">
            {devices.map((d) => (
              <div key={d.id} className="tf-linkrow">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="mono" style={{ color: 'var(--body)' }}>
                    {d.label || d.identifier}
                  </span>
                  <span className="hint" style={{ margin: 0 }}>
                    {t.userDevicesModal.lastSeen(parseServerDate(d.last_seen).toLocaleString())}
                  </span>
                </span>
                <button onClick={() => handleDelete(d)} disabled={busyId === d.id} className="btn danger">
                  {t.common.delete}
                </button>
              </div>
            ))}
          </div>
          <div>
            <button onClick={handleResetAll} disabled={resetting} className="btn danger">
              {t.userDevicesModal.resetAllBtn}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
