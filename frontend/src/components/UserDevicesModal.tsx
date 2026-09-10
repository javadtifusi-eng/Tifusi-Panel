import { useEffect, useState } from 'react'
import { useLang } from '../i18n/LangContext'
import { ApiError, deleteUserDevice, listUserDevices, resetUserDevices, type UserDevice } from '../lib/api'

export default function UserDevicesModal({
  userId,
  username,
  onClose,
}: {
  userId: number
  username: string
  onClose: () => void
}) {
  const { t, dir } = useLang()
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-well-strong p-4" onClick={onClose}>
      <div
        dir={dir}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-cyan-400/20 bg-surface p-6"
        style={{ boxShadow: '0 0 60px rgba(34,211,238,0.1)' }}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold text-heading">{t.userDevicesModal.title(username)}</h2>
          <button onClick={onClose} className="text-muted hover:text-body">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-faint">{t.userDevicesModal.desc}</p>

        {error && <div className="mb-3 text-sm text-danger">{error}</div>}
        {!devices && !error && <div className="text-sm text-faint">{t.loading}</div>}

        {devices && (
          <>
            {devices.length === 0 ? (
              <div className="text-sm text-faint">{t.userDevicesModal.noDevicesYet}</div>
            ) : (
              <div className="flex flex-col gap-2">
                {devices.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-subtle bg-field p-2.5"
                  >
                    <div>
                      <div dir="ltr" className="text-left font-mono text-xs text-body">
                        {d.identifier}
                      </div>
                      <div className="text-[11px] text-faint">
                        {t.userDevicesModal.lastSeen(new Date(d.last_seen).toLocaleString())}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(d)}
                      disabled={busyId === d.id}
                      className="flex-shrink-0 text-xs text-danger hover:underline disabled:opacity-50"
                    >
                      {t.common.delete}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {devices.length > 0 && (
              <button
                onClick={handleResetAll}
                disabled={resetting}
                className="mt-4 text-xs text-danger hover:underline disabled:opacity-50"
              >
                {t.userDevicesModal.resetAllBtn}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
