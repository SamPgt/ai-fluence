import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Brush, ChevronLeft, ChevronRight, Download, Wand2, X } from 'lucide-react'
import type { Asset } from '@ai-fluence/shared'

import { catalogQuery } from '@/lib/queries'
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog'
import { AutofixEditor } from './AutofixEditor'
import { RetouchEditor } from './RetouchEditor'

/** Modèles qui savent retoucher au pinceau (cf. `retouch.service.ts` côté backend). */
const RETOUCH_FAMILIES = ['local/flux2-klein-9b', 'local/flux2-klein-4b']

const NAV =
  'fixed top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:pointer-events-none disabled:opacity-0'

/**
 * Visionneuse plein écran : le média seul, sur fond noir. Clic à côté ou Échap pour fermer.
 * Avec `onPrev` / `onNext` : chevrons fixes sur les bords de l'écran et flèches du clavier.
 */
export function MediaViewer({
  asset,
  onClose,
  onPrev,
  onNext,
}: {
  asset: Asset | null
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
}) {
  // Retouche au pinceau : possible si klein tourne en local.
  const { data: catalog } = useQuery(catalogQuery())
  const canRetouch = RETOUCH_FAMILIES.some((id) => catalog?.families.find((f) => f.id === id)?.available)
  // Mode d'édition : retouche au pinceau ou correction automatique (visages, mains, pieds).
  const [editing, setEditing] = useState<'brush' | 'autofix' | null>(null)
  const retouching = editing !== null
  useEffect(() => setEditing(null), [asset?.id])

  // Flèches du clavier pour passer d'un média à l'autre (pas pendant la retouche).
  useEffect(() => {
    if (!asset || retouching || (!onPrev && !onNext)) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') onPrev?.()
      if (e.key === 'ArrowRight') onNext?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [asset, retouching, onPrev, onNext])

  return (
    <Dialog open={Boolean(asset)} onOpenChange={(v) => !v && onClose()}>
      <DialogPortal>
        <DialogOverlay className="bg-black/90 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center px-20 py-6 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">
            Aperçu
          </DialogPrimitive.Title>
          {asset && editing === 'brush' && <RetouchEditor asset={asset} onDone={onClose} onCancel={() => setEditing(null)} />}
          {asset && editing === 'autofix' && <AutofixEditor asset={asset} onDone={onClose} onCancel={() => setEditing(null)} />}
          {asset && !retouching && (
            <>
              <div
                className="absolute top-4 right-4 flex gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                {canRetouch && asset.mediaType === 'image' && (
                  <button
                    type="button"
                    onClick={() => setEditing('autofix')}
                    className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/20"
                    title="Repérer les visages, mains et pieds et refaire ceux qui sont ratés"
                  >
                    <Wand2 className="h-4 w-4" /> Corriger
                  </button>
                )}
                {canRetouch && asset.mediaType === 'image' && (
                  <button
                    type="button"
                    onClick={() => setEditing('brush')}
                    className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/20"
                    title="Peindre une zone ratée (une main…) et la faire refaire"
                  >
                    <Brush className="h-4 w-4" /> Retoucher
                  </button>
                )}
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
              {/* Chevrons fixes sur les bords : ils ne bougent pas quelle que soit la taille de l'image. */}
              {(onPrev || onNext) && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onPrev?.()
                    }}
                    disabled={!onPrev}
                    aria-label="Précédente"
                    className={`${NAV} left-4`}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onNext?.()
                    }}
                    disabled={!onNext}
                    aria-label="Suivante"
                    className={`${NAV} right-4`}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
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
