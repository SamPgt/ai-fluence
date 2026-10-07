import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Check, Plus, X } from 'lucide-react'
import type { MediaKind, PromptPreset } from '@ai-fluence/shared'

import { presetsQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** Nombre de tags affichés avant le badge « N+ ». */
const MAX_VISIBLE = 5

const TAG =
  'flex h-6 shrink-0 items-center rounded-[5px] border border-border/50 bg-muted/40 px-2 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground'

/**
 * Contexte supplémentaire : seuls les contextes sélectionnés s'affichent, en tags neutres.
 * Le « + » (ou un clic sur un tag) ouvre la liste à cocher, avec recherche.
 * Au survol d'un tag, une croix à gauche permet de le retirer.
 */
export function ContextChips({
  media,
  activeIds,
  onToggle,
}: {
  media: MediaKind
  activeIds: string[]
  onToggle: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const { data: contexts = [] } = useQuery(presetsQuery())
  const available = contexts.filter((c) => c.enabled && (c.media === 'all' || c.media === media))
  const selected = available.filter((c) => activeIds.includes(c.id))
  const visible = selected.slice(0, MAX_VISIBLE)
  const hidden = selected.length - visible.length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Ancre fixe au début de la rangée : le menu ne bouge pas quand des tags s'ajoutent. */}
      <PopoverAnchor asChild>
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pb-2 pl-[5px]">
        {visible.map((c) => (
          <ContextTag key={c.id} context={c} onOpen={() => setOpen(true)} onRemove={() => onToggle(c.id)} />
        ))}
        {hidden > 0 && (
          <button type="button" onClick={() => setOpen(true)} className={TAG} title={`${hidden} autre(s) contexte(s)`}>
            {hidden}+
          </button>
        )}
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(TAG, selected.length === 0 ? 'gap-1' : 'w-6 justify-center px-0')}
            aria-label="Ajouter du contexte supplémentaire"
            title="Contexte supplémentaire"
          >
            <Plus className="h-3 w-3" />
            {selected.length === 0 && 'Contexte'}
          </button>
        </PopoverTrigger>
        </div>
      </PopoverAnchor>

      <PopoverContent side="top" align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Rechercher un contexte…" className="text-[13px]" />
          <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">Contexte supplémentaire</div>
          <CommandList className="max-h-64 pr-1">
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">Aucun contexte trouvé.</CommandEmpty>
            <CommandGroup>
              {available.map((c) => {
                const checked = activeIds.includes(c.id)
                return (
                  <CommandItem key={c.id} value={`${c.label} ${c.text}`} onSelect={() => onToggle(c.id)} className="gap-2">
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border',
                        checked ? 'border-foreground bg-foreground text-background' : 'border-muted-foreground/50',
                      )}
                    >
                      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{c.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{c.text}</span>
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
          <Link
            to="/parametres"
            search={{ tab: 'contexts' }}
            onClick={() => setOpen(false)}
            className="block border-t px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground"
          >
            Gérer les contextes
          </Link>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ContextTag({
  context,
  onOpen,
  onRemove,
}: {
  context: PromptPreset
  onOpen: () => void
  onRemove: () => void
}) {
  return (
    <span className={cn(TAG, 'group/tag gap-1 px-1.5')} title={context.text}>
      {/* Croix au survol, à gauche : retire ce contexte. */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Retirer ${context.label}`}
        className="hidden h-4 w-4 items-center justify-center rounded-[3px] hover:bg-accent group-hover/tag:flex"
      >
        <X className="h-3 w-3" />
      </button>
      <button type="button" onClick={onOpen} className="px-0.5">
        {context.label}
      </button>
    </span>
  )
}
