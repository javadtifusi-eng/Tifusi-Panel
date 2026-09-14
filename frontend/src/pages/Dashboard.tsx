import { useEffect, useState, type FormEvent } from 'react'
import LiveClock from '../components/LiveClock'
import { TifusiMark } from '../components/Logo'
import {
  IconBell,
  IconChip,
  IconGlobe,
  IconGrid,
  IconHome,
  IconLogout,
  IconMenu,
  IconSearch,
  IconServer,
  IconSettings,
  IconTunnel,
  IconUsers,
  type IconProps,
} from '../components/icons'
import { useLang } from '../i18n/LangContext'
import { getAdminProfile, getVersion, type AdminProfile, type VersionInfo } from '../lib/api'
import { initials } from '../lib/format'
import CoresPage from './Cores'
import GroupsPage from './Groups'
import HostsPage from './Hosts'
import NodesPage from './Nodes'
import OverviewPage from './Overview'
import SettingsPage from './Settings'
import TunnelsPage from './Tunnels'
import UsersPage from './Users'

type ActiveTab = 'overview' | 'users' | 'hosts' | 'groups' | 'nodes' | 'cores' | 'tunnels' | 'settings'

const MAIN_TABS: ActiveTab[] = ['overview', 'users', 'hosts', 'groups', 'nodes', 'cores', 'tunnels']

const NAV_ICONS: Record<ActiveTab, (p: IconProps) => JSX.Element> = {
  overview: IconHome,
  users: IconUsers,
  hosts: IconGlobe,
  groups: IconGrid,
  nodes: IconServer,
  cores: IconChip,
  tunnels: IconTunnel,
  settings: IconSettings,
}

