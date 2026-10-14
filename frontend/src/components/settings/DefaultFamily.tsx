/** Choix d'un modèle par défaut (photo ou vidéo) ; vide = celui de l'app. */
import { APP_DEFAULT_FAMILY, getFamily, type MediaKind } from '@ai-fluence/shared'

import { ModelField } from '@/components/composer/ModelField'
import { Label } from '@/components/ui/label'

export function DefaultFamily({
  media,
  value,
  onChange,
}: {
  media: MediaKind
  value: string | null
  onChange: (v: string | null) => void
}) {
  const auto = getFamily(APP_DEFAULT_FAMILY[media])?.label
  return (
    <div className="space-y-1.5">
      <Label>{media === 'image' ? 'Photo' : 'Vidéo'}</Label>
      <ModelField
        media={media}
        value={value}
        onChange={onChange}
        emptyLabel={auto ? `Automatique (${auto})` : 'Automatique'}
      />
    </div>
  )
}
