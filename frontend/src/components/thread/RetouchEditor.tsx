/**
 * Retouche au pinceau (outil local, FLUX.2 klein) : on peint la zone ratée (une main à trois doigts, un objet en
 * trop…), on dit en quelques mots ce qu'il faut à la place, et klein refait seulement cette zone. Le résultat arrive
 * dans le fil de l'image, comme une nouvelle génération (~1 min) ; le reste de l'image ne change pas.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Brush, Loader2, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Asset } from '@ai-fluence/shared'

import { generationsApi } from '@/lib/api'
import { qk } from '@/lib/queries'
import { Button } from '@/components/ui/button'

/** Un trait, en pixels de l'image d'origine. */
interface Stroke {
  size: number
  points: [number, number][]
}

export function RetouchEditor({ asset, onDone, onCancel }: { asset: Asset; onDone: () => void; onCancel: () => void }) {
  const queryClient = useQueryClient()
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const drawing = useRef<Stroke | null>(null)
  // Taille du pinceau en pixels écran ; convertie en pixels de l'image à chaque trait.
  const [brush, setBrush] = useState(40)
  const [prompt, setPrompt] = useState('')
  const [display, setDisplay] = useState<{ w: number; h: number; scale: number } | null>(null)

  // Taille affichée de l'image (et rapport avec sa taille réelle), suivie au redimensionnement.
  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    const measure = () => {
      if (!img.naturalWidth) return
      const w = img.clientWidth
      setDisplay({ w, h: img.clientHeight, scale: img.naturalWidth / w })
    }
    measure()
    img.addEventListener('load', measure)
    const ro = new ResizeObserver(measure)
    ro.observe(img)
    return () => {
      img.removeEventListener('load', measure)
      ro.disconnect()
    }
  }, [])

  // Calque : les traits en rouge translucide, à l'échelle de l'écran.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !display) return
    canvas.width = display.w
    canvas.height = display.h
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Traits opaques sur le calque, transparence portée par le calque entier : pas de surcouche plus foncée.
    for (const s of [...strokes, ...(drawing.current ? [drawing.current] : [])]) paint(ctx, s, 1 / display.scale, '#ef4444')
  }, [strokes, display])

  const toImage = (e: React.PointerEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const scale = display?.scale ?? 1
    return [(e.clientX - rect.left) * scale, (e.clientY - rect.top) * scale]
  }
  const redraw = () => setStrokes((s) => [...s])

  const submit = useMutation({
    mutationFn: async () => {
      const img = imgRef.current!
      const W = img.naturalWidth
      const H = img.naturalHeight
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      for (const s of strokes) paint(ctx, s, 1, '#fff')
      // Cadre de la zone peinte (rayon du pinceau compris).
      const xs = strokes.flatMap((s) => s.points.flatMap(([x]) => [x - s.size / 2, x + s.size / 2]))
      const ys = strokes.flatMap((s) => s.points.flatMap(([, y]) => [y - s.size / 2, y + s.size / 2]))
      const x = Math.max(0, Math.floor(Math.min(...xs)))
      const y = Math.max(0, Math.floor(Math.min(...ys)))
      const box = { x, y, width: Math.min(W, Math.ceil(Math.max(...xs))) - x, height: Math.min(H, Math.ceil(Math.max(...ys))) - y }
      const mask = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Masque illisible.'))), 'image/png'))
      return generationsApi.retouch(asset.id, prompt, mask, box)
    },
    onSuccess: ({ thread }) => {
      toast.success('Retouche lancée : le résultat arrive dans le fil (~1 min).')
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
        {display && (
          <canvas
            ref={canvasRef}
            style={{ width: display.w, height: display.h }}
            className="absolute cursor-crosshair touch-none opacity-50"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drawing.current = { size: brush * (display.scale ?? 1), points: [toImage(e)] }
              redraw()
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return
              drawing.current.points.push(toImage(e))
              redraw()
            }}
            onPointerUp={() => {
              const s = drawing.current
              drawing.current = null
              if (s) setStrokes((all) => [...all, s])
            }}
          />
        )}
      </div>

      <div className="flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-2xl bg-neutral-900/95 p-2.5 text-white shadow-xl">
        <Brush className="ml-1 h-4 w-4 text-white/70" />
        <input
          type="range"
          min={8}
          max={160}
          value={brush}
          onChange={(e) => setBrush(Number(e.target.value))}
          className="w-24 accent-red-500"
          aria-label="Taille du pinceau"
          title="Taille du pinceau"
        />
        <button
          type="button"
          onClick={() => setStrokes((s) => s.slice(0, -1))}
          disabled={!strokes.length}
          className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30"
          title="Annuler le dernier trait"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && strokes.length && !submit.isPending && submit.mutate()}
          placeholder="À la place (facultatif, en anglais de préférence) : a natural hand holding the glass…"
          maxLength={1000}
          className="h-9 min-w-48 flex-1 rounded-full bg-white/10 px-4 text-sm placeholder:text-white/40 focus:outline-none"
        />
        <Button size="sm" className="rounded-full" disabled={!strokes.length || submit.isPending} onClick={() => submit.mutate()}>
          {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brush className="h-4 w-4" />}
          Retoucher
        </Button>
        <button type="button" onClick={onCancel} className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white" title="Quitter la retouche">
          <X className="h-4 w-4" />
        </button>
        <p className="w-full px-1 text-[11px] text-white/50">
          Peins la zone à refaire, un peu plus large que le défaut. Seule cette zone change ; le résultat arrive dans le fil.
        </p>
      </div>
    </div>
  )
}

/** Dessine un trait (points en pixels de l'image) à l'échelle `k`. */
function paint(ctx: CanvasRenderingContext2D, s: Stroke, k: number, color: string) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = s.size * k
  const [first, ...rest] = s.points
  if (!rest.length) {
    ctx.beginPath()
    ctx.arc(first[0] * k, first[1] * k, (s.size * k) / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.moveTo(first[0] * k, first[1] * k)
  for (const [x, y] of rest) ctx.lineTo(x * k, y * k)
  ctx.stroke()
}
