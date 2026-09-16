import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import LiveClock from '../components/LiveClock'
import { TifusiMark } from '../components/Logo'
import {
  IconBell,
  IconBriefcase,
  IconChip,
  IconGlobe,
  IconGrid,
  IconHome,
  IconLogout,
  IconMenu,
  IconPlus,
  IconSearch,
  IconServer,
  IconSettings,
  IconTunnel,
  IconUsers,
  IconX,
  type IconProps,
} from '../components/icons'
import { ToastProvider, trackPointer, useToast } from '../components/ui'
import { useLang } from '../i18n/LangContext'
import { ApiError, getAdminProfile, getVersion, setAdminAvatar, type AdminProfile, type VersionInfo } from '../lib/api'
import { initials } from '../lib/format'
import CoresPage from './Cores'
import GroupsPage from './Groups'
import HostsPage from './Hosts'
import NodesPage from './Nodes'
import OverviewPage from './Overview'
import ResellersPage from './Resellers'
import SettingsPage from './Settings'
import TunnelsPage from './Tunnels'
import UsersPage from './Users'

export type ActiveTab = 'overview' | 'users' | 'hosts' | 'groups' | 'nodes' | 'cores' | 'resellers' | 'tunnels' | 'settings'

const MAIN_TABS: ActiveTab[] = ['overview', 'users', 'hosts', 'groups', 'nodes', 'cores', 'resellers', 'tunnels']

const NAV_ICONS: Record<ActiveTab, (p: IconProps) => JSX.Element> = {
  overview: IconHome,
  users: IconUsers,
  hosts: IconGlobe,
  groups: IconGrid,
  nodes: IconServer,
  cores: IconChip,
  resellers: IconBriefcase,
  tunnels: IconTunnel,
  settings: IconSettings,
}

