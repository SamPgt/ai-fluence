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
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getFamily,
  type Asset,
  type Generation,
  type GenerationRequest,
} from '@ai-fluence/shared'

import { assetsApi } from '@/lib/api'
import { composer } from '@/lib/composer-store'
import { catalogQuery, personasQuery, qk, settingsQuery } from '@/lib/queries'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ModelBadge } from '@/components/ui/model-badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { AssetThumb } from '@/components/composer/ReferencePicker'
import { formatOption } from '@/components/composer/ParamFields'
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
      referenceAssetIds: g.references.map((r) => r.id),
      contextIds: g.contexts.map((c) => c.id),
      loraIds: Object.keys(lorasOf(family)),
      loraWords: lorasOf(family),
      count: generations.length,
    }
  }
  const { data: catalog } = useQuery(catalogQuery())
  const { data: settings } = useQuery(settingsQuery())
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
  const costText =
    generations.some((m) => m.cost) && !pending
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

  const families = catalog?.families.filter((f) => f.available) ?? []
  const pickFamily = (
    media: 'image' | 'video',
    needs: 'image-to-image' | 'image-to-video',
  ) => {
    const candidates = [
      media === 'image'
        ? persona?.defaultImageFamily
        : persona?.defaultVideoFamily,
      media === 'image'
        ? settings?.defaultImageFamily
        : settings?.defaultVideoFamily,
      def?.media === media ? g.family : null,
    ]
    const ok = (id: string | null | undefined) =>
      families.find((f) => f.id === id && f.tasks[needs])
    return (
      candidates.map(ok).find(Boolean) ??
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
      attachments: g.references,
      refMode: g.refMode,
      contextIds: g.contexts.map((c) => c.id),
      loras: lorasOf(family),
      count: generations.length,
      params,
    })
  }
  const edit = (asset: Asset) =>
    composer.load({
      family: pickFamily('image', 'image-to-image'),
      prompt: '',
      attachments: [asset],
    })
  const animate = (asset: Asset) =>
    composer.load({
      family: pickFamily('video', 'image-to-video'),
      prompt: '',
      attachments: [asset],
      refMode: 'start-frame',
    })

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
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Demande (côté utilisateur) : la bulle ne contient que les références et le texte,
          les actions et les infos du modèle sont en dessous, sur le fond. */}
      <div className="ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1.5">
        {(g.references.length > 0 || g.prompt.trim()) && (
          <div className="space-y-2 rounded-2xl rounded-tr-sm bg-secondary/70 px-4 py-3">
            {g.references.length > 0 && (
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
                <span
                  aria-hidden
                  className="h-3.5 w-px bg-muted-foreground/40"
                />
              </>
            )}
            <span className="font-medium text-foreground/80">
              {def?.label ?? g.family}
            </span>
            {def?.badges.map((b) => (
              <ModelBadge key={b} badge={b} />
            ))}
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
                  {g.estimatedCost && ` · ≈ ${formatUsd(g.estimatedCost)}`}
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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                        title="Relancer la même demande avec un autre modèle"
                      >
                        <Shuffle className="h-3 w-3" /> Relancer avec…
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64">
                      <DropdownMenuLabel className="text-[11px] font-bold text-zinc-300 uppercase">
                        {def?.media === 'video'
                          ? 'Modèles vidéo'
                          : 'Modèles photo'}
                      </DropdownMenuLabel>
                      {families
                        .filter(
                          (f) => f.media === def?.media && f.id !== g.family,
                        )
                        .map((f) => (
                          <DropdownMenuItem
                            key={f.id}
                            onClick={() => setRelaunch(relaunchRequest(f.id))}
                            className="justify-between"
                          >
                            {f.label}
                            <span className="flex gap-1">
                              {f.badges.map((b) => (
                                <ModelBadge key={b} badge={b} />
                              ))}
                            </span>
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
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

      <MediaViewer asset={viewing} onClose={() => setViewing(null)} />
      <UpscaleDialog
        asset={upscaling}
        threadId={g.threadId}
        onClose={() => setUpscaling(null)}
      />
      <RelaunchDialog request={relaunch} onClose={() => setRelaunch(null)} />
    </div>
  )
}

/** Grille d'une série (×N) : progression, puis une case par image. */
function SeriesResults({
  generations,
  outputActions,
  onView,
}: {
  generations: Generation[]
  outputActions: (asset: Asset) => React.ReactNode
  onView: (asset: Asset) => void
}) {
  const pending = generations.filter(isPending)
  const done = generations.length - pending.length

  return (
    <div className="space-y-2">
      {pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <>
            <span className="tabular-nums">
              {done} / {generations.length} terminées ·{' '}
              <Elapsed since={generations[0].createdAt} />
            </span>
            <span className="h-1 w-24 overflow-hidden rounded-full bg-secondary">
              <span
                className="block h-full rounded-full bg-brand transition-[width]"
                style={{ width: `${(done / generations.length) * 100}%` }}
              />
            </span>
          </>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {generations.map((m) => {
          const asset = m.outputs[0]
          return (
            <div key={m.id} className="space-y-1">
              {m.status === 'succeeded' && asset ? (
                <div className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-border/40 bg-black/20">
                  {asset.mediaType === 'video' ? (
                    <video
                      src={asset.url}
                      controls
                      loop
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <button
                      onClick={() => onView(asset)}
                      className="block h-full w-full"
                    >
                      <img
                        src={asset.url}
                        alt={m.prompt}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  )}
                  {outputActions(asset)}
                </div>
              ) : isPending(m) ? (
                <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-xl border border-border/50 bg-muted/30 text-xs text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-brand" />
                  {m.status === 'queued' ? 'En file' : 'En cours'}
                </div>
              ) : m.status === 'failed' ? (
                <div
                  className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-center text-xs"
                  title={m.errorMessage ?? undefined}
                >
                  <AlertTriangle className="h-4 w-4 text-destructive-foreground" />
                  <span className="line-clamp-4">
                    {m.errorMessage ?? 'La génération a échoué.'}
                  </span>
                </div>
              ) : (
                <div className="flex aspect-[3/4] items-center justify-center rounded-xl border border-border/40 text-xs text-muted-foreground italic">
                  Résultat indisponible
                </div>
              )}
              <div className="truncate px-0.5 text-[10px] text-muted-foreground tabular-nums">
                #{m.batchIndex + 1}
              </div>
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
