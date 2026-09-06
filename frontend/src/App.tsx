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
