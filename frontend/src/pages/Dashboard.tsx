import { useState } from 'react'
import LiveClock from '../components/LiveClock'
import { Logo } from '../components/Logo'
import GroupsPage from './Groups'
import HostsPage from './Hosts'
import NodesPage from './Nodes'
import RealityScanPage from './RealityScan'
import SettingsPage from './Settings'
import UsersPage from './Users'

const ACCENT = '#22D3EE'

const navItems = [
  { id: 'users', label: 'کاربران', enabled: true },
  { id: 'hosts', label: 'هاست‌ها', enabled: true },
  { id: 'groups', label: 'گروه‌ها', enabled: true },
  { id: 'nodes', label: 'نودها', enabled: true },
  { id: 'reality', label: 'اسکنر REALITY', enabled: true },
  { id: 'settings', label: 'تنظیمات', enabled: true },
] as const

type ActiveTab = 'users' | 'hosts' | 'groups' | 'nodes' | 'reality' | 'settings'

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [active, setActive] = useState<ActiveTab>('users')

  return (
    <div dir="rtl" className="flex min-h-screen w-full bg-panel-950 font-body text-slate-100">
      <aside className="flex w-60 flex-shrink-0 flex-col border-l border-white/10 bg-slate-950/60 px-4 py-6">
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
              disabled={!item.enabled}
              onClick={() => item.enabled && setActive(item.id as ActiveTab)}
              className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-right text-sm transition-colors ${
                item.enabled
                  ? active === item.id
                    ? 'bg-cyan-400/10 text-cyan-300'
                    : 'text-slate-300 hover:bg-white/5'
                  : 'cursor-not-allowed text-slate-600'
              }`}
            >
              <span>{item.label}</span>
              {!item.enabled && <span className="text-[10px] text-slate-700">به‌زودی</span>}
            </button>
          ))}
        </nav>

        <button
          onClick={onLogout}
          className="rounded-lg border border-white/10 px-3 py-2.5 text-right text-sm text-slate-400 hover:bg-white/5"
        >
          خروج
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
        {active === 'reality' && <RealityScanPage />}
        {active === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}
