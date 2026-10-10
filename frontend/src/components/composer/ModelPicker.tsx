/**
 * Menu des modèles : recherche, épinglés, recommandés, puis fournisseurs et groupes
 * (Low cost, LoRA) en sous-menus. Pas de tags : seuls la durée habituelle et le nombre
 * d'images de référence sont affichés. Même menu dans le composer et dans « Relancer avec… ».
 */
import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Info,
  Pin,
  Search,
  Sparkles,
} from 'lucide-react'
import {
  PROVIDERS,
  imageInputInfo,
  type CatalogFamily,
  type MediaKind,
  type ProviderId,
} from '@ai-fluence/shared'

import { cn } from '@/lib/utils'
import { useUiPref } from '@/components/providers/ui-prefs'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { BAR_BUTTON } from './ComposerControls'

const TEXT = {
  search: 'Rechercher un modèle',
  pinned: 'Modèles épinglés',
  pinnedInfo: 'Épingle un modèle (au survol) pour le retrouver ici en premier.',
  pinnedEmpty: 'Les modèles que tu épingles apparaissent ici.',
  recommended: 'Modèles recommandés',
  recommendedInfo: 'Les plus performants, du meilleur au moins bon.',
  providers: 'Fournisseurs',
  providersInfo: 'Tous les modèles, rangés par fournisseur.',
  groups: 'Groupes',
  groupsInfo: 'Des sélections par usage.',
  lowCost: 'Low cost',
  local: 'Local (ComfyUI)',
  lora: 'LoRA',
  noResult: 'Aucun modèle trouvé.',
  choose: 'Choisir un modèle',
  duration:
    'Durée habituelle d’une génération avec ce modèle, d’après tes dernières générations.',
  images: (n: number) => `Jusqu’à ${n} image${n > 1 ? 's' : ''} de référence`,
  pin: 'Épingler',
  unpin: 'Désépingler',
}

/** `42` → `42s`, `95` → `2m`. */
const shortDuration = (s: number) =>
  s < 60 ? `${s}s` : `${Math.round(s / 60)}m`

/** Logo du fournisseur dans une petite tuile (même rendu partout). */
export function ProviderLogo({
  provider,
  size = 'md',
  className,
}: {
  provider: ProviderId
  size?: 'sm' | 'md'
  className?: string
}) {
  const p = PROVIDERS[provider]
  const img = p.logo ? (
    <img
      src={p.logo}
      alt=""
      draggable={false}
      className="size-3.5 object-contain"
    />
  ) : (
    <Sparkles className="size-3.5" />
  )
  if (size === 'sm')
    return (
      <span
        className={cn(
          'flex size-3.5 shrink-0 items-center justify-center',
          className,
        )}
      >
        {img}
      </span>
    )
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-white/[0.08]">
      {img}
    </span>
  )
}

/** Petit ⓘ net à côté d'un titre de section, avec son explication au survol. */
function SectionTitle({ title, info }: { title: string; info: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3.5 pt-3 pb-1.5 text-[12px] font-semibold text-muted-foreground select-none">
      {title}
      <Tooltip>
        <TooltipTrigger asChild>
          <Info
            className="size-2.5 shrink-0 text-muted-foreground/70"
            strokeWidth={2}
            aria-label={info}
          />
        </TooltipTrigger>
        <TooltipContent side="right">{info}</TooltipContent>
      </Tooltip>
    </div>
  )
}

function MiniBadge({
  children,
  tip,
}: {
  children: React.ReactNode
  tip: string
}) {
  // Délai de 500 ms : l'infobulle ne surgit pas en balayant la liste.
  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <span className="flex h-[18px] min-w-[18px] items-center justify-center gap-0.5 rounded-full bg-white/[0.08] px-1.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{tip}</TooltipContent>
    </Tooltip>
  )
}

