/**
 * Enveloppe commune des nœuds : en-tête (icône, nom, suppression), contenu propre
 * au type, puis les connecteurs colorés par type (entrées à gauche, sorties à droite).
 * Pendant un glisser de lien, les entrées incompatibles sont grisées. Une liste circule
 * en orange : sortie et entrées qui la portent, pastille « ×N » du nœud démultiplié.
 */
import { useMemo } from 'react'
import {
  Handle,
  Position,
  useConnection,
  useReactFlow,
  useStore,
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
  List,
  ScanText,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import {
  WORKFLOW_NODES,
  connectionError,
  expectedListSize,
  isListOutput,
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

/** Couleur d'une liste (câble orange) : traitée un élément à la fois. */
export const LIST_COLOR = '#fb923c'

/** Libellé d'une sortie démultipliée : « Images ×3 ». */
const PLURAL: Record<PortType, string> = { text: 'Textes', image: 'Images', video: 'Vidéos' }

export const NODE_ICONS: Record<WorkflowNodeType, LucideIcon> = {
  text: AlignLeft,
  'image-source': ImagePlus,
  describe: ScanText,
  llm: Sparkles,
  'image-gen': ImageIcon,
  'video-gen': Clapperboard,
  output: Flag,
  list: List,
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

/** Ce que la règle des listes dit d'un nœud. */
export interface ListInfo {
  /** Sa sortie est une liste (orange). */
  out: boolean
  /** Nombre d'éléments attendu (null : pas une liste). */
  size: number | null
  /** Ses entrées qui reçoivent une liste. */
  ports: string[]
  /** Les listes reçues : nom et nombre d'éléments (pour l'infobulle « reprend au début »). */
  sources: { name: string; size: number }[]
}

/** Règle des listes pour ce nœud, recalculée seulement quand elle change. */
export function useListInfo(id: string): ListInfo {
  const key = useStore((s) => {
    const g = graphOf(s.nodes, s.edges)
    const out = isListOutput(g, id)
    const into = g.edges.filter((e) => e.target === id && isListOutput(g, e.source))
    const sources = [...new Set(into.map((e) => e.source))].map((sid) => {
      const n = g.nodes.find((x) => x.id === sid)
      const name = n?.type === 'list' ? String(n.data.label ?? '').trim() : ''
      return { name: name || (n ? WORKFLOW_NODES[n.type].label : 'Liste'), size: expectedListSize(g, sid) ?? 0 }
    })
    return JSON.stringify([out, out ? expectedListSize(g, id) : null, [...new Set(into.map((e) => e.targetHandle))], sources])
  })
  return useMemo(() => {
    const [out, size, ports, sources] = JSON.parse(key) as [boolean, number | null, string[], ListInfo['sources']]
    return { out, size, ports, sources }
  }, [key])
}

/**
 * « 15 générations : une par rang des listes. Poses (4) reprend au début. »
 */
function fanoutTitle(list: ListInfo): string {
  const size = list.size ?? 0
  const head = `${size} génération${size > 1 ? 's' : ''} : ${list.sources.length > 1 ? 'une par rang des listes' : 'une par élément'}.`
  const loop = list.sources.filter((s) => s.size > 0 && s.size < size).map((s) => `${s.name} (${s.size}) reprend au début.`)
  return [head, ...loop].join(' ')
}

/** Hauteur d'une ligne de connecteur, et marge sous le contenu. */
const PORT_ROW = 26

export function NodeShell({
  id,
  type,
  selected,
  wide,
  exposed,
  title,
  caption,
  children,
}: {
  id: string
  type: WorkflowNodeType
  /** Nom affiché à la place de celui du type (nœud Liste nommé). */
  title?: string
  /** Légende discrète sous le nœud (nom d'une liste importée). */
  caption?: string
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
  const list = useListInfo(id)
  const dragging = connection.inProgress && connection.fromHandle?.type === 'source' && Boolean(connection.fromHandle.id)
  const graph = dragging ? graphOf(getNodes(), getEdges()) : null
  // Glisser d'un câble orange : les entrées qui l'acceptent sont cerclées d'orange.
  const draggingList = Boolean(graph && connection.fromNode && isListOutput(graph, connection.fromNode.id))

  // Glisser en cours depuis une sortie : cette entrée l'accepterait-elle ?
  const accepts = (port: PortDef) => {
    if (!graph || !connection.inProgress) return true
    return (
      connectionError(graph, {
        source: connection.fromNode.id,
        sourceHandle: connection.fromHandle!.id!,
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
        'relative rounded-2xl border bg-card text-card-foreground shadow-[0_4px_16px_rgba(0,0,0,0.35)] transition-colors',
        selected ? 'border-foreground/40' : 'border-border/70',
        busy && 'border-sky-400/60',
        (latest?.status === 'failed' || latest?.status === 'skipped') &&
          'border-red-500/60',
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 truncate text-[13px] font-medium">
          {title || def.label}
        </span>
        {def.paid && list.ports.length > 0 && (
          <span
            data-testid="node-fanout"
            title={fanoutTitle(list)}
            className="rounded-full bg-orange-400/15 px-2 py-0.5 text-[11px] font-medium text-orange-400 tabular-nums"
          >
            ×{list.size ?? '?'}
          </span>
        )}
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
          const orange = list.ports.includes(port.id) || Boolean(port.list)
          return (
            <div
              key={port.id}
              className={cn(
                'absolute left-0 flex items-center pl-3 text-[11px] transition-opacity',
                !ok && 'opacity-25',
              )}
              style={{ top: 8 + i * PORT_ROW, height: PORT_ROW }}
            >
              <PortHandle port={port} kind="target" list={orange} highlight={draggingList && ok} />
              <span className={orange ? 'text-orange-400' : 'text-muted-foreground'}>
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
            <span data-testid={`port-label-${port.id}`} className={list.out ? 'text-orange-400' : 'text-muted-foreground'}>
              {list.out && def.paid ? PLURAL[port.type] : port.label}
              {list.out && list.size !== null && ` ×${list.size}`}
            </span>
            <PortHandle port={port} kind="source" list={list.out} />
          </div>
        ))}
      </div>
      {caption && (
        <p
          data-testid="node-caption"
          title={caption}
          className="pointer-events-none absolute top-full right-0 left-0 mt-1.5 truncate px-3 text-[11px] text-muted-foreground"
        >
          {caption}
        </p>
      )}
    </div>
  )
}

/** Connecteur, de la couleur de son type. Un lien se retire par la croix au milieu du câble. */
function PortHandle({
  port,
  kind,
  list,
  highlight,
}: {
  port: PortDef
  kind: 'source' | 'target'
  /** Porte une liste : orange. */
  list?: boolean
  /** Accepte le câble orange en cours de glisser. */
  highlight?: boolean
}) {
  return (
    <Handle
      type={kind}
      position={kind === 'target' ? Position.Left : Position.Right}
      id={port.id}
      data-testid={`handle-${kind === 'target' ? 'in' : 'out'}-${port.id}`}
      aria-label={`${kind === 'target' ? 'Entrée' : 'Sortie'} ${port.label}`}
      data-list={list ? 'true' : undefined}
      className={cn('!h-3 !w-3 !border-2 !border-card', highlight && '!outline-2 !outline-offset-1 !outline-orange-400')}
      style={{ background: list ? LIST_COLOR : PORT_COLORS[port.type], top: '50%' }}
    />
  )
}
