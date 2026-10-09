import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react'
import type { Asset } from '@ai-fluence/shared'

import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog'

/**
 * Visionneuse plein écran : le média seul, sur fond noir. Clic à côté ou Échap pour fermer.
 * Avec `assets` (les images d'une série, d'un lot…), flèches et touches ← → pour passer de l'une à l'autre.
 */
export function MediaViewer({
  asset,
  onClose,
  assets,
  onNavigate,
}: {
  asset: Asset | null
  onClose: () => void
  assets?: Asset[]
  onNavigate?: (asset: Asset) => void
}) {
  const index = asset && assets ? assets.findIndex((a) => a.id === asset.id) : -1
  const navigable = Boolean(onNavigate && assets && index >= 0 && assets.length > 1)
  const go = (step: number) => {
    if (!navigable) return
    onNavigate!(assets![(index + step + assets!.length) % assets!.length])
  }

  return (
    <Dialog open={Boolean(asset)} onOpenChange={(v) => !v && onClose()}>
      <DialogPortal>
        <DialogOverlay className="bg-black/90 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') go(1)
            else if (e.key === 'ArrowLeft') go(-1)
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-6 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">Aperçu</DialogPrimitive.Title>
          {asset && (
            <>
              <div className="absolute top-4 right-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
                <a
                  href={`${asset.url}?download=1`}
                  className="rounded-full bg-white/10 p-2.5 text-white transition hover:bg-white/20"
                  aria-label="Télécharger"
                >
                  <Download className="h-4 w-4" />
                </a>
                <DialogPrimitive.Close
                  className="rounded-full bg-white/10 p-2.5 text-white transition hover:bg-white/20"
                  aria-label="Fermer"
                >
                  <X className="h-4 w-4" />
                </DialogPrimitive.Close>
              </div>
              {navigable && (
                <>
                  <span className="absolute top-5 left-5 rounded-full bg-white/10 px-3 py-1 text-xs text-white tabular-nums">
                    {index + 1} / {assets!.length}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      go(-1)
                    }}
                    className="absolute top-1/2 left-4 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/25"
                    aria-label="Image précédente (←)"
                    title="Image précédente (←)"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      go(1)
                    }}
                    className="absolute top-1/2 right-4 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/25"
                    aria-label="Image suivante (→)"
                    title="Image suivante (→)"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                </>
              )}
              {asset.mediaType === 'video' ? (
                <video
                  key={asset.id}
                  src={asset.url}
                  controls
                  autoPlay
                  loop
                  onClick={(e) => e.stopPropagation()}
                  className="max-h-full max-w-full rounded-lg"
                />
              ) : (
                <img
                  src={asset.url}
                  alt=""
                  onClick={(e) => e.stopPropagation()}
                  className="max-h-full max-w-full rounded-lg object-contain"
                />
              )}
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
