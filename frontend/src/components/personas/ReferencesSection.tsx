/** Références d'un persona ou de Général (fiche du persona, page Général). */
import { useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { type Asset } from '@ai-fluence/shared'
import { assetsApi } from '@/lib/api'
import { qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { AssetThumb } from '@/components/composer/ReferencePicker'
import { MediaViewer } from '@/components/thread/MediaViewer'
import { Card } from './LoraSection'

function SortableReference({
  asset,
  onOpen,
  onRemove,
}: {
  asset: Asset
  onOpen: () => void
  onRemove: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: asset.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group relative aspect-square touch-none overflow-hidden rounded-lg',
        isDragging && 'z-10 opacity-80 shadow-lg',
      )}
      {...attributes}
      {...listeners}
      // Un clic (sans glisser) ouvre l'image en grand.
      onClick={onOpen}
    >
      <AssetThumb asset={asset} className="pointer-events-none h-full w-full" />
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        // La croix ne doit pas déclencher le glisser.
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
        aria-label="Retirer de la bibliothèque"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

/**
 * Références d'un persona, ou de Général (`owner.id` = `general`) : import, glisser-déposer
 * pour l'ordre, visionneuse.
 */
export function ReferencesSection({
  owner,
}: {
  owner: { id: string; name: string }
}) {
  return (
    <Card
      title="Photos de références"
      description="Photos de référence, à joindre aux demandes pour des résultats fidèles."
    >
      <ReferencesGrid
        owner={owner}
        className="grid grid-cols-4 gap-2 sm:grid-cols-6"
      />
    </Card>
  )
}

/**
 * Grille des références : glisser pour l'ordre, clic pour la visionneuse, croix pour retirer,
 * carte « + » pointillée en dernier pour importer.
 */
export function ReferencesGrid({
  owner,
  className,
}: {
  owner: { id: string; name: string }
  /** Mise en page de la grille (colonnes, taille des cartes). */
  className: string
}) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  // Index de la référence ouverte en grand (visionneuse).
  const [viewing, setViewing] = useState<number | null>(null)
  const { data: refs = [] } = useQuery({
    queryKey: qk.references(owner.id),
    queryFn: () => assetsApi.references(owner.id).then((r) => r.assets),
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.references(owner.id) })
    queryClient.invalidateQueries({ queryKey: qk.personas })
  }
  const unref = useMutation({
    mutationFn: (assetId: string) =>
      assetsApi.setReference(assetId, owner.id, false),
    onSuccess: refresh,
  })

  // Glisser-déposer : 5 px avant de démarrer, pour garder le clic sur la croix.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const next = arrayMove(
      refs,
      refs.findIndex((a) => a.id === active.id),
      refs.findIndex((a) => a.id === over.id),
    )
    queryClient.setQueryData(qk.references(owner.id), next)
    assetsApi
      .reorderReferences(
        owner.id,
        next.map((a) => a.id),
      )
      .catch(() =>
        queryClient.invalidateQueries({ queryKey: qk.references(owner.id) }),
      )
  }

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files))
        await assetsApi.upload(f, {
          personaId: owner.id === 'general' ? null : owner.id,
          isReference: true,
        })
      refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <div className={className}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={refs.map((a) => a.id)}
            strategy={rectSortingStrategy}
          >
            {refs.map((a, i) => (
              <SortableReference
                key={a.id}
                asset={a}
                onOpen={() => setViewing(i)}
                onRemove={() => unref.mutate(a.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={`Ajouter aux références : ${owner.name}`}
          title={`Ajouter aux références : ${owner.name}`}
          className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-5 w-5" />
          )}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <MediaViewer
        asset={viewing === null ? null : (refs[viewing] ?? null)}
        onClose={() => setViewing(null)}
        onPrev={
          viewing !== null && viewing > 0
            ? () => setViewing(viewing - 1)
            : undefined
        }
        onNext={
          viewing !== null && viewing < refs.length - 1
            ? () => setViewing(viewing + 1)
            : undefined
        }
      />
    </>
  )
}
