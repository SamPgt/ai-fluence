/**
 * Lien du canvas : la courbe de la couleur de son type ; au survol, une croix en son
 * milieu le retire. Quand plusieurs liens arrivent sur une même entrée (n → 1), le
 * numéro des images qu'il apporte (« 2 », ou « 2–4 » pour plusieurs photos) s'affiche
 * au départ du câble : c'est ce numéro que le prompt cite (« @image2 »).
 */
import { useRef, useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react'
import { X } from 'lucide-react'

export function NumberedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const label = typeof data?.number === 'string' ? data.number : null
  const { deleteElements } = useReactFlow()
  // Survol du câble ou de sa croix ; un court délai laisse le temps de passer de l'un à l'autre.
  const [hover, setHover] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const enter = () => {
    clearTimeout(leaveTimer.current)
    setHover(true)
  }
  const leave = () => {
    leaveTimer.current = setTimeout(() => setHover(false), 150)
  }

  return (
    <>
      <g onMouseEnter={enter} onMouseLeave={leave}>
        <BaseEdge id={id} path={path} style={style} interactionWidth={24} />
      </g>
      <EdgeLabelRenderer>
        {label && (
          <span
            data-testid="edge-number"
            className="pointer-events-none absolute grid h-[18px] min-w-[18px] place-items-center rounded-full border border-card bg-sky-400 px-1 text-[10px] font-semibold text-black tabular-nums"
            // Au départ du câble, juste après la sortie : chaque numéro reste lisible,
            // même quand plusieurs liens convergent vers la même entrée.
            style={{ transform: `translate(-50%, -50%) translate(${sourceX + 26}px, ${sourceY}px)` }}
          >
            {label}
          </span>
        )}
        <button
          type="button"
          data-testid="edge-remove"
          aria-label="Retirer le lien"
          title="Retirer le lien"
          onMouseEnter={enter}
          onMouseLeave={leave}
          onClick={() => void deleteElements({ edges: [{ id }] })}
          className="nodrag nopan absolute grid h-5 w-5 place-items-center rounded-full border border-border bg-popover text-muted-foreground shadow transition-opacity hover:bg-red-500 hover:text-white"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: hover ? 'all' : 'none',
            opacity: hover ? 1 : 0,
          }}
        >
          <X className="h-3 w-3" strokeWidth={2.5} />
        </button>
      </EdgeLabelRenderer>
    </>
  )
}
