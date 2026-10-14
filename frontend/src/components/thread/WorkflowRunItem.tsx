/**
 * Workflow lancé depuis le fil : à droite, la bulle « Workflow · Nom » avec les valeurs
 * saisies ; à gauche, l'état pendant l'exécution (et Stop), puis le résultat final.
 * Les étapes intermédiaires restent dans le workflow (lien « Voir dans le workflow »).
 */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ExternalLink,
  Loader2,
  Square,
  TriangleAlert,
  Workflow as WorkflowIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { undoToast } from '@/lib/undo-toast'
import type { Asset, ThreadWorkflowRun } from '@ai-fluence/shared'

import { workflowsApi } from '@/lib/api'
import { qk } from '@/lib/queries'
import { formatUsd } from '@/lib/format'
import { MediaViewer } from './MediaViewer'
import { ResultMenu } from './GenerationItem'

export function WorkflowRunItem({
  run,
  threadId,
}: {
  run: ThreadWorkflowRun
  threadId: string
}) {
  const queryClient = useQueryClient()
  const [viewing, setViewing] = useState<Asset | null>(null)
  const stop = useMutation({
    mutationFn: () => workflowsApi.stop(run.workflowId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: qk.thread(threadId) }),
    onError: (e) => toast.error(e.message),
  })
  // Supprimer le résultat : masqué tout de suite, « Annuler » le remet.
  const remove = useMutation({
    mutationFn: () => workflowsApi.removeRunResult(run.id),
    onSuccess: () => {
      const refresh = () => {
        queryClient.invalidateQueries({ queryKey: qk.thread(threadId) })
        queryClient.invalidateQueries({ queryKey: ['gallery'] })
        queryClient.invalidateQueries({ queryKey: qk.threadsAll })
      }
      refresh()
      toast.success(
        'Résultat supprimé',
        undoToast(() => workflowsApi.restoreRunResult(run.id).then(refresh)),
      )
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div
      data-testid="workflow-run"
      data-status={run.status}
      className="space-y-3"
    >
      {/* La demande : même présentation que le formulaire (en-tête, champs, images en cartes). */}
      <div className="flex justify-end">
        <div
          data-testid="workflow-run-request"
          className="w-full max-w-md overflow-hidden rounded-2xl rounded-tr-sm bg-secondary/70"
        >
          <div className="flex items-center gap-2.5 border-b border-white/5 px-4 py-2.5">
            <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground">
              {run.coverUrl ? (
                <img
                  src={run.coverUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <WorkflowIcon className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="min-w-0 truncate text-[13px]">
              <span className="text-muted-foreground">Workflow</span>
              <span className="ml-2 font-medium">{run.workflowName}</span>
            </span>
          </div>
          <div className="space-y-3 px-4 py-3">
            {run.inputs.map((input) => (
              <div key={input.nodeId} className="space-y-1.5">
                <div className="text-[12px] text-muted-foreground">
                  {input.label}
                </div>
                {input.text !== undefined && (
                  <p className="text-[14px] whitespace-pre-wrap">
                    {input.text}
                  </p>
                )}
                {input.assets.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setViewing(a)}
                    className="flex w-full items-center gap-3 rounded-xl border border-white/5 bg-black/15 p-1.5 pr-3 text-left hover:bg-black/25"
                  >
                    <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg">
                      <img
                        src={a.url}
                        alt={input.label}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute bottom-0.5 left-0.5 grid h-3.5 min-w-3.5 place-items-center rounded bg-black/70 px-0.5 text-[9px] font-medium text-white tabular-nums">
                        {i + 1}
                      </span>
                    </span>
                    {a.width && a.height && (
                      <span className="text-[12px] text-muted-foreground tabular-nums">
                        {a.width} × {a.height}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Le résultat */}
      <div className="max-w-[85%] space-y-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
          {run.cost && !run.removed && <span>{formatUsd(run.cost)}</span>}
          <Link
            to="/workflows/$workflowId"
            params={{ workflowId: run.workflowId }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" /> Voir dans le workflow
          </Link>
          {run.outputs.length > 0 && !run.removed && (
            <ResultMenu series={false} onRemove={() => remove.mutate()} />
          )}
        </div>
        {run.removed ? (
          <div
            data-testid="removed-result"
            className="flex h-[38px] w-[190px] items-center justify-center rounded-md border border-border/60 bg-white/[0.03] text-xs text-muted-foreground"
          >
            Contenu supprimé
          </div>
        ) : run.status === 'running' ? (
          <div className="flex max-w-md items-center gap-3 rounded-2xl border border-border/50 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="flex-1">Workflow en cours…</span>
            <button
              type="button"
              onClick={() => stop.mutate()}
              disabled={stop.isPending}
              aria-label="Arrêter l’exécution"
              title="Arrêter : les étapes en attente ne partent pas"
              className="grid h-7 w-7 place-items-center rounded-full border border-border/60 bg-popover text-foreground hover:bg-red-500 hover:text-white"
            >
              <Square className="h-2.5 w-2.5 fill-current" />
            </button>
          </div>
        ) : run.outputs.length ? (
          <div className="flex flex-wrap gap-2">
            {run.outputs.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setViewing(a)}
                className="overflow-hidden rounded-2xl border border-border/40 bg-black/20"
              >
                {a.mediaType === 'video' ? (
                  <video
                    src={a.url}
                    muted
                    playsInline
                    loop
                    autoPlay
                    className="max-h-[50vh] max-w-full"
                  />
                ) : (
                  <img
                    src={a.url}
                    alt="Résultat du workflow"
                    className="max-h-[50vh] max-w-full"
                  />
                )}
              </button>
            ))}
          </div>
        ) : (
          <div
            role="alert"
            className="flex max-w-md items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            <span>
              {run.status === 'stopped'
                ? 'Exécution arrêtée.'
                : (run.errorMessage ??
                  'Le workflow n’a produit aucun résultat final.')}
            </span>
          </div>
        )}
      </div>
      <MediaViewer asset={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}
