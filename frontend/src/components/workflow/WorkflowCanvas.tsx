/**
 * Canvas d'un workflow (React Flow). L'état local fait foi ; chaque modification
 * du graphe (nœuds, liens, positions, cadrage) est enregistrée automatiquement.
 * Les liens passent par les règles partagées : un lien refusé ne se branche pas.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection as FlowConnection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type Viewport,
  useReactFlow,
  useStore,
  type ReactFlowState,
} from '@xyflow/react'
import { LocateFixed } from 'lucide-react'
import '@xyflow/react/dist/style.css'
import {
  WORKFLOW_NODES,
  WORKFLOW_NODE_GROUPS,
  connect,
  connectionError,
  imagesCarried,
  type Connection,
  type WorkflowGraph,
  type WorkflowNodeType,
} from '@sublime/shared'

import { NODE_ICONS, PORT_COLORS } from './NodeShell'
import { NODE_DND_TYPE, useAddNode } from './NodePalette'
import { nodeTypes } from './nodes'
import { NumberedEdge } from './NumberedEdge'

const edgeTypes = { numbered: NumberedEdge }

/**
 * Numéros des liens d'image (« 1 », « 2–4 »…), dans l'ordre des liens, seulement sur
 * les entrées qui en reçoivent plusieurs. Même numérotation que les images envoyées au modèle.
 */
function edgeNumbers(nodes: FlowNode[], edges: Edge[]): Map<string, string> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const groups = new Map<string, Edge[]>()
  for (const e of edges) {
    // Seules les images sont numérotées (le prompt peut citer « image 2 »).
    const target = byId.get(e.target)
    const port = target ? WORKFLOW_NODES[target.type]?.inputs.find((p) => p.id === e.targetHandle) : undefined
    if (port?.type !== 'image') continue
    const key = `${e.target}:${e.targetHandle}`
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  const out = new Map<string, string>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    let next = 1
    for (const e of group) {
      const count = imagesCarried(byId.get(e.source) as Parameters<typeof imagesCarried>[0])
      if (!count) continue
      out.set(e.id, count === 1 ? String(next) : `${next}–${next + count - 1}`)
      next += count
    }
  }
  return out
}
import type { SaveStatus } from './useWorkflowAutosave'

type FlowNode = Node<Record<string, unknown>, WorkflowNodeType>

const toFlowNodes = (g: WorkflowGraph): FlowNode[] =>
  g.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))

const toFlowEdges = (g: WorkflowGraph): Edge[] =>
  g.edges.map((e) => ({ ...e }))

/** Graphe enregistré : sans l'état d'affichage (sélection, dimensions mesurées…). */
function toGraph(nodes: FlowNode[], edges: Edge[], viewport: Viewport | undefined): WorkflowGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as WorkflowNodeType,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      data: n.data,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle ?? '',
      target: e.target,
      targetHandle: e.targetHandle ?? '',
    })),
    ...(viewport ? { viewport } : {}),
  }
}

const asConnection = (c: FlowConnection | Edge): Connection => ({
  source: c.source,
  sourceHandle: c.sourceHandle ?? '',
  target: c.target,
  targetHandle: c.targetHandle ?? '',
})

