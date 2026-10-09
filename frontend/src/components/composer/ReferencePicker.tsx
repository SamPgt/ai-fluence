import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Library, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type {
  Asset,
  ImageInputInfo,
  Persona,
  VideoRefMode,
} from '@ai-fluence/shared'

import { assetsApi } from '@/lib/api'
import { qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/** Miniature non déplaçable : on choisit une image d'un clic, pas en la glissant. */
export function AssetThumb({
  asset,
  className,
}: {
  asset: Asset
  className?: string
}) {
  return asset.mediaType === 'video' ? (
    <video
      src={asset.url}
      muted
      playsInline
      preload="metadata"
      draggable={false}
      className={cn('object-cover', className)}
    />
  ) : (
    <img
      src={asset.url}
      alt=""
      loading="lazy"
      draggable={false}
      className={cn('object-cover select-none', className)}
    />
  )
}

/** Bibliothèque de références du persona : un clic pour l'ajouter au composer. */
export function ReferencePicker({
  persona,
  selectedIds,
  onToggle,
  info,
  refMode,
}: {
  persona: Persona
  selectedIds: string[]
  onToggle: (asset: Asset) => void
  /** Ce que le modèle choisi accepte comme images (max réel lu dans son schéma). */
  info: ImageInputInfo
  /** Vidéo : usage des images (départ ou références), choisi sous la grille. */
  refMode?: { value: VideoRefMode; onChange: (mode: VideoRefMode) => void }
}) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const { data: refs = [], isLoading } = useQuery({
    queryKey: qk.references(persona.id),
    queryFn: () => assetsApi.references(persona.id).then((r) => r.assets),
  })

  // Références de ce persona sélectionnées, et total des images dans le composer.
  const selectedRefs = refs.filter((a) => selectedIds.includes(a.id)).length
  const full = info.max > 0 && selectedIds.length >= info.max
  const label = info.mode === 'edit' ? 'Édition' : 'Réf.'

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files))
        await assetsApi.upload(f, { personaId: persona.id, isReference: true })
      queryClient.invalidateQueries({ queryKey: qk.references(persona.id) })
      queryClient.invalidateQueries({ queryKey: qk.personas })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-3 text-xs transition-colors hover:bg-accent"
          title={
            info.mode === 'edit'
              ? `Image à retoucher, depuis les références de ${persona.name}`
              : `Références de ${persona.name}`
          }
        >
          <Library className="h-3.5 w-3.5" />
          {label}
          {selectedRefs > 0 && (
            <span className="text-muted-foreground">({selectedRefs})</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[340px] space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">
            Références
            {info.max > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                {selectedIds.length} / {info.max}
              </span>
            )}
          </span>
          <Link
            to="/personas/$personaId"
            params={{ personaId: persona.id }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Gérer
          </Link>
        </div>
        {/* Marge intérieure : le contour de sélection n'est plus coupé par la zone de défilement. */}
        <div className="-m-1 grid max-h-72 grid-cols-4 gap-2 overflow-y-auto p-1">
          {refs.map((a) => {
            const selected = selectedIds.includes(a.id)
            const blocked = !selected && full
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => !blocked && onToggle(a)}
                disabled={blocked}
                title={
                  blocked
                    ? `Maximum atteint pour ce modèle (${info.max})`
                    : undefined
                }
                className={cn(
                  'relative aspect-square overflow-hidden rounded-md ring-2 transition disabled:opacity-40',
                  selected
                    ? 'ring-brand'
                    : 'ring-transparent hover:ring-border',
                )}
              >
                <AssetThumb asset={a} className="h-full w-full" />
                {/* Case ronde : vide si non sélectionnée, cochée sinon. */}
                <span
                  className={cn(
                    'absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full',
                    selected
                      ? 'bg-brand'
                      : 'border border-white/80 bg-black/30',
                  )}
                >
                  {selected && (
                    <Check className="h-3 w-3 text-brand-foreground" />
                  )}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Ajouter à la bibliothèque"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </button>
        </div>
        {refMode && (
          <div className="space-y-1.5 border-t border-border/60 pt-3">
            <div className="text-[11px] font-medium text-muted-foreground">
              Utiliser les images comme
            </div>
            <div className="flex h-8 items-center rounded-full border border-border/60 bg-background/40 p-0.5 text-[11px]">
              {(['start-frame', 'reference'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => refMode.onChange(m)}
                  className={cn(
                    'h-full flex-1 rounded-full px-2.5 whitespace-nowrap transition-colors',
                    refMode.value === m
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {m === 'start-frame' ? 'Début / Fin' : 'Références'}
                </button>
              ))}
            </div>
          </div>
        )}
        {!isLoading && refs.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Ajoute 3 à 5 photos du personnage : elles servent de référence aux
            modèles REF.
          </p>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </PopoverContent>
    </Popover>
  )
}
