import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Film, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getFamily, type Asset } from '@ai-fluence/shared'

import { assetsApi } from '@/lib/api'
import { personasQuery, qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { MediaViewer } from '@/components/thread/MediaViewer'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const Route = createFileRoute('/_app/galerie')({
  component: GalleryPage,
})

function GalleryPage() {
  const [personaId, setPersonaId] = useState<string | null>(null)
  const [media, setMedia] = useState<'image' | 'video' | null>(null)
  const [viewing, setViewing] = useState<{
    asset: Asset
    prompt: string
  } | null>(null)
  const { data: personas = [] } = useQuery(personasQuery())
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState<Asset | null>(null)
  // Retire le résultat de l'app (galerie, fil) ; le fichier reste sur le disque.
  const remove = useMutation({
    mutationFn: (id: string) => assetsApi.remove(id),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['gallery'] })
      queryClient.invalidateQueries({ queryKey: ['thread'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

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
              className="group relative mb-3 break-inside-avoid overflow-hidden rounded-xl border border-border/40"
            >
              <button
                onClick={() =>
                  setViewing({ asset, prompt: generation?.prompt ?? '' })
                }
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
              <button
                type="button"
                onClick={() => setDeleting(asset)}
                title="Supprimer ce résultat"
                aria-label="Supprimer ce résultat"
                className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition group-hover:opacity-100 hover:bg-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              {generation && (
                <Link
                  to="/t/$threadId"
                  params={{ threadId: generation.threadId }}
                  className={cn(
                    'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pt-6 pb-2 text-[11px] text-white/90 opacity-0 transition group-hover:opacity-100',
                  )}
                >
                  <span className="line-clamp-2">
                    {generation.prompt || '(sans prompt)'}
                  </span>
                  <span className="text-white/60">
                    {getFamily(generation.family)?.label}
                  </span>
                </Link>
              )}
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
        asset={viewing?.asset ?? null}
        onClose={() => setViewing(null)}
        assets={items.map((i) => i.asset)}
        onNavigate={(asset) => setViewing({ asset, prompt: items.find((i) => i.asset.id === asset.id)?.generation?.prompt ?? '' })}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Supprimer ce résultat ?"
        description="Il sera retiré de la galerie et de son fil. Le fichier reste dans ton dossier local."
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  )
}
