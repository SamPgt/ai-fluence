import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Download, X } from 'lucide-react'
import type { Asset } from '@ai-fluence/shared'

import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog'

/** Visionneuse plein écran : le média seul, sur fond noir. Clic à côté ou Échap pour fermer. */
export function MediaViewer({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(asset)} onOpenChange={(v) => !v && onClose()}>
      <DialogPortal>
        <DialogOverlay className="bg-black/90 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onClick={onClose}
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
              {asset.mediaType === 'video' ? (
                <video
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
