/**
 * Exécution d'un workflow côté interface : bouton ▶ (tout le graphe) ou ▶ d'un nœud,
 * fenêtre de devis à confirmer, puis suivi de l'exécution. Les nœuds lisent leurs
 * résultats dans ce contexte.
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useReactFlow } from '@xyflow/react'
import { Loader2, Play, Square } from 'lucide-react'
import { toast } from 'sonner'
import { WORKFLOW_NODES, type WorkflowGraph, type WorkflowNodeResult, type WorkflowStateResponse } from '@sublime/shared'

import { workflowsApi } from '@/lib/api'
import { qk, workflowStateQuery } from '@/lib/queries'
import { formatUsd } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Ce qui peut changer le prix : les nœuds (type, modèle, réglages, images) et les liens.
 * Pas les positions, ni le texte tapé : déplacer un nœud ou écrire ne relance pas le calcul.
 */
export function priceKey(graph: WorkflowGraph, nodeIds?: string[]): string {
  return JSON.stringify([
    graph.nodes.map((n) => {
      const { text: _text, instruction: _instruction, ...data } = n.data
      return [n.id, n.type, data]
    }),
    graph.edges.map((e) => [e.source, e.sourceHandle, e.target, e.targetHandle]),
    nodeIds ?? null,
  ])
}

/** Devis d'une exécution (gratuit) : gardé en cache, il est prêt au moment du clic. */
const quoteOptions = (workflowId: string, graph: WorkflowGraph, nodeIds?: string[]) =>
  queryOptions({
    queryKey: ['workflow-quote', workflowId, priceKey(graph, nodeIds)],
    queryFn: () => workflowsApi.quote(workflowId, { graph, nodeIds }),
    staleTime: 5 * 60_000,
    retry: false,
  })

const hasPaidNode = (graph: WorkflowGraph) => graph.nodes.some((n) => WORKFLOW_NODES[n.type]?.paid)

interface RunContextValue {
  state: WorkflowStateResponse | undefined
  running: boolean
  /** Devis de tout le workflow, calculé en arrière-plan. */
  price: string | null
  /** Prépare le devis d'un nœud (au survol de son ▶). */
  prefetchNode: (nodeId: string) => void
  /** Ouvre le devis pour ces nœuds (absent : tout le workflow). */
  requestRun: (nodeIds?: string[]) => void
  /** Arrête l'exécution en cours (les étapes en attente ne partent pas). */
  stop: () => void
  stopping: boolean
}

const RunContext = createContext<RunContextValue>({
  state: undefined,
  running: false,
  price: null,
  prefetchNode: () => {},
  requestRun: () => {},
  stop: () => {},
  stopping: false,
})

export const useWorkflowRun = () => useContext(RunContext)

/**
 * Résultat actif d'un nœud parmi ses résultats réussis : celui choisi dans le nœud,
 * sinon le plus récent. C'est lui qui part aux nœuds suivants.
 */
export function pickActive(results: WorkflowNodeResult[], activeResultId: unknown): WorkflowNodeResult | undefined {
  const done = results.filter((r) => r.status === 'succeeded' && (r.generation?.outputs.length || r.text))
  return done.find((r) => r.id === activeResultId) ?? done[0]
}

/** Résultats d'un nœud, du plus récent au plus ancien. */
export function useNodeResults(nodeId: string): WorkflowNodeResult[] {
  const { state } = useWorkflowRun()
  return state?.results.filter((r) => r.nodeId === nodeId) ?? []
}

