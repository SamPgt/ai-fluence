/**
 * Librairies de photos libres de droits (Unsplash, Pexels), ouvertes depuis le
 * bouton + du composer. Un clic importe la photo et la joint au composer.
 *
 * Quotas serrés (Unsplash : 50 appels par heure en mode démo) : pas de
 * défilement infini, la page suivante se charge au clic sur « Voir plus », et
 * les réponses sont gardées en cache (ici 1 h, 24 h côté serveur).
 */
import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { GlobeOff, Loader2, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Asset, LibraryPhoto, LibrarySource } from '@ai-fluence/shared'

import { libraryApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'

/** Catégories : recherches toutes faites, thèmes courants en création de contenu. */
const CATEGORIES: { label: string; query: string }[] = [
  { label: 'Populaires', query: '' },
  { label: 'Mode', query: 'fashion' },
  { label: 'Fitness', query: 'fitness' },
  { label: 'Sport', query: 'sport' },
  { label: 'Paysage', query: 'landscape' },
  { label: 'Photos de rue', query: 'street photography' },
  { label: 'Lifestyle', query: 'lifestyle' },
  { label: 'Voyage', query: 'travel' },
  { label: 'Intérieur', query: 'interior design' },
  { label: 'Plage', query: 'beach' },
  { label: 'Ville de nuit', query: 'city night' },
]

const HOUR = 60 * 60 * 1000
const UTM = '?utm_source=ai_fluence&utm_medium=referral'

const SOURCES: {
  id: LibrarySource
  label: string
  site: string
  envVar: string
  Mark: (props: { className?: string }) => React.ReactNode
}[] = [
  {
    id: 'unsplash',
    label: 'Unsplash',
    site: `https://unsplash.com/${UTM}`,
    envVar: 'UNSPLASH_ACCESS_KEY',
    Mark: UnsplashMark,
  },
  {
    id: 'pexels',
    label: 'Pexels',
    site: 'https://www.pexels.com',
    envVar: 'PEXELS_API_KEY',
    Mark: PexelsMark,
  },
]

/** Recherche lancée à partir de ce nombre de caractères (en dessous : la catégorie choisie). */
const MIN_SEARCH = 3

/** Logo Unsplash (pictogramme officiel simplifié). */
function UnsplashMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M10 9V0h12v9H10zm12 5h10v18H0V14h10v9h12v-9z" />
    </svg>
  )
}

