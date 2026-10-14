/**
 * « Reformuler » : réécrit le texte en prompt plus visuel.
 * Le bouton a été retiré du composer (bruit visuel, peu utile en français), le code est gardé ici.
 */
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { MediaKind } from '@ai-fluence/shared'

import { promptsApi } from '@/lib/api'
import { composer } from '@/lib/composer-store'

export function useEnhancePrompt(
  prompt: string,
  media: MediaKind,
) {
  return useMutation({
    mutationFn: () =>
      promptsApi.enhance({ prompt, media }).then((r) => r.prompt),
    onSuccess: (next) => {
      composer.setPrompt(next)
      toast.success('Prompt reformulé', {
        action: { label: 'Annuler', onClick: () => composer.setPrompt(prompt) },
      })
    },
    onError: (e) => toast.error((e as Error).message),
  })
}
