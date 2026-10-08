import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import {
  Check,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Search,
  ThumbsUp,
  X,
} from 'lucide-react'
import {
  CIVITAI_BASE_MODELS,
  getFamily,
  type CivitaiLora,
  type CivitaiSort,
  type PersonaLora,
} from '@ai-fluence/shared'

import { civitaiApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

const FAMILIES = Object.keys(CIVITAI_BASE_MODELS).map((id) => ({
  id,
  label: getFamily(id)?.label.replace(/ LoRA$/, '') ?? id,
  media: getFamily(id)?.media ?? 'image',
}))

const SORTS: { value: CivitaiSort; label: string }[] = [
  { value: 'Most Downloaded', label: 'Les plus téléchargées' },
  { value: 'Highest Rated', label: 'Les mieux notées' },
  { value: 'Newest', label: 'Les plus récentes' },
]

const compact = new Intl.NumberFormat('fr-FR', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** Transforme une LoRA Civitai en ligne(s) du persona (Wan 2.2 : une ligne par passe). */
export function toPersonaLoras(item: CivitaiLora): PersonaLora[] {
  return item.files.map((f) => ({
    id: crypto.randomUUID(),
    label: (f.noise
      ? `${item.name} · ${f.noise.toUpperCase()}`
      : item.name
    ).slice(0, 60),
    path: f.url,
    scale: 1,
    family: item.family,
    ...(f.noise ? { noise: f.noise } : {}),
    triggerWords: item.triggerWords,
    ...(item.previews[0] ? { previewUrl: item.previews[0].url } : {}),
    sourceUrl: item.pageUrl,
  }))
}

export function CivitaiBrowser({
  open,
  onOpenChange,
  addedPaths,
  remaining,
  onAdd,
  onRemove,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Liens déjà présents dans le persona. */
  addedPaths: Set<string>
  /** Places restantes dans le persona. */
  remaining: number
  onAdd: (item: CivitaiLora) => void
  onRemove: (item: CivitaiLora) => void
}) {
  const [family, setFamily] = useState<string>('')
  const [sort, setSort] = useState<CivitaiSort>('Most Downloaded')
  const [nsfw, setNsfw] = useState(false)
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')

  // Recherche lancée 400 ms après la dernière frappe.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 400)
    return () => clearTimeout(t)
  }, [text])

  const results = useInfiniteQuery({
    queryKey: ['civitai', family, sort, nsfw, query],
    queryFn: ({ pageParam }) =>
      civitaiApi.search({
        family: family || undefined,
        query: query || undefined,
        sort,
        nsfw,
        cursor: pageParam || undefined,
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  // Le même modèle peut revenir sur deux pages : on dédoublonne.
  const items = [
    ...new Map(
      (results.data?.pages ?? [])
        .flatMap((p) => p.items)
        .map((i) => [i.versionId, i]),
    ).values(),
  ]

  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (
          e.isIntersecting &&
          results.hasNextPage &&
          !results.isFetchingNextPage
        ) {
          results.fetchNextPage()
        }
      },
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [results])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Plein écran opaque, contenu centré avec de la marge. */}
      <DialogContent
        showCloseButton={false}
        className="inset-0 top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 sm:max-w-none data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100"
      >
        <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col px-8">
          <div className="flex items-center gap-3 border-b border-border/60 py-5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand/10 text-brand">
              <Globe className="h-[18px] w-[18px]" />
            </div>
            <div>
              <DialogTitle className="text-[15px]">
                Bibliothèque communautaire
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                LoRA partagées sur Civitai. Clique sur une carte pour l’ajouter
                au persona.
              </p>
            </div>
            <DialogClose
              aria-label="Fermer"
              className="ml-auto grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-[18px] w-[18px]" />
            </DialogClose>
          </div>

          <div className="flex min-h-0 flex-1">
            <aside className="w-60 shrink-0 space-y-6 overflow-y-auto border-r border-border/60 py-5 pr-5">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  placeholder="Rechercher…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="pl-8"
                />
              </div>

              <FilterGroup title="Modèle">
                <FilterOption
                  active={family === ''}
                  onClick={() => setFamily('')}
                >
                  Tous
                </FilterOption>
                {FAMILIES.map((f) => (
                  <FilterOption
                    key={f.id}
                    active={family === f.id}
                    onClick={() => setFamily(f.id)}
                  >
                    {f.label}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {f.media === 'video' ? 'vidéo' : 'photo'}
                    </span>
                  </FilterOption>
                ))}
              </FilterGroup>

              <FilterGroup title="Trier par">
                {SORTS.map((s) => (
                  <FilterOption
                    key={s.value}
                    active={sort === s.value}
                    onClick={() => setSort(s.value)}
                  >
                    {s.label}
                  </FilterOption>
                ))}
              </FilterGroup>

              <label className="flex items-center justify-between gap-2 text-sm">
                Contenu adulte
                <Switch checked={nsfw} onCheckedChange={setNsfw} />
              </label>
            </aside>

            <div className="min-w-0 flex-1 overflow-y-auto py-5 pl-5">
              {results.isPending ? (
                <Grid>
                  {Array.from({ length: 12 }, (_, i) => (
                    <div
                      key={i}
                      className="aspect-[3/4] animate-pulse rounded-lg bg-muted/40"
                    />
                  ))}
                </Grid>
              ) : results.isError ? (
                <Empty>{(results.error as Error).message}</Empty>
              ) : items.length === 0 ? (
                <Empty>Aucune LoRA ne correspond.</Empty>
              ) : (
                <>
                  <Grid>
                    {items.map((item) => {
                      const added = item.files.every((f) =>
                        addedPaths.has(f.url),
                      )
                      const full = !added && item.files.length > remaining
                      return (
                        <LoraCard
                          key={item.versionId}
                          item={item}
                          added={added}
                          disabled={full}
                          showFamily={!family}
                          onClick={() =>
                            added ? onRemove(item) : !full && onAdd(item)
                          }
                        />
                      )
                    })}
                  </Grid>
                  <div ref={sentinel} className="flex justify-center py-6">
                    {results.isFetchingNextPage && (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FilterGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </div>
      {children}
    </div>
  )
}

function FilterOption({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center rounded-md px-2 text-left text-[13px] transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function LoraCard({
  item,
  added,
  disabled,
  showFamily,
  onClick,
}: {
  item: CivitaiLora
  added: boolean
  disabled: boolean
  showFamily: boolean
  onClick: () => void
}) {
  const preview = item.previews[0]
  const videoRef = useRef<HTMLVideoElement>(null)

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-pressed={added}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
      title={
        disabled
          ? 'Le persona a déjà 12 LoRA.'
          : added
            ? 'Retirer du persona'
            : 'Ajouter au persona'
      }
      onMouseEnter={() => videoRef.current?.play().catch(() => {})}
      onMouseLeave={() => {
        const v = videoRef.current
        if (v) {
          v.pause()
          v.currentTime = 0
        }
      }}
      className={cn(
        'group relative aspect-[3/4] overflow-hidden rounded-lg bg-muted/40 text-left outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring',
        added && 'ring-2 ring-brand',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      {preview && (
        <img
          src={preview.url}
          alt=""
          loading="lazy"
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      )}
      {preview?.videoUrl && (
        <video
          ref={videoRef}
          src={preview.videoUrl}
          muted
          loop
          playsInline
          preload="none"
          className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}

      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
        {showFamily ? (
          <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
            {getFamily(item.family)?.label.replace(/ LoRA$/, '')}
          </span>
        ) : (
          <span />
        )}
        {added ? (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-brand text-brand-foreground">
            <Check className="h-3.5 w-3.5" />
          </span>
        ) : (
          <a
            href={item.pageUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label="Voir sur Civitai"
            title="Voir sur Civitai"
            className="grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition group-hover:opacity-100 hover:bg-black/80"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2.5 pt-10">
        <div className="line-clamp-2 text-[13px] leading-snug font-medium text-white">
          {item.name}
        </div>
        <div className="mt-1 flex items-center gap-2.5 text-[11px] text-white/60">
          <span className="truncate">{item.creator}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <Download className="h-3 w-3" />
            {compact.format(item.downloads)}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <ThumbsUp className="h-3 w-3" />
            {compact.format(item.likes)}
          </span>
        </div>
        {(item.triggerWords.length > 0 || item.files.length > 1) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.files.length > 1 && (
              <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] text-white">
                HIGH + LOW
              </span>
            )}
            {item.triggerWords.slice(0, 2).map((w) => (
              <span
                key={w}
                className="max-w-full truncate rounded bg-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white"
              >
                {w}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
