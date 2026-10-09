/**
 * Choix visuel d'un trait dans la bibliothèque : catégories par zone à gauche, miniatures à droite.
 * Un clic sur une miniature ajoute (ou remplace) la bulle de la catégorie dans le composer.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, Dice5, ImageIcon, Library, Loader2, Search, Star } from 'lucide-react'
import { LIBRARY_ZONES, orderCategories, type Gender, type GenerationTrait, type LibraryCategory } from '@ai-fluence/shared'

import { libraryCategoriesQuery, libraryOptionsQuery, libraryThumbnailsQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Mode « tirage » (créateur de personnage) : on choisit parmi quoi tirer au hasard, au lieu d'une option. */
export interface DrawPool {
  drawFrom: 'all' | 'favorites' | 'pool'
  ids: string[]
  onChange: (drawFrom: 'all' | 'favorites' | 'pool', ids: string[]) => void
}

export function TraitPicker({
  open,
  initialCategoryId,
  gender,
  selected,
  onPick,
  onClose,
  categoryIds,
  title = 'Ajouter un trait',
  pool,
}: {
  open: boolean
  /** Mode tirage : coche les options parmi lesquelles tirer (une seule catégorie). */
  pool?: DrawPool
  /** Limite la fenêtre à ces catégories (fiche du créateur de personnage). */
  categoryIds?: string[]
  title?: string
  /** Catégorie ouverte d'emblée (clic sur une bulle pour la changer). */
  initialCategoryId: string | null
  /** Genre du personnage : options et miniatures de ce genre. Null : choix Femme / Homme dans la fenêtre. */
  gender: Gender | null
  selected: GenerationTrait[]
  onPick: (trait: GenerationTrait) => void
  onClose: () => void
}) {
  const { data: categories = [] } = useQuery({ ...libraryCategoriesQuery(), enabled: open })
  const usable = orderCategories(categories).filter((c) => c.optionCount > 0 && (!categoryIds || categoryIds.includes(c.id)))
  const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId)
  const category = usable.find((c) => c.id === categoryId) ?? usable[0] ?? null
  useEffect(() => {
    if (open) setCategoryId(initialCategoryId)
  }, [open, initialCategoryId])

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[min(720px,85vh)] flex-col gap-0 p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border/40 px-5 py-3.5">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="text-xs">
            {pool
              ? 'Coche les options parmi lesquelles tirer au hasard pour chaque variante, ou tire dans toute la liste ou tes favoris.'
              : "Choisis visuellement : l'option est ajoutée en bulle et intégrée au prompt en anglais."}
          </DialogDescription>
        </DialogHeader>
        {usable.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <Library className="h-6 w-6 text-muted-foreground" />
            <p className="max-w-sm text-sm text-muted-foreground">
              Ta bibliothèque est vide. Importe des wildcards (coiffures, tenues, lieux…) pour les choisir ici.
            </p>
            <Link to="/bibliotheque" onClick={onClose} className="text-sm text-brand hover:underline">
              Ouvrir la bibliothèque
            </Link>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <nav className="w-56 shrink-0 space-y-3 overflow-y-auto border-r border-border/40 p-2">
              {LIBRARY_ZONES.map((zone) => {
                const items = usable.filter((c) => c.zone === zone.id)
                if (!items.length) return null
                return (
                  <div key={zone.id}>
                    <div className="px-2 pb-1 text-[11px] font-bold tracking-wide text-zinc-300 uppercase">{zone.label}</div>
                    {items.map((c) => {
                      const chosen = selected.find((t) => t.categoryId === c.id)
                      return (
                        <button
                          key={c.id}
                          onClick={() => setCategoryId(c.id)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors',
                            c.depth === 1 && 'pl-6',
                            category?.id === c.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{c.label}</span>
                          {chosen && <Check className="h-3.5 w-3.5 shrink-0 text-brand" />}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </nav>
            {category && (
              <OptionGrid
                key={category.id}
                category={category}
                gender={gender}
                selectedOptionId={selected.find((t) => t.categoryId === category.id)?.optionId ?? null}
                onPick={onPick}
                pool={pool}
                onDone={onClose}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function OptionGrid({
  category,
  gender,
  selectedOptionId,
  onPick,
  pool,
  onDone,
}: {
  category: LibraryCategory
  gender: Gender | null
  selectedOptionId: string | null
  onPick: (trait: GenerationTrait) => void
  pool?: DrawPool
  onDone: () => void
}) {
  const { data: options = [], isLoading } = useQuery(libraryOptionsQuery(category.id))
  const { data: thumbnails = [] } = useQuery(libraryThumbnailsQuery(category.id))
  const [search, setSearch] = useState('')
  // Sans genre de personnage : on choisit la version à afficher.
  const [preview, setPreview] = useState<Gender>(gender ?? 'female')
  const shown = gender ?? preview

  const thumbOf = useMemo(() => {
    const map = new Map(thumbnails.filter((t) => t.url).map((t) => [`${t.optionId}:${t.gender}`, t.url!]))
    return (optionId: string, optionGender: Gender | null) =>
      category.gendered ? (map.get(`${optionId}:${optionGender ?? shown}`) ?? null) : (map.get(`${optionId}:any`) ?? null)
  }, [thumbnails, category.gendered, shown])

  // Options masquées : jamais proposées. Favorites en premier, ou seules avec le filtre ★.
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const usable = useMemo(
    () => options.filter((o) => !o.hidden && (!category.gendered || !o.gender || o.gender === shown)),
    [options, category.gendered, shown],
  )
  const favoriteCount = usable.filter((o) => o.favorite).length
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return usable
      .filter((o) => !favoritesOnly || o.favorite)
      .filter((o) => !q || o.fragment.toLowerCase().includes(q) || o.label?.toLowerCase().includes(q))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite))
  }, [usable, search, favoritesOnly])
  // Tirage : copie locale, à jour d'un clic à l'autre (des clics rapides ne s'écrasent pas).
  const [draw, setDraw] = useState(() => ({ drawFrom: pool?.drawFrom ?? 'all', ids: pool?.ids ?? [] }))
  const setPool = (drawFrom: DrawPool['drawFrom'], ids: string[]) => {
    setDraw({ drawFrom, ids })
    pool?.onChange(drawFrom, ids)
  }
  const inPool = (id: string) => draw.drawFrom === 'pool' && draw.ids.includes(id)
  const togglePool = (id: string) => {
    const current = draw.drawFrom === 'pool' ? draw.ids : []
    const ids = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    setPool(ids.length ? 'pool' : 'all', ids)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Rechercher dans ${category.label}…`} className="h-8 pl-8 text-xs" />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{visible.length} option(s)</span>
        {favoriteCount > 0 && (
          <button
            type="button"
            onClick={() => setFavoritesOnly((v) => !v)}
            className={cn(
              'flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors',
              favoritesOnly ? 'border-amber-400/50 bg-amber-400/10 text-foreground' : 'border-input text-muted-foreground hover:text-foreground',
            )}
            title="Seulement mes favoris"
          >
            <Star className={cn('h-3 w-3 text-amber-400', favoritesOnly && 'fill-current')} /> {favoriteCount}
          </button>
        )}
        {category.gendered && !gender && (
          <div className="ml-auto flex h-7 items-center rounded-md border border-input p-0.5 text-[11px]" title="Le persona n'a pas de genre : choisis la version">
            {(['female', 'male'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setPreview(g)}
                className={cn('h-full rounded px-2 transition-colors', preview === g ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {g === 'female' ? 'Femme' : 'Homme'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
            {visible.map((o) => {
              const url = thumbOf(o.id, o.gender)
              return (
                <button
                  key={o.id}
                  onClick={() =>
                    pool
                      ? togglePool(o.id)
                      : onPick({
                      optionId: o.id,
                      categoryId: category.id,
                      categoryLabel: category.label,
                      zone: category.zone,
                      label: o.label,
                      fragment: o.fragment,
                      thumbnailUrl: url,
                    })
                  }
                  title={o.fragment}
                  className={cn(
                    'group overflow-hidden rounded-xl border bg-card text-left transition-colors',
                    (pool ? inPool(o.id) : o.id === selectedOptionId) ? 'border-brand ring-1 ring-brand' : 'border-border/40 hover:border-border',
                  )}
                >
                  <div className="relative flex aspect-[4/5] items-center justify-center bg-secondary/40">
                    {o.favorite && <Star className="absolute right-1.5 bottom-1.5 h-3.5 w-3.5 fill-amber-400 text-amber-400 drop-shadow" />}
                    {pool && inPool(o.id) && (
                      <span className="absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-md bg-brand text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                    {url ? (
                      <img src={url} alt={o.label ?? o.fragment} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-muted-foreground/50" />
                    )}
                  </div>
                  <div className="space-y-0.5 p-2">
                    <span className="flex items-center gap-1.5 text-[12px] font-medium">
                      <span className="truncate">{o.label ?? o.fragment}</span>
                      {!o.label && <span className="shrink-0 rounded bg-secondary px-1 text-[9px] font-semibold text-muted-foreground">EN</span>}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
      {pool && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/40 px-4 py-2.5 text-xs">
          <Dice5 className="h-3.5 w-3.5 text-brand" />
          <span className="text-muted-foreground">Tirer au hasard parmi</span>
          {(
            [
              ['all', `Toute la liste (${usable.length})`],
              ['favorites', `Mes favoris (${favoriteCount})`],
              ['pool', `Ma sélection (${draw.ids.length})`],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              disabled={(mode === 'favorites' && !favoriteCount) || (mode === 'pool' && !draw.ids.length)}
              onClick={() => setPool(mode, draw.ids)}
              className={cn(
                'h-7 rounded-full border px-3 transition-colors disabled:opacity-40',
                draw.drawFrom === mode ? 'border-brand/50 bg-brand/10 text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
          <span className="text-[11px] text-muted-foreground">· clique sur les miniatures pour composer ta sélection</span>
          <Button size="sm" className="ml-auto h-7" onClick={onDone}>
            Valider
          </Button>
        </div>
      )}
    </div>
  )
}
