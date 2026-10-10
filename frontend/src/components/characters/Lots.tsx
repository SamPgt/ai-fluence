/**
 * Lots de variantes (créateur de personnage, images master) : regroupement des séries d'un fil,
 * vignette d'une variante et barre de progression d'un lot en cours.
 */
import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { Generation } from '@ai-fluence/shared'

import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'

export const isPending = (g: Generation) => g.status === 'queued' || g.status === 'running'

/** Une série (même `batchId`) = un lot, dans l'ordre du fil. */
export function groupLots(generations: Generation[]): Generation[][] {
  const out: Generation[][] = []
  for (const g of generations) {
    const last = out.at(-1)
    if (g.batchId && last?.[0].batchId === g.batchId) last.push(g)
    else out.push([g])
  }
  return out
}

export function LotTabs({ lots, current, onPick }: { lots: Generation[][]; current: Generation[]; onPick: (index: number) => void }) {
  return (
    <>
      {lots.map((l, i) => (
        <button
          key={l[0].id}
          onClick={() => onPick(i)}
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[11px] tabular-nums transition-colors',
            l === current ? 'border-border bg-accent text-foreground' : 'border-border/40 text-muted-foreground hover:text-foreground',
          )}
        >
          Lot {i + 1} · {l.length}
        </button>
      ))}
    </>
  )
}

/** Progression d'un lot : terminées, temps restant estimé d'après les durées réelles, annulation (local). */
export function LotProgress({ lot, onCancel }: { lot: Generation[]; onCancel: () => void }) {
  const pending = lot.filter(isPending)
  if (!pending.length) return null
  const done = lot.length - pending.length
  const durations = lot.filter((g) => !isPending(g)).map((g) => g.durationMs).filter((d): d is number => d !== null)
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null
  const local = lot[0]?.provider === 'comfy'
  return (
    <div className="flex items-center gap-3 border-b border-border/40 px-4 py-2 text-[11px] text-muted-foreground">
      <span className="tabular-nums">
        {local ? 'En local, une image à la fois · ' : ''}
        {done} / {lot.length} terminées
        {avg !== null && ` · reste ≈ ${formatDuration(avg * pending.length)}`}
      </span>
      <span className="h-1 w-40 overflow-hidden rounded-full bg-secondary">
        <span className="block h-full rounded-full bg-brand" style={{ width: `${(done / lot.length) * 100}%` }} />
      </span>
      {local && (
        <button className="ml-auto hover:text-foreground" onClick={onCancel}>
          Annuler le lot
        </button>
      )}
    </div>
  )
}

export function VariantCard({
  generation: g,
  selected,
  queuePosition,
  caption,
  corner,
  aspect = 'portrait',
  onSelect,
}: {
  generation: Generation
  selected: boolean
  queuePosition: number
  /** Légende sous la vignette (traits tirés, variante…). */
  caption: string
  /** Bouton en haut à droite de la vignette (étoile master…). */
  corner?: ReactNode
  /** Portrait (personnage) ou paysage (lieu). */
  aspect?: 'portrait' | 'landscape'
  onSelect: () => void
}) {
  const image = g.outputs[0]
  return (
    <div className="space-y-1">
      <div className="relative">
        <button
          onClick={onSelect}
          disabled={g.status !== 'succeeded'}
          className={cn(
            'relative flex w-full items-center justify-center overflow-hidden rounded-xl border bg-secondary/30',
            aspect === 'landscape' ? 'aspect-[3/2]' : 'aspect-[4/5]',
            selected ? 'border-brand ring-1 ring-brand' : 'border-border/40',
            g.status === 'queued' && 'border-dashed',
          )}
        >
          <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 text-[10px] font-semibold text-white">#{g.batchIndex + 1}</span>
          {g.status === 'succeeded' && image ? (
            <img src={image.url} alt="" className="h-full w-full object-cover" />
          ) : g.status === 'running' ? (
            <span className="flex flex-col items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-brand" /> En cours
            </span>
          ) : g.status === 'queued' ? (
            <span className="text-[11px] text-muted-foreground">En file · {queuePosition}</span>
          ) : (
            <span className="px-2 text-center text-[11px] text-destructive-foreground">{g.errorMessage ?? 'Échec'}</span>
          )}
        </button>
        {corner && g.status === 'succeeded' && image && <div className="absolute top-1.5 right-1.5">{corner}</div>}
      </div>
      <p className="truncate px-0.5 text-[10px] text-muted-foreground" title={caption}>
        {caption || '—'}
      </p>
    </div>
  )
}
