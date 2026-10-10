/**
 * Contrôles de la barre du composer, sans bordure ni fond (fond au survol) :
 * bascule photo / vidéo, résolution, ratio, et compteurs − valeur + .
 */
import { useEffect, useState } from 'react'
import { Image as ImageIcon, Minus, Play, Plus } from 'lucide-react'
import type { MediaKind } from '@ai-fluence/shared'

import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/** Bouton léger de la barre : pas de bordure ni de fond, fond au survol. */
export const BAR_BUTTON =
  'flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-2 text-[13px] text-foreground/80 transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent/60'

// ── Photo / vidéo ─────────────────────────────────────────────

export function MediaSwitch({
  value,
  onChange,
}: {
  value: MediaKind
  onChange: (media: MediaKind) => void
}) {
  const options = [
    { media: 'image' as const, label: 'Photo', Icon: ImageIcon },
    { media: 'video' as const, label: 'Vidéo', Icon: Play },
  ]
  return (
    <div
      role="radiogroup"
      aria-label="Type de média"
      className="relative flex shrink-0 items-center gap-0.5 rounded-full p-1 shadow-[inset_0_0_0_1px_var(--color-border)]"
    >
      {/* Pastille claire qui glisse sous l'option choisie. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1 left-1 size-7 rounded-full bg-foreground transition-transform duration-200 ease-out',
          value === 'video' && 'translate-x-[calc(100%+2px)]',
        )}
      />
      {options.map(({ media, label, Icon }) => (
        <button
          key={media}
          type="button"
          role="radio"
          aria-checked={value === media}
          aria-label={label}
          title={label}
          onClick={() => onChange(media)}
          className={cn(
            'relative z-10 flex size-7 items-center justify-center rounded-full transition-colors',
            value === media
              ? 'text-background'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon
            className={cn('size-3.5', media === 'video' && 'fill-current')}
          />
        </button>
      ))}
    </div>
  )
}

// ── Résolution : un clic passe à la valeur suivante ───────────

const upper = (v: unknown) => String(v).toUpperCase()

export function ResolutionToggle({
  values,
  value,
  onChange,
  name = 'Résolution',
  format = upper,
  bars: showBars = true,
}: {
  values: unknown[]
  value: unknown
  onChange: (v: unknown) => void
  /** Ce que règle le bouton (infobulle et lecteur d'écran). */
  name?: string
  format?: (v: unknown) => string
  /** Barres de niveau (réservées à la résolution). */
  bars?: boolean
}) {
  const index = Math.max(
    0,
    values.findIndex((v) => v === value),
  )
  // Barres de niveau : au plus 4, remplies jusqu'au niveau choisi.
  const bars = Math.min(values.length, 4)
  const level = Math.round(((index + 1) / values.length) * bars)
  return (
    <button
      type="button"
      onClick={() => onChange(values[(index + 1) % values.length])}
      title={`${name} (clic pour changer)`}
      aria-label={`${name} ${format(values[index])}`}
      className={BAR_BUTTON}
    >
      {showBars && (
        <span aria-hidden className="flex items-end gap-px">
          {Array.from({ length: bars }, (_, i) => (
            <span
              key={i}
              className={cn(
                'w-0.5 rounded-full',
                i < level ? 'bg-foreground' : 'bg-muted-foreground/40',
              )}
              style={{ height: 6 + i * 4 }}
            />
          ))}
        </span>
      )}
      <span className="tabular-nums">{format(values[index])}</span>
    </button>
  )
}

// ── Ratio : la forme de chaque format ─────────────────────────

/** `16:9` → [16, 9] ; « auto », « adaptive »… → null. */
function parseRatio(v: unknown): [number, number] | null {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(v))
  return m ? [Number(m[1]), Number(m[2])] : null
}

function RatioShape({ value, size = 14 }: { value: unknown; size?: number }) {
  const r = parseRatio(value)
  if (!r) {
    return (
      <span
        aria-hidden
        className="block rounded-[2px] border border-dashed border-current"
        style={{ width: size, height: size }}
      />
    )
  }
  const [w, h] = r
  const scale = size / Math.max(w, h)
  return (
    <span
      aria-hidden
      className="block rounded-[2px] bg-current"
      style={{ width: Math.max(4, w * scale), height: Math.max(4, h * scale) }}
    />
  )
}

const ratioLabel = (v: unknown) =>
  parseRatio(v) ? String(v) : String(v) === 'adaptive' ? 'Auto' : String(v)

export function AspectRatioPicker({
  values,
  value,
  onChange,
}: {
  values: unknown[]
  value: unknown
  onChange: (v: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Proportions"
          title="Proportions"
          className={BAR_BUTTON}
        >
          <span className="flex size-3.5 items-center justify-center">
            <RatioShape value={value} size={14} />
          </span>
          <span className="tabular-nums">{ratioLabel(value)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-auto p-2">
        <div className="px-1 pb-2 text-[11px] font-medium text-muted-foreground">
          Proportions
        </div>
        <div className="grid grid-cols-4 gap-1">
          {values.map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => {
                onChange(v)
                setOpen(false)
              }}
              className={cn(
                'flex w-16 flex-col items-center gap-1.5 rounded-lg px-1 pt-2.5 pb-1.5 text-[11px] tabular-nums transition-colors',
                v === value
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <span className="flex h-6 items-center justify-center">
                <RatioShape value={v} size={22} />
              </span>
              {ratioLabel(v)}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── Compteur − valeur + ───────────────────────────────────────

export function Stepper({
  value,
  label,
  format,
  prev,
  next,
  normalize,
  onChange,
}: {
  value: number
  label: string
  /** Affichage de la valeur (ex. `15s`). */
  format: (v: number) => string
  prev: (v: number) => number | null
  next: (v: number) => number | null
  /** Valeur saisie au clavier → valeur acceptée (bornée). */
  normalize: (v: number) => number
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => setDraft(null), [value])
  const down = prev(value)
  const up = next(value)
  const commit = () => {
    if (draft === null) return
    const n = Number(draft.replace(/[^\d.-]/g, ''))
    if (Number.isFinite(n) && draft.trim() !== '') onChange(normalize(n))
    setDraft(null)
  }
  const step =
    'flex size-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-30'
  return (
    <div
      className="flex h-8 shrink-0 items-center gap-0.5 px-0.5"
      aria-label={label}
      title={label}
    >
      <button
        type="button"
        className={step}
        disabled={down === null}
        onClick={() => down !== null && onChange(down)}
        aria-label={`${label} : moins`}
      >
        <Minus className="size-3.5" />
      </button>
      <input
        value={draft ?? format(value)}
        onFocus={(e) => {
          setDraft(String(value))
          requestAnimationFrame(() => e.target.select())
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') {
            setDraft(null)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        aria-label={label}
        className="w-9 rounded-md bg-transparent text-center text-[13px] text-foreground/80 tabular-nums outline-none focus:bg-accent/60"
      />
      <button
        type="button"
        className={step}
        disabled={up === null}
        onClick={() => up !== null && onChange(up)}
        aria-label={`${label} : plus`}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}
