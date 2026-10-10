import { useRef } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Images,
  LayoutGrid,
  Library,
  MapPin,
  LogOut,
  Plus,
  Settings,
  Settings2,
  Trash2,
} from 'lucide-react'
import type { Persona, User } from '@ai-fluence/shared'

import { authApi, personasApi } from '@/lib/api'
import { personasQuery, qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { SESSION_QUERY_KEY } from '@/server/auth'
import { useUiPref } from '@/components/providers/ui-prefs'
import { PersonaAvatar, initials } from '@/components/personas/PersonaAvatar'
import { LogoMark } from '@/components/ui/logo-mark'
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
              active ? 'rounded-lg' : 'rounded-lg',
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

/** Glisser uniquement de haut en bas, dans la barre. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

function PersonaBubble({
  persona,
  active,
  onSelect,
}: {
  persona: Persona
  active: boolean
  onSelect: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: persona.id,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'relative w-full touch-none',
        isDragging && 'z-10 opacity-80',
      )}
      {...attributes}
      {...listeners}
      // Les bulles restent des boutons : le conteneur ne doit pas prendre le focus.
      tabIndex={-1}
    >
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
    </div>
  )
}

export function PersonaRail({ user }: { user: User }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [personaId, setPersonaId] = useUiPref('personaId')
  const { data: personas = [] } = useQuery(personasQuery())

  // Glisser-déposer : 5 px de déplacement avant de démarrer, pour garder le clic.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )
  // Ignore le clic qui suit immédiatement un dépôt.
  const droppedAt = useRef(0)
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    droppedAt.current = Date.now()
    if (!over || active.id === over.id) return
    const from = personas.findIndex((p) => p.id === active.id)
    const to = personas.findIndex((p) => p.id === over.id)
    const next = arrayMove(personas, from, to)
    queryClient.setQueryData(qk.personas, next)
    personasApi.reorder(next.map((p) => p.id)).catch(() => {
      queryClient.invalidateQueries({ queryKey: qk.personas })
    })
  }

  const select = (id: string) => {
    if (Date.now() - droppedAt.current < 150) return
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
    <nav className="flex w-[62px] shrink-0 flex-col items-center gap-2 border-r border-border/40 bg-sidebar py-3">
      {/* Marque de l'app : simple logo, non cliquable. */}
      <div
        className="pointer-events-none mb-1 grid h-[30px] place-items-center text-brand select-none"
        aria-label="AI Fluence"
      >
        <LogoMark className="h-[22px] w-[22px]" />
      </div>

      <Bubble
        active={personaId === ''}
        label="Tous les fils"
        onClick={() => select('')}
      >
        <span
          className={cn(
            'grid h-[38px] w-[38px] place-items-center rounded-[7px] transition-colors hover:bg-[#141413] hover:text-foreground',
            personaId === ''
              ? 'bg-[#141413] text-foreground'
              : 'text-[#a8a8a3]',
          )}
        >
          <LayoutGrid className="h-[17px] w-[17px]" strokeWidth={1.5} />
        </span>
      </Bubble>

      <div className="my-1 h-px w-8 bg-border" />

      <div className="flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto scrollbar-none pt-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[verticalOnly]}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={personas.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            {personas.map((p) => (
              <PersonaBubble
                key={p.id}
                persona={p}
                active={personaId === p.id}
                onSelect={() => select(p.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
        {/* Ouvre le créateur de personnage (la création rapide y reste accessible). */}
        <Bubble
          active={false}
          label="Créer un personnage"
          onClick={() => navigate({ to: '/personnages/nouveau' })}
        >
          {/* Même taille que les bulles de personas (44px), fond clair. */}
          <span className="grid h-11 w-11 place-items-center bg-muted/50 text-muted-foreground transition hover:brightness-125 hover:text-foreground">
            <Plus className="h-4 w-4" strokeWidth={1.6} />
          </span>
        </Bubble>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/bibliotheque"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            activeProps={{ className: 'bg-accent text-foreground' }}
            aria-label="Bibliothèque"
          >
            <Library className="h-5 w-5" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">Bibliothèque</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/lieux"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            activeProps={{ className: 'bg-accent text-foreground' }}
            aria-label="Lieux"
          >
            <MapPin className="h-5 w-5" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">Lieux</TooltipContent>
      </Tooltip>

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
            className="flex h-9.25 w-9.25 items-center justify-center overflow-hidden rounded-full bg-secondary text-sm font-semibold text-secondary-foreground ring-offset-2 ring-offset-sidebar transition hover:ring-2 hover:ring-border"
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
        <DropdownMenuContent side="right" align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="text-sm font-medium">{user.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {user.email}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
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
          <DropdownMenuItem
            onClick={logout}
            className="text-red-500 focus:bg-red-500/10 focus:text-red-400 [&_svg]:!text-red-500"
          >
            <LogOut className="h-4 w-4 text-red-500" />
            Déconnexion
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

    </nav>
  )
}