// Always the newest build: GitHub serves the latest release's asset at this fixed URL.
const APP_DOWNLOAD_URL = 'https://github.com/javadtifusi-eng/Tifusi-VPN/releases/latest/download/tifusi-vpn.apk'

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const { lang, setLang, t, dir } = useLang()
  const [active, setActive] = useState<ActiveTab>('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profile, setProfile] = useState<AdminProfile | null>(null)
  const [version, setVersion] = useState<VersionInfo | null>(null)
  const [search, setSearch] = useState('')
  const [bellOpen, setBellOpen] = useState(false)

  useEffect(() => {
    getAdminProfile().then(setProfile).catch(() => undefined)
    getVersion().then(setVersion).catch(() => undefined)
  }, [])

  // 'overview' and 'settings' always show — overview degrades gracefully
  // per-section when a scope is missing, and settings is where an admin
  // changes their own password regardless of what else they can reach.
  function canSee(id: ActiveTab): boolean {
    if (id === 'overview' || id === 'settings') return true
    if (!profile || profile.is_owner || profile.permissions === null) return true
    return (profile.permissions as string[]).includes(id)
  }

  function selectTab(id: ActiveTab) {
    setActive(id)
    setSidebarOpen(false)
    setBellOpen(false)
  }

  // The header search filters the Users page: typing there while on Users
  // narrows the list live, and Enter from any other page opens Users.
  function submitSearch(e: FormEvent) {
    e.preventDefault()
    if (canSee('users')) selectTab('users')
  }

  function labelFor(id: ActiveTab): string {
    return id === 'overview' ? t.nav.dashboard : t.nav[id]
  }

  const subtitle = active === 'overview' ? t.nav.subtitles.overview(profile?.username ?? '') : t.nav.subtitles[active]
  const updateAvailable = !!version?.update_available
  const sideEdge = dir === 'rtl' ? 'right-0 border-l' : 'left-0 border-r'
  const closedTranslate = dir === 'rtl' ? 'translate-x-full' : '-translate-x-full'

  function navButton(id: ActiveTab) {
    const Icon = NAV_ICONS[id]
    const isActive = active === id
    return (
      <button
        key={id}
        type="button"
        onClick={() => selectTab(id)}
        aria-current={isActive ? 'page' : undefined}
        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-[9px] text-start text-[13.5px] transition-colors ${
          isActive ? 'border-[#262626] bg-raised text-primary' : 'border-transparent text-muted hover:bg-hover hover:text-primary'
        }`}
      >
        <Icon />
        <span className="truncate">{labelFor(id)}</span>
      </button>
    )
  }

  return (
    <div dir={dir} className="min-h-screen w-full bg-app font-body text-primary lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      {/* Mobile top bar — under lg the sidebar is an off-canvas drawer
          instead of a column, opened from here. */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-subtle bg-app/95 px-4 py-3 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label={t.nav.menu}
          className="rounded-lg border border-subtle p-2 text-secondary"
        >
          <IconMenu size={18} strokeWidth={2} />
        </button>
        <div className="flex items-center gap-2">
          <TifusiMark size={28} />
          <span className="font-en text-sm font-semibold text-heading">{t.nav.brand}</span>
        </div>
        <div className="w-9" />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 z-50 flex w-64 flex-col gap-[22px] overflow-y-auto border-subtle bg-side px-3.5 py-5 transition-transform duration-200 ${sideEdge} ${
          sidebarOpen ? 'translate-x-0' : closedTranslate
        } lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-auto lg:translate-x-0 lg:transition-none`}
      >
        <div className="flex items-center gap-2.5 px-2 py-1">
          <TifusiMark size={30} />
          <strong className="font-en text-[15px] font-semibold text-heading">{t.nav.brand}</strong>
        </div>

        <nav aria-label={t.nav.menu} className="flex flex-col gap-0.5">
          {MAIN_TABS.filter(canSee).map(navButton)}
          <div className="h-3.5" />
          {navButton('settings')}
        </nav>

        <div className="flex-1" />

        <a
          href={APP_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-[#1f1f1f] px-2.5 py-[9px] font-en text-[12px] text-primary transition-colors hover:bg-hover"
        >
          <TifusiMark size={22} />
          <span>{t.nav.appDownload}</span>
        </a>

        <div className="flex items-center gap-2.5 border-t border-subtle px-2 pt-3">
          <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-[#e5e5e5] font-en text-xs font-semibold text-app">
            {profile ? initials(profile.username) : ''}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-en text-[13px] font-medium text-primary">
              <bdi>{profile?.username ?? '…'}</bdi>
            </div>
            <div className="truncate text-[11px] text-faint">
              {profile ? (profile.is_owner ? t.nav.ownerRole : t.nav.adminRole) : ' '}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}
            title={t.nav.switchLang}
            aria-label={t.nav.switchLang}
            className="grid h-7 min-w-[30px] place-items-center rounded-md border border-subtle px-1.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-primary"
          >
            {t.nav.switchLangShort}
          </button>
          <button
            type="button"
            onClick={onLogout}
            title={t.nav.logout}
            aria-label={t.nav.logout}
            className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-danger"
          >
            <IconLogout size={16} className="rtl:-scale-x-100" />
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-col gap-4 px-4 pb-10 pt-20 lg:px-[22px] lg:pt-[18px]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-hair pb-3.5">
          <div className="min-w-0">
            <h1 className="text-[21px] font-semibold leading-tight text-heading">{labelFor(active)}</h1>
            <p className="mt-1 text-xs text-muted">{subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {canSee('users') && (
              <form
                role="search"
                onSubmit={submitSearch}
                className="flex w-[220px] max-w-full items-center gap-2 rounded-lg border border-subtle bg-[#121212] px-3 py-[7px] transition-colors focus-within:border-strong"
              >
                <IconSearch size={14} strokeWidth={2} className="text-muted" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.nav.searchPlaceholder}
                  aria-label={t.nav.searchPlaceholder}
                  className="w-full border-0 bg-transparent text-[12.5px] text-primary outline-none"
                />
              </form>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => setBellOpen((v) => !v)}
                aria-label={t.nav.notifications}
                aria-expanded={bellOpen}
                className="relative grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-primary"
              >
                <IconBell size={18} />
                {updateAvailable && <i className="absolute end-1 top-1 h-[7px] w-[7px] rounded-full bg-danger" />}
              </button>
              {bellOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setBellOpen(false)} />
                  <div className="absolute end-0 top-full z-40 mt-2 w-64 rounded-xl border border-subtle bg-surface p-3 text-xs shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
                    <div className="mb-2 text-[13px] font-semibold text-heading">{t.nav.notifications}</div>
                    {updateAvailable && version?.latest ? (
                      <div className="rounded-[10px] border border-well-edge bg-well px-3 py-2 leading-relaxed text-body">
                        {t.nav.updateNotice(version.latest)}
                      </div>
                    ) : (
                      <div className="text-faint">{t.nav.noNotifications}</div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2.5 border-s border-hair ps-3">
              <LiveClock />
              {version && (
                <span
                  dir="ltr"
                  title={updateAvailable ? t.nav.updateAvailable : t.nav.upToDate}
                  className={`rounded-md border px-2 py-0.5 font-en text-[11px] ${
                    updateAvailable ? 'border-warning/30 text-warning' : 'border-subtle text-faint'
                  }`}
                >
                  v{version.current}
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="min-w-0">
          {active === 'overview' && <OverviewPage onNavigate={selectTab} canOpen={canSee} />}
          {active === 'users' && <UsersPage search={search} />}
          {active === 'hosts' && <HostsPage />}
          {active === 'groups' && <GroupsPage />}
          {active === 'nodes' && <NodesPage />}
          {active === 'cores' && <CoresPage />}
          {active === 'tunnels' && <TunnelsPage />}
          {active === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  )
}