interface PaletteItem {
  group: string
  icon: ReactNode
  title: string
  sub: string
  run: () => void
}

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const { lang, setLang, t, dir } = useLang()
  const [active, setActive] = useState<ActiveTab>('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profile, setProfile] = useState<AdminProfile | null>(null)
  const [version, setVersion] = useState<VersionInfo | null>(null)
  const [search, setSearch] = useState('')
  const [bellOpen, setBellOpen] = useState(false)
  // Bumped to ask a page to open its "create" form (from the palette or the dashboard).
  const [createSignal, setCreateSignal] = useState<{ tab: ActiveTab; n: number }>({ tab: 'overview', n: 0 })
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    getAdminProfile()
      .then((p) => {
        setProfile(p)
        // A reseller has no overview; it lands on its own users.
        if (p.is_reseller) setActive((a) => (a === 'overview' ? 'users' : a))
      })
      .catch(() => undefined)
    getVersion().then(setVersion).catch(() => undefined)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // 'overview' and 'settings' always show — overview degrades gracefully
  // per-section when a scope is missing, and settings is where an admin
  // changes their own password regardless of what else they can reach.
  // Two exceptions: only the owner manages resellers, and a reseller never
  // gets the overview's panel-wide numbers.
  function canSee(id: ActiveTab): boolean {
    if (id === 'resellers') return !!profile?.is_owner
    if (id === 'overview') return !profile?.is_reseller
    if (id === 'settings') return true
    if (!profile || profile.is_owner || profile.permissions === null) return true
    return (profile.permissions as string[]).includes(id)
  }

  function selectTab(id: ActiveTab) {
    setActive(id)
    setSidebarOpen(false)
    setBellOpen(false)
    window.scrollTo({ top: 0 })
  }

  function openCreate(tab: ActiveTab) {
    selectTab(tab)
    setCreateSignal((s) => ({ tab, n: s.n + 1 }))
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
  const signal = (tab: ActiveTab) => (createSignal.tab === tab ? createSignal.n : 0)

  function navButton(id: ActiveTab) {
    const Icon = NAV_ICONS[id]
    const isActive = active === id
    return (
      <button
        key={id}
        type="button"
        onClick={() => selectTab(id)}
        onPointerMove={trackPointer}
        aria-current={isActive ? 'page' : undefined}
        className={`nav-spot flex w-full items-center gap-3 rounded-lg border px-3 py-[9px] text-start text-[13.5px] transition-colors ${
          isActive ? 'border-[#2a2a2a] bg-raised text-primary' : 'border-transparent text-muted hover:bg-hover hover:text-primary'
        }`}
      >
        <Icon />
        <span className="truncate">{labelFor(id)}</span>
      </button>
    )
  }

  const paletteItems: PaletteItem[] = useMemo(() => {
    const pages = [...MAIN_TABS, 'settings' as const].filter(canSee).map((id) => {
      const Icon = NAV_ICONS[id]
      return {
        group: t.ui.shell.pagesGroup,
        icon: <Icon size={14} />,
        title: labelFor(id),
        sub: t.ui.shell.goTo,
        run: () => selectTab(id),
      }
    })
    const creates: [ActiveTab, string][] = [
      ['users', t.usersPage.newBtn],
      ['hosts', t.hostsPage.newBtn],
      ['groups', t.groupsPage.newBtn],
      ['nodes', t.nodesPage.newBtn],
      ['cores', t.coresPage.newBtn],
      ['tunnels', t.tunnelsPage.newBtn],
      ['resellers', t.ui.resellers.newBtn],
    ]
    const actions = creates
      .filter(([tab]) => canSee(tab))
      .map(([tab, title]) => ({
        group: t.ui.shell.actionsGroup,
        icon: <IconPlus size={14} />,
        title: title.replace(/^\+\s*/, ''),
        sub: labelFor(tab),
        run: () => openCreate(tab),
      }))
    return [...pages, ...actions]
    // canSee/labelFor only read profile and t.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, t])

  return (
    <ToastProvider>
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
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label={t.ui.shell.quickSearch}
            className="rounded-lg border border-subtle p-2 text-secondary"
          >
            <IconSearch size={18} strokeWidth={2} />
          </button>
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

          <div className="flex items-center gap-2.5 border-t border-subtle px-2 pt-3">
            <ProfileChip profile={profile} onAvatarChange={(avatar) => setProfile((p) => (p ? { ...p, avatar } : p))} />
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

        <main className="flex min-w-0 flex-col gap-5 px-4 pb-12 pt-20 lg:px-6 lg:pt-5">
          <header className="tf-shell-top">
            <div className="min-w-0">
              <h1>{labelFor(active)}</h1>
              <p>{subtitle}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {canSee('users') && (
                <form
                  role="search"
                  onSubmit={submitSearch}
                  className="flex w-[200px] max-w-full items-center gap-2 rounded-[11px] border border-[#2a2a2a] bg-surface px-3 py-[6px] transition-colors focus-within:border-strong"
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

              <button type="button" className="tf-quick hidden sm:inline-flex" onClick={() => setPaletteOpen(true)}>
                {t.ui.shell.quickSearch} <kbd>Ctrl K</kbd>
              </button>

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
                  <span className="flex flex-col items-center gap-0.5 leading-none">
                    <span
                      dir="ltr"
                      title={updateAvailable && version.latest ? t.nav.updateNotice(version.latest) : t.nav.upToDate}
                      className={`rounded-md border px-2 py-0.5 font-en text-[11px] ${
                        updateAvailable ? 'border-warning/30 text-warning' : 'border-success/30 text-body'
                      }`}
                    >
                      v{version.current}
                    </span>
                    {/* Only claim "up to date" when GitHub was actually reachable to compare against. */}
                    {updateAvailable ? (
                      <span className="whitespace-nowrap text-[10px] text-warning">{t.nav.updateAvailable}</span>
                    ) : version.latest ? (
                      <span className="whitespace-nowrap text-[10px] text-success">{t.nav.upToDate}</span>
                    ) : null}
                  </span>
                )}
              </div>
            </div>
          </header>

          <div className="min-w-0">
            {active === 'overview' && (
              <OverviewPage
                username={profile?.username ?? ''}
                onNavigate={selectTab}
                onCreate={openCreate}
                onOpenPalette={() => setPaletteOpen(true)}
                canOpen={canSee}
              />
            )}
            {active === 'users' && <UsersPage search={search} createSignal={signal('users')} />}
            {active === 'hosts' && <HostsPage createSignal={signal('hosts')} />}
            {active === 'groups' && <GroupsPage createSignal={signal('groups')} />}
            {active === 'nodes' && <NodesPage createSignal={signal('nodes')} />}
            {active === 'cores' && <CoresPage createSignal={signal('cores')} />}
            {active === 'tunnels' && <TunnelsPage createSignal={signal('tunnels')} />}
            {active === 'resellers' && <ResellersPage createSignal={signal('resellers')} />}
            {active === 'settings' && <SettingsPage />}
          </div>
        </main>
      </div>
      {paletteOpen && <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} />}
    </ToastProvider>
  )
}

function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const { t, dir } = useLang()
  const [q, setQ] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const query = q.trim().toLowerCase()
  const results = items.filter(
    (it) => !query || it.title.toLowerCase().includes(query) || it.sub.toLowerCase().includes(query) || it.group.includes(query),
  )
  const idx = Math.min(activeIdx, Math.max(0, results.length - 1))

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  function choose(it: PaletteItem) {
    onClose()
    it.run()
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => (i + 1) % Math.max(1, results.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => (i - 1 + results.length) % Math.max(1, results.length))
    } else if (e.key === 'Enter' && results[idx]) {
      e.preventDefault()
      choose(results[idx])
    }
  }

  let lastGroup = ''
  return (
    <>
      <div className="tf-scrim" onClick={onClose} />
      <div className="tf-modal-wrap" onClick={onClose}>
        <div dir={dir} className="tf-palette" role="dialog" aria-modal="true" aria-label={t.ui.shell.quickSearch} onClick={(e) => e.stopPropagation()}>
          <div className="tf-palette-input">
            <IconSearch size={16} className="text-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setActiveIdx(0)
              }}
              onKeyDown={onKey}
              placeholder={t.ui.shell.palettePlaceholder}
              role="combobox"
              aria-expanded="true"
            />
            <kbd>Esc</kbd>
          </div>
          <div className="tf-palette-list" ref={listRef} role="listbox">
            {results.length === 0 && <div className="tf-palette-group" style={{ padding: 16 }}>{t.ui.shell.noResults}</div>}
            {results.map((it, i) => {
              const header = it.group !== lastGroup ? it.group : null
              lastGroup = it.group
              return (
                <div key={`${it.group}-${it.title}-${i}`}>
                  {header && <div className="tf-palette-group">{header}</div>}
                  <button
                    type="button"
                    className="tf-palette-item"
                    role="option"
                    aria-selected={i === idx}
                    onPointerMove={() => setActiveIdx(i)}
                    onClick={() => choose(it)}
                  >
                    <span className="pi">{it.icon}</span>
                    <span>{it.title}</span>
                    <small>{it.sub}</small>
                  </button>
                </div>
              )
            })}
          </div>
          <div className="tf-palette-foot">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> {t.ui.shell.move}
            </span>
            <span>
              <kbd>Enter</kbd> {t.ui.shell.open}
            </span>
            <span>
              <kbd>Esc</kbd> {t.ui.shell.close}
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

