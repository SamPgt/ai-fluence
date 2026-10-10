import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { getFamily, type GenerationRequest, type PriceChangedResponse } from '@ai-fluence/shared'

import { ApiError, generationsApi } from '@/lib/api'
import { qk } from '@/lib/queries'
import { formatUnit, formatUsd } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Relance directe d'une demande (même modèle ou un autre), après confirmation du prix. */
export function RelaunchDialog({ request, onClose }: { request: GenerationRequest | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const label = request ? (getFamily(request.family)?.label ?? request.family) : ''

  const quote = useQuery({
    queryKey: ['relaunch-quote', request ? JSON.stringify(request) : null],
    queryFn: () => generationsApi.quote(request!).then((r) => r.quote),
    enabled: Boolean(request),
    staleTime: 4 * 60_000,
    retry: false,
  })

  const create = useMutation({
    mutationFn: () => generationsApi.create({ ...request!, expectedCost: quote.data!.estimatedCost }),
    onSuccess: ({ thread }) => {
      queryClient.invalidateQueries({ queryKey: qk.thread(thread.id) })
      queryClient.invalidateQueries({ queryKey: qk.threadsAll })
      queryClient.invalidateQueries({ queryKey: qk.balance })
      onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as PriceChangedResponse
        queryClient.setQueryData(['relaunch-quote', JSON.stringify(request)], body.quote)
        toast.warning(`Le prix a changé : ${formatUsd(body.quote.estimatedCost)}. Reclique pour confirmer.`)
        return
      }
      toast.error((err as Error).message)
    },
  })

  return (
    <Dialog open={Boolean(request)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Relancer avec {label} ?</DialogTitle>
          <DialogDescription>
            Même prompt, mêmes références, nouveau seed. Le résultat arrive à la suite du fil.
          </DialogDescription>
        </DialogHeader>
        {quote.error && <p className="text-sm text-destructive-foreground">{(quote.error as Error).message}</p>}
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground tabular-nums">
            {quote.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : quote.data ? (
              <>
                ≈ <span className="text-foreground">{formatUsd(quote.data.estimatedCost)}</span> ·{' '}
                {formatUnit(quote.data.unit, quote.data.quantity)}
              </>
            ) : null}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
              Annuler
            </Button>
            <Button
              autoFocus
              onClick={() => create.mutate()}
              disabled={!quote.data || quote.isFetching || create.isPending}
              variant="outline"
            >
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Relancer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
