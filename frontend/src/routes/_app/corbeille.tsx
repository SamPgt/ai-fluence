import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageIcon, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { trashApi } from '@/lib/api'
import { qk } from '@/lib/queries'
import { PageHeader } from '@/components/layout/PageHeader'
import { PersonaAvatar } from '@/components/personas/PersonaAvatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export const Route = createFileRoute('/_app/corbeille')({
  component: TrashPage,
})

/** Mot à saisir pour une suppression définitive. */
const CONFIRM_WORD = 'confirmer'

/** Textes de l'écran. */
const TEXT = {
  pageTitle: 'Corbeille',
  intro: (days: number) =>
    `Tout élément supprimé est conservé ici pendant ${days} jours. Ensuite, il est supprimé définitivement.`,
  empty: 'La corbeille est vide.',
  groupPersonas: 'Personas',
  groupThreads: 'Fils',
  restore: 'Restaurer',
  restored: (name: string) => `${name} restauré`,
  purge: 'Supprimer définitivement',
  purgeTitle: (name: string) => `Supprimer définitivement « ${name} » ?`,
  purgeDescription:
    'Cette suppression est définitive. Pour continuer, écris « confirmer ».',
  emptyTrash: 'Vider la corbeille',
  emptyTrashTitle: 'Vider la corbeille ?',
  emptyTrashDescription:
    'Tout le contenu de la corbeille sera supprimé définitivement. Pour continuer, écris « confirmer ».',
  emptied: 'Corbeille vidée',
  cancel: 'Annuler',
  confirmInputLabel: 'Écris confirmer',
  threadCount: (n: number) => (n > 1 ? `${n} fils` : `${n} fil`),
  purgeToday: 'Supprimé définitivement aujourd’hui',
  purgeIn: (days: number) =>
    days > 1
      ? `Supprimé définitivement dans ${days} jours`
      : 'Supprimé définitivement dans 1 jour',
}

/** « dans 3 jours », « aujourd’hui »… */
function remaining(purgeAt: string): string {
  const days = Math.ceil(
    (new Date(purgeAt).getTime() - Date.now()) / 86_400_000,
  )
  return days <= 0 ? TEXT.purgeToday : TEXT.purgeIn(days)
}

type Target = { kind: 'persona' | 'thread'; id: string; name: string }

