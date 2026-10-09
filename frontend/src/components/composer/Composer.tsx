/**
 * Composer de génération (évolution du ChatInput du fork) : prompt, pièces
 * jointes, modèle, paramètres, devis en direct et envoi.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSelector } from '@tanstack/react-store'
import { ArrowUp, Film, ImageIcon, ImagePlus, Info, Loader2, ScanFace, Shapes, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  TASK_LABEL,
  buildInput,
  resolveTask,
  schemaSupportsLoras,
  type GenerationRequest,
  type PriceChangedResponse,
  type TaskKind,
} from '@ai-fluence/shared'

import { ApiError, assetsApi, generationsApi, promptsApi } from '@/lib/api'
import { composer, composerStore } from '@/lib/composer-store'
import { catalogQuery, personasQuery, presetsQuery, qk, settingsQuery } from '@/lib/queries'
import { formatUnit, formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ModelPicker } from './ModelPicker'
import {
  ParamField,
  ParamsPopover,
  QUICK_FIELDS,
  editableFields,
  labelOf,
} from './ParamFields'
import { ContextChips } from './PresetChips'
import { AssetThumb, ReferencePicker } from './ReferencePicker'
import { TraitPicker } from './TraitPicker'

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Tailles de série proposées dans le composer. */
const SERIES_SIZES = [1, 4, 8]

interface ComposerProps {
  threadId?: string
  personaId: string | null
  /** Modèle proposé par défaut (ex. celui de la dernière génération du fil). */
  suggestedFamily?: string | null
}