function ModelRow({
  family: f,
  selected,
  pinned,
  onSelect,
  onTogglePin,
}: {
  family: CatalogFamily
  selected: boolean
  pinned: boolean
  onSelect: () => void
  onTogglePin: () => void
}) {
  const refs = imageInputInfo(f.media, f.tasks, 'reference').max
  return (
    <div
      role="menuitemradio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className="group/row mx-1 flex h-[53px] cursor-pointer items-start gap-2 rounded-xl p-2 outline-none hover:bg-white/[0.05] focus-visible:bg-white/[0.05]"
    >
      <ProviderLogo provider={f.provider} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate text-[13px] text-foreground">
            {f.label}
          </span>
          <span className="flex shrink-0 gap-0.5">
            {f.typicalSeconds !== null && (
              <MiniBadge tip={TEXT.duration}>
                {shortDuration(f.typicalSeconds)}
              </MiniBadge>
            )}
            {refs > 0 && (
              <MiniBadge tip={TEXT.images(refs)}>
                <ImageIcon className="size-2.5" />
                {refs}
              </MiniBadge>
            )}
          </span>
        </div>
        <div
          className="truncate text-[11px] text-muted-foreground"
          title={f.hint}
        >
          {f.hint}
        </div>
      </div>
      <div className="flex items-center gap-1 self-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onTogglePin()
          }}
          aria-label={pinned ? TEXT.unpin : TEXT.pin}
          title={pinned ? TEXT.unpin : TEXT.pin}
          className={cn(
            'flex size-[22px] items-center justify-center rounded-lg text-muted-foreground hover:bg-white/[0.08] hover:text-foreground',
            pinned
              ? 'opacity-100'
              : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
          )}
        >
          <Pin className={cn('size-3.5', pinned && 'fill-current')} />
        </button>
        {selected && <Check className="size-4 shrink-0" />}
      </div>
    </div>
  )
}

/** Délai avant de fermer un sous-menu : laisse le temps d'aller de la ligne au panneau. */
const SUB_CLOSE_DELAY = 150

/**
 * Ligne qui ouvre un sous-menu (fournisseur ou groupe) à droite. Visible seulement tant que la
 * souris est sur la ligne ou sur le panneau. Le panneau ne prend jamais le focus : sinon la liste
 * principale perd le focus, le panneau se referme aussitôt et le défilement saute.
 */
