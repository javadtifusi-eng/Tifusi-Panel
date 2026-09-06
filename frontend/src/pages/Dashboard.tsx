import { useState } from 'react'
import LiveClock from '../components/LiveClock'
import { Logo } from '../components/Logo'
import { useLang } from '../i18n/LangContext'
import GroupsPage from './Groups'
import HostsPage from './Hosts'
import NodesPage from './Nodes'
import SettingsPage from './Settings'
import UsersPage from './Users'

const ACCENT = '#22D3EE'

type ActiveTab = 'users' | 'hosts' | 'groups' | 'nodes' | 'settings'

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const { lang, setLang, t, dir } = useLang()
  const [active, setActive] = useState<ActiveTab>('users')

  const navItems: { id: ActiveTab; label: string }[] = [
    { id: 'users', label: t.nav.users },
    { id: 'hosts', label: t.nav.hosts },
    { id: 'groups', label: t.nav.groups },
    { id: 'nodes', label: t.nav.nodes },
    { id: 'settings', label: t.nav.settings },
  ]

  return (
    <div dir={dir} className="flex min-h-screen w-full bg-panel-950 font-body text-slate-100">
      <aside className={`flex w-60 flex-shrink-0 flex-col bg-slate-950/60 px-4 py-6 ${dir === 'rtl' ? 'border-l' : 'border-r'} border-white/10`}>
        <div className="mb-8 flex items-center gap-2.5 px-2">
          <Logo accent={ACCENT} size={36} />
          <div>
            <div className="font-display text-sm font-bold tracking-[2px] text-slate-50">TIFUSI</div>
            <div className="font-display text-[9px] font-semibold tracking-[3px]" style={{ color: ACCENT }}>
              PANEL
            </div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
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

      <main className="flex-1 overflow-y-auto p-8">
        <div className="mb-6 flex items-center justify-end">
          <LiveClock />
        </div>
        {active === 'users' && <UsersPage />}
        {active === 'hosts' && <HostsPage />}
        {active === 'groups' && <GroupsPage />}
        {active === 'nodes' && <NodesPage />}
        {active === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}
