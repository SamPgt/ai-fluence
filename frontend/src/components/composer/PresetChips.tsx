import { Fragment, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Command as CommandPrimitive } from 'cmdk'
import { Plus, Search, X } from 'lucide-react'
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
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

// Même style que le menu des modèles (ModelPicker), qui fait référence :
// titres de section, lignes arrondies, survol discret, barre de recherche.
const GROUP =
  'p-0 [&_[cmdk-group-heading]]:px-3.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:select-none [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-col [&_[cmdk-group-items]]:gap-1'
const ITEM =
  'mx-1 gap-2 rounded-xl p-2 text-[13px] text-foreground data-[selected=true]:bg-white/[0.05] data-[selected=true]:text-foreground'

/** Nombre de tags affichés avant le badge « N+ ». */
const MAX_VISIBLE = 5

const TAG =
  'flex h-6 shrink-0 items-center rounded-[5px] border border-border/50 bg-muted/40 px-2 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground'

/** Mots déclencheurs proposés dans le composer : ceux laissés cochés dans la fiche de la LoRA. */
export function availableWords(l: PersonaLora): string[] {
  const hidden = new Set(l.hiddenWords ?? [])
  return l.triggerWords.filter((w) => !hidden.has(w))
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
  activeLoras: chosen = {},
  onToggleLora,
  onToggleLoraWord,
}: {
  media: MediaKind
  /** Persona du fil : ses raccourcis s'ajoutent à ceux disponibles partout. */
  personaId: string | null
  activeIds: string[]
  onToggle: (id: string) => void
  /** LoRA du persona compatibles avec le modèle choisi. */
  loras?: PersonaLora[]
  /** LoRA cochées → mots déclencheurs choisis. */
  activeLoras?: Record<string, string[]>
  onToggleLora?: (id: string, words?: string[]) => void
  onToggleLoraWord?: (
    id: string,
    word: string,
    unloadWhenEmpty?: boolean,
  ) => void
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
  const activeLoras = loras.filter((l) => l.id in chosen)
  const loraFull = activeLoras.length >= MAX_LORAS_PER_GENERATION
  const nothing = selected.length === 0 && activeLoras.length === 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Ancre fixe au début de la rangée : le menu ne bouge pas quand des tags s'ajoutent. */}
      <PopoverAnchor asChild>
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pb-2 pl-[5px]">
          {/* Un tag par mot déclencheur choisi ; une LoRA sans mot choisi garde un tag à son nom. */}
          {activeLoras.flatMap((l) =>
            chosen[l.id]?.length
              ? chosen[l.id].map((w) => (
                  <LoraTag
                    key={`${l.id}-${w}`}
                    text={w}
                    title={l.label}
                    onOpen={() => setOpen(true)}
                    onRemove={() => onToggleLoraWord?.(l.id, w, true)}
                  />
                ))
              : [
                  <LoraTag
                    key={l.id}
                    text={l.label || 'LoRA'}
                    title="LoRA chargée sans mot déclencheur"
                    onOpen={() => setOpen(true)}
                    onRemove={() => onToggleLora?.(l.id)}
                  />,
                ],
          )}
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

      <PopoverContent
        side="top"
        align="start"
        className="w-80 overflow-hidden rounded-2xl p-0"
      >
        <Command className="rounded-none bg-transparent">
          <div className="flex h-11 items-center gap-2 border-b border-border/60 pr-2 pl-4">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              autoFocus
              placeholder={
                loras.length
                  ? 'Rechercher une LoRA ou un raccourci'
                  : 'Rechercher un raccourci'
              }
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            />
          </div>
          {/* Marge à droite : la barre de défilement ne déborde pas sur les lignes. */}
          <CommandList className="thin-scrollbar max-h-96 pr-1 pb-1.5">
            <CommandEmpty className="px-4 py-6 text-center text-[12px] text-muted-foreground">
              Aucun résultat.
            </CommandEmpty>
            {loras.length > 0 && (
              <CommandGroup
                heading={`LoRA · ${activeLoras.length} / ${MAX_LORAS_PER_GENERATION}`}
                className={GROUP}
              >
                {loras.map((l) => {
                  const checked = l.id in chosen
                  const blocked = !checked && loraFull
                  const words = availableWords(l)
                  return (
                    <Fragment key={l.id}>
                      <CommandItem
                        value={`lora ${l.id} ${l.label}`}
                        disabled={blocked}
                        onSelect={() => onToggleLora?.(l.id, words.slice(0, 1))}
                        className={ITEM}
                        title={
                          blocked
                            ? `${MAX_LORAS_PER_GENERATION} LoRA maximum par génération`
                            : undefined
                        }
                      >
                        <CheckMark checked={checked} tone="lora" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px]">
                            {l.label || 'LoRA sans nom'}
                          </span>
                          {words.length === 0 && (
                            <span className="block truncate text-[11px] text-muted-foreground">
                              Sans mot déclencheur
                            </span>
                          )}
                        </span>
                      </CommandItem>
                      {/* Mots déclencheurs : chacun se choisit séparément. */}
                      {words.map((w) => (
                        <CommandItem
                          key={w}
                          value={`lora ${l.id} ${l.label} ${w}`}
                          disabled={blocked}
                          onSelect={() => onToggleLoraWord?.(l.id, w)}
                          className={cn(ITEM, 'py-1.5 pl-9')}
                        >
                          <CheckMark
                            checked={chosen[l.id]?.includes(w) ?? false}
                            tone="lora"
                            className="h-3.5 w-3.5"
                          />
                          <span className="truncate font-mono text-[12px] text-violet-300">
                            {w}
                          </span>
                        </CommandItem>
                      ))}
                    </Fragment>
                  )
                })}
              </CommandGroup>
            )}
            <CommandGroup heading="Contexte supplémentaire" className={GROUP}>
              {available.map((c) => {
                const checked = activeIds.includes(c.id)
                return (
                  <CommandItem
                    key={c.id}
                    value={`${c.label} ${c.text}`}
                    onSelect={() => onToggle(c.id)}
                    className={ITEM}
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
          <div className="flex h-10 items-center justify-between border-t border-border/60 px-4 text-[12px] text-muted-foreground">
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
    <span
      data-testid="context-tag"
      className={cn(TAG, 'group/tag gap-1 px-1.5')}
      title={context.text}
    >
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
  text,
  title,
  onOpen,
  onRemove,
}: {
  text: string
  title: string
  onOpen: () => void
  onRemove: () => void
}) {
  return (
    <span className={cn(LORA_TAG, 'group/tag gap-1 px-1.5')} title={title}>
      {/* Pastille violette, remplacée au survol par la croix qui retire ce mot. */}
      <span className="flex h-4 w-4 items-center justify-center group-hover/tag:hidden">
        <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Retirer ${text}`}
        className="hidden h-4 w-4 items-center justify-center rounded-[3px] hover:bg-violet-500/20 group-hover/tag:flex"
      >
        <X className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="max-w-40 truncate pr-0.5"
      >
        {text}
      </button>
    </span>
  )
}
