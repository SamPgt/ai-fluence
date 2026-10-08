import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cpu, Loader2, Power } from 'lucide-react'
import { toast } from 'sonner'
import type { ComfyState, ComfyStatus as Status } from '@ai-fluence/shared'

import { comfyApi } from '@/lib/api'
import { comfyStatusQuery, qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const STATE_LABEL: Record<ComfyState, string> = {
  stopped: 'Arrêté',
  starting: 'Démarrage…',
  running: 'Connecté',
  stopping: 'Arrêt…',
  error: 'Erreur',
}

const STATE_DOT: Record<ComfyState, string> = {
  stopped: 'bg-muted-foreground/50',
  starting: 'bg-amber-400 animate-pulse',
  running: 'bg-emerald-400',
  stopping: 'bg-amber-400 animate-pulse',
  error: 'bg-red-400',
}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} Go`

/** Statut du ComfyUI local, avec démarrage/arrêt. Invisible si le backend n'a pas de `COMFYUI_URL`. */
export function ComfyStatus() {
  const queryClient = useQueryClient()
  const { data: status } = useQuery(comfyStatusQuery())

  const onDone = (next: { status: Status }) => queryClient.setQueryData(qk.comfy, next.status)
  const onError = (err: Error) => toast.error(err.message)
  const start = useMutation({ mutationFn: comfyApi.start, onSuccess: onDone, onError })
  const stop = useMutation({ mutationFn: comfyApi.stop, onSuccess: onDone, onError })

  if (!status?.enabled) return null

  const busy = status.state === 'starting' || status.state === 'stopping' || start.isPending || stop.isPending
  const canStart = status.canControl && (status.state === 'stopped' || status.state === 'error')
  const canStop = status.canControl && status.state === 'running'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 border-t border-border/40 px-4 py-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Cpu className="h-3.5 w-3.5" />
          <span>
            ComfyUI : <span className="font-medium text-foreground">{STATE_LABEL[status.state]}</span>
          </span>
          <span className={cn('ml-auto h-2 w-2 rounded-full', STATE_DOT[status.state])} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-semibold">ComfyUI local</span>
          <span className="text-muted-foreground">{status.url}</span>
        </div>

        {status.state === 'running' && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {status.gpu && (
              <>
                <dt className="text-muted-foreground">GPU</dt>
                <dd>{status.gpu.name}</dd>
                <dt className="text-muted-foreground">VRAM libre</dt>
                <dd>
                  {gb(status.gpu.vramFree)} / {gb(status.gpu.vramTotal)}
                </dd>
              </>
            )}
            {status.version && (
              <>
                <dt className="text-muted-foreground">Version</dt>
                <dd>{status.version}</dd>
              </>
            )}
          </dl>
        )}

        {status.state === 'stopped' && (
          <p className="text-muted-foreground">
            {status.canControl
              ? 'ComfyUI ne tourne pas. Démarre-le pour générer en local.'
              : 'ComfyUI ne tourne pas. Lance-le depuis ton terminal (COMFYUI_LAUNCH non configuré).'}
          </p>
        )}
        {status.state === 'starting' && (
          <p className="text-muted-foreground">Démarrage en cours, ça peut prendre jusqu’à une minute.</p>
        )}
        {status.error && <p className="text-red-400">{status.error}</p>}

        {status.log.length > 0 && (status.state === 'starting' || status.state === 'error') && (
          <pre className="max-h-40 overflow-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
            {status.log.join('\n')}
          </pre>
        )}

        {(canStart || canStop || busy) && status.canControl && (
          <Button
            size="sm"
            variant={canStop ? 'outline' : 'default'}
            className="w-full"
            disabled={busy}
            onClick={() => (canStop ? stop.mutate() : start.mutate())}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
            {canStop ? 'Arrêter ComfyUI' : busy ? STATE_LABEL[status.state] : 'Démarrer ComfyUI'}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