function TrashPage() {
  const queryClient = useQueryClient()
  const { data, isPending } = useQuery({
    queryKey: qk.trash,
    queryFn: trashApi.list,
  })
  const [purging, setPurging] = useState<Target | null>(null)
  const [emptying, setEmptying] = useState(false)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.trash })
    queryClient.invalidateQueries({ queryKey: qk.personas })
    queryClient.invalidateQueries({ queryKey: qk.threadsAll })
  }
  const onError = (e: Error) => toast.error(e.message)

  const restore = useMutation({
    mutationFn: (t: Target) =>
      t.kind === 'persona'
        ? trashApi.restorePersona(t.id)
        : trashApi.restoreThread(t.id),
    onSuccess: (_, t) => {
      refresh()
      toast.success(TEXT.restored(t.name))
    },
    onError,
  })
  const purge = useMutation({
    mutationFn: (t: Target) =>
      t.kind === 'persona'
        ? trashApi.purgePersona(t.id)
        : trashApi.purgeThread(t.id),
    onSuccess: () => {
      setPurging(null)
      refresh()
    },
    onError,
  })
  const empty = useMutation({
    mutationFn: trashApi.empty,
    onSuccess: () => {
      setEmptying(false)
      refresh()
      toast.success(TEXT.emptied)
    },
    onError,
  })

  const personas = data?.personas ?? []
  const threads = data?.threads ?? []
  const isEmpty = personas.length === 0 && threads.length === 0

  return (
    <>
      <PageHeader
        right={
          !isEmpty && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEmptying(true)}
            >
              <Trash2 className="h-4 w-4" /> {TEXT.emptyTrash}
            </Button>
          )
        }
      >
        <span className="text-sm font-medium">{TEXT.pageTitle}</span>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[810px] space-y-6 px-6 py-6">
          <p className="text-sm text-muted-foreground">
            {TEXT.intro(data?.days ?? 7)}
          </p>

          {isPending ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          ) : isEmpty ? (
            <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-border/60 py-16 text-sm text-muted-foreground">
              <Trash2 className="h-5 w-5" />
              {TEXT.empty}
            </div>
          ) : (
            <>
              {personas.length > 0 && (
                <Group title={TEXT.groupPersonas}>
                  {personas.map((p) => {
                    const target: Target = {
                      kind: 'persona',
                      id: p.id,
                      name: p.name,
                    }
                    return (
                      <Row
                        key={p.id}
                        media={
                          <PersonaAvatar
                            persona={p}
                            size={40}
                            className="rounded-lg"
                          />
                        }
                        title={p.name}
                        subtitle={`${TEXT.threadCount(p.threadCount)} · ${remaining(p.purgeAt)}`}
                        restoring={
                          restore.isPending && restore.variables?.id === p.id
                        }
                        onRestore={() => restore.mutate(target)}
                        onPurge={() => setPurging(target)}
                      />
                    )
                  })}
                </Group>
              )}
              {threads.length > 0 && (
                <Group title={TEXT.groupThreads}>
                  {threads.map((t) => {
                    const target: Target = {
                      kind: 'thread',
                      id: t.id,
                      name: t.title,
                    }
                    return (
                      <Row
                        key={t.id}
                        media={
                          t.coverUrl ? (
                            <img
                              src={t.coverUrl}
                              alt=""
                              className="h-10 w-10 rounded-lg object-cover"
                            />
                          ) : (
                            <span className="grid h-10 w-10 place-items-center rounded-lg bg-muted text-muted-foreground">
                              <ImageIcon className="h-4 w-4" />
                            </span>
                          )
                        }
                        title={t.title}
                        subtitle={`${t.personaName ? `${t.personaName} · ` : ''}${remaining(t.purgeAt)}`}
                        restoring={
                          restore.isPending && restore.variables?.id === t.id
                        }
                        onRestore={() => restore.mutate(target)}
                        onPurge={() => setPurging(target)}
                      />
                    )
                  })}
                </Group>
              )}
            </>
          )}
        </div>
      </div>

      <TypedConfirmDialog
        open={Boolean(purging)}
        onOpenChange={(o) => !o && setPurging(null)}
        title={TEXT.purgeTitle(purging?.name ?? '')}
        description={TEXT.purgeDescription}
        confirmLabel={TEXT.purge}
        pending={purge.isPending}
        onConfirm={() => purging && purge.mutate(purging)}
      />
      <TypedConfirmDialog
        open={emptying}
        onOpenChange={setEmptying}
        title={TEXT.emptyTrashTitle}
        description={TEXT.emptyTrashDescription}
        confirmLabel={TEXT.emptyTrash}
        pending={empty.isPending}
        onConfirm={() => empty.mutate()}
      />
    </>
  )
}

function Group({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-medium text-muted-foreground">
        {title}
      </h2>
      <div className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card/50">
        {children}
      </div>
    </section>
  )
}

function Row({
  media,
  title,
  subtitle,
  restoring,
  onRestore,
  onPurge,
}: {
  media: React.ReactNode
  title: string
  subtitle: string
  restoring: boolean
  onRestore: () => void
  onPurge: () => void
}) {
  return (
    <div data-testid="trash-row" className="flex items-center gap-3 px-4 py-3">
      <div className="shrink-0">{media}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRestore}
        disabled={restoring}
      >
        {restoring ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RotateCcw className="h-4 w-4" />
        )}
        {TEXT.restore}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onPurge}
        aria-label={TEXT.purge}
        title={TEXT.purge}
        className="text-muted-foreground hover:text-red-400"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}

/** Suppression définitive : on demande de saisir « confirmer ». */
function TypedConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  pending: boolean
  onConfirm: () => void
}) {
  const [word, setWord] = useState('')
  // Champ vide à chaque ouverture, même après une suppression réussie.
  useEffect(() => {
    if (open) setWord('')
  }, [open])
  const ok = word.trim().toLowerCase() === CONFIRM_WORD
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setWord('')
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (ok) onConfirm()
          }}
          className="space-y-4"
        >
          <Input
            autoFocus
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder={CONFIRM_WORD}
            aria-label={TEXT.confirmInputLabel}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {TEXT.cancel}
            </Button>
            <Button
              type="submit"
              disabled={!ok || pending}
              variant="primary"
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
