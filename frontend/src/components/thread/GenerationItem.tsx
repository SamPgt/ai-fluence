import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  BookmarkPlus,
  Clapperboard,
  Download,
  Loader2,
  Pencil,
  RefreshCw,
  Shuffle,
  ImageUpscale,
  SquarePen,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { getFamily, type Asset, type Generation, type GenerationRequest } from '@ai-fluence/shared'

import { assetsApi, generationsApi } from '@/lib/api'
import { composer } from '@/lib/composer-store'
import { catalogQuery, personasQuery, qk, settingsQuery } from '@/lib/queries'
import { formatDuration, formatUsd, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ModelBadge } from '@/components/ui/model-badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { AssetThumb } from '@/components/composer/ReferencePicker'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MediaViewer } from './MediaViewer'
import { UpscaleDialog } from './UpscaleDialog'
import { RelaunchDialog } from './RelaunchDialog'

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

const isPending = (g: Generation) => g.status === 'queued' || g.status === 'running'

/** Rafraîchit le composant chaque seconde tant que `active` (chronos, temps restant). */
function useTick(active: boolean) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [active])
}

/**
 * Une demande et son résultat. `generations` : une seule génération, ou toutes celles d'une série (×N),
 * qui partagent la même demande et s'affichent en grille.
 */