/** Logo Pexels (carré arrondi et « P », simplifié). */
function PexelsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <path
        d="M12 23V9h6a4.5 4.5 0 0 1 0 9h-6"
        fill="none"
        stroke="var(--color-background)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function LibraryBrowser({
  open,
  onOpenChange,
  personaId,
  onImport,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  personaId?: string | null
  /** Photo importée : jointe au composer. */
  onImport: (asset: Asset) => void
}) {
  const [source, setSource] = useState<LibrarySource>('unsplash')
  const [category, setCategory] = useState(0)
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Chaque ouverture repart de zéro : Unsplash, catégorie « Populaires », sans recherche.
  useEffect(() => {
    if (!open) return
    setSource('unsplash')
    setCategory(0)
    setText('')
    setSearch('')
  }, [open])

  // Recherche lancée 400 ms après la dernière frappe, dès 3 caractères (chaque recherche coûte un appel).
  useEffect(() => {
    const value = text.trim()
    const t = setTimeout(
      () => setSearch(value.length >= MIN_SEARCH ? value : ''),
      400,
    )
    return () => clearTimeout(t)
  }, [text])

  const query = search || CATEGORIES[category].query
  const current = SOURCES.find((s) => s.id === source)!

  // Nouvelle liste : retour en haut.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [query, source])

  const status = useQuery({
    queryKey: ['library', 'status'],
    queryFn: libraryApi.status,
    enabled: open,
    staleTime: HOUR,
  })
  const enabled = status.data?.[source] === true

  const results = useInfiniteQuery({
    queryKey: ['library', source, 'search', query],
    queryFn: ({ pageParam }) =>
      libraryApi.search(source, { query: query || undefined, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => last.nextPage ?? undefined,
    enabled: open && enabled,
    staleTime: HOUR,
    gcTime: HOUR,
    retry: false,
  })

  // La même photo peut revenir sur deux pages : on dédoublonne.
  const items = [
    ...new Map(
      (results.data?.pages ?? []).flatMap((p) => p.items).map((i) => [i.id, i]),
    ).values(),
  ]

  const importing = useMutation({
    mutationFn: (photo: LibraryPhoto) =>
      libraryApi.import(source, photo.id, personaId),
    onSuccess: ({ asset }) => {
      onImport(asset)
      onOpenChange(false)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const clearSearch = () => {
    setText('')
    setSearch('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Fenêtre centrée (pas plein écran) : on pioche une image et on revient au composer. */}
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(780px,calc(100dvh-4rem))] w-[min(1120px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden rounded-2xl border-border/60 bg-background p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">
          Choisir depuis une librairie
        </DialogTitle>
        <DialogDescription className="sr-only">
          Photos libres de droits Unsplash et Pexels. Un clic ajoute la photo au
          composer.
        </DialogDescription>

        {/* Sources */}
        <aside className="hidden w-52 shrink-0 flex-col gap-1 border-r border-border/60 p-3 sm:flex">
          <div className="px-2 pt-1 pb-2 text-[11px] font-medium text-muted-foreground">
            Librairies
          </div>
          {SOURCES.map(({ id, label, Mark }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSource(id)}
              aria-pressed={source === id}
              className={cn(
                'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors',
                source === id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Mark className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Recherche */}
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 pr-3 pl-4">
            <div className="relative flex min-w-0 flex-1 items-center">
              <Search className="pointer-events-none absolute left-0 h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  // Échap vide d'abord la recherche ; une deuxième fois, ferme la fenêtre.
                  if (e.key === 'Escape' && text) {
                    e.preventDefault()
                    e.stopPropagation()
                    clearSearch()
                  }
                }}
                placeholder={`Rechercher sur ${current.label} (en anglais de préférence)…`}
                aria-label={`Rechercher sur ${current.label}`}
                className="h-9 w-full bg-transparent pr-8 pl-6 text-sm placeholder:text-muted-foreground/60 focus:outline-none"
              />
              {text && (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label="Effacer la recherche"
                  className="absolute right-1 grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <DialogClose
              aria-label="Fermer"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-[18px] w-[18px]" />
            </DialogClose>
          </div>

          {/* Photos */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
            {/* Catégories : discrètes, au-dessus de la grille. Une recherche en cours les désactive. */}
            {enabled && (
              <div className="mb-3 flex flex-wrap gap-1.5 px-1">
                {CATEGORIES.map((c, i) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => {
                      clearSearch()
                      setCategory(i)
                    }}
                    aria-pressed={!search && category === i}
                    className={cn(
                      'h-7 rounded-full px-3 text-xs transition-colors',
                      !search && category === i
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)] hover:text-foreground',
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            {status.isPending ? (
              <Skeletons />
            ) : !enabled ? (
              <Empty>
                Librairie {current.label} désactivée : ajoute{' '}
                <code>{current.envVar}</code> dans <code>backend/.env</code>.
              </Empty>
            ) : results.isPending ? (
              <Skeletons />
            ) : results.isError ? (
              <Offline message={(results.error as Error).message} />
            ) : items.length === 0 ? (
              <Empty>Aucune photo ne correspond.</Empty>
            ) : (
              <>
                <div className="columns-2 gap-1 md:columns-3">
                  {items.map((photo) => (
                    <PhotoCard
                      key={photo.id}
                      photo={photo}
                      source={source}
                      busy={
                        importing.isPending &&
                        importing.variables?.id === photo.id
                      }
                      disabled={importing.isPending}
                      onClick={() => importing.mutate(photo)}
                    />
                  ))}
                </div>
                {results.hasNextPage && (
                  <div className="flex justify-center pt-2 pb-4">
                    <button
                      type="button"
                      onClick={() => results.fetchNextPage()}
                      disabled={results.isFetchingNextPage}
                      className="flex h-9 items-center gap-2 rounded-full px-4 text-sm text-foreground/80 shadow-[inset_0_0_0_1px_var(--color-border)] transition-colors hover:bg-accent/60 disabled:opacity-60"
                    >
                      {results.isFetchingNextPage && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      Voir plus
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">
            Photos libres de droits{' '}
            <a
              href={current.site}
              target="_blank"
              rel="noreferrer"
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              {current.label}
            </a>
            . Un clic ajoute la photo au composer.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PhotoCard({
  photo,
  source,
  busy,
  disabled,
  onClick,
}: {
  photo: LibraryPhoto
  source: LibrarySource
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <div className="mb-1 break-inside-avoid rounded-2xl p-2 transition-colors hover:bg-white/[0.05]">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={photo.description || 'Ajouter au composer'}
        className="group relative block w-full overflow-hidden rounded-xl disabled:cursor-wait"
        style={{
          aspectRatio: `${photo.width} / ${photo.height}`,
          backgroundColor: photo.color,
        }}
      >
        <img
          src={photo.thumbUrl}
          alt={photo.description}
          loading="lazy"
          draggable={false}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100',
            busy && 'opacity-100',
          )}
        >
          <span className="flex h-8 items-center gap-1.5 rounded-full bg-background/90 px-3 text-[13px] font-medium text-foreground">
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {busy ? 'Import…' : 'Ajouter'}
          </span>
        </span>
      </button>
      {photo.description && (
        <div className="mt-2 truncate text-[13px] text-foreground/90">
          {photo.description}
        </div>
      )}
      {/* Attribution exigée : le photographe, avec le lien vers son profil (Unsplash)
          ou vers la page de la photo (Pexels). La source est citée dans le pied de la fenêtre. */}
      <a
        href={source === 'pexels' ? photo.pageUrl : photo.author.profileUrl}
        target="_blank"
        rel="noreferrer"
        title={photo.author.name}
        className="mt-0.5 block truncate text-xs text-muted-foreground hover:text-foreground"
      >
        {photo.author.username
          ? `@${photo.author.username}`
          : photo.author.name}
      </a>
    </div>
  )
}

function Skeletons() {
  const heights = ['h-56', 'h-72', 'h-48', 'h-64', 'h-52', 'h-80']
  return (
    <div className="columns-2 gap-3 md:columns-3">
      {Array.from({ length: 9 }, (_, i) => (
        <div
          key={i}
          className={cn(
            'mb-4 animate-pulse break-inside-avoid rounded-xl bg-muted/40',
            heights[i % heights.length],
          )}
        />
      ))}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[calc(100%-2.5rem)] items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {/* Un paragraphe : dans un conteneur flex, les espaces autour des <code> disparaîtraient. */}
      <p>{children}</p>
    </div>
  )
}

/** Source indisponible (panne, quota) sans rien en cache : globe barré, détail en dessous. */
function Offline({ message }: { message: string }) {
  return (
    <div className="flex h-[calc(100%-2.5rem)] flex-col items-center justify-center gap-3 px-6 text-center">
      <GlobeOff
        className="h-8 w-8 text-muted-foreground/60"
        strokeWidth={1.5}
      />
      <p className="max-w-xs text-xs text-muted-foreground">{message}</p>
    </div>
  )
}
