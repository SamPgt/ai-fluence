/**
 * Sidebar unique de l'app : marque, recherche, Nouveau fil, navigation, puis tous les fils
 * (un fil n'appartient plus à un persona), crédit et compte en bas.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronsUpDown,
  History,
  House,
  Images,
  Library,
  LogOut,
  PanelLeft,
  PanelLeftOpen,
  Plus,
  Settings,
  Trash2,
  Workflow,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Thread, User } from '@ai-fluence/shared'

import { undoToast } from '@/lib/undo-toast'
import { authApi, threadsApi, trashApi } from '@/lib/api'
import { composer } from '@/lib/composer-store'
import { balanceQuery, qk, settingsQuery, threadsQuery } from '@/lib/queries'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useIsMac } from '@/lib/platform'
import { SESSION_QUERY_KEY } from '@/server/auth'
import { useUiPref } from '@/components/providers/ui-prefs'
import { ChatListItem } from '@/components/chat/ChatListItem'
import { ChatSearchDialog } from '@/components/chat/ChatSearchDialog'
import { initials } from '@/components/personas/PersonaAvatar'
import { LogoMark } from '@/components/ui/logo-mark'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CreditFooter } from './CreditFooter'

const NAV = [
  { to: '/accueil', label: 'Accueil', icon: House },
  { to: '/bibliotheque', label: 'Bibliothèque', icon: Library },
  { to: '/workflows', label: 'Workflows', icon: Workflow },
  { to: '/galerie', label: 'Galerie', icon: Images },
] as const

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-3 pb-1 text-xs font-semibold text-muted-foreground/80">
      {children}
    </div>
  )
}

export function AppSidebar({ user }: { user: User }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const params = useParams({ strict: false }) as { threadId?: string }
  const [collapsed, setCollapsed] = useUiPref('sidebarCollapsed')
  const mac = useIsMac()
  const { data: threads = [] } = useQuery(threadsQuery(null))

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: qk.threadsAll })

  const remove = useMutation({
    mutationFn: (id: string) => threadsApi.remove(id),
    onSuccess: (_, id) => {
      // Le brouillon du fil part avec lui (un fil restauré n'en a pas).
      composer.dropDraft(id)
      invalidate()
      queryClient.invalidateQueries({ queryKey: qk.trash })
      if (id === params.threadId) navigate({ to: '/' })
      toast.success(
        'Fil mis à la corbeille',
        undoToast(() =>
          trashApi.restoreThread(id).then(() => {
            invalidate()
            queryClient.invalidateQueries({ queryKey: qk.trash })
          }),
        ),
      )
    },
  })
  const togglePin = useMutation({
    mutationFn: (t: { id: string; isPinned: boolean }) =>
      threadsApi.update(t.id, { isPinned: !t.isPinned }),
    onSuccess: invalidate,
  })

  const logout = async () => {
    await authApi.logout().catch(() => null)
    queryClient.setQueryData(SESSION_QUERY_KEY, null)
    queryClient.clear()
    navigate({ to: '/connexion' })
  }

  const pinned = threads.filter((t) => t.isPinned)
  const recent = threads.filter((t) => !t.isPinned)
  const item = (t: (typeof threads)[number]) => (
    <ChatListItem
      key={t.id}
      thread={t}
      isActive={params.threadId === t.id}
      onDelete={() => remove.mutate(t.id)}
      onTogglePin={() => togglePin.mutate(t)}
    />
  )

  // Repliée : une barre d'icônes de 48 px, jamais invisible.
  if (collapsed)
    return (
      <CollapsedRail
        user={user}
        recent={threads.slice(0, 15)}
        activeId={params.threadId}
        onExpand={() => setCollapsed(false)}
        onLogout={logout}
      />
    )

  return (
    <aside
      data-testid="thread-panel"
      aria-label="Navigation"
      className="w-72 shrink-0 overflow-hidden border-r border-border/40 bg-panel"
    >
      <div className="flex h-full w-72 flex-col">
        <div className="space-y-3 p-3">
          {/* Marque, recherche (⌘K) et repli de la sidebar (⌘B). */}
          <div className="flex h-8 items-center gap-2 px-1">
            {/* Logo et nom : retour à l'accueil (nouveau fil). */}
            <Link
              to="/"
              className="flex flex-1 items-center gap-2"
              aria-label="Sublime, accueil"
            >
              <LogoMark className="h-[20px] w-[20px]" />
              <span className="text-[15px] font-medium tracking-tight">
                Sublime
              </span>
            </Link>
            <ChatSearchDialog compact />
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label="Replier le panneau"
              title={`Replier (${mac ? '⌘' : 'Ctrl+'}B)`}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => navigate({ to: '/' })}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg border border-border/60 bg-white/[0.04] px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-white/[0.07]"
          >
            <Plus className="h-4 w-4" strokeWidth={1.6} />
            <span className="flex-1 text-left">Nouveau fil</span>
            <kbd className="pointer-events-none ml-auto inline-flex h-5 items-center gap-0.5 rounded-md bg-white/[0.06] px-1.5 font-sans text-[11px] text-muted-foreground select-none">
              <span className="text-xs">{mac ? '⌘' : '⇧'}</span>L
            </kbd>
          </button>
          <nav className="space-y-0.5">
            {NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="flex h-8 items-center gap-2.5 rounded-[5px] px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                activeProps={{ className: 'bg-accent text-foreground' }}
              >
                <Icon className="h-4 w-4" strokeWidth={1.6} />
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="mx-3 h-px bg-border/40" />

        {/* Radix met le contenu en display:table, ce qui casse le truncate : on le force en block. */}
        <ScrollArea className="min-h-0 flex-1 px-3 [&_[data-radix-scroll-area-viewport]>div]:!block">
          {pinned.length > 0 && (
            <>
              <GroupLabel>Épinglés</GroupLabel>
              <div className="space-y-0.5">{pinned.map(item)}</div>
            </>
          )}
          <GroupLabel>Récents</GroupLabel>
          <div className="space-y-0.5 pb-3">
            {recent.map(item)}
            {threads.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                Aucun fil pour l’instant.
              </p>
            )}
          </div>
        </ScrollArea>

        <CreditFooter />

        {/* Compte : Paramétrage, Corbeille, Déconnexion. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Menu utilisateur"
              className="flex shrink-0 items-center gap-2.5 border-t border-border/40 px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initials(user.name)
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">
                  {user.name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {user.email}
                </span>
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <AccountMenu side="top" onLogout={logout} />
        </DropdownMenu>
      </div>
    </aside>
  )
}

const RAIL_BUTTON =
  'grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground'

/** Infobulle à droite d'une icône de la barre repliée. */
function RailTip({
  label,
  children,
}: {
  label: React.ReactNode
  children: React.ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Sidebar repliée (48 px) : logo, déplier, Nouveau fil, recherche, navigation, fils récents (au
 * survol ou au clic), puis crédit compact et avatar.
 */
function CollapsedRail({
  user,
  recent,
  activeId,
  onExpand,
  onLogout,
}: {
  user: User
  recent: Thread[]
  activeId?: string
  onExpand: () => void
  onLogout: () => void
}) {
  const navigate = useNavigate()
  const mac = useIsMac()
  const { data: settings } = useQuery(settingsQuery())
  const { data: balance } = useQuery(balanceQuery(Boolean(settings?.hasApiKey)))
  const [recentOpen, setRecentOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const openRecent = () => {
    clearTimeout(closeTimer.current)
    setRecentOpen(true)
  }
  const closeRecentSoon = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setRecentOpen(false), 150)
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  return (
    <aside
      data-testid="thread-panel"
      data-collapsed
      aria-label="Navigation"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border/40 bg-panel py-3"
    >
      <Link
        to="/"
        aria-label="Sublime, accueil"
        className="grid h-9 w-9 place-items-center"
      >
        <LogoMark className="h-[20px] w-[20px]" />
      </Link>
      <RailTip label={`Déplier (${mac ? '⌘' : 'Ctrl+'}B)`}>
        <button
          type="button"
          onClick={onExpand}
          aria-label="Déplier le panneau"
          className={RAIL_BUTTON}
        >
          <PanelLeftOpen className="h-4 w-4" strokeWidth={1.6} />
        </button>
      </RailTip>
      <div className="my-1 h-px w-7 bg-border/60" />
      <RailTip
        label={
          <>
            Nouveau fil
            <kbd className="rounded bg-white/[0.08] px-1.5 font-sans text-[11px] text-muted-foreground">
              {mac ? '⌘' : '⇧'}L
            </kbd>
          </>
        }
      >
        <button
          type="button"
          onClick={() => navigate({ to: '/' })}
          aria-label="Nouveau fil"
          className="grid h-9 w-9 place-items-center rounded-lg border border-border/60 bg-white/[0.04] text-foreground transition-colors hover:bg-white/[0.08]"
        >
          <Plus className="h-4 w-4" strokeWidth={1.6} />
        </button>
      </RailTip>
      <ChatSearchDialog compact className={RAIL_BUTTON} />
      {NAV.map(({ to, label, icon: Icon }) => (
        <RailTip key={to} label={label}>
          <Link
            to={to}
            aria-label={label}
            className={RAIL_BUTTON}
            activeProps={{ className: 'bg-accent text-foreground' }}
          >
            <Icon className="h-4 w-4" strokeWidth={1.6} />
          </Link>
        </RailTip>
      ))}
      <div className="my-1 h-px w-7 bg-border/60" />
      {/* Fils récents : la liste s'ouvre à droite, au survol ou au clic. */}
      <Popover open={recentOpen} onOpenChange={setRecentOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Fils récents"
            onMouseEnter={openRecent}
            onMouseLeave={closeRecentSoon}
            className={cn(
              RAIL_BUTTON,
              recentOpen && 'bg-accent text-foreground',
            )}
          >
            <History className="h-4 w-4" strokeWidth={1.6} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={10}
          onMouseEnter={openRecent}
          onMouseLeave={closeRecentSoon}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-72 p-1.5"
        >
          <div className="px-2.5 pt-1.5 pb-1 text-xs text-muted-foreground">
            Fils récents
          </div>
          {recent.map((t) => (
            <Link
              key={t.id}
              to="/t/$threadId"
              params={{ threadId: t.id }}
              onClick={() => setRecentOpen(false)}
              className={cn(
                'block truncate rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                t.id === activeId && 'bg-accent text-foreground',
              )}
            >
              {t.title}
            </Link>
          ))}
          {recent.length === 0 && (
            <p className="px-2.5 py-3 text-xs text-muted-foreground">
              Aucun fil pour l’instant.
            </p>
          )}
        </PopoverContent>
      </Popover>

      <div className="flex-1" />
      <Link
        to="/parametres"
        search={{ tab: 'credits' }}
        title="Crédit"
        className="flex flex-col items-center gap-0.5 rounded-md px-1 py-1 text-[10px] text-muted-foreground hover:text-foreground tabular-nums"
      >
        {settings && !settings.hasApiKey
          ? '—'
          : balance
            ? formatUsd(balance.available, 'balance')
            : '…'}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Menu utilisateur"
            className="mt-1 grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
          >
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                className="h-full w-full object-cover"
              />
            ) : (
              initials(user.name)
            )}
          </button>
        </DropdownMenuTrigger>
        <AccountMenu side="right" onLogout={onLogout} />
      </DropdownMenu>
    </aside>
  )
}

/** Paramétrage, Corbeille, Déconnexion (sidebar dépliée ou repliée). */
function AccountMenu({
  side,
  onLogout,
}: {
  side: 'top' | 'right'
  onLogout: () => void
}) {
  return (
    <DropdownMenuContent
      side={side}
      align={side === 'top' ? 'start' : 'end'}
      className="w-64"
    >
      <DropdownMenuItem asChild>
        <Link to="/parametres" search={{ tab: 'account' }}>
          <Settings className="h-4 w-4" />
          Paramétrage
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/corbeille">
          <Trash2 className="h-4 w-4" />
          Corbeille
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={onLogout}
        className="text-red-500 focus:bg-red-500/10 focus:text-red-400 [&_svg]:!text-red-500"
      >
        <LogOut className="h-4 w-4 text-red-500" />
        Déconnexion
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}
