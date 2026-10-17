/**
 * Modifier un workflow : son titre et sa couverture (image importée, ou un de ses
 * résultats). Sans couverture choisie, la liste montre la dernière image produite.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageIcon, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { WORKFLOW_LIMITS, type WorkflowSummary } from '@sublime/shared'

import { assetsApi, workflowsApi } from '@/lib/api'
import { qk } from '@/lib/queries'
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
import { Input } from '@/components/ui/input'

const mediaUrl = (id: string) => `/api/media/${id}`

export function EditWorkflowDialog({
  workflow,
  onClose,
}: {
  workflow: WorkflowSummary | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  /** Couverture choisie : un média, ou null (dernière image produite). */
  const [cover, setCover] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (!workflow) return
    setName(workflow.name)
    setCover(workflow.coverAssetId)
  }, [workflow])

  // Résultats du workflow : on peut en choisir un comme couverture.
  const { data: state } = useQuery({
    queryKey: qk.workflowState(workflow?.id ?? ''),
    queryFn: () => workflowsApi.state(workflow!.id),
    enabled: Boolean(workflow),
  })
  const outputs = [
    ...new Map(
      (state?.results ?? [])
        .flatMap((r) => r.generation?.outputs ?? [])
        .filter((a) => a.mediaType === 'image')
        .map((a) => [a.id, a]),
    ).values(),
  ].slice(0, 12)

  const save = useMutation({
    mutationFn: () => workflowsApi.update(workflow!.id, { name: name.trim(), coverAssetId: cover }),
    onSuccess: ({ workflow: w }) => {
      queryClient.invalidateQueries({ queryKey: qk.workflows })
      queryClient.setQueryData(qk.workflow(w.id), w)
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  const upload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      setCover((await assetsApi.upload(file)).asset.id)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  // Aperçu : la couverture choisie, sinon ce que la liste affichera (dernière image produite).
  const preview = cover ? mediaUrl(cover) : (outputs[0]?.url ?? null)

  return (
    <Dialog open={Boolean(workflow)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modifier le workflow</DialogTitle>
          <DialogDescription>Son titre et sa couverture dans la liste des workflows.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) save.mutate()
          }}
        >
          <Input
            aria-label="Titre du workflow"
            value={name}
            maxLength={WORKFLOW_LIMITS.nameLength}
            onChange={(e) => setName(e.target.value)}
            placeholder="Titre du workflow"
          />

          <div className="space-y-2">
            <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-border/60 bg-muted/30">
              {preview ? (
                <img src={preview} alt="Couverture" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-muted-foreground">
                  <ImageIcon className="h-6 w-6" />
                </div>
              )}
              {!cover && preview && (
                <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white/90">
                  Dernière image produite
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  void upload(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Importer une couverture
              </Button>
              {cover && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setCover(null)}>
                  Retirer la couverture
                </Button>
              )}
            </div>
            {outputs.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs text-muted-foreground">Ou un résultat du workflow :</p>
                <div className="grid grid-cols-6 gap-1.5">
                  {outputs.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      aria-pressed={cover === a.id}
                      aria-label="Utiliser ce résultat comme couverture"
                      onClick={() => setCover(a.id)}
                      className={cn(
                        'aspect-square overflow-hidden rounded-md border-2 transition',
                        cover === a.id ? 'border-sky-400' : 'border-transparent opacity-70 hover:opacity-100',
                      )}
                    >
                      <img src={a.url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              Annuler
            </Button>
            <Button type="submit" variant="outline" disabled={!name.trim() || save.isPending || uploading}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
