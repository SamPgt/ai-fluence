import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageUpscale, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Asset, PriceChangedResponse } from '@ai-fluence/shared'

import { ApiError, generationsApi } from '@/lib/api'
import { qk } from '@/lib/queries'
import { formatUnit, formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AssetThumb } from '@/components/composer/ReferencePicker'

/** Paliers proposés (schémas SpicyAPI des upscalers image et vidéo). */
const RESOLUTIONS: Record<'image' | 'video', { value: string; hint: string }[]> = {
  image: [
    { value: '2k', hint: '≈ 4 Mpx' },
    { value: '4k', hint: '≈ 17 Mpx' },
    { value: '8k', hint: '≈ 67 Mpx' },
  ],
  video: [
    { value: '720p', hint: 'HD' },
    { value: '1080p', hint: 'Full HD' },
    { value: '2k', hint: '1440p' },
    { value: '4k', hint: 'UHD' },
  ],
}

const DEFAULT: Record<'image' | 'video', string> = { image: '4k', video: '1080p' }

export function UpscaleDialog({
  asset,
  threadId,
  onClose,
}: {
  asset: Asset | null
  threadId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const media = asset?.mediaType ?? 'image'
  const [resolution, setResolution] = useState<string | null>(null)
  const current = resolution ?? DEFAULT[media]

  const quote = useQuery({
    queryKey: ['upscale-quote', asset?.id, current],
    queryFn: () => generationsApi.upscaleQuote({ assetId: asset!.id, resolution: current }).then((r) => r.quote),
    enabled: Boolean(asset),
    staleTime: 4 * 60_000,
    retry: false,
  })

  const create = useMutation({
    mutationFn: () =>
      generationsApi.upscale({ assetId: asset!.id, resolution: current, expectedCost: quote.data!.estimatedCost }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.thread(threadId) })
      queryClient.invalidateQueries({ queryKey: qk.threadsAll })
      queryClient.invalidateQueries({ queryKey: qk.balance })
      close()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as PriceChangedResponse
        queryClient.setQueryData(['upscale-quote', asset?.id, current], body.quote)
        toast.warning(`Le prix a changé : ${formatUsd(body.quote.estimatedCost)}. Reclique pour confirmer.`)
        return
      }
      toast.error((err as Error).message)
    },
  })

  const close = () => {
    setResolution(null)
    onClose()
  }

  return (
    <Dialog open={Boolean(asset)} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upscale {media === 'video' ? 'de la vidéo' : 'de l’image'}</DialogTitle>
          <DialogDescription>
            Agrandit et affine le résultat sans changer le cadrage. Le nouveau fichier arrive dans le fil.
          </DialogDescription>
        </DialogHeader>

        {asset && (
          <div className="flex gap-4">
            <AssetThumb asset={asset} className="h-24 w-24 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <div className="text-xs text-muted-foreground">Résolution de sortie</div>
              <div className="grid grid-cols-2 gap-1.5">
                {RESOLUTIONS[media].map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setResolution(r.value)}
                    className={cn(
                      'flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm transition-colors',
                      current === r.value ? 'border-brand/70 bg-brand/10' : 'border-border hover:bg-accent',
                    )}
                  >
                    <span className="font-medium">{r.value}</span>
                    <span className="text-[11px] text-muted-foreground">{r.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {quote.error && <p className="text-sm text-destructive-foreground">{(quote.error as Error).message}</p>}

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground tabular-nums">
            {quote.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : quote.data ? (
              <>
                ≈ <span className="text-foreground">{formatUsd(quote.data.estimatedCost)}</span>
                {media === 'video' && <> · {formatUnit(quote.data.unit, quote.data.quantity)}</>}
              </>
            ) : null}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close} disabled={create.isPending}>
              Annuler
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!quote.data || quote.isFetching || create.isPending}
              variant="outline"
            >
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUpscale className="h-4 w-4" />}
              Upscaler
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