export function GenerationItem({ generations }: { generations: Generation[] }) {
  const g = generations[0]
  const series = generations.length > 1
  const anyPending = generations.some(isPending)
  const queryClient = useQueryClient()
  const [viewing, setViewing] = useState<Asset | null>(null)
  const [upscaling, setUpscaling] = useState<Asset | null>(null)
  const isUpscale = g.task === 'upscale'
  const [relaunch, setRelaunch] = useState<GenerationRequest | null>(null)
  const [deleting, setDeleting] = useState<{ kind: 'generation' } | { kind: 'asset'; asset: Asset } | null>(null)
  /** Même demande (nouveau seed), sur ce modèle ou un autre. */
  const relaunchRequest = (family: string): GenerationRequest => {
    const params = { ...g.params }
    delete params.seed
    // Modèle sans visage : l'image du visage redevient une simple référence.
    const keepFace = Boolean(g.face && catalog?.families.find((f) => f.id === family)?.supportsFace)
    return {
      threadId: g.threadId,
      personaId: g.personaId,
      family,
      refMode: g.refMode,
      prompt: g.prompt,
      params,
      referenceAssetIds: [...g.references, ...(g.face && !keepFace ? [g.face] : [])].map((r) => r.id),
      faceAssetId: keepFace ? g.face!.id : null,
      contextIds: g.contexts.map((c) => c.id),
      count: generations.length,
      traitIds: g.traits.map((t) => t.optionId),
    }
  }
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

  // Suppression : retire de l'app (fil, galerie), les fichiers restent sur le disque.
  const removeGenerations = async (ids: string[]) => {
    const results = await Promise.allSettled(ids.map((id) => generationsApi.remove(id)))
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) throw failed.reason
  }
  const remove = useMutation({
    mutationFn: async (target: NonNullable<typeof deleting>) => {
      if (target.kind === 'generation') await removeGenerations(generations.map((m) => m.id))
      else await assetsApi.remove(target.asset.id)
    },
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: qk.thread(g.threadId) })
      queryClient.invalidateQueries({ queryKey: qk.threadsAll })
      queryClient.invalidateQueries({ queryKey: ['gallery'] })
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
    composer.load({
      family,
      prompt: g.prompt.trim(),
      attachments: g.face ? [...g.references, g.face] : g.references,
      faceId: g.face?.id ?? null,
      refMode: g.refMode,
      contextIds: g.contexts.map((c) => c.id),
      count: generations.length,
      traits: g.traits,
      params,
    })
  }
  const edit = (asset: Asset) => composer.load({ family: pickFamily('image', 'image-to-image'), prompt: '', attachments: [asset] })
  const animate = (asset: Asset) =>
    composer.load({ family: pickFamily('video', 'image-to-video'), prompt: '', attachments: [asset], refMode: 'start-frame' })

  const outputActions = (asset: Asset) => (
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
      {!isUpscale && settings?.hasApiKey && (
        <ActionButton onClick={() => setUpscaling(asset)} title="Upscale">
          <ImageUpscale className="h-3.5 w-3.5" />
        </ActionButton>
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
      <ActionButton onClick={() => setDeleting({ kind: 'asset', asset })} title="Supprimer ce résultat">
        <Trash2 className="h-3.5 w-3.5" />
      </ActionButton>
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Demande (côté utilisateur) : la bulle ne contient que les références et le texte,
          les actions et les infos du modèle sont en dessous, sur le fond. */}
      <div className="ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1.5">
        {(g.references.length > 0 || g.face || g.prompt.trim() || g.traits.length > 0) && (
          <div className="space-y-2 rounded-2xl rounded-tr-sm bg-secondary/70 px-4 py-3">
            {g.traits.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {g.traits.map((t) => (
                  <span
                    key={t.optionId}
                    className="flex h-7 items-center gap-1.5 rounded-full border border-brand/30 bg-brand/[0.06] pr-2.5 pl-0.5 text-xs"
                    title={`${t.categoryLabel} : ${t.fragment}`}
                  >
                    {t.thumbnailUrl ? (
                      <img src={t.thumbnailUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <span className="h-6 w-6 rounded-full bg-secondary" />
                    )}
                    {t.label ?? t.fragment}
                  </span>
                ))}
              </div>
            )}
            {(g.references.length > 0 || g.face) && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {g.references.map((r) => (
                  <button key={r.id} onClick={() => setViewing(r)} className="overflow-hidden rounded-lg">
                    <AssetThumb asset={r} className="h-14 w-14" />
                  </button>
                ))}
                {g.face && (
                  <button
                    onClick={() => setViewing(g.face)}
                    className="relative overflow-hidden rounded-lg"
                    title="Visage appliqué au résultat"
                  >
                    <AssetThumb asset={g.face} className="h-14 w-14" />
                    <span className="absolute bottom-0.5 left-0.5 rounded bg-emerald-600/90 px-1 text-[9px] font-medium text-white">
                      Visage
                    </span>
                  </button>
                )}
              </div>
            )}
            {g.prompt.trim() && <p className="text-[15px] whitespace-pre-wrap">{g.prompt.trim()}</p>}
          </div>
        )}
        <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {/* Actions sur la demande */}
          {!isUpscale ? (
            <div className="-ml-0.5 flex items-center gap-0.5">
              <button
                onClick={() => rerun()}
                className="rounded-md p-1.5 hover:bg-accent hover:text-foreground"
                title="Modifier la demande : la remet dans le composer"
                aria-label="Modifier la demande"
              >
                <SquarePen className="size-[14.4px]" />
              </button>
              <button
                onClick={() => setRelaunch(relaunchRequest(g.family))}
                className="flex items-center gap-1 rounded-md px-1.5 py-1.5 hover:bg-accent hover:text-foreground"
                title="Relancer la même demande avec un nouveau seed"
              >
                <RefreshCw className="size-[14.4px]" /> Relancer
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-1 rounded-md px-1.5 py-1.5 hover:bg-accent hover:text-foreground"
                    title="Relancer la même demande avec un autre modèle"
                  >
                    <Shuffle className="size-[14.4px]" /> Relancer avec…
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel className="text-[11px] font-bold text-zinc-300 uppercase">
                    {def?.media === 'video' ? 'Modèles vidéo' : 'Modèles photo'}
                  </DropdownMenuLabel>
                  {families
                    .filter((f) => f.media === def?.media && f.id !== g.family)
                    .map((f) => (
                      <DropdownMenuItem key={f.id} onClick={() => setRelaunch(relaunchRequest(f.id))} className="justify-between">
                        {f.label}
                        <span className="flex gap-1">
                          {f.badges.map((b) => <ModelBadge key={b} badge={b} />)}
                        </span>
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                onClick={() => setDeleting({ kind: 'generation' })}
                className="rounded-md p-1.5 hover:bg-accent hover:text-destructive"
                title="Supprimer la demande et ses résultats"
                aria-label="Supprimer la demande"
              >
                <Trash2 className="size-[14.4px]" />
              </button>
            </div>
          ) : (
            <span />
          )}
          {/* Contextes, modèle et paramètres */}
          <div className="flex flex-wrap items-center justify-end gap-1.5 pr-1">
            {g.contexts.map((c) => (
              <span key={c.id} title={c.text} className="rounded-full border border-brand/30 px-2 py-0.5 text-brand/90">
                {c.label}
              </span>
            ))}
            <span className="font-medium text-foreground/80">{def?.label ?? g.family}</span>
            {def?.badges.map((b) => <ModelBadge key={b} badge={b} />)}
            {g.lorasApplied > 0 && <span className="text-violet-300">· LoRA ×{g.lorasApplied}</span>}
            {Object.entries(g.params)
              .filter(([k, v]) => v !== undefined && k !== 'seed')
              .slice(0, 4)
              .map(([k, v]) => (
                <span key={k} className="rounded bg-secondary/60 px-1.5 py-0.5">
                  {/* Fichiers ComfyUI (modèle, LoRA) : sans l'extension. */}
                  {String(v).replace(/\.(safetensors|ckpt|pt|gguf)$/i, '')}
                </span>
              ))}
          </div>
        </div>
      </div>

      {/* Résultat */}
      {series && (
        <SeriesResults
          generations={generations}
          outputActions={outputActions}
          onView={setViewing}
          onCancelRest={(ids) => removeGenerations(ids).then(() => {
            queryClient.invalidateQueries({ queryKey: qk.thread(g.threadId) })
          }).catch((e) => toast.error((e as Error).message))}
        />
      )}
      {!series && (
      <div className="flex justify-start">
        <div className="w-full max-w-[85%] space-y-2">
          {pending && (
            <div className="flex aspect-[4/3] max-w-md flex-col items-center justify-center gap-3 rounded-2xl border border-border/50 bg-muted/30">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
              <div className="text-center text-xs text-muted-foreground">
                <div>{g.status === 'queued' ? 'En file d’attente…' : 'Génération en cours…'}</div>
                <div className="tabular-nums">
                  <Elapsed since={g.createdAt} />
                  {g.provider === 'comfy' ? ' · local' : g.estimatedCost && ` · ≈ ${formatUsd(g.estimatedCost)}`}
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
                  Modifier la demande
                </button>
              </div>
            </div>
          )}

          {g.status === 'succeeded' && g.outputs.length === 0 && (
            <p className="text-xs text-muted-foreground italic">Résultat supprimé.</p>
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
                  {outputActions(asset)}
                </div>
              ))}
            </div>
          )}

          {/* Pied : date et actions à gauche, coût à droite (comme le prix du composer et le total du fil) */}
          {!pending && (
            <div className={cn('flex items-center gap-2 text-[11px] text-muted-foreground', g.outputs.length <= 1 && 'max-w-xl')}>
              <span>{timeAgo(g.createdAt)}</span>
              {g.seed !== null && <span>· seed {g.seed}</span>}
              {g.durationMs !== null && (
                <span title={g.provider === 'comfy' ? 'Temps de calcul sur ton GPU' : 'De l’envoi au résultat'}>
                  · {formatDuration(g.durationMs)}
                </span>
              )}
              {!isUpscale && settings?.hasApiKey && g.status === 'succeeded' && g.outputs.length === 1 && (
                <button
                  onClick={() => setUpscaling(g.outputs[0])}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                  title="Agrandir et affiner le résultat"
                >
                  <ImageUpscale className="h-3 w-3" /> Upscale
                </button>
              )}
              <span className="ml-auto pr-1 tabular-nums">
                {g.provider === 'comfy' ? 'Local' : g.cost ? formatUsd(g.cost) : '—'}
                {g.provider !== 'comfy' && g.cost && !g.settled && ' (provisoire)'}
              </span>
            </div>
          )}
        </div>
      </div>
      )}

      <MediaViewer
        asset={viewing}
        onClose={() => setViewing(null)}
        // Les images de la demande (toute la série ×N) : flèches pour comparer sans quitter le plein écran.
        assets={generations.flatMap((x) => x.outputs)}
        onNavigate={setViewing}
      />
      <UpscaleDialog asset={upscaling} threadId={g.threadId} onClose={() => setUpscaling(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting?.kind === 'asset' ? 'Supprimer ce résultat ?' : 'Supprimer cette demande ?'}
        description={
          deleting?.kind === 'asset'
            ? 'Il sera retiré du fil et de la galerie. Le fichier reste dans ton dossier local.'
            : anyPending && g.provider === 'comfy'
              ? `${series ? 'Les images en attente seront annulées' : 'La génération en cours sera annulée'} dans ComfyUI. La demande sera retirée du fil.`
              : `Le prompt et ${series ? `les ${generations.length} images de la série` : 'ses résultats'} seront retirés du fil et de la galerie. Les fichiers restent dans ton dossier local.`
        }
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
      <RelaunchDialog request={relaunch} onClose={() => setRelaunch(null)} />
    </div>
  )
}

