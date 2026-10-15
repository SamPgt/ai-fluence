/**
 * Champ de formulaire « modèle » : ouvre le même menu que le composer
 * (logos, sections, sous-menus), filtré sur la photo ou la vidéo.
 */
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, X } from 'lucide-react'
import type { MediaKind } from '@sublime/shared'

import { catalogQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { ModelPicker, ProviderLogo } from './ModelPicker'

export function ModelField({
  media,
  value,
  onChange,
  emptyLabel,
  fallbackId,
}: {
  media: MediaKind
  value: string | null
  onChange: (id: string | null) => void
  /** Texte affiché quand aucun modèle n'est choisi. */
  emptyLabel: string
  /** Modèle utilisé quand rien n'est choisi : affiché avec son logo et le badge « par défaut ». */
  fallbackId?: string
}) {
  const { data: catalog } = useQuery(catalogQuery())
  const families = catalog?.families ?? []
  const current = families.find((f) => f.id === value)
  const fallback = current ? undefined : families.find((f) => f.id === fallbackId)
  const shown = current ?? fallback

  return (
    <div className="relative">
      <ModelPicker
        families={families}
        media={media}
        value={value}
        onChange={onChange}
        trigger={
          <button
            type="button"
            className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent/40"
          >
            {shown && <ProviderLogo provider={shown.provider} size="sm" />}
            <span
              className={cn(
                'min-w-0 truncate text-left',
                !shown && 'flex-1 text-muted-foreground',
              )}
            >
              {shown?.label ?? emptyLabel}
            </span>
            {fallback && (
              <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-muted-foreground">
                par défaut
              </span>
            )}
            {shown && <span className="flex-1" />}
            {!current && (
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            )}
          </button>
        }
      />
      {/* Revenir au choix automatique. */}
      {current && (
        <button
          type="button"
          onClick={() => onChange(null)}
          title="Revenir au choix automatique"
          aria-label="Revenir au choix automatique"
          className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
