import { useEffect, useState } from 'react'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import { LangProvider } from './i18n/LangContext'
import { clearToken, getToken, setToken } from './lib/auth'

export default function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken())

  useEffect(() => {
    function handleUnauthorized() {
      setTokenState(null)
    }
    window.addEventListener('tifusi:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('tifusi:unauthorized', handleUnauthorized)
  }, [])

  // One listener moves the glow of whichever .hover-btn is under the pointer (see index.css).
  useEffect(() => {
    function handlePointerMove(e: PointerEvent) {
      const button = (e.target as Element | null)?.closest?.('.hover-btn') as HTMLElement | null
      if (!button) return
      const rect = button.getBoundingClientRect()
      button.style.setProperty('--x', `${e.clientX - rect.left}px`)
      button.style.setProperty('--y', `${e.clientY - rect.top}px`)
    }
    document.addEventListener('pointermove', handlePointerMove)
    return () => document.removeEventListener('pointermove', handlePointerMove)
  }, [])

  function handleAuthenticated(newToken: string) {
    setToken(newToken)
    setTokenState(newToken)
  }

  function handleLogout() {
    clearToken()
    setTokenState(null)
  }

  return (
    <LangProvider>
      {!token ? <Login onAuthenticated={handleAuthenticated} /> : <Dashboard onLogout={handleLogout} />}
    </LangProvider>
  )
}
