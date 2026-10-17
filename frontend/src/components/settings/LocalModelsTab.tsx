/**
 * Paramètres → Modèles locaux : les modèles de diffusion de ComfyUI (dossiers `diffusion_models` et `unet`).
 * Un fichier reconnu à son nom est rangé tout seul dans sa famille ; sinon on choisit son type (une variante de
 * klein 4B, de Z-Image…). Chaque fichier visible apparaît dans le menu « Modèle » de sa famille ; caché, il n'est
 * plus proposé, et une famille dont tous les fichiers sont cachés disparaît des modèles.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { LocalModelFile, LocalModelsResponse } from '@sublime/shared'

import { settingsApi } from '@/lib/api'
import { comfyStatusQuery, qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const AUTO = '__auto'
const LOCAL_MODELS_KEY = ['local-models'] as const

const sizeOf = (bytes: number | null) => (bytes === null ? '' : `${(bytes / 1e9).toFixed(1)} Go`)

export function LocalModelsTab() {
  const queryClient = useQueryClient()
  const { data: comfy } = useQuery(comfyStatusQuery())
  const running = comfy?.state === 'running'
  const { data, isLoading } = useQuery({
    queryKey: LOCAL_MODELS_KEY,
    queryFn: () => settingsApi.localModels(),
    enabled: running,
  })
  const update = useMutation({
    mutationFn: (body: { file: string; family?: string | null; hidden?: boolean }) => settingsApi.setLocalModel(body),
    onSuccess: (next) => {
      queryClient.setQueryData(LOCAL_MODELS_KEY, next)
      // Les modèles proposés et leur menu « Modèle » changent.
      queryClient.invalidateQueries({ queryKey: qk.catalog })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  if (!comfy) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
  if (!comfy.enabled) return <p className="text-sm text-muted-foreground">ComfyUI n'est pas configuré (COMFYUI_URL).</p>
  if (!running) return <p className="text-sm text-muted-foreground">Démarre ComfyUI pour voir ses modèles.</p>
  if (isLoading || !data) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />

  const groups = groupByFamily(data)
  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Les modèles de diffusion de ComfyUI (dossiers <code>diffusion_models</code> et <code>unet</code>). Un fichier reconnu à son nom
        est rangé tout seul ; pour une variante au nom différent (un klein 4B retravaillé…), choisis son type. Chaque fichier visible
        apparaît dans le menu « Modèle » de sa famille ; caché, il n'est plus proposé. Un fichier ajouté dans ComfyUI apparaît ici
        sans redémarrer. Le type doit être le bon : une variante garde l'encodeur de texte et le VAE de sa famille.
      </p>
      {groups.map((g) => {
        const visible = g.files.filter((f) => !f.hidden).length
        return (
          <section key={g.id} className="rounded-xl border border-border/60 bg-card/50">
            <div className="flex items-baseline gap-2 border-b border-border/40 px-4 py-2.5">
              <span className="text-sm font-semibold">{g.label}</span>
              <span className="text-xs text-muted-foreground">
                {g.id === 'unknown'
                  ? 'choisis leur type pour les utiliser'
                  : visible === 0
                    ? 'tout est caché : modèle retiré des choix'
                    : `${visible} visible${visible > 1 ? 's' : ''} sur ${g.files.length}`}
              </span>
            </div>
            {g.files.map((f) => (
              <FileRow
                key={f.file}
                file={f}
                data={data}
                pending={update.isPending && update.variables?.file === f.file}
                onChange={(patch) => update.mutate({ file: f.file, ...patch })}
              />
            ))}
          </section>
        )
      })}
    </div>
  )
}

function FileRow({
  file: f,
  data,
  pending,
  onChange,
}: {
  file: LocalModelFile
  data: LocalModelsResponse
  pending: boolean
  onChange: (patch: { family?: string | null; hidden?: boolean }) => void
}) {
  const labelOf = (id: string | null) => data.families.find((x) => x.id === id)?.label ?? 'non reconnu'
  // Wan : une paire de fichiers propre à son workflow, on peut seulement la cacher.
  const fixed = Boolean(f.detected && !data.families.find((x) => x.id === f.detected)?.assignable)
  return (
    <div className={cn('flex flex-wrap items-center gap-3 border-b border-border/30 px-4 py-2 last:border-0', f.hidden && 'opacity-50')}>
      <button
        type="button"
        onClick={() => onChange({ hidden: !f.hidden })}
        disabled={pending || (!f.family && !f.hidden)}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
        title={f.hidden ? 'Caché : clic pour le proposer de nouveau' : 'Visible : clic pour le cacher'}
      >
        {f.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.file}>
        {f.file}
      </span>
      <span className="w-14 text-right text-xs text-muted-foreground tabular-nums">{sizeOf(f.bytes)}</span>
      <Select
        value={f.assigned ? (f.family ?? AUTO) : AUTO}
        disabled={pending || fixed}
        onValueChange={(v) => onChange({ family: v === AUTO ? null : v })}
      >
        <SelectTrigger size="sm" className="h-8 w-56 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>Auto · {labelOf(f.detected)}</SelectItem>
          {data.families
            .filter((x) => x.assignable)
            .map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {x.label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
    </div>
  )
}

/** Fichiers rangés par famille (ordre du catalogue), les non reconnus à la fin. */
function groupByFamily(data: LocalModelsResponse) {
  const groups = data.families
    .map((fam) => ({ id: fam.id, label: fam.label, files: data.files.filter((f) => f.family === fam.id) }))
    .filter((g) => g.files.length)
  const unknown = data.files.filter((f) => !f.family)
  return unknown.length ? [...groups, { id: 'unknown', label: 'Non reconnus', files: unknown }] : groups
}
