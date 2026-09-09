import { useEffect, useState } from 'react'
import LiveClock from '../components/LiveClock'
import { Logo } from '../components/Logo'
import SystemStatsBar from '../components/SystemStats'
import { useLang } from '../i18n/LangContext'
import { getAdminProfile, type AdminProfile } from '../lib/api'

function MenuIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
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
    <div dir={dir} className="flex min-h-screen w-full bg-panel-950 font-body text-slate-100">
      {/* Mobile top bar — the fixed w-60 sidebar below doesn't fit next to real
          content on a phone-width screen, so under lg it's an off-canvas
          drawer instead, opened from here. */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-white/10 bg-panel-950/95 px-4 py-3 backdrop-blur lg:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label={t.nav.menu}
          className="rounded-lg border border-white/10 p-2 text-slate-300"
        >
          <MenuIcon />
        </button>
        <div className="flex items-center gap-2">
          <Logo accent={ACCENT} size={26} glow={false} />
          <span className="font-display text-xs font-bold tracking-[2px] text-slate-50">TIFUSI</span>
        </div>
        <div className="w-9" />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 z-50 flex w-64 flex-shrink-0 flex-col bg-slate-950 px-4 py-6 transition-transform duration-200 lg:static lg:z-auto lg:w-60 lg:translate-x-0 lg:bg-slate-950/60 ${sideEdge} border-white/10 ${
          sidebarOpen ? 'translate-x-0' : closedTranslate
        } lg:transition-none`}
      >
        <div className="mb-8 flex items-center gap-2.5 px-2">
          <Logo accent={ACCENT} size={36} />
          <div>
            <div className="font-display text-sm font-bold tracking-[2px] text-slate-50">TIFUSI</div>
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
                active === item.id ? 'bg-cyan-400/10 text-cyan-300' : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mb-2 flex justify-center gap-2">
          <button
            onClick={() => setLang('en')}
            className={`rounded-md border px-3 py-1 text-[11px] ${lang === 'en' ? 'border-cyan-400/50 text-cyan-300' : 'border-white/20 text-slate-400'}`}
          >
            EN
          </button>
          <button
            onClick={() => setLang('fa')}
            className={`rounded-md border px-3 py-1 text-[11px] ${lang === 'fa' ? 'border-cyan-400/50 text-cyan-300' : 'border-white/20 text-slate-400'}`}
          >
            فارسی
          </button>
        </div>

        <button
          onClick={onLogout}
          className={`rounded-lg border border-white/10 px-3 py-2.5 text-sm text-slate-400 hover:bg-white/5 ${dir === 'rtl' ? 'text-right' : 'text-left'}`}
        >
          {t.nav.logout}
        </button>
      </aside>

      <main className="w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 pt-20 lg:p-8 lg:pt-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-full overflow-x-auto">
            <SystemStatsBar />
          </div>
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
