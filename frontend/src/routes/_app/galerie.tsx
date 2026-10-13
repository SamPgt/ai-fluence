import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Film, Loader2, Workflow } from 'lucide-react'
import { getFamily } from '@ai-fluence/shared'

import { assetsApi } from '@/lib/api'
import { personasQuery, qk } from '@/lib/queries'
import { PageHeader } from '@/components/layout/PageHeader'
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
  component: GalleryPage,
})

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
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Tous</SelectItem>
                {personas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
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
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {query.isLoading && (
          <Loader2 className="mx-auto mt-20 h-5 w-5 animate-spin text-muted-foreground" />
        )}
        {!query.isLoading && items.length === 0 && (
          <p className="mt-20 text-center text-sm text-muted-foreground">
            Rien ici pour l’instant.
          </p>
        )}
        <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5">
          {items.map(({ asset, generation }) => (
            <div
              key={asset.id}
              data-testid="gallery-item"
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
                    <span className="line-clamp-2">{generation.prompt || '(sans prompt)'}</span>
                    <span className="text-white/60">{getFamily(generation.family)?.label}</span>
                  </Link>
                ) : generation.workflowId ? (
                  <Link
                    to="/workflows/$workflowId"
                    params={{ workflowId: generation.workflowId }}
                    className={GALLERY_CAPTION}
                  >
                    <span className="line-clamp-2">{generation.prompt || '(sans prompt)'}</span>
                    <span className="text-white/60">{getFamily(generation.family)?.label} · Voir dans le workflow</span>
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
