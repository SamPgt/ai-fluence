/**
 * Contextes : textes activables d'un clic dans le composer, ajoutés à la fin du prompt.
 * Chaque contexte peut être masqué (interrupteur) sans être supprimé.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, SquarePen, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { MediaKind, PromptPreset } from '@ai-fluence/shared'

import { presetsApi } from '@/lib/api'
import { presetsQuery, qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

type Media = MediaKind | 'all'

const MEDIA_LABEL: Record<Media, string> = {
  all: 'Photo · Vidéo',
  image: 'Photo',
  video: 'Vidéo',
}

function toMedia(photo: boolean, video: boolean): Media {
  return photo && video ? 'all' : photo ? 'image' : 'video'
}

/** Modale de création et de modification d'un contexte. */
function ShortcutDialog({
  open,
  shortcut,
  onOpenChange,
}: {
  open: boolean
  /** Contexte à modifier, ou `null` pour en créer un. */
  shortcut: PromptPreset | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('')
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState(true)
  const [video, setVideo] = useState(true)

  useEffect(() => {
    if (!open) return
    setLabel(shortcut?.label ?? '')
    setText(shortcut?.text ?? '')
    setPhoto(!shortcut || shortcut.media !== 'video')
    setVideo(!shortcut || shortcut.media !== 'image')
  }, [open, shortcut])

  const save = useMutation({
    mutationFn: () => {
      const body = {
        label: label.trim(),
        text: text.trim(),
        media: toMedia(photo, video),
      }
      return shortcut
        ? presetsApi.update(shortcut.id, body)
        : presetsApi.create(body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.presets })
      onOpenChange(false)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const valid = label.trim() && text.trim() && (photo || video)
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (valid) save.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {shortcut ? 'Modifier le contexte' : 'Nouveau contexte'}
          </DialogTitle>
          <DialogDescription>
            Activé dans le composer, son texte est ajouté à la fin du prompt, après le tien.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="shortcut-label">Nom</Label>
            <Input
              id="shortcut-label"
              placeholder="ex. Lumière dorée"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={40}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shortcut-text">Texte</Label>
            <Textarea
              id="shortcut-text"
              rows={4}
              placeholder="ex. golden hour lighting, warm tones, soft shadows"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Proposé pour</Label>
            <div className="flex gap-4">
              {(
                [
                  { checked: photo, set: setPhoto, label: 'Photo' },
                  { checked: video, set: setVideo, label: 'Vidéo' },
                ] as const
              ).map((o) => (
                <label
                  key={o.label}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={o.checked}
                    onChange={(e) => o.set(e.target.checked)}
                    className="h-4 w-4 accent-brand"
                  />
                  {o.label}
                </label>
              ))}
            </div>
            {!photo && !video && (
              <p className="text-xs text-amber-300">
                Coche au moins Photo ou Vidéo.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={!valid || save.isPending}
              className="brand-gradient hover:opacity-90"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {shortcut ? 'Enregistrer' : 'Ajouter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ShortcutRow({
  shortcut,
  onEdit,
}: {
  shortcut: PromptPreset
  onEdit: () => void
}) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.presets })

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      presetsApi.update(shortcut.id, { enabled }),
    // Bascule immédiate dans l'UI, resynchronisée ensuite.
    onMutate: (enabled) =>
      queryClient.setQueryData<PromptPreset[]>(qk.presets, (list) =>
        list?.map((p) => (p.id === shortcut.id ? { ...p, enabled } : p)),
      ),
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: () => presetsApi.remove(shortcut.id),
    onSuccess: refresh,
  })

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border border-border/60 px-3 py-2.5 transition-opacity',
        !shortcut.enabled && 'opacity-50',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{shortcut.label}</span>
          <span className="rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {MEDIA_LABEL[shortcut.media]}
          </span>
        </div>
        <p className="mt-1 line-clamp-3 text-xs whitespace-pre-wrap text-muted-foreground">
          {shortcut.text}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        <Switch
          checked={shortcut.enabled}
          onCheckedChange={(v) => toggle.mutate(v)}
          aria-label={
            shortcut.enabled
              ? 'Masquer du composer'
              : 'Afficher dans le composer'
          }
          title={
            shortcut.enabled ? 'Affiché dans le composer' : 'Masqué du composer'
          }
          className="mr-1"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={onEdit}
          aria-label="Modifier"
        >
          <SquarePen className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setConfirming(true)}
          aria-label="Supprimer"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Supprimer « ${shortcut.label} » ?`}
        description="Pour simplement le cacher du composer, utilise plutôt l’interrupteur."
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}

export function ContextsTab() {
  const { data: shortcuts = [] } = useQuery(presetsQuery())
  const [editing, setEditing] = useState<PromptPreset | null>(null)
  const [open, setOpen] = useState(false)

  const openDialog = (s: PromptPreset | null) => {
    setEditing(s)
    setOpen(true)
  }

  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-card/50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Contextes</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Affichés au-dessus du chat : la sélection ajoute le texte
            correspondant à la fin du prompt. L’interrupteur les masque sans
            les supprimer.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => openDialog(null)}
          className="shrink-0 brand-gradient hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Nouveau
        </Button>
      </div>
      <div className="space-y-2">
        {shortcuts.map((s) => (
          <ShortcutRow key={s.id} shortcut={s} onEdit={() => openDialog(s)} />
        ))}
        {shortcuts.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Aucun contexte pour l’instant.
          </p>
        )}
      </div>
      <ShortcutDialog open={open} shortcut={editing} onOpenChange={setOpen} />
    </section>
  )
}
