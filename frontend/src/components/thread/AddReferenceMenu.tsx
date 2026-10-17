/**
 * « Ajouter aux références » : le média devient une référence d'un persona choisi dans le
 * menu, ou de Général. Même bouton (signet) dans un fil et dans la visionneuse.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookmarkPlus } from 'lucide-react'
import { toast } from 'sonner'
import type { Asset } from '@sublime/shared'

import { assetsApi } from '@/lib/api'
import { personasQuery, qk } from '@/lib/queries'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function AddReferenceMenu({
  asset,
  className,
  iconClassName = 'h-3.5 w-3.5',
}: {
  asset: Asset
  /** Style du bouton (celui des boutons voisins). */
  className: string
  iconClassName?: string
}) {
  const queryClient = useQueryClient()
  const { data: personas = [] } = useQuery(personasQuery())
  const toReference = useMutation({
    mutationFn: (owner: { id: string; name: string }) => assetsApi.setReference(asset.id, owner.id, true),
    onSuccess: (_, owner) => {
      toast.success(`Ajoutée aux références : ${owner.name}`)
      queryClient.invalidateQueries({ queryKey: ['references'] })
      queryClient.invalidateQueries({ queryKey: qk.personas })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title="Ajouter aux références" aria-label="Ajouter aux références" className={className}>
          <BookmarkPlus className={iconClassName} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {[...personas, { id: 'general', name: 'Général' }].map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => toReference.mutate(o)} className="text-xs">
            {o.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