/** Grille d'une série (×N) : progression, temps restant estimé, une case par image. */
function SeriesResults({
  generations,
  outputActions,
  onView,
  onCancelRest,
}: {
  generations: Generation[]
  outputActions: (asset: Asset) => React.ReactNode
  onView: (asset: Asset) => void
  onCancelRest: (ids: string[]) => void
}) {
  const pending = generations.filter(isPending)
  useTick(pending.length > 0)
  const done = generations.filter((m) => !isPending(m))
  const local = generations[0].provider === 'comfy'

  // Temps restant : durée moyenne des images terminées × images restantes, moins le temps déjà passé sur l'image en cours.
  const durations = done.map((m) => m.durationMs).filter((d): d is number => d !== null)
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null
  const runningSince = (m: Generation) => {
    const previous = generations.filter((x) => x.batchIndex < m.batchIndex && x.completedAt).map((x) => x.completedAt!)
    return previous.sort().at(-1) ?? m.createdAt
  }
  const running = generations.find((m) => m.status === 'running')
  const remainingMs =
    avg !== null && pending.length
      ? Math.max(0, avg * pending.length - (running && local ? Date.now() - new Date(runningSince(running)).getTime() : 0))
      : null
  const queued = generations.filter((m) => m.status === 'queued')
  const cost = generations.reduce((sum, m) => sum + Number(m.cost ?? 0), 0)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Série · {generations.length} images</span>
        {pending.length > 0 ? (
          <>
            <span className="tabular-nums">
              {done.length} / {generations.length} terminées
              {remainingMs !== null && ` · reste ≈ ${formatDuration(remainingMs)}`}
            </span>
            <span className="h-1 w-24 overflow-hidden rounded-full bg-secondary">
              <span
                className="block h-full rounded-full bg-brand transition-[width]"
                style={{ width: `${(done.length / generations.length) * 100}%` }}
              />
            </span>
            {local && (
              <button
                onClick={() => onCancelRest(pending.map((m) => m.id))}
                className="ml-auto rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                title="Annule dans ComfyUI les images pas encore générées"
              >
                Annuler le reste
              </button>
            )}
          </>
        ) : (
          <>
            <span>· {timeAgo(generations[0].createdAt)}</span>
            {durations.length > 0 && (
              <span title={local ? 'Temps de calcul total sur ton GPU' : 'Cumul des durées'}>
                · {formatDuration(durations.reduce((a, b) => a + b, 0))}
              </span>
            )}
            <span className="ml-auto pr-1 tabular-nums">{local ? 'Local' : formatUsd(cost)}</span>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {generations.map((m) => {
          const asset = m.outputs[0]
          return (
            <div key={m.id} className="space-y-1">
              {m.status === 'succeeded' && asset ? (
                <div className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-border/40 bg-black/20">
                  {asset.mediaType === 'video' ? (
                    <video src={asset.url} controls loop playsInline preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    <button onClick={() => onView(asset)} className="block h-full w-full">
                      <img src={asset.url} alt={m.prompt} className="h-full w-full object-cover" loading="lazy" />
                    </button>
                  )}
                  {outputActions(asset)}
                </div>
              ) : m.status === 'running' ? (
                <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-xl border border-border/50 bg-muted/30 text-xs text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-brand" />
                  <span className="tabular-nums">
                    En cours · <Elapsed since={local ? runningSince(m) : m.createdAt} />
                  </span>
                </div>
              ) : m.status === 'queued' ? (
                <div className="flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed border-border/60 text-xs text-muted-foreground">
                  En file · {queued.indexOf(m) + 1}
                </div>
              ) : m.status === 'failed' ? (
                <div
                  className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-center text-xs"
                  title={m.errorMessage ?? undefined}
                >
                  <AlertTriangle className="h-4 w-4 text-destructive-foreground" />
                  <span className="line-clamp-4">{m.errorMessage ?? 'La génération a échoué.'}</span>
                </div>
              ) : (
                <div className="flex aspect-[3/4] items-center justify-center rounded-xl border border-border/40 text-xs text-muted-foreground italic">
                  Résultat supprimé
                </div>
              )}
              <div className="truncate px-0.5 text-[10px] text-muted-foreground tabular-nums">
                #{m.batchIndex + 1}
                {m.seed !== null && ` · seed ${m.seed}`}
                {m.durationMs !== null && ` · ${formatDuration(m.durationMs)}`}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