const AVATAR_PX = 160
// Mirrors AVATAR_MAX_CHARS in backend/app/schemas/admin.py.
const AVATAR_MAX_CHARS = 60_000

// Crops the picked image to a centred square and re-encodes it as a small
// JPEG, so any phone photo fits the backend's size cap.
async function avatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  // JPEG has no alpha; transparent areas would otherwise turn black.
  ctx.fillStyle = '#e5e5e5'
  ctx.fillRect(0, 0, AVATAR_PX, AVATAR_PX)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX)
  bitmap.close()
  for (const quality of [0.86, 0.7, 0.5]) {
    const url = canvas.toDataURL('image/jpeg', quality)
    if (url.length <= AVATAR_MAX_CHARS) return url
  }
  throw new Error('image too large')
}

function CameraGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  )
}

// The signed-in admin at the foot of the sidebar. Tapping it opens a small
// menu to set or remove the profile picture.
function ProfileChip({
  profile,
  onAvatarChange,
}: {
  profile: AdminProfile | null
  onAvatarChange: (avatar: string | null) => void
}) {
  const { t } = useLang()
  const say = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function save(avatar: string | null) {
    setBusy(true)
    try {
      await setAdminAvatar(avatar)
      onAvatarChange(avatar)
      say(avatar ? t.nav.avatarSaved : t.nav.avatarRemoved)
    } catch (err) {
      say(err instanceof ApiError ? err.message : t.errorGeneric)
    } finally {
      setBusy(false)
    }
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Cleared so picking the same file again still fires onChange.
    e.target.value = ''
    if (!file) return
    let url: string
    try {
      url = await avatarDataUrl(file)
    } catch {
      say(t.nav.avatarBadFile)
      return
    }
    await save(url)
  }

  const role = profile ? (profile.is_owner ? t.nav.ownerRole : profile.is_reseller ? t.nav.resellerRole : t.nav.adminRole) : ' '

  return (
    <div ref={wrap} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!profile || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t.nav.avatarMenu}
        className="group -m-1 flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-2.5 rounded-lg p-1 text-start transition-colors hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f97316] disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="relative grid h-8 w-8 flex-shrink-0 place-items-center overflow-hidden rounded-full bg-[#e5e5e5] font-en text-xs font-semibold text-app">
          {profile?.avatar ? (
            <img src={profile.avatar} alt="" className="h-full w-full object-cover" />
          ) : profile ? (
            initials(profile.username)
          ) : (
            ''
          )}
          <span
            aria-hidden="true"
            className={`absolute inset-0 grid place-items-center bg-black/55 text-white transition-opacity ${
              busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
            }`}
          >
            {busy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <CameraGlyph />}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-en text-[13px] font-medium text-primary">
            <bdi>{profile?.username ?? '…'}</bdi>
          </span>
          <span className="block truncate text-[11px] text-faint">{role}</span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full z-20 mb-2 flex w-44 flex-col gap-0.5 rounded-lg border border-subtle bg-surface p-1 shadow-lg ltr:left-0 rtl:right-0"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              fileInput.current?.click()
            }}
            className="flex items-center gap-2 rounded-md px-2.5 py-2 text-start text-[13px] text-primary transition-colors hover:bg-hover"
          >
            <CameraGlyph />
            {t.nav.avatarUpload}
          </button>
          {profile?.avatar && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                void save(null)
              }}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-start text-[13px] text-danger transition-colors hover:bg-hover"
            >
              <IconX size={14} />
              {t.nav.avatarRemove}
            </button>
          )}
        </div>
      )}

      <input ref={fileInput} type="file" accept="image/*" hidden onChange={onPick} />
    </div>
  )
}
