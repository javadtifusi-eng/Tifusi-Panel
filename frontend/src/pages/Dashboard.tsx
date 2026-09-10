import { useEffect, useState } from 'react'
import LiveClock from '../components/LiveClock'
import { Logo } from '../components/Logo'
import SystemStatsBar from '../components/SystemStats'
import { useLang } from '../i18n/LangContext'
import { useTheme } from '../theme/ThemeContext'
import { getAdminProfile, type AdminProfile } from '../lib/api'

function MenuIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  )
}
import CoresPage from './Cores'
import GroupsPage from './Groups'
import HostsPage from './Hosts'
import NodesPage from './Nodes'
import OverviewPage from './Overview'
import SettingsPage from './Settings'
import TunnelsPage from './Tunnels'
import UsersPage from './Users'

const ACCENT = '#22D3EE'

type ActiveTab = 'overview' | 'users' | 'hosts' | 'groups' | 'nodes' | 'cores' | 'tunnels' | 'settings'

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const { lang, setLang, t, dir } = useLang()
  const { theme, toggleTheme } = useTheme()
  const [active, setActive] = useState<ActiveTab>('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profile, setProfile] = useState<AdminProfile | null>(null)

  useEffect(() => {
    getAdminProfile().then(setProfile).catch(() => undefined)
  }, [])

  // 'overview' and 'settings' always show — overview degrades gracefully
  // per-section when a scope is missing, and settings is where an admin
  // changes their own password regardless of what else they can reach.
  function canSee(id: ActiveTab): boolean {
    if (id === 'overview' || id === 'settings') return true
    if (!profile || profile.is_owner || profile.permissions === null) return true
    return (profile.permissions as string[]).includes(id)
  }

  const allNavItems: { id: ActiveTab; label: string }[] = [
    { id: 'overview', label: t.nav.dashboard },
    { id: 'users', label: t.nav.users },
    { id: 'hosts', label: t.nav.hosts },
    { id: 'groups', label: t.nav.groups },
    { id: 'nodes', label: t.nav.nodes },
    { id: 'cores', label: t.nav.cores },
    { id: 'tunnels', label: t.nav.tunnels },
    { id: 'settings', label: t.nav.settings },
  ]
  const navItems = allNavItems.filter((item) => canSee(item.id))

  function selectTab(id: ActiveTab) {
    setActive(id)
    setSidebarOpen(false)
  }

  const sideEdge = dir === 'rtl' ? 'right-0 border-l' : 'left-0 border-r'
  const closedTranslate = dir === 'rtl' ? 'translate-x-full' : '-translate-x-full'

  return (
    <div dir={dir} className="flex min-h-screen w-full bg-app font-body text-primary">
      {/* Mobile top bar — the fixed w-60 sidebar below doesn't fit next to real
          content on a phone-width screen, so under lg it's an off-canvas
          drawer instead, opened from here. */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-subtle bg-app/95 px-4 py-3 backdrop-blur lg:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label={t.nav.menu}
          className="rounded-lg border border-subtle p-2 text-secondary"
        >
          <MenuIcon />
        </button>
        <div className="flex items-center gap-2">
          <Logo accent={ACCENT} size={32} glow={false} />
          <span className="font-display text-xs font-bold tracking-[2px] text-heading">TIFUSI</span>
        </div>
        <div className="w-9" />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-well-strong lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 z-50 flex w-64 flex-shrink-0 flex-col bg-surface px-4 py-6 transition-transform duration-200 lg:static lg:z-auto lg:w-60 lg:translate-x-0 lg:bg-surface ${sideEdge} border-subtle ${
          sidebarOpen ? 'translate-x-0' : closedTranslate
        } lg:transition-none`}
      >
        <div className="mb-8 flex items-center gap-2.5 px-2">
          <Logo accent={ACCENT} size={46} />
          <div>
            <div className="font-display text-sm font-bold tracking-[2px] text-heading">TIFUSI</div>
            <div className="font-display text-[9px] font-semibold tracking-[3px]" style={{ color: ACCENT }}>
              PANEL
            </div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => selectTab(item.id)}
              className={`rounded-lg px-3 py-2.5 text-sm transition-colors ${dir === 'rtl' ? 'text-right' : 'text-left'} ${
                active === item.id ? 'bg-accent-tint text-accent' : 'text-secondary hover:bg-field'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mb-2 flex justify-center gap-2">
          <button
            onClick={() => setLang('en')}
            className={`rounded-md border px-3 py-1 text-[11px] ${lang === 'en' ? 'border-cyan-400/50 text-accent' : 'border-edge text-muted'}`}
          >
            EN
          </button>
          <button
            onClick={() => setLang('fa')}
            className={`rounded-md border px-3 py-1 text-[11px] ${lang === 'fa' ? 'border-cyan-400/50 text-accent' : 'border-edge text-muted'}`}
          >
            فارسی
          </button>
          <button
            onClick={toggleTheme}
            aria-label={t.nav.toggleTheme}
            title={t.nav.toggleTheme}
            className="flex items-center justify-center rounded-md border border-edge px-3 py-1 text-muted hover:border-cyan-400/50 hover:text-accent"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>

        <button
          onClick={onLogout}
          className={`rounded-lg border border-subtle px-3 py-2.5 text-sm text-muted hover:bg-field ${dir === 'rtl' ? 'text-right' : 'text-left'}`}
        >
          {t.nav.logout}
        </button>
      </aside>

      <main className="w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 pt-20 lg:p-8 lg:pt-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <SystemStatsBar />
          <LiveClock />
        </div>
        {active === 'overview' && <OverviewPage />}
        {active === 'users' && <UsersPage />}
        {active === 'hosts' && <HostsPage />}
        {active === 'groups' && <GroupsPage />}
        {active === 'nodes' && <NodesPage />}
        {active === 'cores' && <CoresPage />}
        {active === 'tunnels' && <TunnelsPage />}
        {active === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}