function SubMenu({
  icon,
  label,
  open,
  onOpenChange,
  onClickOutside,
  children,
}: {
  icon: React.ReactNode
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Clic hors du sous-menu : le menu principal décide s'il se referme. */
  onClickOutside: (target: EventTarget | null) => void
  children: React.ReactNode
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = () => {
    clearTimeout(timer.current)
    onOpenChange(true)
  }
  const hide = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onOpenChange(false), SUB_CLOSE_DELAY)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <button
          type="button"
          onMouseEnter={show}
          onMouseLeave={hide}
          onClick={show}
          className={cn(
            'mx-1 flex h-10 w-[calc(100%-0.5rem)] items-center justify-between rounded-xl p-2 text-left text-[13px] text-foreground outline-none hover:bg-white/[0.05]',
            open && 'bg-white/[0.05]',
          )}
        >
          <span className="flex items-center gap-2">
            {icon}
            {label}
          </span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={6}
        onMouseEnter={show}
        onMouseLeave={hide}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={() => onOpenChange(false)}
        onPointerDownOutside={(e) => {
          onOpenChange(false)
          onClickOutside(e.target)
        }}
        className="thin-scrollbar max-h-96 w-80 overflow-y-auto rounded-2xl p-0 py-1 pr-1"
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

export function ModelPicker({
  families,
  media,
  value,
  onChange,
  lora,
  trigger,
  align = 'start',
}: {
  families: CatalogFamily[]
  /** Seuls les modèles de ce type sont proposés (la bascule photo / vidéo choisit le type). */
  media: MediaKind
  value: string | null
  onChange: (id: string) => void
  /** Le persona a des LoRA pour ce modèle : pastille violette. `active` = mots des LoRA cochées. */
  lora?: { active: string[] } | null
  /** Bouton d'ouverture personnalisé (ex. « Relancer avec… »). */
  trigger?: React.ReactNode
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sub, setSub] = useState<string | null>(null)
  const [pinnedPref, setPinnedPref] = useUiPref('pinnedModels')
  const pinnedIds = pinnedPref ? pinnedPref.split(',') : []

  const list = families.filter((f) => f.available && f.media === media)
  const current = families.find((f) => f.id === value)
  const isLora = (f: CatalogFamily) => f.badges.includes('LORA')

  const choose = (id: string) => {
    onChange(id)
    setOpen(false)
    setSub(null)
    setQuery('')
  }
  const togglePin = (id: string) =>
    setPinnedPref(
      (pinnedIds.includes(id)
        ? pinnedIds.filter((x) => x !== id)
        : [...pinnedIds, id]
      ).join(','),
    )
  const row = (f: CatalogFamily) => (
    <ModelRow
      key={f.id}
      family={f}
      selected={f.id === value}
      pinned={pinnedIds.includes(f.id)}
      onSelect={() => choose(f.id)}
      onTogglePin={() => togglePin(f.id)}
    />
  )

  const q = query.trim().toLowerCase()
  const found = q
    ? list.filter((f) =>
        `${f.label} ${f.hint} ${PROVIDERS[f.provider].label}`
          .toLowerCase()
          .includes(q),
      )
    : []
  const pinned = list.filter((f) => pinnedIds.includes(f.id))
  const recommended = list
    .filter((f) => f.recommended)
    .sort((a, b) => a.recommended! - b.recommended!)
  // Fournisseurs dans l'ordre de PROVIDERS (OpenAI, ByteDance, Alibaba, Google…).
  const order = Object.keys(PROVIDERS)
  const providers = [...new Set(list.map((f) => f.provider))].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
  )
  const groups = [
    // Modèles locaux : sur le GPU, gratuits (présents quand ComfyUI tourne).
    { id: 'local', label: TEXT.local, items: list.filter((f) => f.runtime === 'comfy') },
    {
      id: 'low-cost',
      label: TEXT.lowCost,
      items: list.filter((f) => f.lowCost),
    },
    { id: 'lora', label: TEXT.lora, items: list.filter(isLora) },
  ].filter((g) => g.items.length)

  // Un sous-menu ouvert capte les clics extérieurs : on referme tout le menu
  // si le clic tombe aussi hors du panneau principal.
  const contentRef = useRef<HTMLDivElement>(null)
  const closeIfOutside = (target: EventTarget | null) => {
    if (target instanceof Node && contentRef.current?.contains(target)) return
    setOpen(false)
    setSub(null)
    setQuery('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setSub(null)
          setQuery('')
        }
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <button type="button" className={cn(BAR_BUTTON, 'pr-1.5')}>
            {current && <ProviderLogo provider={current.provider} size="sm" />}
            <span className="max-w-40 truncate">
              {current?.label ?? TEXT.choose}
            </span>
            {lora && (
              <span
                title={
                  lora.active.length
                    ? `LoRA active : ${lora.active.join(', ')}`
                    : 'LoRA disponibles pour ce persona'
                }
                className="size-1.5 shrink-0 rounded-full bg-violet-400"
              />
            )}
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        side="top"
        align={align}
        className="w-80 overflow-hidden rounded-2xl p-0"
      >
        <div className="flex h-11 items-center gap-2 border-b border-border/60 pr-2 pl-4">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={TEXT.search}
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        {/* Marge à droite : la barre de défilement ne déborde pas sur les lignes. */}
        <div className="thin-scrollbar max-h-96 overflow-y-auto pr-1 pb-1.5">
          {q ? (
            found.length ? (
              <div className="flex flex-col gap-1 pt-1">{found.map(row)}</div>
            ) : (
              <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
                {TEXT.noResult}
              </p>
            )
          ) : (
            <>
              {/* Survoler une ligne normale referme le sous-menu ouvert. */}
              <div onMouseEnter={() => setSub(null)}>
                <SectionTitle title={TEXT.pinned} info={TEXT.pinnedInfo} />
                {pinned.length ? (
                  <div className="flex flex-col gap-1">{pinned.map(row)}</div>
                ) : (
                  <p className="px-3.5 pb-2 text-[12px] text-muted-foreground/80">
                    {TEXT.pinnedEmpty}
                  </p>
                )}

                {recommended.length > 0 && (
                  <>
                    <SectionTitle
                      title={TEXT.recommended}
                      info={TEXT.recommendedInfo}
                    />
                    <div className="flex flex-col gap-1">
                      {recommended.map(row)}
                    </div>
                  </>
                )}
              </div>

              <SectionTitle title={TEXT.providers} info={TEXT.providersInfo} />
              {providers.map((p) => (
                <SubMenu
                  key={p}
                  icon={<ProviderLogo provider={p} />}
                  label={PROVIDERS[p].label}
                  open={sub === p}
                  onOpenChange={(o) =>
                    setSub((s) => (o ? p : s === p ? null : s))
                  }
                  onClickOutside={closeIfOutside}
                >
                  <div className="flex flex-col gap-1">
                    {list.filter((f) => f.provider === p).map(row)}
                  </div>
                </SubMenu>
              ))}

              {groups.length > 0 && (
                <>
                  <SectionTitle title={TEXT.groups} info={TEXT.groupsInfo} />
                  {groups.map((g) => (
                    <SubMenu
                      key={g.id}
                      icon={
                        <span className="flex size-6 items-center justify-center rounded-lg bg-white/[0.08] text-[10px] font-semibold text-muted-foreground">
                          {g.id === 'lora' ? 'L' : g.id === 'local' ? 'G' : '$'}
                        </span>
                      }
                      label={g.label}
                      open={sub === g.id}
                      onOpenChange={(o) =>
                        setSub((s) => (o ? g.id : s === g.id ? null : s))
                      }
                      onClickOutside={closeIfOutside}
                    >
                      <div className="flex flex-col gap-1">
                        {g.items.map(row)}
                      </div>
                    </SubMenu>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
