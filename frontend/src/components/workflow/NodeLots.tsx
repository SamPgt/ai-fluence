/**
 * Résultats d'un nœud, par lot : un lot est ce qu'une exécution du nœud a produit (une
 * image, ou une par élément d'une liste). Le nœud affiche le lot actif, celui qui part
 * dans la suite, dans une zone réservée à la forme du format : sa hauteur ne bouge pas
 * pendant l'exécution. Un sélecteur « ‹ Lot 3 sur 7 › » passe d'un lot à l'autre.
 */
import { useState } from 'react'
import { ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, TriangleAlert } from 'lucide-react'
import type { Asset, WorkflowNodeResult, WorkflowNodeStatus } from '@sublime/shared'

import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MediaViewer } from '@/components/thread/MediaViewer'
import { resultOutputs } from './WorkflowRun'

/** « 14 h 32, 16/10 ». */
export function lotDate(iso: string): string {
  const d = new Date(iso)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getHours()} h ${two(d.getMinutes())}, ${two(d.getDate())}/${two(d.getMonth() + 1)}`
}

/** Nombre d'éléments réussis d'un lot (1 hors liste). */
const lotSize = (r: WorkflowNodeResult) => (r.items ? r.items.filter((i) => i.status === 'succeeded').length : 1)

/** « 16:9 » → 16/9 (null si illisible). */
export function parseRatio(v: unknown): number | null {
  const m = typeof v === 'string' ? /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(v) : null
  return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null
}

/**
 * Sélecteur de lot : « ‹ Lot 3 sur 7 · 6 images · 14 h 32, 16/10 › ». Les flèches passent
 * au lot précédent ou suivant, le centre ouvre la liste. Le lot choisi part dans la suite.
 */
export function LotSelector({
  lots,
  activeId,
  onPick,
  unit,
}: {
  /** Lots réussis, du plus récent au plus ancien. */
  lots: WorkflowNodeResult[]
  activeId: string | undefined
  onPick: (id: string) => void
  /** « image », « vidéo », « texte ». */
  unit: string
}) {
  const [open, setOpen] = useState(false)
  if (lots.length < 2) return null
  const index = Math.max(0, lots.findIndex((r) => r.id === activeId))
  const number = (i: number) => lots.length - i
  const describe = (r: WorkflowNodeResult) => {
    const n = lotSize(r)
    return `${n} ${unit}${n > 1 ? 's' : ''} · ${lotDate(r.createdAt)}`
  }
  const arrow = 'grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30'
  return (
    <div data-testid="lot-selector" className="flex items-center gap-0.5 text-[11px] tabular-nums">
      <button
        type="button"
        aria-label="Lot précédent"
        disabled={index >= lots.length - 1}
        onClick={() => onPick(lots[index + 1].id)}
        className={arrow}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Choisir un lot"
            className="min-w-0 flex-1 truncate rounded-md px-1 py-1 text-center text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <span className="text-foreground">
              Lot {number(index)} sur {lots.length}
            </span>{' '}
            · {describe(lots[index])}
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="max-h-72 w-64 overflow-y-auto p-1">
          {lots.map((r, i) => {
            const thumb = resultOutputs(r)[0]
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={i === index}
                aria-label={`Utiliser le lot ${number(i)}`}
                onClick={() => {
                  onPick(r.id)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs tabular-nums hover:bg-accent',
                  i === index && 'bg-accent',
                )}
              >
                {thumb ? (
                  thumb.mediaType === 'video' ? (
                    <video src={thumb.url} muted preload="metadata" className="h-7 w-7 shrink-0 rounded object-cover" />
                  ) : (
                    <img src={thumb.url} alt="" draggable={false} className="h-7 w-7 shrink-0 rounded object-cover" />
                  )
                ) : null}
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-foreground">Lot {number(i)}</span>{' '}
                  <span className="text-muted-foreground">· {describe(r)}</span>
                </span>
              </button>
            )
          })}
        </PopoverContent>
      </Popover>
      <button type="button" aria-label="Lot suivant" disabled={index <= 0} onClick={() => onPick(lots[index - 1].id)} className={arrow}>
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

interface Cell {
  label: string
  status: WorkflowNodeStatus | 'empty'
  media: Asset | undefined
  error: string | null
}

/** Cellules affichées : celles du lot (une par élément), sinon des emplacements vides. */
function cellsOf(lot: WorkflowNodeResult | undefined, expected: number | null): Cell[] {
  if (lot?.items) {
    return lot.items.map((i) => ({ label: i.label, status: i.status, media: i.generation?.outputs[0], error: i.errorMessage }))
  }
  if (lot && !(expected && lot.status !== 'succeeded')) {
    return [{ label: '', status: lot.status, media: lot.generation?.outputs[0], error: lot.errorMessage }]
  }
  // Pas encore de résultat (ou lot de liste pas encore commencé) : la place est réservée.
  const busy = lot?.status === 'pending' || lot?.status === 'running'
  return Array.from({ length: Math.max(1, expected ?? 1) }, () => ({
    label: '',
    status: busy ? lot!.status : 'empty',
    media: undefined,
    error: null,
  }))
}

/** Nombre maximum de cellules affichées dans la grille (la dernière dit combien il en reste). */
const GRID_MAX = 9

/**
 * Médias d'un lot dans une zone réservée : une image à la forme du format, ou une grille
 * (une cellule par élément, avec son libellé). Sans résultat, des emplacements vides.
 */
export function MediaLot({
  lot,
  ratio,
  expected,
}: {
  lot: WorkflowNodeResult | undefined
  /** Largeur / hauteur des images (format choisi). */
  ratio: number
  /** Nœud démultiplié : nombre d'éléments attendu (null : une seule image). */
  expected: number | null
}) {
  const [viewing, setViewing] = useState<number | null>(null)
  const cells = cellsOf(lot, expected)
  const media = cells.flatMap((c) => (c.media ? [c.media] : []))
  const open = (asset: Asset) => setViewing(media.indexOf(asset))
  const viewer = (
    <MediaViewer
      addReference
      asset={viewing !== null ? (media[viewing] ?? null) : null}
      onClose={() => setViewing(null)}
      onPrev={viewing !== null && viewing > 0 ? () => setViewing(viewing - 1) : undefined}
      onNext={viewing !== null && viewing < media.length - 1 ? () => setViewing(viewing + 1) : undefined}
    />
  )

  // Une seule image : le cadre du format, 16 rem de haut au plus.
  if (expected === null && !lot?.items) {
    const cell = cells[0]
    return (
      <>
        <div
          data-testid="lot-frame"
          className="mx-auto max-w-full"
          style={{ aspectRatio: String(ratio), width: ratio >= 1 ? '100%' : `${Math.round(256 * ratio)}px` }}
        >
          {cell.media ? (
            <button
              type="button"
              onClick={() => open(cell.media!)}
              aria-label="Voir le résultat en grand"
              className="block h-full w-full overflow-hidden rounded-lg border border-border/40 bg-black/20"
            >
              <MediaTag asset={cell.media} alt="Résultat" />
            </button>
          ) : (
            <EmptyCell status={cell.status} />
          )}
        </div>
        {viewer}
      </>
    )
  }

  const cols = cells.length <= 1 ? 1 : cells.length <= 4 ? 2 : 3
  const shown = cells.slice(0, GRID_MAX)
  const hidden = cells.length - shown.length
  return (
    <>
      <div data-testid="lot-grid" className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {shown.map((cell, i) => {
          const more = hidden > 0 && i === shown.length - 1
          return (
            <div key={i} data-testid="lot-item" data-status={cell.status} className="min-w-0 space-y-0.5">
              <div className="relative" style={{ aspectRatio: String(ratio) }}>
                {cell.media ? (
                  <button
                    type="button"
                    onClick={() => open(cell.media!)}
                    aria-label={cell.label ? `Voir « ${cell.label} » en grand` : 'Voir le résultat en grand'}
                    className="block h-full w-full overflow-hidden rounded-md border border-border/40 bg-black/20"
                  >
                    <MediaTag asset={cell.media} alt={cell.label || 'Résultat'} cover />
                  </button>
                ) : (
                  <EmptyCell status={cell.status} error={cell.error} small />
                )}
                {more && (
                  <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-md bg-black/60 text-sm font-medium">
                    +{hidden + 1}
                  </span>
                )}
              </div>
              {cell.label && (
                <p title={cell.label} className="truncate text-[10px] leading-tight text-muted-foreground">
                  {cell.label}
                </p>
              )}
            </div>
          )
        })}
      </div>
      {viewer}
    </>
  )
}

function MediaTag({ asset, alt, cover }: { asset: Asset; alt: string; cover?: boolean }) {
  const fit = cover ? 'object-cover' : 'object-contain'
  return asset.mediaType === 'video' ? (
    <video src={asset.url} muted playsInline loop autoPlay className={cn('h-full w-full', fit)} />
  ) : (
    <img src={asset.url} alt={alt} draggable={false} className={cn('h-full w-full', fit)} />
  )
}

/** Emplacement sans média : vide, en cours, ou en échec. */
function EmptyCell({ status, error, small }: { status: Cell['status']; error?: string | null; small?: boolean }) {
  const busy = status === 'pending' || status === 'running'
  const failed = status === 'failed' || status === 'skipped'
  return (
    <div
      title={failed ? (error ?? 'Échec.') : undefined}
      className={cn(
        'grid h-full w-full place-items-center border border-dashed',
        small ? 'rounded-md' : 'rounded-lg',
        failed ? 'border-red-500/40 bg-red-500/5' : 'border-border/50 bg-black/10',
      )}
    >
      {busy ? (
        <Loader2 className={cn('animate-spin text-sky-300', small ? 'h-3.5 w-3.5' : 'h-5 w-5')} />
      ) : failed ? (
        <TriangleAlert className={cn('text-red-300', small ? 'h-3.5 w-3.5' : 'h-5 w-5')} />
      ) : (
        <ImageIcon className={cn('text-muted-foreground/30', small ? 'h-3.5 w-3.5' : 'h-6 w-6')} />
      )}
    </div>
  )
}