export function Composer({
  threadId,
  personaId,
  suggestedFamily,
}: ComposerProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [dragging, setDragging] = useState(false)

  const state = useSelector(composerStore, (s) => s)
  const { data: settings } = useQuery(settingsQuery())
  const { data: catalog, error: catalogError } = useQuery(
    catalogQuery(Boolean(settings)),
  )
  const { data: personas = [] } = useQuery(personasQuery())
  const { data: contexts = [] } = useQuery(presetsQuery())
  const persona = personas.find((p) => p.id === personaId) ?? null
  const families = catalog?.families ?? []

  // Modèle par défaut : dernier du fil > persona > paramètres > premier modèle photo dispo.
  useEffect(() => {
    if (
      !catalog ||
      (state.family && families.some((f) => f.id === state.family))
    )
      return
    const preferred = [
      suggestedFamily,
      persona?.defaultImageFamily,
      settings?.defaultImageFamily,
    ].find((id) => id && families.some((f) => f.id === id && f.available))
    const fallback = families.find((f) => f.media === 'image' && f.available)
    if (preferred || fallback)
      composer.setFamily((preferred ?? fallback!.id) as string)
  }, [catalog, persona?.id, suggestedFamily]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.focusTick) textareaRef.current?.focus()
  }, [state.focusTick])

  const family = families.find((f) => f.id === state.family)
  const isLocal = family?.provider === 'comfy'
  const params = (state.family && state.paramsByFamily[state.family]) || {}

  // Visage (modèles locaux avec ReActor) : une image jointe peut servir de visage plutôt que d'image de départ.
  const imageAttachments = state.attachments.filter((a) => a.mediaType === 'image')
  const faceId = !family?.supportsFace || state.faceChoice === 'none'
    ? null
    : state.faceChoice !== 'auto' && imageAttachments.some((a) => a.id === state.faceChoice)
      ? state.faceChoice
      : (imageAttachments[1]?.id ?? null)
  const inputs = state.attachments.filter((a) => a.id !== faceId)
  const counts = {
    images: inputs.filter((a) => a.mediaType === 'image').length,
    videos: inputs.filter((a) => a.mediaType === 'video').length,
  }
  const resolution = family
    ? resolveTask(
        family.media,
        Object.keys(family.tasks) as TaskKind[],
        counts,
        state.refMode,
      )
    : null
  const task = resolution?.ok ? resolution.task : null
  const schema = task ? family?.tasks[task]?.schema : undefined
  // Des traits suffisent à faire un prompt : le texte libre devient facultatif.
  const requiresPrompt = (schema?.required?.includes('prompt') ?? true) && state.traits.length === 0
  // Fenêtre des traits : null = fermée ; sinon la catégorie à ouvrir (« '' » = la première).
  const [traitPicker, setTraitPicker] = useState<string | null>(null)
  const supportsLoras = schemaSupportsLoras(schema)
  const personaLoras =
    persona?.loras.filter((l) => l.family === state.family) ?? []
  const showRefToggle =
    family?.media === 'video' &&
    counts.images > 0 &&
    counts.videos === 0 &&
    family.tasks['image-to-video'] &&
    family.tasks['reference-to-video']

  // Contextes envoyés : ceux qui sont actifs ET proposés pour ce type de média.
  const activeContextIds = contexts
    .filter((c) => c.enabled && state.contextIds.includes(c.id) && (c.media === 'all' || c.media === (family?.media ?? 'image')))
    .map((c) => c.id)

  const request: GenerationRequest | null = family
    ? {
        threadId: threadId ?? null,
        personaId,
        family: family.id,
        refMode: state.refMode,
        prompt: state.prompt,
        params,
        referenceAssetIds: inputs.map((a) => a.id),
        faceAssetId: faceId,
        contextIds: activeContextIds,
        count: state.count,
        traitIds: state.traits.map((t) => t.optionId),
      }
    : null

  const canQuote = Boolean(
    (settings?.hasApiKey || isLocal) &&
    family?.available &&
    resolution?.ok &&
    (!requiresPrompt || state.prompt.trim()) &&
    !uploading,
  )
  const debounced = useDebounced(canQuote ? request : null, 600)
  const quoteKey = useMemo(
    () => (debounced ? JSON.stringify({ ...debounced, threadId: null }) : null),
    [debounced],
  )
  const quote = useQuery({
    queryKey: ['quote', quoteKey],
    queryFn: () => generationsApi.quote(debounced!).then((r) => r.quote),
    enabled: Boolean(quoteKey) && canQuote,
    staleTime: 4 * 60_000,
    retry: false,
  })
  const quoteIsCurrent =
    canQuote &&
    quoteKey !== null &&
    JSON.stringify({ ...request, threadId: null }) === quoteKey

  const create = useMutation({
    mutationFn: (body: GenerationRequest) => generationsApi.create(body),
    onSuccess: ({ thread }) => {
      composer.clearAfterSend()
      queryClient.invalidateQueries({ queryKey: qk.threadsAll })
      queryClient.invalidateQueries({ queryKey: qk.thread(thread.id) })
      queryClient.invalidateQueries({ queryKey: qk.balance })
      if (!threadId)
        navigate({ to: '/t/$threadId', params: { threadId: thread.id } })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as PriceChangedResponse
        queryClient.setQueryData(['quote', quoteKey], body.quote)
        toast.warning(
          `Le prix a changé : ${formatUsd(body.quote.estimatedCost)}. Reclique pour confirmer.`,
        )
        return
      }
      toast.error((err as Error).message)
    },
  })

  const enhance = useMutation({
    mutationFn: () =>
      promptsApi
        .enhance({
          prompt: state.prompt,
          personaId,
          media: family?.media ?? 'image',
        })
        .then((r) => r.prompt),
    onSuccess: (next) => {
      const previous = state.prompt
      composer.setPrompt(next)
      toast.success('Prompt reformulé', {
        action: {
          label: 'Annuler',
          onClick: () => composer.setPrompt(previous),
        },
      })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const onFiles = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
    )
    if (!list.length) return
    setUploading((n) => n + list.length)
    for (const f of list) {
      try {
        const { asset } = await assetsApi.upload(f, { personaId })
        composer.addAttachments([asset])
      } catch (e) {
        toast.error(`${f.name} : ${(e as Error).message}`)
      } finally {
        setUploading((n) => n - 1)
      }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const send = () => {
    if (!request || !canQuote || create.isPending) return
    if (!quoteIsCurrent || !quote.data) {
      toast.info('Calcul du prix en cours…')
      return
    }
    create.mutate({ ...request, expectedCost: quote.data.estimatedCost })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }


  // Ordre fixe (ratio, résolution, durée), quel que soit l'ordre du schéma du modèle.
  const quickFields = editableFields(schema)
    .filter(([k]) => QUICK_FIELDS.includes(k))
    .sort(([a], [b]) => QUICK_FIELDS.indexOf(a) - QUICK_FIELDS.indexOf(b))
  const quoteError = quote.error ? (quote.error as Error).message : null
  const notices: { text: string; tone: 'error' | 'warn' }[] = []
  if (catalogError)
    notices.push({ text: (catalogError as Error).message, tone: 'error' })
  if (resolution && !resolution.ok)
    notices.push({ text: resolution.reason, tone: 'warn' })
  // Fichiers ignorés : calculés tout de suite (même logique que le serveur), sans attendre le devis.
  const dropped =
    quoteIsCurrent && quote.data
      ? quote.data.dropped
      : schema && task
        ? buildInput({
            schema,
            task,
            prompt: '',
            params: {},
            images: inputs.filter((a) => a.mediaType === 'image').map((a) => a.id),
            videos: inputs.filter((a) => a.mediaType === 'video').map((a) => a.id),
            loras: [],
          }).dropped
        : 0
  if (dropped > 0) {
    notices.push({
      text:
        family?.supportsFace && task === 'image-to-image'
          ? 'Une seule image de départ possible : passe l’autre en « Visage » ou retire-la.'
          : `${dropped} fichier(s) ignoré(s) : trop de références pour ce modèle`,
      tone: 'warn',
    })
  }
  if (quoteError) notices.push({ text: quoteError, tone: 'error' })

  return (
    <div className="shrink-0 px-4 pt-2 pb-5">
      <div
        className="mx-auto max-w-4xl"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          onFiles(e.dataTransfer.files)
        }}
      >
        <ContextChips media={family?.media ?? 'image'} activeIds={state.contextIds} onToggle={composer.toggleContext} />

        <div
          className={cn(
            'relative flex flex-col rounded-3xl border bg-muted/50 shadow-[0_2px_8px_rgba(0,0,0,0.2)] backdrop-blur-sm transition-colors',
            dragging
              ? 'border-brand/70 bg-brand/5'
              : 'border-border/60',
          )}
        >
          {/* Pièces jointes */}
          {(state.attachments.length > 0 || uploading > 0) && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {state.attachments.map((a, i) => (
                <div
                  key={a.id}
                  className="group relative overflow-hidden rounded-xl border border-border/30"
                >
                  <AssetThumb asset={a} className="h-20 w-20" />
                  {family?.media === 'video' &&
                    task === 'image-to-video' &&
                    i < 2 && (
                      <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">
                        {i === 0 ? 'Début' : 'Fin'}
                      </span>
                    )}
                  {a.mediaType === 'video' && (
                    <Film className="absolute top-1 left-1 h-3.5 w-3.5 text-white drop-shadow" />
                  )}
                  {family?.supportsFace && a.mediaType === 'image' && (
                    <button
                      type="button"
                      onClick={() => composer.setFace(a.id === faceId ? 'none' : a.id)}
                      title={
                        a.id === faceId
                          ? 'Visage appliqué au résultat. Cliquer pour en faire l’image de départ.'
                          : 'Image de départ. Cliquer pour l’utiliser comme visage.'
                      }
                      className={cn(
                        'absolute bottom-1 left-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white transition-colors',
                        a.id === faceId ? 'bg-emerald-600/90 hover:bg-emerald-600' : 'bg-black/70 hover:bg-black/85',
                      )}
                    >
                      {a.id === faceId ? <ScanFace className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                      {a.id === faceId ? 'Visage' : 'Départ'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => composer.removeAttachment(a.id)}
                    className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive"
                    aria-label="Retirer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {Array.from({ length: uploading }).map((_, i) => (
                <div
                  key={`up-${i}`}
                  className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-border"
                >
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ))}
            </div>
          )}

          {/* Traits choisis dans la bibliothèque : une bulle par catégorie */}
          {state.traits.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {state.traits.map((t) => (
                <span
                  key={t.optionId}
                  className="group flex h-7 items-center gap-1.5 rounded-full border border-brand/30 bg-brand/[0.06] pr-1 pl-0.5 text-xs"
                  title={`${t.categoryLabel} : ${t.fragment}`}
                >
                  <button type="button" onClick={() => setTraitPicker(t.categoryId)} className="flex items-center gap-1.5" aria-label={`Changer ${t.categoryLabel}`}>
                    {t.thumbnailUrl ? (
                      <img src={t.thumbnailUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <span className="h-6 w-6 rounded-full bg-secondary" />
                    )}
                    <span className="max-w-40 truncate">{t.label ?? t.fragment}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => composer.removeTrait(t.optionId)}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={`Retirer ${t.label ?? t.fragment}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={state.prompt}
            onChange={(e) => composer.setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files)
              if (files.length) {
                e.preventDefault()
                onFiles(files)
              }
            }}
            placeholder={
              family?.media === 'video'
                ? 'Décris la scène et le mouvement… (glisse une image pour l’animer)'
                : 'Décris l’image… (glisse des images de référence ici)'
            }
            className="field-sizing-content max-h-[220px] min-h-[52px] w-full resize-none border-0 bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-normal placeholder:text-muted-foreground/50 focus:ring-0 focus:outline-none"
            rows={1}
          />

          {/* Barre d'outils */}
          <div className="flex items-center gap-2 px-2.5 pb-2.5">
            {/* Outils sur une seule ligne (défilement horizontal si ça déborde) */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scrollbar-none py-1">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
                multiple
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background/40 transition-colors hover:bg-accent"
                title="Ajouter une image ou une vidéo"
                aria-label="Ajouter un fichier"
              >
                <ImagePlus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setTraitPicker('')}
                className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-3 text-xs font-medium transition-colors hover:bg-accent"
                title="Choisir un trait dans la bibliothèque (coiffure, tenue, lieu…)"
              >
                <Shapes className="h-3.5 w-3.5" /> Trait
              </button>
              {persona && (
                <ReferencePicker
                  persona={persona}
                  selectedIds={state.attachments.map((a) => a.id)}
                  onToggle={(a) =>
                    state.attachments.some((x) => x.id === a.id)
                      ? composer.removeAttachment(a.id)
                      : composer.addAttachments([a])
                  }
                />
              )}
              <ModelPicker
                families={families}
                value={state.family}
                onChange={composer.setFamily}
                lora={
                  persona && supportsLoras && personaLoras.length
                    ? {
                        personaName: persona.name,
                        triggerWord: persona.triggerWord,
                      }
                    : null
                }
              />
              {quickFields.map(([key, prop]) => (
                <div key={key} title={labelOf(key)}>
                  <ParamField
                    name={key}
                    prop={prop}
                    value={params[key]}
                    compact
                    onChange={(v) =>
                      state.family && composer.setParam(state.family, key, v)
                    }
                  />
                </div>
              ))}
              <ParamsPopover
                schema={schema}
                values={params}
                onChange={(k, v) =>
                  state.family && composer.setParam(state.family, k, v)
                }
                onReset={() =>
                  state.family && composer.resetParams(state.family)
                }
              />
              {showRefToggle && (
                <div className="flex h-8 items-center rounded-full border border-border/60 bg-background/40 p-0.5 text-[11px]">
                  {(['start-frame', 'reference'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => composer.setRefMode(m)}
                      className={cn(
                        'h-full rounded-full px-2.5 transition-colors',
                        state.refMode === m
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {m === 'start-frame' ? 'Image de départ' : 'Références'}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => enhance.mutate()}
                disabled={
                  !state.prompt.trim() ||
                  enhance.isPending ||
                  !settings?.hasApiKey
                }
                className="flex h-8 items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2.5 text-xs transition-colors hover:bg-accent disabled:opacity-30"
                title={
                  persona
                    ? `Reformuler avec la personnalité de ${persona.name}`
                    : 'Reformuler le prompt'
                }
              >
                {enhance.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                Reformuler
              </button>
            </div>

            {/* Série : nombre d'images générées avec cette demande (l'une après l'autre en local). */}
            <div
              className="flex h-8 shrink-0 items-center rounded-full border border-border/60 bg-background/40 p-0.5 text-[11px]"
              title={isLocal ? 'Nombre d’images, générées l’une après l’autre sur ton GPU' : 'Nombre d’images à générer'}
            >
              {SERIES_SIZES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => composer.setCount(n)}
                  className={cn(
                    'h-full rounded-full px-2.5 tabular-nums transition-colors',
                    state.count === n ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  ×{n}
                </button>
              ))}
            </div>

            {/* Générer : prix à gauche du bouton, détail au survol. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-foreground/80 tabular-nums">
                    {canQuote && (quote.isFetching || !quoteIsCurrent) ? (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    ) : quoteIsCurrent && quote.data ? (
                      isLocal ? 'Local' : <>≈ {formatUsd(quote.data.estimatedCost)}</>
                    ) : null}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    onClick={send}
                    disabled={
                      !canQuote ||
                      create.isPending ||
                      !quoteIsCurrent ||
                      !quote.data
                    }
                    className="h-9 w-9 rounded-full brand-gradient brand-shadow hover:opacity-90"
                    aria-label={
                      quoteIsCurrent && quote.data && !isLocal
                        ? `Générer ${state.count > 1 ? `${state.count} images ` : ''}pour ${formatUsd(quote.data.estimatedCost)}`
                        : state.count > 1
                          ? `Générer ${state.count} images`
                          : 'Générer'
                    }
                  >
                    {create.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </TooltipTrigger>
              {task && family && (
                <TooltipContent side="top" align="end" className="text-xs">
                  <div>
                    {TASK_LABEL[task]} · {family.label}
                    {state.count > 1 && ` · série de ${state.count}`}
                  </div>
                  {isLocal && <div className="opacity-70">Sur ton GPU via ComfyUI, gratuit</div>}
                  {quoteIsCurrent && quote.data && !isLocal && (
                    <div className="opacity-70">
                      Maximum facturé {formatUsd(quote.data.maxCharge)} ·{' '}
                      {formatUnit(quote.data.unit, quote.data.quantity)}
                    </div>
                  )}
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        </div>

        <TraitPicker
          open={traitPicker !== null}
          initialCategoryId={traitPicker || null}
          gender={persona?.gender ?? null}
          selected={state.traits}
          onPick={(trait) => {
            composer.setTrait(trait)
            setTraitPicker(null)
          }}
          onClose={() => setTraitPicker(null)}
        />

        {/* Aperçu du prompt réellement envoyé, quand des traits l'assemblent */}
        {state.traits.length > 0 && quoteIsCurrent && quote.data && (
          <p className="mt-2 line-clamp-2 px-3 font-mono text-[11px] text-muted-foreground" title={quote.data.finalPrompt}>
            <span className="font-sans font-medium text-foreground/70">Prompt envoyé : </span>
            {quote.data.finalPrompt}
          </p>
        )}

        {/* Messages : affichés seulement quand il y a quelque chose à lire. */}
        {notices.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 text-[11px]">
            {notices.map((n) => (
              <span
                key={n.text}
                className={cn(
                  'flex items-center gap-1',
                  n.tone === 'error'
                    ? 'text-destructive-foreground'
                    : 'text-amber-300',
                )}
              >
                <Info className="h-3 w-3 shrink-0" /> {n.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
