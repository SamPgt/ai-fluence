/**
 * Enveloppe commune des nœuds : en-tête (icône, nom, suppression), contenu propre
 * au type, puis les connecteurs colorés par type (entrées à gauche, sorties à droite).
 * Pendant un glisser de lien, les entrées incompatibles sont grisées.
 */
import {
  Handle,
  Position,
  useConnection,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import {
  AlignLeft,
  Loader2,
  Play,
  Clapperboard,
  Flag,
  Image as ImageIcon,
  ImagePlus,
  ScanText,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import {
  WORKFLOW_NODES,
  connectionError,
  type PortDef,
  type PortType,
  type WorkflowGraph,
  type WorkflowNodeType,
} from '@sublime/shared'

import { cn } from '@/lib/utils'
import { useNodeResults, useWorkflowRun } from './WorkflowRun'

export const PORT_COLORS: Record<PortType, string> = {
  text: '#a1a1aa',
  image: '#38bdf8',
  video: '#a78bfa',
}

export const NODE_ICONS: Record<WorkflowNodeType, LucideIcon> = {
  text: AlignLeft,
  'image-source': ImagePlus,
  describe: ScanText,
  llm: Sparkles,
  'image-gen': ImageIcon,
  'video-gen': Clapperboard,
  output: Flag,
}

/** Graphe courant, lu dans React Flow (pour vérifier un lien pendant le glisser). */
export function graphOf(nodes: Node[], edges: Edge[]): WorkflowGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as WorkflowNodeType,
      position: n.position,
      data: n.data,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle ?? '',
      target: e.target,
      targetHandle: e.targetHandle ?? '',
    })),
  }
}

/** Hauteur d'une ligne de connecteur, et marge sous le contenu. */
const PORT_ROW = 26

export function NodeShell({
  id,
  type,
  selected,
  wide,
  exposed,
  children,
}: {
  id: string
  type: WorkflowNodeType
  selected?: boolean
  /** Nœud plus large (aperçu du résultat final). */
  wide?: boolean
  /** Entrée « À fournir » : demandée dans le formulaire du fil. */
  exposed?: boolean
  children?: React.ReactNode
}) {
  const def = WORKFLOW_NODES[type]
  const Icon = NODE_ICONS[type]
  const { running, requestRun, prefetchNode } = useWorkflowRun()
  const latest = useNodeResults(id)[0]
  const busy = latest?.status === 'pending' || latest?.status === 'running'
  const { deleteElements, getNodes, getEdges } = useReactFlow()
  const connection = useConnection()

  // Glisser en cours depuis une sortie : cette entrée l'accepterait-elle ?
  const accepts = (port: PortDef) => {
    if (!connection.inProgress || !connection.fromHandle?.id) return true
    if (connection.fromHandle.type !== 'source') return true
    return (
      connectionError(graphOf(getNodes(), getEdges()), {
        source: connection.fromNode.id,
        sourceHandle: connection.fromHandle.id,
        target: id,
        targetHandle: port.id,
      }) === null
    )
  }

  const rows = Math.max(def.inputs.length, def.outputs.length)

  return (
    <div
      data-testid="workflow-node"
      data-node-type={type}
      data-status={latest?.status}
      className={cn(
        wide ? 'w-[400px]' : 'w-[280px]',
        'rounded-2xl border bg-card text-card-foreground shadow-[0_4px_16px_rgba(0,0,0,0.35)] transition-colors',
        selected ? 'border-foreground/40' : 'border-border/70',
        busy && 'border-sky-400/60',
        (latest?.status === 'failed' || latest?.status === 'skipped') &&
          'border-red-500/60',
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 truncate text-[13px] font-medium">
          {def.label}
        </span>
        {exposed && (
          <span
            title="À fournir"
            className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] font-medium text-sky-300"
          >
            Entrée
          </span>
        )}
        {def.paid && (
          <button
            type="button"
            onClick={() => requestRun([id])}
            onMouseEnter={() => prefetchNode(id)}
            onFocus={() => prefetchNode(id)}
            disabled={running}
            aria-label={`Lancer le nœud ${def.label}`}
            title="Lancer ce nœud"
            className="nodrag grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => deleteElements({ nodes: [{ id }] })}
          aria-label={`Supprimer le nœud ${def.label}`}
          title="Supprimer le nœud"
          className="nodrag grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* La molette déplace le canvas, sauf dans un champ en cours d'édition (classe nowheel posée au focus). */}
      {children && (
        <div className="nodrag cursor-default space-y-2 px-3 pt-3">
          {children}
        </div>
      )}

      {/* Connecteurs : une ligne par entrée (gauche) et par sortie (droite). */}
      <div className="relative py-2" style={{ height: rows * PORT_ROW + 16 }}>
        {def.inputs.map((port, i) => {
          const ok = accepts(port)
          return (
            <div
              key={port.id}
              className={cn(
                'absolute left-0 flex items-center pl-3 text-[11px] transition-opacity',
                !ok && 'opacity-25',
              )}
              style={{ top: 8 + i * PORT_ROW, height: PORT_ROW }}
            >
              <PortHandle port={port} kind="target" />
              <span className="text-muted-foreground">
                {port.label}
                {port.required && (
                  <span className="text-foreground/60"> *</span>
                )}
              </span>
            </div>
          )
        })}
        {def.outputs.map((port, i) => (
          <div
            key={port.id}
            className="absolute right-0 flex items-center pr-3 text-[11px]"
            style={{ top: 8 + i * PORT_ROW, height: PORT_ROW }}
          >
            <span className="text-muted-foreground">{port.label}</span>
            <PortHandle port={port} kind="source" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Connecteur, de la couleur de son type. Un lien se retire par la croix au milieu du câble. */
function PortHandle({
  port,
  kind,
}: {
  port: PortDef
  kind: 'source' | 'target'
}) {
  return (
    <Handle
      type={kind}
      position={kind === 'target' ? Position.Left : Position.Right}
      id={port.id}
      data-testid={`handle-${kind === 'target' ? 'in' : 'out'}-${port.id}`}
      aria-label={`${kind === 'target' ? 'Entrée' : 'Sortie'} ${port.label}`}
      className="!h-3 !w-3 !border-2 !border-card"
      style={{ background: PORT_COLORS[port.type], top: '50%' }}
    />
  )
}
