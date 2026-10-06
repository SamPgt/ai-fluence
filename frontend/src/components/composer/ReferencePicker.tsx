import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Library, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { Asset, Persona } from '@ai-fluence/shared'

import { assetsApi } from '@/lib/api'
import { qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function AssetThumb({ asset, className }: { asset: Asset; className?: string }) {
  return asset.mediaType === 'video' ? (
    <video src={asset.url} muted playsInline preload="metadata" className={cn('object-cover', className)} />
  ) : (
    <img src={asset.url} alt="" loading="lazy" className={cn('object-cover', className)} />
  )
}

/** Bibliothèque de références du persona : un clic pour l'ajouter au composer. */
export function ReferencePicker({
  persona,
  selectedIds,
  onToggle,
}: {
  persona: Persona
  selectedIds: string[]
  onToggle: (asset: Asset) => void
}) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const { data: refs = [], isLoading } = useQuery({
    queryKey: qk.references(persona.id),
    queryFn: () => assetsApi.references(persona.id).then((r) => r.assets),
  })

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files)) await assetsApi.upload(f, { personaId: persona.id, isReference: true })
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
          title={`Références de ${persona.name}`}
        >
          <Library className="h-3.5 w-3.5" />
          Réf. {persona.name}
          {persona.referenceCount > 0 && <span className="text-muted-foreground">({persona.referenceCount})</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[340px] space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Références de {persona.name}</span>
          <Link
            to="/personas/$personaId"
            params={{ personaId: persona.id }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Gérer
          </Link>
        </div>
        <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto">
          {refs.map((a) => {
            const selected = selectedIds.includes(a.id)
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onToggle(a)}
                className={cn(
                  'relative aspect-square overflow-hidden rounded-md ring-2 transition',
                  selected ? 'ring-violet-400' : 'ring-transparent hover:ring-border',
                )}
              >
                <AssetThumb asset={a} className="h-full w-full" />
                {selected && (
                  <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500">
                    <Check className="h-3 w-3 text-white" />
                  </span>
                )}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Ajouter à la bibliothèque"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </button>
        </div>
        {!isLoading && refs.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Ajoute 3 à 5 photos du personnage : elles servent de référence aux modèles REF.
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
