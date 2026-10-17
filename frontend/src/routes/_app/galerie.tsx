import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Film, Loader2, Workflow } from 'lucide-react'
import { getFamily } from '@sublime/shared'

import { assetsApi } from '@/lib/api'
import { personasQuery, qk } from '@/lib/queries'
import { PageHeader } from '@/components/layout/PageHeader'
import { PersonaAvatar } from '@/components/personas/PersonaAvatar'
import { MediaViewer } from '@/components/thread/MediaViewer'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Légende d'une image au survol : prompt et modèle, lien vers sa demande. */
const GALLERY_CAPTION =
  'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pt-6 pb-2 text-[11px] text-white/90 opacity-0 transition group-hover:opacity-100'

export const Route = createFileRoute('/_app/galerie')({
  // Arrivée depuis une image (?a=<id> : Accueil) : la galerie s'ouvre sur elle.
  validateSearch: (search: Record<string, unknown>): { a?: string } =>
    typeof search.a === 'string' && search.a ? { a: search.a } : {},
  component: GalleryPage,
})

/** Pages chargées au plus pour retrouver l'image visée. */
const TARGET_MAX_PAGES = 5

function GalleryPage() {
  const [personaId, setPersonaId] = useState<string | null>(null)
  const [media, setMedia] = useState<'image' | 'video' | null>(null)
  // Média ouvert dans la visionneuse (son id) : les flèches parcourent la galerie.
  const [viewing, setViewing] = useState<string | null>(null)
  const { data: personas = [] } = useQuery(personasQuery())

  const query = useInfiniteQuery({
    queryKey: qk.gallery(personaId, media),
    queryFn: ({ pageParam }) =>
      assetsApi.gallery({
        personaId: personaId ?? undefined,
        media: media ?? undefined,
        before: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
  })
  const items = query.data?.pages.flatMap((p) => p.items) ?? []

  // Image visée : posée en haut de la zone (petite marge), et gardée là pendant que les
  // images au-dessus se chargent (elles changent la mise en page), jusqu'au premier geste.
  const { a: target } = Route.useSearch()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pinned = useRef<string | null>(null)
  // Image déjà atteinte : un rechargement des données ne ramène plus dessus.
  const reached = useRef<string | null>(null)
  const goToTarget = (id: string) => {
    const el = scrollRef.current
    const node = el?.querySelector<HTMLElement>(`[data-asset-id="${CSS.escape(id)}"]`)
    if (!el || !node) return false
    // Marge plus petite que l'écart entre deux images (12 px) : l'image du dessus ne dépasse pas.
    el.scrollTop += node.getBoundingClientRect().top - el.getBoundingClientRect().top - 6
    return true
  }
  useEffect(() => {
    if (!target || !query.data || reached.current === target) return
    if (goToTarget(target)) {
      reached.current = target
      pinned.current = target
    } else if (query.hasNextPage && !query.isFetchingNextPage && query.data.pages.length < TARGET_MAX_PAGES) {
      // Plus ancienne que la première page : on charge la suite.
      void query.fetchNextPage()
    }
  }, [target, query.data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    const release = () => {
      pinned.current = null
    }
    const observer = new ResizeObserver(() => {
      if (pinned.current) goToTarget(pinned.current)
    })
    observer.observe(content)
    el.addEventListener('wheel', release, { passive: true })
    el.addEventListener('touchstart', release, { passive: true })
    el.addEventListener('keydown', release)
    el.addEventListener('pointerdown', release)
    return () => {
      observer.disconnect()
      el.removeEventListener('wheel', release)
      el.removeEventListener('touchstart', release)
      el.removeEventListener('keydown', release)
      el.removeEventListener('pointerdown', release)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const viewIndex = viewing
    ? items.findIndex((i) => i.asset.id === viewing)
    : -1

  return (
    <>
      <PageHeader
        right={
          <div className="flex gap-2">
            <Select
              value={personaId ?? '__all'}
              onValueChange={(v) => setPersonaId(v === '__all' ? null : v)}
            >
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Tous</SelectItem>
                {/* Bulle du persona à gauche de son nom (aussi dans le bouton une fois choisi). */}
                {personas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex min-w-0 items-center gap-2">
                      <PersonaAvatar
                        persona={p}
                        size={18}
                        className="rounded-md"
                      />
                      <span className="truncate">{p.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={media ?? '__all'}
              onValueChange={(v) =>
                setMedia(v === '__all' ? null : (v as 'image' | 'video'))
              }
            >
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Tout format</SelectItem>
                <SelectItem value="image">Photos</SelectItem>
                <SelectItem value="video">Vidéos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      >
        <span className="text-sm font-medium">Galerie</span>
      </PageHeader>
      <div ref={scrollRef} data-testid="gallery-scroll" className="min-h-0 flex-1 overflow-y-auto p-4">
        {query.isLoading && (
          <Loader2 className="mx-auto mt-20 h-5 w-5 animate-spin text-muted-foreground" />
        )}
        {!query.isLoading && items.length === 0 && (
          <p className="mt-20 text-center text-sm text-muted-foreground">
            Rien ici pour l’instant.
          </p>
        )}
        <div ref={contentRef} className="columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5">
          {items.map(({ asset, generation }) => (
            <div
              key={asset.id}
              data-testid="gallery-item"
              data-asset-id={asset.id}
              className="group relative mb-3 break-inside-avoid overflow-hidden rounded-xl border border-border/40"
            >
              <button
                onClick={() => setViewing(asset.id)}
                className="block w-full"
              >
                {asset.mediaType === 'video' ? (
                  <video
                    src={asset.url}
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    className="w-full"
                    onMouseEnter={(e) => e.currentTarget.play()}
                    onMouseLeave={(e) => e.currentTarget.pause()}
                  />
                ) : (
                  <img
                    src={asset.url}
                    alt=""
                    loading="lazy"
                    className="w-full"
                  />
                )}
              </button>
              {asset.mediaType === 'video' && (
                <Film className="absolute top-2 left-2 h-4 w-4 text-white drop-shadow" />
              )}
              {generation?.workflowId && (
                <span className="pointer-events-none absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white/90">
                  <Workflow className="h-3 w-3" /> Workflow
                </span>
              )}
              {generation &&
                (generation.threadId ? (
                  <Link
                    to="/t/$threadId"
                    params={{ threadId: generation.threadId }}
                    search={{ g: generation.id }}
                    className={GALLERY_CAPTION}
                  >
                    <span className="line-clamp-2">
                      {generation.prompt || '(sans prompt)'}
                    </span>
                    <span className="text-white/60">
                      {getFamily(generation.family)?.label}
                    </span>
                  </Link>
                ) : generation.workflowId ? (
                  <Link
                    to="/workflows/$workflowId"
                    params={{ workflowId: generation.workflowId }}
                    className={GALLERY_CAPTION}
                  >
                    <span className="line-clamp-2">
                      {generation.prompt || '(sans prompt)'}
                    </span>
                    <span className="text-white/60">
                      {getFamily(generation.family)?.label} · Voir dans le
                      workflow
                    </span>
                  </Link>
                ) : null)}
            </div>
          ))}
        </div>
        {query.hasNextPage && (
          <div className="flex justify-center py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              Charger plus
            </Button>
          </div>
        )}
      </div>
      <MediaViewer
        asset={viewIndex >= 0 ? items[viewIndex].asset : null}
        onClose={() => setViewing(null)}
        source={
          viewIndex >= 0 && items[viewIndex].generation
            ? {
                threadId: items[viewIndex].generation!.threadId,
                workflowId: items[viewIndex].generation!.workflowId,
                generationId: items[viewIndex].generation!.id,
              }
            : null
        }
        onPrev={
          viewIndex > 0
            ? () => setViewing(items[viewIndex - 1].asset.id)
            : undefined
        }
        onNext={
          viewIndex < 0
            ? undefined
            : viewIndex < items.length - 1
              ? () => setViewing(items[viewIndex + 1].asset.id)
              : query.hasNextPage
                ? // Au bout de la page : on charge la suivante, puis on avance.
                  () =>
                    void query.fetchNextPage().then((res) => {
                      const next = res.data?.pages.flatMap((p) => p.items)[
                        viewIndex + 1
                      ]
                      if (next) setViewing(next.asset.id)
                    })
                : undefined
        }
      />
    </>
  )
}
