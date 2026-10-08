import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import {
  MAX_LORAS_PER_GENERATION,
  type MediaKind,
  type PersonaLora,
  type PromptPreset,
} from '@ai-fluence/shared'

import { presetsQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { CheckMark } from '@/components/ui/check-mark'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/** Nombre de tags affichés avant le badge « N+ ». */
const MAX_VISIBLE = 5

const TAG =
  'flex h-6 shrink-0 items-center rounded-[5px] border border-border/50 bg-muted/40 px-2 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground'

/** Nom court d'une LoRA : son mot déclencheur (souvent plus parlant que son nom). */
export function loraTitle(l: PersonaLora): string {
  return l.triggerWords[0] ?? (l.label || 'LoRA')
}

/** Tags LoRA : violets, comme le badge LORA, pour les reconnaître d'un coup d'œil. */
const LORA_TAG =
  'flex h-6 shrink-0 items-center rounded-[5px] border border-violet-500/30 bg-violet-500/10 px-2 text-[11px] text-violet-300 transition-colors hover:border-violet-400/60 hover:text-violet-200'

/**
 * LoRA du persona (en tête, en violet) et contexte supplémentaire (tags neutres).
 * Seuls les éléments sélectionnés s'affichent.
 * Le « + » (ou un clic sur un tag) ouvre la liste à cocher, avec recherche.
 * Au survol d'un tag, une croix à gauche permet de le retirer.
 */
export function ContextChips({
  media,
  personaId,
  activeIds,
  onToggle,
  loras = [],
  activeLoraIds = [],
  onToggleLora,
}: {
  media: MediaKind
  /** Persona du fil : ses raccourcis s'ajoutent à ceux disponibles partout. */
  personaId: string | null
  activeIds: string[]
  onToggle: (id: string) => void
  /** LoRA du persona compatibles avec le modèle choisi. */
  loras?: PersonaLora[]
  activeLoraIds?: string[]
  onToggleLora?: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const { data: contexts = [] } = useQuery(presetsQuery())
  const available = contexts.filter(
    (c) =>
      c.enabled &&
      (c.personaId === null || c.personaId === personaId) &&
      (c.media === 'all' || c.media === media),
  )
  const selected = available.filter((c) => activeIds.includes(c.id))
  const visible = selected.slice(0, MAX_VISIBLE)
  const hidden = selected.length - visible.length
  const activeLoras = loras.filter((l) => activeLoraIds.includes(l.id))
  const loraFull = activeLoras.length >= MAX_LORAS_PER_GENERATION
  const nothing = selected.length === 0 && activeLoras.length === 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Ancre fixe au début de la rangée : le menu ne bouge pas quand des tags s'ajoutent. */}
      <PopoverAnchor asChild>
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pb-2 pl-[5px]">
          {activeLoras.map((l) => (
            <LoraTag
              key={l.id}
              lora={l}
              onOpen={() => setOpen(true)}
              onRemove={() => onToggleLora?.(l.id)}
            />
          ))}
          {visible.map((c) => (
            <ContextTag
              key={c.id}
              context={c}
              onOpen={() => setOpen(true)}
              onRemove={() => onToggle(c.id)}
            />
          ))}
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={TAG}
              title={`${hidden} autre(s) contexte(s)`}
            >
              {hidden}+
            </button>
          )}
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(TAG, nothing ? 'gap-1' : 'w-6 justify-center px-0')}
              aria-label="Ajouter un raccourci"
              title="Contexte supplémentaire"
            >
              <Plus className="h-3 w-3" />
              {nothing && 'Raccourci'}
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>

      <PopoverContent side="top" align="start" className="w-72 p-0">
        <Command>
          <CommandInput
            placeholder={
              loras.length ? 'Rechercher…' : 'Rechercher un raccourci…'
            }
            className="text-[13px]"
          />
          <CommandList className="max-h-80 pr-1">
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              Aucun résultat.
            </CommandEmpty>
            {loras.length > 0 && (
              <CommandGroup
                heading={`LoRA · ${activeLoras.length} / ${MAX_LORAS_PER_GENERATION}`}
              >
                {loras.map((l) => {
                  const checked = activeLoraIds.includes(l.id)
                  const blocked = !checked && loraFull
                  return (
                    <CommandItem
                      key={l.id}
                      value={`lora ${l.label} ${l.triggerWords.join(' ')}`}
                      disabled={blocked}
                      onSelect={() => onToggleLora?.(l.id)}
                      className="gap-2"
                      title={
                        blocked
                          ? `${MAX_LORAS_PER_GENERATION} LoRA maximum par génération`
                          : undefined
                      }
                    >
                      <CheckMark checked={checked} tone="lora" />
                      <span className="min-w-0 flex-1">
                        {/* Le mot déclencheur dit souvent mieux ce que fait la LoRA que son nom. */}
                        <span className="block truncate text-[13px] text-violet-300">
                          {l.triggerWords.length
                            ? l.triggerWords.join(', ')
                            : l.label || 'LoRA sans nom'}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {l.triggerWords.length
                            ? l.label || 'LoRA sans nom'
                            : 'Sans mot déclencheur'}
                        </span>
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
            <CommandGroup heading="Contexte supplémentaire">
              {available.map((c) => {
                const checked = activeIds.includes(c.id)
                return (
                  <CommandItem
                    key={c.id}
                    value={`${c.label} ${c.text}`}
                    onSelect={() => onToggle(c.id)}
                    className="gap-2"
                  >
                    <CheckMark checked={checked} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">
                        {c.label}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {c.text}
                      </span>
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
          <div className="flex items-center justify-between border-t px-3 py-2 text-[12px] text-muted-foreground">
            <Link
              to="/parametres"
              search={{ tab: 'shortcuts' }}
              onClick={() => setOpen(false)}
              className="hover:text-foreground"
            >
              Gérer les raccourcis
            </Link>
            {personaId && loras.length > 0 && (
              <Link
                to="/personas/$personaId"
                params={{ personaId }}
                search={{ tab: 'lora' }}
                onClick={() => setOpen(false)}
                className="hover:text-foreground"
              >
                Gérer les LoRA
              </Link>
            )}
          </div>
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

function LoraTag({
  lora,
  onOpen,
  onRemove,
}: {
  lora: PersonaLora
  onOpen: () => void
  onRemove: () => void
}) {
  return (
    <span
      className={cn(LORA_TAG, 'group/tag gap-1 px-1.5')}
      title={
        lora.triggerWords.length
          ? `Mot déclencheur : ${lora.triggerWords.join(', ')}`
          : 'LoRA'
      }
    >
      {/* Pastille violette, remplacée au survol par la croix qui retire la LoRA. */}
      <span className="flex h-4 w-4 items-center justify-center group-hover/tag:hidden">
        <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Retirer ${lora.label || 'la LoRA'}`}
        className="hidden h-4 w-4 items-center justify-center rounded-[3px] hover:bg-violet-500/20 group-hover/tag:flex"
      >
        <X className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="max-w-40 truncate pr-0.5"
      >
        {loraTitle(lora)}
      </button>
    </span>
  )
}
