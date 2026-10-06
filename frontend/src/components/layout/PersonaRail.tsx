import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Images,
  LayoutGrid,
  LogOut,
  Plus,
  Settings,
  Settings2,
} from 'lucide-react'
import type { Persona, User } from '@ai-fluence/shared'

import { authApi } from '@/lib/api'
import { personasQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { SESSION_QUERY_KEY } from '@/server/auth'
import { useUiPref } from '@/components/providers/ui-prefs'
import { NewPersonaDialog } from '@/components/personas/NewPersonaDialog'
import { PersonaAvatar, initials } from '@/components/personas/PersonaAvatar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** Bulle de la barre (indicateur à gauche façon Discord). */
function Bubble({
  active,
  label,
  onClick,
  children,
  action,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="group relative flex w-full justify-center">
      <span
        className={cn(
          'absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-foreground transition-all',
          active ? 'h-8' : 'h-0 group-hover:h-4',
        )}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            aria-label={label}
            className={cn(
              'overflow-hidden transition-all duration-200',
              active ? 'rounded-xl' : 'rounded-2xl hover:rounded-xl',
            )}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
      {action}
    </div>
  )
}

function PersonaBubble({
  persona,
  active,
  onSelect,
}: {
  persona: Persona
  active: boolean
  onSelect: () => void
}) {
  return (
    <Bubble
      active={active}
      label={persona.name}
      onClick={onSelect}
      action={
        // Petit engrenage : paramétrage du persona.
        <Link
          to="/personas/$personaId"
          params={{ personaId: persona.id }}
          aria-label={`Paramétrer ${persona.name}`}
          className="absolute -top-1 right-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground group-hover:flex hover:text-foreground"
        >
          <Settings2 className="h-3 w-3" />
        </Link>
      }
    >
      <PersonaAvatar persona={persona} size={44} />
    </Bubble>
  )
}

export function PersonaRail({ user }: { user: User }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [personaId, setPersonaId] = useUiPref('personaId')
  const [creating, setCreating] = useState(false)
  const { data: personas = [] } = useQuery(personasQuery())

  const select = (id: string) => {
    setPersonaId(id)
    navigate({ to: '/' })
  }

  const logout = async () => {
    await authApi.logout().catch(() => null)
    queryClient.setQueryData(SESSION_QUERY_KEY, null)
    queryClient.clear()
    navigate({ to: '/connexion' })
  }

  return (
    <nav className="flex w-[64px] shrink-0 flex-col items-center gap-2 border-r border-border/40 bg-sidebar py-3">
      {/* Marque de l'app : simple logo, non cliquable. */}
      <img src="/logo.svg" alt="AI Fluence" className="pointer-events-none mb-1 h-8 w-8 select-none" draggable={false} />

      <Bubble
        active={personaId === ''}
        label="Tous les fils"
        onClick={() => select('')}
      >
        <span className="flex h-11 w-11 items-center justify-center bg-muted text-foreground brand-gradient">
          <LayoutGrid className="h-5 w-5 text-white" />
        </span>
      </Bubble>

      <div className="my-1 h-px w-8 bg-border" />

      <div className="flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto scrollbar-none pt-1">
        {personas.map((p) => (
          <PersonaBubble
            key={p.id}
            persona={p}
            active={personaId === p.id}
            onSelect={() => select(p.id)}
          />
        ))}
        <Bubble
          active={false}
          label="Nouveau persona"
          onClick={() => setCreating(true)}
        >
          <span className="flex h-11 w-11 items-center justify-center bg-muted text-emerald-400 transition-colors hover:bg-emerald-500 hover:text-white">
            <Plus className="h-5 w-5" />
          </span>
        </Bubble>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/galerie"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            activeProps={{ className: 'bg-accent text-foreground' }}
            aria-label="Galerie"
          >
            <Images className="h-5 w-5" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">Galerie</TooltipContent>
      </Tooltip>

      {/* Menu utilisateur : Paramétrage puis Déconnexion */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Menu utilisateur"
            className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-secondary text-sm font-semibold text-secondary-foreground ring-offset-2 ring-offset-sidebar transition hover:ring-2 hover:ring-border"
          >
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name} className="h-full w-full object-cover" />
            ) : (
              initials(user.name)
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="text-sm font-medium">{user.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {user.email}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/parametres" search={{ tab: 'api-key' }}>
              <Settings className="h-4 w-4" />
              Paramétrage
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={logout} variant="destructive">
            <LogOut className="h-4 w-4" />
            Déconnexion
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewPersonaDialog open={creating} onOpenChange={setCreating} />
    </nav>
  )
}
