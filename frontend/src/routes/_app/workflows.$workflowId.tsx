import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { ReactFlowProvider } from '@xyflow/react'
import { toast } from 'sonner'
import { WORKFLOW_LIMITS, type Workflow, type WorkflowGraph } from '@sublime/shared'

import { workflowsApi } from '@/lib/api'
import { qk, workflowQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  SAVE_LABELS,
  WorkflowCanvas,
} from '@/components/workflow/WorkflowCanvas'
import { useWorkflowAutosave } from '@/components/workflow/useWorkflowAutosave'
import { NodePalette } from '@/components/workflow/NodePalette'
import { useUiPref } from '@/components/providers/ui-prefs'
import { RunButton, StopButton, WorkflowRunProvider, priceKey } from '@/components/workflow/WorkflowRun'

export const Route = createFileRoute('/_app/workflows/$workflowId')({
  component: WorkflowPage,
})

function WorkflowPage() {
  const { workflowId } = Route.useParams()
  // Lecture fraîche à l'ouverture : le canvas part de la dernière version enregistrée.
  const { data: workflow, error } = useQuery({
    ...workflowQuery(workflowId),
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

  if (error) {
    return (
      <>
        <PageHeader panel="none" />
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
          <div className="space-y-3 text-center">
            <p>{error.message}</p>
            <Link
              to="/workflows"
              className="text-foreground underline underline-offset-4"
            >
              Retour aux workflows
            </Link>
          </div>
        </div>
      </>
    )
  }
  if (!workflow) {
    return (
      <>
        <PageHeader panel="none" />
        <Loader2 className="m-auto h-5 w-5 animate-spin text-muted-foreground" />
      </>
    )
  }
  // Un workflow = un canvas : on repart de zéro en changeant de workflow.
  return <Editor key={workflow.id} workflow={workflow} />
}

function Editor({ workflow }: { workflow: Workflow }) {
  const { status, schedule } = useWorkflowAutosave(workflow.id)
  const [collapsed] = useUiPref('sidebarCollapsed')
  // Graphe tel qu'affiché : envoyé au lancement d'une exécution.
  const graph = useRef<WorkflowGraph>(workflow.graph)
  // Graphe du devis en arrière-plan : mis à jour une fois les changements de prix posés.
  const [priceGraph, setPriceGraph] = useState<WorkflowGraph>(workflow.graph)
  const priceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(priceTimer.current), [])
  const onChange = (g: WorkflowGraph) => {
    graph.current = g
    schedule(g)
    clearTimeout(priceTimer.current)
    priceTimer.current = setTimeout(
      () => setPriceGraph((prev) => (priceKey(prev) === priceKey(g) ? prev : g)),
      800,
    )
  }
  return (
    <ReactFlowProvider>
      <WorkflowRunProvider workflowId={workflow.id} getGraph={() => graph.current} priceGraph={priceGraph}>
      {/* La palette des nœuds remplace la sidebar de l'app (avec « Retour » en haut). */}
      <div className="flex min-h-0 flex-1">
        <NodePalette collapsed={collapsed} />
        <div className="flex min-w-0 flex-1 flex-col">
          <PageHeader
            panel="palette"
            right={
              <div className="flex items-center gap-2">
                <span
                  data-testid="workflow-save-status"
                  data-status={status}
                  className={cn(
                    'px-2 text-xs text-muted-foreground',
                    status === 'error' && 'text-red-400',
                  )}
                >
                  {SAVE_LABELS[status]}
                </span>
              </div>
            }
          >
            <WorkflowName workflow={workflow} />
          </PageHeader>
          <WorkflowCanvas initial={workflow.graph} onChange={onChange} overlay={
            <div className="flex items-center gap-2">
              <StopButton />
              <RunButton />
            </div>
          } />
        </div>
      </div>
      </WorkflowRunProvider>
    </ReactFlowProvider>
  )
}

/** Nom modifiable sur place : Entrée ou clic ailleurs enregistre, Échap annule. */
function WorkflowName({ workflow }: { workflow: Workflow }) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    ...workflowQuery(workflow.id),
    initialData: workflow,
  })
  const current = data.name
  const [value, setValue] = useState(current)
  useEffect(() => setValue(current), [current])

  const rename = useMutation({
    mutationFn: (name: string) => workflowsApi.update(workflow.id, { name }),
    onSuccess: ({ workflow: w }) => {
      queryClient.setQueryData(
        qk.workflow(w.id),
        (old: Workflow | undefined) => (old ? { ...old, name: w.name } : w),
      )
      queryClient.invalidateQueries({ queryKey: qk.workflows })
    },
    onError: (e) => {
      setValue(current)
      toast.error(e.message)
    },
  })

  const commit = () => {
    const name = value.trim()
    if (!name) setValue(current)
    else if (name !== current) rename.mutate(name)
  }

  return (
    <input
      aria-label="Nom du workflow"
      value={value}
      maxLength={WORKFLOW_LIMITS.nameLength}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setValue(current)
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
        }
      }}
      className="h-7 min-w-0 max-w-sm flex-1 truncate rounded-md bg-transparent px-2 text-sm font-medium outline-none hover:bg-accent/60 focus:bg-accent"
    />
  )
}
