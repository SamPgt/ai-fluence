import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  BookmarkPlus,
  Clapperboard,
  Download,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Shuffle,
} from 'lucide-react'
import { toast } from 'sonner'
import { TASK_LABEL, getFamily, type Asset, type Generation } from '@ai-fluence/shared'

import { assetsApi } from '@/lib/api'
import { composer } from '@/lib/composer-store'
import { catalogQuery, personasQuery, qk, settingsQuery } from '@/lib/queries'
import { formatUsd, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ModelBadge } from '@/components/ui/model-badge'
import { AssetThumb } from '@/components/composer/ReferencePicker'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MediaViewer } from './MediaViewer'

function Elapsed({ since }: { since: string }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000))
  return <>{s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`}</>
}

function ActionButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80"
    >
      {children}
    </button>
  )
}

export function GenerationItem({ generation: g }: { generation: Generation }) {
  const queryClient = useQueryClient()
  const [viewing, setViewing] = useState<Asset | null>(null)
  const { data: catalog } = useQuery(catalogQuery())
  const { data: settings } = useQuery(settingsQuery())
  const { data: personas = [] } = useQuery(personasQuery())
  const persona = personas.find((p) => p.id === g.personaId) ?? null
  const def = getFamily(g.family)
  const pending = g.status === 'queued' || g.status === 'running'

  const toReference = useMutation({
    mutationFn: (asset: Asset) => assetsApi.setReference(asset.id, persona!.id, true),
    onSuccess: () => {
      toast.success(`Ajoutée aux références de ${persona!.name}`)
      queryClient.invalidateQueries({ queryKey: qk.references(persona!.id) })
      queryClient.invalidateQueries({ queryKey: qk.personas })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const families = catalog?.families.filter((f) => f.available) ?? []
  const pickFamily = (media: 'image' | 'video', needs: 'image-to-image' | 'image-to-video') => {
    const candidates = [
      media === 'image' ? persona?.defaultImageFamily : persona?.defaultVideoFamily,
      media === 'image' ? settings?.defaultImageFamily : settings?.defaultVideoFamily,
      def?.media === media ? g.family : null,
    ]
    const ok = (id: string | null | undefined) => families.find((f) => f.id === id && f.tasks[needs])
    return (candidates.map(ok).find(Boolean) ?? families.find((f) => f.media === media && f.tasks[needs]))?.id
  }

  /** Recharge le composer avec cette génération (modèle au choix). */
  const rerun = (family = g.family, keepSeed = false) => {
    const params = { ...g.params }
    if (!keepSeed) delete params.seed
    composer.load({ family, prompt: g.prompt, attachments: g.references, refMode: g.refMode, params })
  }
  const edit = (asset: Asset) => composer.load({ family: pickFamily('image', 'image-to-image'), prompt: '', attachments: [asset] })
  const animate = (asset: Asset) =>
    composer.load({ family: pickFamily('video', 'image-to-video'), prompt: '', attachments: [asset], refMode: 'start-frame' })

  return (
    <div className="space-y-3">
      {/* Demande (côté utilisateur) */}
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-2 rounded-2xl rounded-tr-sm bg-secondary/70 px-4 py-3">
          {g.references.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {g.references.map((r) => (
                <button key={r.id} onClick={() => setViewing(r)} className="overflow-hidden rounded-lg">
                  <AssetThumb asset={r} className="h-14 w-14" />
                </button>
              ))}
            </div>
          )}
          {g.prompt && <p className="text-[15px] whitespace-pre-wrap">{g.prompt}</p>}
          <div className="flex flex-wrap items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/80">{def?.label ?? g.family}</span>
            {def?.badges.map((b) => <ModelBadge key={b} badge={b} />)}
            <span>· {TASK_LABEL[g.task]}</span>
            {g.lorasApplied > 0 && <span className="text-violet-300">· LoRA ×{g.lorasApplied}</span>}
            {Object.entries(g.params)
              .filter(([k, v]) => v !== undefined && k !== 'seed')
              .slice(0, 4)
              .map(([k, v]) => (
                <span key={k} className="rounded bg-background/50 px-1.5 py-0.5">
                  {String(v)}
                </span>
              ))}
          </div>
        </div>
      </div>

      {/* Résultat */}
      <div className="flex justify-start">
        <div className="w-full max-w-[85%] space-y-2">
          {pending && (
            <div className="flex aspect-[4/3] max-w-md flex-col items-center justify-center gap-3 rounded-2xl border border-border/50 bg-muted/30">
              <Loader2 className="h-6 w-6 animate-spin text-violet-300" />
              <div className="text-center text-xs text-muted-foreground">
                <div>{g.status === 'queued' ? 'En file d’attente…' : 'Génération en cours…'}</div>
                <div className="tabular-nums">
                  <Elapsed since={g.createdAt} />
                  {g.estimatedCost && ` · ≈ ${formatUsd(g.estimatedCost)}`}
                </div>
              </div>
            </div>
          )}

          {g.status === 'failed' && (
            <div className="flex max-w-md items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive-foreground" />
              <div className="space-y-2">
                <p>{g.errorMessage ?? 'La génération a échoué.'}</p>
                <button onClick={() => rerun()} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  Recharger dans le composer
                </button>
              </div>
            </div>
          )}

          {g.status === 'succeeded' && (
            <div className={cn('grid gap-2', g.outputs.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
              {g.outputs.map((asset) => (
                <div key={asset.id} className="group relative max-w-xl overflow-hidden rounded-2xl border border-border/40 bg-black/20">
                  {asset.mediaType === 'video' ? (
                    <video src={asset.url} controls loop playsInline preload="metadata" className="w-full" />
                  ) : (
                    <button onClick={() => setViewing(asset)} className="block w-full">
                      <img src={asset.url} alt={g.prompt} className="w-full object-contain" loading="lazy" />
                    </button>
                  )}
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {asset.mediaType === 'image' && (
                      <>
                        <ActionButton onClick={() => edit(asset)} title="Éditer (image → image)">
                          <Pencil className="h-3.5 w-3.5" />
                        </ActionButton>
                        <ActionButton onClick={() => animate(asset)} title="Animer (image → vidéo)">
                          <Clapperboard className="h-3.5 w-3.5" />
                        </ActionButton>
                      </>
                    )}
                    {persona && (
                      <ActionButton onClick={() => toReference.mutate(asset)} title={`Ajouter aux références de ${persona.name}`}>
                        <BookmarkPlus className="h-3.5 w-3.5" />
                      </ActionButton>
                    )}
                    <a
                      href={`${asset.url}?download=1`}
                      title="Télécharger"
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pied : coût, temps, actions */}
          {!pending && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="tabular-nums">
                {g.cost ? formatUsd(g.cost) : '—'}
                {g.cost && !g.settled && ' (provisoire)'}
              </span>
              <span>· {timeAgo(g.createdAt)}</span>
              {g.seed !== null && <span>· seed {g.seed}</span>}
              <button onClick={() => rerun()} className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground" title="Varier : même demande, nouveau seed">
                <Shuffle className="h-3 w-3" /> Varier
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="rounded p-1 hover:bg-accent hover:text-foreground" aria-label="Plus d’actions">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-60">
                  <DropdownMenuItem onClick={() => rerun(g.family, true)}>
                    <RefreshCw className="h-4 w-4" /> Relancer à l’identique (même seed)
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Shuffle className="mr-2 h-4 w-4 text-muted-foreground" /> Relancer avec…
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-64">
                      <DropdownMenuLabel className="text-[11px] font-bold text-zinc-300 uppercase">
                        {def?.media === 'video' ? 'Modèles vidéo' : 'Modèles photo'}
                      </DropdownMenuLabel>
                      {families
                        .filter((f) => f.media === def?.media && f.id !== g.family)
                        .map((f) => (
                          <DropdownMenuItem key={f.id} onClick={() => rerun(f.id)} className="justify-between">
                            {f.label}
                            <span className="flex gap-1">
                              {f.badges.map((b) => <ModelBadge key={b} badge={b} />)}
                            </span>
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px] font-normal break-words whitespace-pre-wrap text-muted-foreground">
                    Prompt envoyé : {g.finalPrompt || '—'}
                  </DropdownMenuLabel>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>

      <MediaViewer asset={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}
