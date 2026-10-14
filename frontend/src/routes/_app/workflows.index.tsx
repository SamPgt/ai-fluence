import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, Plus, Trash2, Workflow } from 'lucide-react'
import { toast } from 'sonner'

import { trashApi, workflowsApi } from '@/lib/api'
import { qk, workflowsQuery } from '@/lib/queries'
import { timeAgo } from '@/lib/format'
import { undoToast } from '@/lib/undo-toast'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { EditWorkflowDialog } from '@/components/workflow/EditWorkflowDialog'
import type { WorkflowSummary } from '@ai-fluence/shared'

export const Route = createFileRoute('/_app/workflows/')({
  component: WorkflowsPage,
})

const nodeCount = (n: number) => (n > 1 ? `${n} nœuds` : `${n} nœud`)
/** « modifié il y a 3 min », « modifié le 12 oct. ». */
const modified = (iso: string) => {
  const t = timeAgo(iso)
  return `modifié ${/^\d/.test(t) ? `le ${t}` : t}`
}

/** Liste des workflows (globaux, tous personas confondus). */
function WorkflowsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: workflows = [], isPending } = useQuery(workflowsQuery())
  const [editing, setEditing] = useState<WorkflowSummary | null>(null)

  const create = useMutation({
    mutationFn: () => workflowsApi.create(),
    onSuccess: ({ workflow }) => {
      queryClient.invalidateQueries({ queryKey: qk.workflows })
      navigate({
        to: '/workflows/$workflowId',
        params: { workflowId: workflow.id },
      })
    },
    onError: (e) => toast.error(e.message),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.workflows })
    queryClient.invalidateQueries({ queryKey: qk.trash })
  }
  const remove = useMutation({
    mutationFn: (id: string) => workflowsApi.remove(id),
    onSuccess: (_, id) => {
      refresh()
      toast.success(
        'Workflow mis à la corbeille',
        undoToast(() => trashApi.restoreWorkflow(id).then(refresh)),
      )
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <>
      <PageHeader
        panel="none"
        right={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => create.mutate()}
            disabled={create.isPending}
          >
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Nouveau workflow
          </Button>
        }
      >
        <span className="text-sm font-medium">Workflows</span>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] px-6 py-6">
          {isPending ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          ) : workflows.length === 0 ? (
            <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-border/60 py-16 text-center text-sm text-muted-foreground">
              <Workflow className="h-5 w-5" />
              <p>
                Enchaîne des étapes (texte, image, vidéo) pour construire tes
                créations pas à pas.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => create.mutate()}
                disabled={create.isPending}
              >
                <Plus className="h-4 w-4" /> Créer un workflow
              </Button>
            </div>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-x-5 gap-y-7">
              {workflows.map((w) => (
                <li
                  key={w.id}
                  data-testid="workflow-card"
                  className="group relative"
                >
                  <Link
                    to="/workflows/$workflowId"
                    params={{ workflowId: w.id }}
                    className="block"
                  >
                    {/* La couverture fait la carte : pas de cadre autour, le visuel d'abord. */}
                    <div className="aspect-[16/10] overflow-hidden rounded-lg border border-border/60 bg-muted/30 transition-colors group-hover:border-border">
                      {w.coverUrl ? (
                        <img
                          src={w.coverUrl}
                          alt=""
                          draggable={false}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                        />
                      ) : (
                        <div className="grid h-full place-items-center text-muted-foreground">
                          <Workflow className="h-6 w-6" />
                        </div>
                      )}
                    </div>
                    <div className="mt-2.5 truncate pr-2 text-[15px] font-medium">
                      {w.name}
                    </div>
                    <div className="truncate text-[13px] text-muted-foreground">
                      {nodeCount(w.nodeCount)} · {modified(w.updatedAt)}
                    </div>
                  </Link>
                  <div className="absolute top-2.5 right-2.5 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => setEditing(w)}
                      aria-label={`Modifier « ${w.name} »`}
                      title="Modifier le titre et la couverture"
                      className="grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white/90 backdrop-blur transition hover:bg-black/80"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(w.id)}
                      aria-label={`Mettre « ${w.name} » à la corbeille`}
                      title="Mettre à la corbeille"
                      className="grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white/90 backdrop-blur transition hover:bg-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <EditWorkflowDialog workflow={editing} onClose={() => setEditing(null)} />
    </>
  )
}
