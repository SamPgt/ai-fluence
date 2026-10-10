/**
 * Champ de formulaire « modèle » : ouvre le même menu que le composer
 * (logos, sections, sous-menus), filtré sur la photo ou la vidéo.
 */
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, X } from 'lucide-react'
import type { MediaKind } from '@ai-fluence/shared'

import { catalogQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { ModelPicker, ProviderLogo } from './ModelPicker'

export function ModelField({
  media,
  value,
  onChange,
  emptyLabel,
}: {
  media: MediaKind
  value: string | null
  onChange: (id: string | null) => void
  /** Texte affiché quand aucun modèle n'est choisi. */
  emptyLabel: string
}) {
  const { data: catalog } = useQuery(catalogQuery())
  const families = catalog?.families ?? []
  const current = families.find((f) => f.id === value)

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
            {current && <ProviderLogo provider={current.provider} size="sm" />}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-left',
                !current && 'text-muted-foreground',
              )}
            >
              {current?.label ?? emptyLabel}
            </span>
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