export function WorkflowRunProvider({
  workflowId,
  getGraph,
  priceGraph,
  children,
}: {
  workflowId: string
  /** Graphe tel qu'affiché (il est enregistré au lancement). */
  getGraph: () => WorkflowGraph | null
  /** Graphe pour le devis en arrière-plan (mis à jour seulement quand le prix peut changer). */
  priceGraph: WorkflowGraph
  children: React.ReactNode
}) {
  const fullQuote = useQuery({ ...quoteOptions(workflowId, priceGraph), enabled: hasPaidNode(priceGraph) })
  const queryClient = useQueryClient()
  const { data: state } = useQuery(workflowStateQuery(workflowId))
  const running = state?.run?.status === 'running'
  const { fitView, getNodes } = useReactFlow()
  const [target, setTarget] = useState<{ nodeIds?: string[] } | null>(null)
  const stopRun = useMutation({
    mutationFn: () => workflowsApi.stop(workflowId),
    onSuccess: (s) => queryClient.setQueryData(qk.workflowState(workflowId), s),
    onError: (e) => toast.error(e.message),
  })

  // Fin d'une exécution suivie : notification, galerie à jour.
  const watched = useRef<string | null>(null)
  useEffect(() => {
    const run = state?.run
    if (!run) return
    if (run.status === 'running') watched.current = run.id
    else if (watched.current === run.id) {
      watched.current = null
      queryClient.invalidateQueries({ queryKey: ['gallery'] })
      queryClient.invalidateQueries({ queryKey: qk.balance })
      // Nœuds Résultat : la notification y mène directement.
      const outputs = getNodes().filter((n) => n.type === 'output')
      const action = outputs.length
        ? {
            action: {
              label: 'Voir le résultat',
              onClick: () => void fitView({ nodes: outputs.map((n) => ({ id: n.id })), padding: 0.3, duration: 400 }),
            },
          }
        : {}
      if (run.status === 'succeeded') toast.success('Workflow terminé', action)
      else if (run.status === 'stopped') toast('Exécution arrêtée : les étapes en attente ne sont pas parties.')
      else toast.error('Exécution terminée avec des erreurs : voir les nœuds en rouge.')
    }
  }, [state?.run, queryClient, fitView, getNodes])

  return (
    <RunContext.Provider
      value={{
        state,
        running,
        price: fullQuote.data?.estimatedCost ?? null,
        prefetchNode: (nodeId) => {
          const graph = getGraph()
          if (graph) void queryClient.prefetchQuery(quoteOptions(workflowId, graph, [nodeId]))
        },
        requestRun: (nodeIds) => setTarget({ nodeIds }),
        stop: () => stopRun.mutate(),
        stopping: stopRun.isPending,
      }}
    >
      {children}
      <RunDialog
        workflowId={workflowId}
        target={target}
        getGraph={getGraph}
        onClose={() => setTarget(null)}
        onStarted={(s) => {
          queryClient.setQueryData(qk.workflowState(workflowId), s)
          if (s.run) watched.current = s.run.id
        }}
      />
    </RunContext.Provider>
  )
}

/** Bouton ▶ du header : lance tout le workflow. */
/** Bouton Stop : une bulle à part, icône seule, pendant une exécution. */
export function StopButton() {
  const { running, stop, stopping } = useWorkflowRun()
  if (!running) return null
  return (
    <button
      type="button"
      onClick={stop}
      disabled={stopping}
      aria-label="Arrêter l’exécution"
      title="Arrêter : les étapes en attente ne partent pas"
      className="grid h-8 w-8 place-items-center rounded-full border border-border/60 bg-popover text-foreground shadow-lg transition-colors hover:bg-red-500 hover:text-white disabled:opacity-60"
    >
      {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3 fill-current" />}
    </button>
  )
}

export function RunButton() {
  const { running, requestRun } = useWorkflowRun()
  return (
    <Button
      variant="outline"
      onClick={() => requestRun()}
      disabled={running}
      aria-label="Lancer le workflow"
      className="h-8 gap-1.5 rounded-full bg-popover px-3.5 text-[13px] font-normal shadow-lg hover:bg-accent"
    >
      {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
      {running ? 'En cours…' : 'Lancer'}
    </Button>
  )
}

function RunDialog({
  workflowId,
  target,
  getGraph,
  onClose,
  onStarted,
}: {
  workflowId: string
  target: { nodeIds?: string[] } | null
  getGraph: () => WorkflowGraph | null
  onClose: () => void
  onStarted: (state: WorkflowStateResponse) => void
}) {
  // Graphe figé à l'ouverture : le devis et le lancement portent sur le même.
  const [graph, setGraph] = useState<WorkflowGraph | null>(null)
  useEffect(() => setGraph(target ? getGraph() : null), [target]) // eslint-disable-line react-hooks/exhaustive-deps

  // Même clé que le devis calculé en arrière-plan : déjà prêt au clic.
  const quote = useQuery({
    ...quoteOptions(workflowId, graph ?? { nodes: [], edges: [] }, target?.nodeIds),
    enabled: Boolean(graph),
  })
  const run = useMutation({
    mutationFn: () =>
      workflowsApi.run(workflowId, { graph: graph!, nodeIds: target?.nodeIds, expectedCost: quote.data!.estimatedCost }),
    onSuccess: (s) => {
      onStarted(s)
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  const steps = quote.data?.nodes.length ?? 0
  return (
    <Dialog open={Boolean(target)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{target?.nodeIds ? 'Lancer ce nœud ?' : 'Lancer le workflow ?'}</DialogTitle>
          <DialogDescription>
            {quote.data
              ? `${steps} étape${steps > 1 ? 's' : ''}, dans l’ordre des liens. Les résultats arrivent dans les nœuds.`
              : 'Calcul du prix…'}
          </DialogDescription>
        </DialogHeader>
        {quote.error && <p className="text-sm text-destructive-foreground">{(quote.error as Error).message}</p>}
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground tabular-nums">
            {quote.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : quote.data ? (
              <>
                ≈ <span className="text-foreground">{formatUsd(quote.data.estimatedCost)}</span>
              </>
            ) : null}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={run.isPending}>
              Annuler
            </Button>
            <Button
              autoFocus
              variant="outline"
              onClick={() => run.mutate()}
              disabled={!quote.data || quote.isFetching || run.isPending}
            >
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Lancer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
