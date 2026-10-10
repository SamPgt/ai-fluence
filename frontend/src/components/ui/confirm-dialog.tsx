import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Modale de confirmation de l'app (remplace `window.confirm`). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Supprimer',
  destructive = true,
  pending = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  destructive?: boolean
  pending?: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          {/* Focus sur Annuler pour une action destructrice : Entrée n'efface jamais par erreur. */}
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            autoFocus={destructive}
          >
            Annuler
          </Button>
          <Button
            onClick={onConfirm}
            disabled={pending}
            autoFocus={!destructive}
            variant={destructive ? 'primary' : 'default'}
            className={destructive ? 'bg-red-600 text-white hover:bg-red-500' : undefined}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