export function WorkflowCanvas({
  initial,
  onChange,
  overlay,
}: {
  initial: WorkflowGraph
  /** Appelé à chaque modification du graphe enregistré. */
  onChange: (graph: WorkflowGraph) => void
  /** Flotte en haut à droite du canvas (bouton ▶ Lancer). */
  overlay?: React.ReactNode
}) {
  const [nodes, setNodes] = useState<FlowNode[]>(() => toFlowNodes(initial))
  const [edges, setEdges] = useState<Edge[]>(() => toFlowEdges(initial))
  const [viewport, setViewport] = useState<Viewport | undefined>(initial.viewport)
  const { screenToFlowPosition } = useReactFlow()
  const addNode = useAddNode()
  // Menu « Ajouter un nœud » du clic droit sur le canvas (position écran).
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // Saisie dans un champ d'un nœud : Maj sert à étendre la sélection du texte,
  // pas à la sélection de nœuds au lasso (qui recouvrirait le champ).
  const [typing, setTyping] = useState(false)
  const isField = (t: EventTarget | null) => t instanceof HTMLElement && t.matches('input, textarea, [contenteditable="true"]')

  // Liens de la couleur de leur type (celui du connecteur de départ), numérotés
  // quand plusieurs arrivent sur une même entrée.
  const coloredEdges = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const numbers = edgeNumbers(nodes, edges)
    return edges.map((e) => {
      const type = byId.get(e.source)?.type
      const port = type ? WORKFLOW_NODES[type]?.outputs.find((p) => p.id === e.sourceHandle) : undefined
      return {
        ...e,
        type: 'numbered',
        data: { number: numbers.get(e.id) ?? null },
        ...(port ? { style: { stroke: PORT_COLORS[port.type], strokeWidth: 2 } } : {}),
      }
    })
  }, [nodes, edges])

  const graph = useMemo(() => toGraph(nodes, edges, viewport), [nodes, edges, viewport])
  const json = useMemo(() => JSON.stringify(graph), [graph])
  useEffect(() => {
    onChange(JSON.parse(json))
    // Seul le contenu compte, pas l'identité des objets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json])

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  )
  const isValidConnection = useCallback(
    (c: FlowConnection | Edge) => connectionError(graph, asConnection(c)) === null,
    [graph],
  )
  const onConnect = useCallback(
    (c: FlowConnection) => {
      const next = connect(graph, asConnection(c), crypto.randomUUID())
      setEdges(toFlowEdges(next))
    },
    [graph],
  )

  return (
    <div
      data-testid="workflow-canvas"
      className="relative min-h-0 flex-1"
      onFocus={(e) => setTyping(isField(e.target))}
      onBlur={(e) => !isField(e.relatedTarget) && setTyping(false)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(NODE_DND_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        const type = e.dataTransfer.getData(NODE_DND_TYPE)
        if (!type || !(type in WORKFLOW_NODES)) return
        e.preventDefault()
        addNode(type as WorkflowNodeType, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
      }}
    >
      <ReactFlow
        colorMode="dark"
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={nodes}
        edges={coloredEdges}
        onPaneContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onPaneClick={() => setMenu(null)}
        onMoveStart={() => setMenu(null)}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        defaultViewport={initial.viewport}
        fitView={!initial.viewport}
        onMoveEnd={(_, v) => setViewport({ x: Math.round(v.x), y: Math.round(v.y), zoom: Number(v.zoom.toFixed(3)) })}
        deleteKeyCode={['Backspace', 'Delete']}
        selectionKeyCode={typing ? null : 'Shift'}
        connectOnClick={false}
        // Navigation des outils de design (Figma, Flora) : deux doigts ou molette déplacent
        // le canvas, pincer (ou ⌘/Ctrl + molette) zoome, bouton du milieu (ou gauche sur le
        // fond) le fait glisser.
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        panOnDrag={[0, 1]}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        style={{ '--xy-background-color': 'var(--background)' } as React.CSSProperties}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="space-y-1 text-center">
            <p className="text-sm text-muted-foreground">Ce workflow est vide.</p>
            <p className="text-xs text-muted-foreground/70">Glisse un nœud depuis la palette, ou fais un clic droit.</p>
          </div>
        </div>
      )}
      <RecenterButton />
      {overlay && <div className="absolute top-3 right-3 z-10">{overlay}</div>}
      {menu && (
        <AddNodeMenu
          at={menu}
          onPick={(type) => {
            addNode(type, screenToFlowPosition(menu))
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

export const SAVE_LABELS: Record<SaveStatus, string> = {
  saved: 'Enregistré',
  pending: 'Modifié',
  saving: 'Enregistrement…',
  error: 'Échec de l’enregistrement',
}

/** Menu du clic droit : ajoute le nœud choisi à l'endroit du clic. */
function AddNodeMenu({
  at,
  onPick,
  onClose,
}: {
  at: { x: number; y: number }
  onPick: (type: WorkflowNodeType) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      role="menu"
      aria-label="Ajouter un nœud"
      className="fixed z-50 w-56 rounded-lg border border-border/60 bg-popover p-1 shadow-lg"
      style={{ left: at.x, top: at.y }}
    >
      {WORKFLOW_NODE_GROUPS.map((group, i) => (
        <div key={group.label} className={i > 0 ? 'mt-1 border-t border-border/50 pt-1' : ''}>
          <div className="px-2 py-1 text-[11px] text-muted-foreground">{group.label}</div>
          {group.types.map((type) => {
            const Icon = NODE_ICONS[type]
            return (
              <button
                key={type}
                type="button"
                role="menuitem"
                onClick={() => onPick(type)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                {WORKFLOW_NODES[type].label}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Aucun nœud (même en partie) dans la zone visible du canvas. */
function allNodesOffscreen(s: ReactFlowState): boolean {
  if (s.nodeLookup.size === 0 || !s.width || !s.height) return false
  const [tx, ty, zoom] = s.transform
  for (const n of s.nodeLookup.values()) {
    const { x, y } = n.internals.positionAbsolute
    const left = x * zoom + tx
    const top = y * zoom + ty
    const right = left + (n.measured.width ?? 0) * zoom
    const bottom = top + (n.measured.height ?? 0) * zoom
    if (right > 0 && bottom > 0 && left < s.width && top < s.height) return false
  }
  return true
}

/** Plus aucun nœud à l'écran : un bouton, en haut au centre, recadre sur tous les nœuds. */
function RecenterButton() {
  const offscreen = useStore(allNodesOffscreen)
  const { fitView } = useReactFlow()
  if (!offscreen) return null
  return (
    <button
      type="button"
      onClick={() => void fitView({ padding: 0.2, duration: 300 })}
      className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border/60 bg-popover px-3.5 py-1.5 text-[13px] shadow-lg transition-colors hover:bg-accent"
    >
      <LocateFixed className="h-3.5 w-3.5 text-muted-foreground" />
      Recentrer sur les nœuds
    </button>
  )
}
