import { useEffect, useRef, useState } from 'react'
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
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  APP_DEFAULT_FAMILY,
  getFamily,
  type Asset,
  type Generation,
  type GenerationRequest,
} from '@ai-fluence/shared'

import { assetsApi, generationsApi } from '@/lib/api'
import { composer } from '@/lib/composer-store'
import { catalogQuery, personasQuery, qk } from '@/lib/queries'
import { formatDuration, formatUsd, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { AssetThumb } from '@/components/composer/ReferencePicker'
import { formatOption } from '@/components/composer/ParamFields'
import { ModelPicker, ProviderLogo } from '@/components/composer/ModelPicker'
import { MediaViewer } from './MediaViewer'
import { UpscaleDialog } from './UpscaleDialog'
import { RelaunchDialog } from './RelaunchDialog'

function Elapsed({ since }: { since: string }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(
    0,
    Math.floor((Date.now() - new Date(since).getTime()) / 1000),
  )
  return <>{s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`}</>
}

function ActionButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
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

const isPending = (g: Generation) =>
  g.status === 'queued' || g.status === 'running'

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
 * Une demande et son résultat. `generations` : une seule génération, ou toutes
 * celles d'une série (×N), qui partagent la même demande et s'affichent en grille.
 */
export function GenerationItem({ generations }: { generations: Generation[] }) {
  const g = generations[0]
  const series = generations.length > 1
  const queryClient = useQueryClient()
  const [viewing, setViewing] = useState<Asset | null>(null)
  const [upscaling, setUpscaling] = useState<Asset | null>(null)
  const isUpscale = g.task === 'upscale'
  const [relaunch, setRelaunch] = useState<GenerationRequest | null>(null)
  const [deleting, setDeleting] = useState<{ kind: 'generation' } | { kind: 'asset'; asset: Asset } | null>(null)
  const anyPending = generations.some(isPending)
  const local = g.runtime === 'comfy'
  /** Même demande (nouveau seed), sur ce modèle ou un autre. */
  const relaunchRequest = (family: string): GenerationRequest => {
    const params = { ...g.params }
    delete params.seed
    return {
      threadId: g.threadId,
      personaId: g.personaId,
      family,
      refMode: g.refMode,
      prompt: g.prompt,
      params,
      // Modèle sans visage : l'image du visage redevient une simple référence.
      referenceAssetIds: [...g.references, ...(g.face && !keepFace(family) ? [g.face] : [])].map((r) => r.id),
      faceAssetId: keepFace(family) ? g.face!.id : null,
      contextIds: g.contexts.map((c) => c.id),
      loraIds: Object.keys(lorasOf(family)),
      loraWords: lorasOf(family),
      count: generations.length,
      // Les traits tirés au hasard sont retirés au hasard (dans toute la catégorie).
      traitIds: g.traits.filter((t) => !t.random).map((t) => t.optionId),
      traitSlots: g.traits.filter((t) => t.random).map((t) => ({ categoryId: t.categoryId, drawFrom: 'all' as const, pool: [] })),
    }
  }
  const keepFace = (family: string) => Boolean(g.face && catalog?.families.find((f) => f.id === family)?.supportsFace)
  const { data: catalog } = useQuery(catalogQuery())
  const { data: personas = [] } = useQuery(personasQuery())
  const persona = personas.find((p) => p.id === g.personaId) ?? null
  const def = getFamily(g.family)
  const pending = generations.some(isPending)
  // Coût réel une fois connu, sinon l'estimation pendant la génération.
  const realCost = generations.reduce((sum, m) => sum + Number(m.cost ?? 0), 0)
  const estimate = generations.reduce(
    (sum, m) => sum + Number(m.estimatedCost ?? 0),
    0,
  )
  // Génération locale (ComfyUI) : gratuite, pas de coût affiché.
  const costText =
    g.runtime === 'comfy'
      ? null
      : generations.some((m) => m.cost) && !pending
      ? formatUsd(realCost)
      : estimate > 0
        ? `≈ ${formatUsd(estimate)}`
        : null

  const toReference = useMutation({
    mutationFn: (asset: Asset) =>
      assetsApi.setReference(asset.id, persona!.id, true),
    onSuccess: () => {
      toast.success(`Ajoutée aux références de ${persona!.name}`)
      queryClient.invalidateQueries({ queryKey: qk.references(persona!.id) })
      queryClient.invalidateQueries({ queryKey: qk.personas })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  // Suppression : retire de l'app (fil, galerie), les fichiers restent sur le disque. En local, annule dans ComfyUI.
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
  /**
   * Modèle pour Éditer (image → image) ou Animer (image → vidéo) : le modèle de
   * cette génération s'il sait faire l'action (éditer = même demande, petite
   * modification), sinon celui du persona, sinon celui de l'app.
   */
  const pickFamily = (
    media: 'image' | 'video',
    needs: 'image-to-image' | 'image-to-video',
  ) => {
    const ok = (id: string | null | undefined) =>
      families.find((f) => f.id === id && f.media === media && f.tasks[needs])
    return (
      ok(g.family) ??
      ok(
        media === 'image'
          ? persona?.defaultImageFamily
          : persona?.defaultVideoFamily,
      ) ??
      ok(APP_DEFAULT_FAMILY[media]) ??
      // Filet de sécurité : le modèle de l'app a été retiré du catalogue.
      families.find((f) => f.media === media && f.tasks[needs])
    )?.id
  }

  /**
   * LoRA de cette génération, avec les mots envoyés. Anciennes générations : les
   * LoRA du persona pour ce modèle, sans mot (on ne réinjecte rien d'office).
   */
  const lorasOf = (family: string): Record<string, string[]> => {
    if (family !== g.family) return {}
    if (!g.loras.length && g.lorasApplied > 0) {
      return Object.fromEntries(
        (persona?.loras ?? [])
          .filter((l) => l.family === family)
          .map((l) => [l.id, []]),
      )
    }
    return Object.fromEntries(g.loras.map((l) => [l.id, l.triggerWords]))
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
      loras: lorasOf(family),
      count: generations.length,
      traits: g.traits.filter((t) => !t.random),
      slots: g.traits
        .filter((t) => t.random)
        .map((t) => ({ categoryId: t.categoryId, categoryLabel: t.categoryLabel, zone: t.zone, drawFrom: 'all' as const, pool: [] })),
      params,
    })
  }
  // Éditer / Animer : nouvelle intention, le composer repart de zéro avec cette image.
  const edit = (asset: Asset) =>
    composer.startFromImage(
      asset,
      pickFamily('image', 'image-to-image'),
      'edit',
    )
  const animate = (asset: Asset) =>
    composer.startFromImage(
      asset,
      pickFamily('video', 'image-to-video'),
      'animate',
    )

  // Actions au survol d'un résultat (image seule ou case d'une série).
  const outputActions = (asset: Asset) => (
    <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      {asset.mediaType === 'image' && (
        <>
          <ActionButton
            onClick={() => edit(asset)}
            title="Éditer (image → image)"
          >
            <Pencil className="h-3.5 w-3.5" />
          </ActionButton>
          <ActionButton
            onClick={() => animate(asset)}
            title="Animer (image → vidéo)"
          >
            <Clapperboard className="h-3.5 w-3.5" />
          </ActionButton>
        </>
      )}
      {persona && (
        <ActionButton
          onClick={() => toReference.mutate(asset)}
          title={`Ajouter aux références de ${persona.name}`}
        >
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
  // Visionneuse : passer d'un résultat à l'autre de la demande (toute la série ×N).
  const allOutputs = generations.flatMap((m) => m.outputs).filter((a) => a.mediaType === 'image')
  const viewingIndex = viewing ? allOutputs.findIndex((a) => a.id === viewing.id) : -1

  return (
    <div className="space-y-3">
      {/* Demande (côté utilisateur) : la bulle ne contient que les références et le texte,
          les actions et les infos du modèle sont en dessous, sur le fond. */}
      <div className="ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1.5">
        {(g.references.length > 0 || g.face || g.prompt.trim() || g.traits.length > 0) && (
          <div className="space-y-2 rounded-2xl rounded-tr-sm bg-secondary/70 px-4 py-3">
            {g.traits.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {g.traits.map((t) =>
                  t.random && series ? (
                    // Série : chaque image a son propre tirage, affiché sous l'image.
                    <span
                      key={t.optionId}
                      className="flex h-7 items-center gap-1.5 rounded-full border border-dashed border-brand/50 px-2.5 text-xs"
                      title="Tirée au hasard pour chaque image"
                    >
                      🎲 {t.categoryLabel}
                    </span>
                  ) : (
                    <span
                      key={t.optionId}
                      className="flex h-7 items-center gap-1.5 rounded-full border border-brand/30 bg-brand/[0.06] pr-2.5 pl-0.5 text-xs"
                      title={`${t.categoryLabel} : ${t.fragment}${t.random ? ' (tiré au hasard)' : ''}`}
                    >
                      {t.thumbnailUrl ? (
                        <img src={t.thumbnailUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                      ) : (
                        <span className="h-6 w-6 rounded-full bg-secondary" />
                      )}
                      {t.random && '🎲 '}
                      {t.label ?? t.fragment}
                    </span>
                  ),
                )}
              </div>
            )}
            {(g.references.length > 0 || g.face) && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {g.references.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setViewing(r)}
                    className="overflow-hidden rounded-lg"
                  >
                    <AssetThumb asset={r} className="h-14 w-14" />
                  </button>
                ))}
                {g.face && (
                  <button
                    onClick={() => setViewing(g.face)}
                    className="relative overflow-hidden rounded-lg"
                    title="Visage appliqué au résultat (ReActor)"
                  >
                    <AssetThumb asset={g.face} className="h-14 w-14" />
                    <span className="absolute bottom-0.5 left-0.5 rounded bg-brand px-1 text-[9px] font-semibold text-white">Visage</span>
                  </button>
                )}
              </div>
            )}
            {g.prompt.trim() && (
              <p className="text-[15px] whitespace-pre-wrap">
                {g.prompt.trim()}
              </p>
            )}
          </div>
        )}
        <div className="flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {/* Modifier la demande | modèle, paramètres, puis tags */}
          <div className="flex flex-wrap items-center justify-end gap-1.5 pr-1">
            {!isUpscale && (
              <>
                <button
                  onClick={() => rerun()}
                  className="rounded-md p-1 hover:bg-accent hover:text-foreground"
                  title="Modifier la demande : la remet dans le composer"
                  aria-label="Modifier la demande"
                >
                  <RotateCcw className="size-[14px]" />
                </button>
                <button
                  onClick={() => setDeleting({ kind: 'generation' })}
                  className="rounded-md p-1 hover:bg-accent hover:text-destructive"
                  title="Supprimer la demande et ses résultats"
                  aria-label="Supprimer la demande"
                >
                  <Trash2 className="size-[14px]" />
                </button>
                <span
                  aria-hidden
                  className="h-3.5 w-px bg-muted-foreground/40"
                />
              </>
            )}
            <span className="flex items-center gap-1.5 font-medium text-foreground/80">
              {def?.provider && (
                <ProviderLogo
                  provider={def.provider}
                  size="sm"
                  className="opacity-70"
                />
              )}
              {def?.label ?? g.family}
            </span>
            {Object.entries(g.params)
              .filter(([k, v]) => v !== undefined && k !== 'seed')
              .slice(0, 4)
              .map(([k, v]) => (
                <span key={k} className="rounded bg-secondary/60 px-1.5 py-0.5">
                  {formatOption(k, v)}
                </span>
              ))}
            {/* Série : nombre d'images générées avec cette demande. */}
            {series && (
              <span className="rounded bg-secondary/60 px-1.5 py-0.5 tabular-nums">
                x{generations.length}
              </span>
            )}
            {/* LoRA (violet) puis raccourcis (bleu), après le modèle et ses réglages. */}
            <RequestTags generation={g} />
          </div>
        </div>
      </div>

      {/* Résultat */}
      <div className="flex justify-start">
        <div className="w-full max-w-[85%] space-y-2">
          {/* Au-dessus du résultat : coût, puis « Série · N images » pour une série. */}
          {(costText || series) && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
              {costText && <span>{costText}</span>}
              {costText && series && (
                <span
                  aria-hidden
                  className="h-3.5 w-px bg-muted-foreground/40"
                />
              )}
              {series && <span>Série · {generations.length} images</span>}
            </div>
          )}
          {series && (
            <SeriesResults
              generations={generations}
              outputActions={outputActions}
              onView={setViewing}
              onCancelRest={(ids) =>
                removeGenerations(ids)
                  .then(() => queryClient.invalidateQueries({ queryKey: qk.thread(g.threadId) }))
                  .catch((e) => toast.error((e as Error).message))
              }
            />
          )}
          {!series && pending && (
            <div className="flex aspect-[4/3] max-w-md flex-col items-center justify-center gap-3 rounded-2xl border border-border/50 bg-muted/30">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
              <div className="text-center text-xs text-muted-foreground">
                <div>
                  {g.status === 'queued'
                    ? 'En file d’attente…'
                    : 'Génération en cours…'}
                </div>
                <div className="tabular-nums">
                  <Elapsed since={g.createdAt} />
                  {local ? ' · sur ton GPU' : g.estimatedCost && ` · ≈ ${formatUsd(g.estimatedCost)}`}
                </div>
              </div>
            </div>
          )}

          {!series && g.status === 'failed' && (
            <div className="flex max-w-md items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive-foreground" />
              <div className="space-y-2">
                <p>{g.errorMessage ?? 'La génération a échoué.'}</p>
                <button
                  onClick={() => rerun()}
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Modifier la demande
                </button>
              </div>
            </div>
          )}

          {!series && g.status === 'succeeded' && (
            <div
              className={cn(
                'grid gap-2',
                g.outputs.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
              )}
            >
              {g.outputs.map((asset) => (
                <div
                  key={asset.id}
                  // Largeur ajustée au média : une image verticale ne s'étire pas en largeur.
                  className="group relative w-fit max-w-xl overflow-hidden rounded-2xl border border-border/40 bg-black/20"
                >
                  {asset.mediaType === 'video' ? (
                    <video
                      src={asset.url}
                      controls
                      loop
                      playsInline
                      preload="metadata"
                      // Hauteur plafonnée : une vidéo 9:16 tient entière à l'écran.
                      className="block max-h-[70vh] w-auto max-w-full"
                    />
                  ) : (
                    <button onClick={() => setViewing(asset)} className="block">
                      <img
                        src={asset.url}
                        alt={g.prompt}
                        className="block max-h-[70vh] w-auto max-w-full object-contain"
                        loading="lazy"
                      />
                    </button>
                  )}
                  {outputActions(asset)}
                </div>
              ))}
            </div>
          )}

          {/* Pied : actions à gauche, coût à droite (comme le prix du composer et le total du fil) */}
          {!pending && (
            <div
              className={cn(
                'flex items-center gap-1 text-[11px] text-muted-foreground',
                g.outputs.length <= 1 && 'max-w-xl',
              )}
            >
              {!isUpscale && (
                <>
                  <button
                    onClick={() => setRelaunch(relaunchRequest(g.family))}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                    title="Relancer la même demande"
                  >
                    <RefreshCw className="h-3 w-3" /> Relancer
                  </button>
                  {/* Même menu que le composer, limité au type de média de cette génération. */}
                  <ModelPicker
                    families={families}
                    media={def?.media ?? 'image'}
                    value={g.family}
                    onChange={(id) => setRelaunch(relaunchRequest(id))}
                    trigger={
                      <button
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                        title="Relancer la même demande avec un autre modèle"
                      >
                        <Shuffle className="h-3 w-3" /> Relancer avec…
                      </button>
                    }
                  />
                </>
              )}
              {!series && (
                <span className="flex items-center gap-1 px-1.5 tabular-nums">
                  {timeAgo(g.createdAt)}
                  {g.seed !== null && ` · seed ${g.seed}`}
                  {g.durationMs !== null && (
                    <span title={local ? 'Temps de calcul sur ton GPU' : 'De l’envoi au résultat'}>· {formatDuration(g.durationMs)}</span>
                  )}
                  {local && ' · Local'}
                </span>
              )}
              {!isUpscale &&
                !series &&
                g.status === 'succeeded' &&
                g.outputs.length === 1 && (
                  <button
                    onClick={() => setUpscaling(g.outputs[0])}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                    title="Agrandir et affiner le résultat"
                  >
                    <ImageUpscale className="h-3 w-3" /> Upscale
                  </button>
                )}
            </div>
          )}
        </div>
      </div>

      <MediaViewer
        asset={viewing}
        onClose={() => setViewing(null)}
        onPrev={viewingIndex > 0 ? () => setViewing(allOutputs[viewingIndex - 1]) : undefined}
        onNext={viewingIndex >= 0 && viewingIndex < allOutputs.length - 1 ? () => setViewing(allOutputs[viewingIndex + 1]) : undefined}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting?.kind === 'asset' ? 'Supprimer ce résultat ?' : 'Supprimer cette demande ?'}
        description={
          deleting?.kind === 'asset'
            ? 'Il sera retiré du fil et de la galerie. Le fichier reste dans ton dossier local.'
            : anyPending && local
              ? `${series ? 'Les images en attente seront annulées' : 'La génération en cours sera annulée'} dans ComfyUI. La demande sera retirée du fil.`
              : `Le prompt et ${series ? `les ${generations.length} images de la série` : 'ses résultats'} seront retirés du fil et de la galerie. Les fichiers restent dans ton dossier local.`
        }
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
      <UpscaleDialog
        asset={upscaling}
        threadId={g.threadId}
        onClose={() => setUpscaling(null)}
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
  const local = generations[0].runtime === 'comfy'

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

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
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
            {local && <span className="ml-auto pr-1">Local</span>}
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
              {/* Tirages 🎲 propres à cette image */}
              {m.traits.some((t) => t.random) && (
                <div className="truncate px-0.5 text-[10px] text-brand" title={m.traits.filter((t) => t.random).map((t) => `${t.categoryLabel} : ${t.fragment}`).join('\n')}>
                  🎲 {m.traits.filter((t) => t.random).map((t) => t.label ?? t.fragment).join(' · ')}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const TAG_TONE = {
  lora: 'border-violet-400/40',
  context: 'border-brand/30',
} as const

/**
 * Tags de la demande (mots déclencheurs des LoRA puis raccourcis) résumés en une
 * pastille « Tags · N », du même style que les réglages ; la liste s'ouvre au survol.
 */
function RequestTags({ generation: g }: { generation: Generation }) {
  const tags = [
    ...g.loras.flatMap((l) =>
      (l.triggerWords.length ? l.triggerWords : [l.label || 'LoRA']).map(
        (text) => ({
          key: `lora-${l.id}-${text}`,
          text,
          title: l.label,
          tone: 'lora' as const,
        }),
      ),
    ),
    ...g.contexts.map((c) => ({
      key: `ctx-${c.id}`,
      text: c.label,
      title: c.text,
      tone: 'context' as const,
    })),
  ]
  if (!tags.length) return null

  const badge = (t: (typeof tags)[number]) => (
    <span
      key={t.key}
      title={t.title}
      className={cn(
        'max-w-40 truncate rounded-full border px-2 py-0.5 text-white/80',
        TAG_TONE[t.tone],
      )}
    >
      {t.text}
    </span>
  )

  return <TagsChip tags={tags} badge={badge} />
}

/** Pastille « Tags · N » : la liste des tags s'ouvre au survol. */
function TagsChip<T extends { key: string }>({
  tags,
  badge,
}: {
  tags: T[]
  badge: (t: T) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Petit délai à la sortie : on peut passer du « +N » au popover sans qu'il se ferme.
  const show = () => {
    clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const hide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          onMouseEnter={show}
          onMouseLeave={hide}
          className="cursor-default rounded bg-secondary/60 px-1.5 py-0.5 tabular-nums"
        >
          Tags · {tags.length}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        onMouseEnter={show}
        onMouseLeave={hide}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex w-auto max-w-72 flex-wrap gap-1 p-2 text-[11px]"
      >
        {tags.map(badge)}
      </PopoverContent>
    </Popover>
  )
}
