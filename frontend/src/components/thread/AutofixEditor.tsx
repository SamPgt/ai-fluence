/**
 * Correction automatique (outil local, FLUX.2 klein) : les visages, mains et pieds de l'image sont repérés, montrés
 * en cadres colorés ; on décoche ceux qui sont faux (un sac pris pour une main), on déplace ou agrandit ceux qui
 * couvrent mal la partie (ce qui dépasse du cadre reste tel quel : un talon raté resterait visible), on en ajoute au
 * besoin, puis klein refait les zones gardées.
 * Le résultat arrive dans le fil de l'image (~1 min par zone) ; le reste de l'image ne change pas.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Asset } from '@sublime/shared'

import { generationsApi, type AutofixKind, type AutofixPart } from '@/lib/api'
import { qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const KINDS: { id: AutofixKind; label: string; color: string }[] = [
  { id: 'face', label: 'Visages', color: '#38bdf8' },
  { id: 'hand', label: 'Mains', color: '#f87171' },
  { id: 'foot', label: 'Pieds', color: '#4ade80' },
]
const colorOf = (kind: AutofixKind) => KINDS.find((k) => k.id === kind)!.color

export function AutofixEditor({ asset, onDone, onCancel }: { asset: Asset; onDone: () => void; onCancel: () => void }) {
  const queryClient = useQueryClient()
  const imgRef = useRef<HTMLImageElement>(null)
  const [display, setDisplay] = useState<{ w: number; h: number } | null>(null)
  const { data, isLoading, error } = useQuery({
    queryKey: ['autofix-detect', asset.id],
    queryFn: () => generationsApi.detectParts(asset.id, ['face', 'hand', 'foot']),
    staleTime: Infinity,
    retry: false,
  })
  // Zones modifiables (déplacées, redimensionnées, ajoutées), en pixels de l'image ; décochées par index.
  const [edited, setEdited] = useState<AutofixPart[] | null>(null)
  const [off, setOff] = useState<Set<number>>(new Set())
  const drag = useRef<{ i: number; mode: 'move' | 'resize'; x0: number; y0: number; box: AutofixPart; moved: boolean } | null>(null)

  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    const measure = () => img.naturalWidth && setDisplay({ w: img.clientWidth, h: img.clientHeight })
    measure()
    img.addEventListener('load', measure)
    const ro = new ResizeObserver(measure)
    ro.observe(img)
    return () => {
      img.removeEventListener('load', measure)
      ro.disconnect()
    }
  }, [])

  const parts = edited ?? data?.parts ?? []
  const kept = parts.filter((_, i) => !off.has(i))
  const W = data?.width ?? 1
  const H = data?.height ?? 1
  const clamp = (b: AutofixPart): AutofixPart => {
    const width = Math.max(16, Math.min(W, b.width))
    const height = Math.max(16, Math.min(H, b.height))
    return { ...b, width, height, x: Math.max(0, Math.min(W - width, b.x)), y: Math.max(0, Math.min(H - height, b.y)) }
  }
  const update = (i: number, box: AutofixPart) => setEdited(parts.map((p, j) => (j === i ? clamp(box) : p)))
  const addZone = (kind: AutofixKind) => {
    const size = Math.round(Math.min(W, H) * 0.18)
    setEdited([...parts, { kind, x: (W - size) / 2, y: (H - size) / 2, width: size, height: size }])
  }
  const startDrag = (e: React.PointerEvent, i: number, mode: 'move' | 'resize') => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { i, mode, x0: e.clientX, y0: e.clientY, box: parts[i], moved: false }
  }
  const onDrag = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !scale) return
    const dx = (e.clientX - d.x0) / scale
    const dy = (e.clientY - d.y0) / scale
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true
    if (!d.moved) return
    update(
      d.i,
      d.mode === 'move' ? { ...d.box, x: d.box.x + dx, y: d.box.y + dy } : { ...d.box, width: d.box.width + dx, height: d.box.height + dy },
    )
  }
  const endDrag = (i: number) => {
    const d = drag.current
    drag.current = null
    // Un simple clic (sans glisser) coche ou décoche la zone.
    if (d && !d.moved && d.mode === 'move') toggle(i)
  }
  const toggle = (i: number) =>
    setOff((s) => {
      const next = new Set(s)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  const toggleKind = (kind: AutofixKind) => {
    const idx = parts.map((p, i) => (p.kind === kind ? i : -1)).filter((i) => i >= 0)
    const allOn = idx.every((i) => !off.has(i))
    setOff((s) => {
      const next = new Set(s)
      for (const i of idx) allOn ? next.add(i) : next.delete(i)
      return next
    })
  }

  const scale = data && display ? display.w / data.width : 0

  const fix = useMutation({
    mutationFn: () => generationsApi.autofix(asset.id, kept.map(({ kind, x, y, width, height }) => ({ kind, x, y, width, height }))),
    onSuccess: ({ thread, found }) => {
      toast.success(`Correction lancée (${found}) : le résultat arrive dans le fil.`)
      queryClient.invalidateQueries({ queryKey: qk.thread(thread.id) })
      queryClient.invalidateQueries({ queryKey: qk.threadsAll })
      onDone()
    },
    onError: (e) => toast.error((e as Error).message),
  })


  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" onClick={(e) => e.stopPropagation()}>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <img ref={imgRef} src={asset.url} alt="" draggable={false} className="max-h-full max-w-full rounded-lg object-contain select-none" />
        {display && scale > 0 && (
          <div className="absolute" style={{ width: display.w, height: display.h }}>
            {parts.map((p, i) => {
              const on = !off.has(i)
              return (
                <div
                  key={i}
                  role="button"
                  onPointerDown={(e) => startDrag(e, i, 'move')}
                  onPointerMove={onDrag}
                  onPointerUp={() => endDrag(i)}
                  title={on ? 'Glisser : déplacer · clic : ignorer cette zone' : 'Clic : corriger cette zone'}
                  className={cn('absolute cursor-move touch-none rounded-md border-2', on ? 'bg-white/5' : 'border-dashed opacity-50')}
                  style={{
                    left: p.x * scale,
                    top: p.y * scale,
                    width: p.width * scale,
                    height: p.height * scale,
                    borderColor: on ? colorOf(p.kind) : '#a3a3a3',
                  }}
                >
                  <span
                    className="absolute -top-5 left-0 rounded px-1 text-[10px] whitespace-nowrap text-black"
                    style={{ background: on ? colorOf(p.kind) : '#a3a3a3' }}
                  >
                    {KINDS.find((k) => k.id === p.kind)!.label.slice(0, -1).toLowerCase()} {on ? '' : '· ignoré'}
                  </span>
                  {on && (
                    <span
                      onPointerDown={(e) => startDrag(e, i, 'resize')}
                      onPointerMove={onDrag}
                      onPointerUp={() => endDrag(i)}
                      className="absolute -right-1.5 -bottom-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white"
                      style={{ background: colorOf(p.kind) }}
                      title="Glisser : redimensionner"
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-2xl bg-neutral-900/95 p-2.5 text-white shadow-xl">
        {isLoading ? (
          <span className="flex items-center gap-2 px-2 text-sm text-white/70">
            <Loader2 className="h-4 w-4 animate-spin" /> Recherche des visages, mains et pieds…
          </span>
        ) : error ? (
          <span className="px-2 text-sm text-red-300">{(error as Error).message}</span>
        ) : (
          <>
            {KINDS.map((k) => {
              const n = parts.filter((p) => p.kind === k.id).length
              const kept = parts.filter((p, i) => p.kind === k.id && !off.has(i)).length
              return (
                <button
                  key={k.id}
                  type="button"
                  disabled={!n}
                  onClick={() => toggleKind(k.id)}
                  className="flex h-8 items-center gap-1.5 rounded-full border border-white/15 px-3 text-xs disabled:opacity-30"
                  title={n ? 'Cocher ou décocher toutes ces zones' : 'Rien trouvé'}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: k.color }} />
                  {k.label} {n ? `${kept}/${n}` : '0'}
                </button>
              )
            })}
            <span className="mx-1 h-5 w-px bg-white/15" />
            {KINDS.map((k) => (
              <button
                key={`add-${k.id}`}
                type="button"
                onClick={() => addZone(k.id)}
                className="flex h-8 items-center gap-0.5 rounded-full px-2 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                title={`Ajouter une zone « ${k.label.slice(0, -1).toLowerCase()} », à placer sur l'image`}
              >
                <Plus className="h-3 w-3" /> {k.label.slice(0, -1)}
              </button>
            ))}
            <span className="mr-auto" />
            <Button size="sm" className="rounded-full" disabled={!kept.length || fix.isPending} onClick={() => fix.mutate()}>
              {fix.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Corriger {kept.length ? `(${kept.length})` : ''}
            </Button>
          </>
        )}
        <button type="button" onClick={onCancel} className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white" title="Fermer">
          <X className="h-4 w-4" />
        </button>
        <p className="w-full px-1 text-[11px] text-white/50">
          Clic sur un cadre : l'ignorer (un sac pris pour une main…). Glisser : le déplacer ; coin : le redimensionner. Le cadre
          doit couvrir toute la partie ratée : ce qui dépasse reste tel quel. ~1 min par zone ; le reste de l'image ne change pas.
        </p>
      </div>
    </div>
  )
}
