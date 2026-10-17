import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Layers, Library, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type {
  Asset,
  ImageInputInfo,
  Persona,
  VideoRefMode,
} from '@sublime/shared'

import { assetsApi } from '@/lib/api'
import { qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { PersonaAvatar } from '@/components/personas/PersonaAvatar'
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

/** Propriétaire d'une section : un persona, ou Général (`general`). */
type Owner = { id: string; name: string; persona: Persona | null }

/**
 * Références du composer : une section par persona (avec son titre), puis Général.
 * Un clic ajoute ou retire l'image de la demande.
 */
export function ReferencePicker({
  personas,
  selectedIds,
  onToggle,
  info,
  refMode,
}: {
  personas: Persona[]
  selectedIds: string[]
  onToggle: (asset: Asset) => void
  /** Ce que le modèle choisi accepte comme images (max réel lu dans son schéma). */
  info: ImageInputInfo
  /** Vidéo : usage des images (départ ou références), choisi sous la grille. */
  refMode?: { value: VideoRefMode; onChange: (mode: VideoRefMode) => void }
}) {
  const owners: Owner[] = [
    ...personas.map((p) => ({ id: p.id, name: p.name, persona: p })),
    { id: 'general', name: 'Général', persona: null },
  ]
  const selected = selectedIds.length
  const label = info.mode === 'edit' ? 'Édition' : 'Réf.'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] text-foreground/80 shadow-[inset_0_0_0_1px_var(--color-border)] transition-colors hover:bg-accent/60"
          title={
            info.mode === 'edit'
              ? 'Image à retoucher, depuis les références'
              : 'Références'
          }
        >
          <Library className="h-3.5 w-3.5" />
          {label}
          {selected > 0 && (
            <span className="text-muted-foreground">({selected})</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[480px] space-y-3">
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
            to="/bibliotheque"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Gérer
          </Link>
        </div>
        {/* Marge intérieure : le contour de sélection n'est plus coupé par la zone de défilement. */}
        <div className="-m-1 max-h-[min(30rem,60vh)] space-y-4 overflow-y-auto p-1 pr-5">
          {owners.map((o) => (
            <ReferenceSection
              key={o.id}
              owner={o}
              selectedIds={selectedIds}
              full={info.max > 0 && selectedIds.length >= info.max}
              max={info.max}
              onToggle={onToggle}
            />
          ))}
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
      </PopoverContent>
    </Popover>
  )
}

/** Titre (persona ou Général) puis sa grille, avec « + » pour importer dans cette section. */
function ReferenceSection({
  owner,
  selectedIds,
  full,
  max,
  onToggle,
}: {
  owner: Owner
  selectedIds: string[]
  full: boolean
  max: number
  onToggle: (asset: Asset) => void
}) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const { data: refs = [] } = useQuery({
    queryKey: qk.references(owner.id),
    queryFn: () => assetsApi.references(owner.id).then((r) => r.assets),
  })

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files))
        await assetsApi.upload(f, {
          personaId: owner.persona?.id,
          isReference: true,
        })
      queryClient.invalidateQueries({ queryKey: qk.references(owner.id) })
      queryClient.invalidateQueries({ queryKey: qk.personas })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <section aria-label={`Références : ${owner.name}`} className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium">
        {owner.persona ? (
          <PersonaAvatar
            persona={owner.persona}
            size={18}
            className="rounded-md"
          />
        ) : (
          <span className="grid h-[18px] w-[18px] place-items-center rounded-md bg-muted text-muted-foreground">
            <Layers className="h-3 w-3" />
          </span>
        )}
        {owner.name}
        <span className="ml-auto font-normal text-muted-foreground tabular-nums">
          {refs.length}
        </span>
      </div>
      {/* Même taille d'images qu'avant (4 par ligne sur 340 px), plus de colonnes sur la largeur. */}
      <div className="grid grid-cols-6 gap-2">
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
                blocked ? `Maximum atteint pour ce modèle (${max})` : undefined
              }
              className={cn(
                'relative aspect-square overflow-hidden rounded-md ring-2 transition disabled:opacity-40',
                selected ? 'ring-brand' : 'ring-transparent hover:ring-border',
              )}
            >
              <AssetThumb asset={a} className="h-full w-full" />
              {/* Case ronde : vide si non sélectionnée, cochée sinon. */}
              <span
                className={cn(
                  'absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full',
                  // Cochée : blanc adouci (ni gris terne, ni blanc pur), avec une ombre légère.
                  selected
                    ? 'bg-white/85 shadow-[0_1px_3px_rgba(0,0,0,0.35)] backdrop-blur-sm'
                    : 'border border-white/80 bg-black/30',
                )}
              >
                {selected && (
                  <Check className="h-3 w-3 text-neutral-900" strokeWidth={2.75} />
                )}
              </span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent hover:text-foreground"
          title={`Ajouter aux références : ${owner.name}`}
          aria-label={`Ajouter aux références : ${owner.name}`}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
    </section>
  )
}
