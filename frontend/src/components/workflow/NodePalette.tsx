/**
 * Palette des nœuds : remplace la sidebar de l'app dans l'éditeur de workflow.
 * Glisser un nœud sur le canvas le pose à cet endroit ; un clic le pose au centre.
 */
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, PanelLeft } from 'lucide-react'
import { useReactFlow, useStoreApi, type XYPosition } from '@xyflow/react'
import {
  APP_DEFAULT_FAMILY,
  WORKFLOW_NODES,
  WORKFLOW_NODE_GROUPS,
  type WorkflowNodeType,
} from '@sublime/shared'

import { catalogQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useUiPref } from '@/components/providers/ui-prefs'
import { CreditFooter } from '@/components/layout/CreditFooter'
import { NODE_ICONS } from './NodeShell'
import { initialData } from './nodes'

/** Type MIME du glisser-déposer d'un nœud depuis la palette. */
export const NODE_DND_TYPE = 'application/x-aif-workflow-node'

/**
 * Ajoute un nœud au canvas (centré sur `at`, en coordonnées du canvas). Le nouveau
 * nœud est le seul sélectionné : on peut le déplacer aussitôt sans entraîner les autres.
 */
export function useAddNode() {
  const { addNodes } = useReactFlow()
  const store = useStoreApi()
  const { data: catalog } = useQuery(catalogQuery())
  const available = (id: string) =>
    catalog?.families.some((f) => f.id === id && f.available) ?? false
  const defaults = {
    image: available(APP_DEFAULT_FAMILY.image)
      ? APP_DEFAULT_FAMILY.image
      : null,
    video: available(APP_DEFAULT_FAMILY.video)
      ? APP_DEFAULT_FAMILY.video
      : null,
  }
  return (type: WorkflowNodeType, at: XYPosition) => {
    store.getState().unselectNodesAndEdges()
    addNodes({
      id: `${type}-${crypto.randomUUID().slice(0, 8)}`,
      type,
      // Le nœud (280 px de large) est centré sur le point visé.
      position: { x: Math.round(at.x - 140), y: Math.round(at.y - 40) },
      data: initialData(type, defaults),
      selected: true,
    })
  }
}

export function NodePalette({ collapsed }: { collapsed: boolean }) {
  const [, setCollapsed] = useUiPref('sidebarCollapsed')
  const { screenToFlowPosition } = useReactFlow()
  const addNode = useAddNode()

  const addAtCenter = (type: WorkflowNodeType) => {
    const pane = document
      .querySelector('[data-testid="workflow-canvas"]')
      ?.getBoundingClientRect()
    if (!pane) return
    addNode(
      type,
      screenToFlowPosition({
        x: pane.left + pane.width / 2,
        y: pane.top + pane.height / 2,
      }),
    )
  }

  return (
    <aside
      data-testid="node-palette"
      aria-label="Palette des nœuds"
      className={cn(
        'shrink-0 overflow-hidden border-r border-border/40 bg-panel transition-[width] duration-200 ease-out',
        collapsed ? 'w-0 border-r-0' : 'w-72',
      )}
    >
      {/* En-tête et pied fixes : seule la liste des nœuds défile. */}
      <div className="flex h-full w-72 flex-col">
        {/* Retour à la liste des workflows, et repli comme la sidebar de l'app. */}
        <div className="flex shrink-0 items-center gap-1 p-3 pb-0">
          <Link
            to="/workflows"
            className="flex h-8 flex-1 items-center gap-1.5 rounded-[5px] px-2 text-[13px] text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Retour
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Replier le panneau"
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        </div>
        <div className="shrink-0 px-4 pt-3 pb-1">
          <h2 className="text-sm font-medium">Nœuds</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Glisse un nœud sur le canvas, ou clique pour l’ajouter au centre.
          </p>
        </div>
        <ScrollArea className="min-h-0 w-72 flex-1">
          <div className="flex w-72 flex-col px-3 pb-4">
            {WORKFLOW_NODE_GROUPS.map((group) => (
              <section key={group.label} className="mt-4">
                <h3 className="px-1 pb-1 text-xs font-medium text-muted-foreground">
                  {group.label}
                </h3>
                {group.types.map((type) => {
                  const def = WORKFLOW_NODES[type]
                  const Icon = NODE_ICONS[type]
                  return (
                    <button
                      key={type}
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(NODE_DND_TYPE, type)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onClick={() => addAtCenter(type)}
                      aria-label={`Ajouter le nœud ${def.label}`}
                      className="flex w-full cursor-grab items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent/60 active:cursor-grabbing"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] leading-tight font-medium">
                          {def.label}
                        </span>
                        <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                          {def.hint}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </section>
            ))}
          </div>
        </ScrollArea>
        <CreditFooter />
      </div>
    </aside>
  )
}
