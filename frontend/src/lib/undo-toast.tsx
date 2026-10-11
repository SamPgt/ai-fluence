/**
 * Action « annuler » des notifications de suppression : une simple flèche
 * (sens inverse des aiguilles), sans texte, de la couleur du texte du toast.
 */
import { RotateCcw } from 'lucide-react'
import type { ExternalToast } from 'sonner'

export function undoToast(onUndo: () => void): ExternalToast {
  return {
    action: {
      // Nom accessible « Annuler » (lecteurs d'écran, tests), sans texte visible.
      label: (
        <span aria-label="Annuler" title="Annuler" className="grid place-items-center">
          <RotateCcw className="size-4" />
        </span>
      ),
      onClick: onUndo,
    },
    actionButtonStyle: {
      background: 'transparent',
      color: 'inherit',
      padding: '0 4px',
      height: 24,
    },
  }
}
