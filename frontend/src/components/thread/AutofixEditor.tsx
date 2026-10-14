/**
 * Correction automatique (outil local, FLUX.2 klein) : les visages, mains et pieds de l'image sont repérés, montrés
 * en cadres colorés ; on décoche ceux qui sont faux (un sac pris pour une main), puis klein refait les zones gardées.
 * Le résultat arrive dans le fil de l'image (~1 min par zone) ; le reste de l'image ne change pas.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Asset } from '@ai-fluence/shared'

import { generationsApi, type AutofixKind } from '@/lib/api'
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
  // Zones cochées (par index) : toutes au départ.
  const [off, setOff] = useState<Set<number>>(new Set())

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

  const parts = data?.parts ?? []
  const kept = parts.filter((_, i) => !off.has(i))
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

  const scale = data && display ? display.w / data.width : 0

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" onClick={(e) => e.stopPropagation()}>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <img ref={imgRef} src={asset.url} alt="" draggable={false} className="max-h-full max-w-full rounded-lg object-contain select-none" />
        {display && scale > 0 && (
          <div className="absolute" style={{ width: display.w, height: display.h }}>
            {parts.map((p, i) => {
              const on = !off.has(i)
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggle(i)}
                  title={on ? 'Clic : ne pas corriger cette zone' : 'Clic : corriger cette zone'}
                  className={cn('absolute rounded-md border-2 transition', on ? 'bg-white/5' : 'border-dashed opacity-50')}
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
                </button>
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
          Clic sur un cadre pour l'ignorer (un sac pris pour une main…). Visages retravaillés en gardant les traits ; mains et
          pieds refaits entièrement. ~1 min par zone ; le reste de l'image ne change pas.
        </p>
      </div>
    </div>
  )
}
