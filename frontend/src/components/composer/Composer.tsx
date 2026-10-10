/**
 * Composer de génération (évolution du ChatInput du fork) : prompt, pièces
 * jointes, modèle, paramètres, devis en direct et envoi.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSelector } from '@tanstack/react-store'
import { ArrowUp, Film, Info, Loader2, Pencil, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  imageInputInfo,
  resolveTask,
  schemaSupportsLoras,
  MAX_LORAS_PER_GENERATION,
  appDefault,
  APP_DEFAULT_FAMILY,
  type GenerationRequest,
  type JsonSchemaProp,
  type MediaKind,
  type PriceChangedResponse,
  type TaskKind,
} from '@ai-fluence/shared'

import { ApiError, assetsApi, generationsApi } from '@/lib/api'
import { composer, composerStore, isEmptyDraft } from '@/lib/composer-store'
import {
  catalogQuery,
  personasQuery,
  presetsQuery,
  qk,
  settingsQuery,
} from '@/lib/queries'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ModelPicker } from './ModelPicker'
import {
  AspectRatioPicker,
  MediaSwitch,
  ResolutionToggle,
  Stepper,
} from './ComposerControls'
import { ParamsPopover } from './ParamFields'
import { ContextChips } from './PresetChips'
import { AssetThumb, ReferencePicker } from './ReferencePicker'

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

/** Étiquette en bas à gauche d'une vignette jointe (numéro, crayon, Début / Fin). */
const THUMB_TAG =
  'absolute bottom-1 left-1 flex h-4 min-w-4 items-center justify-center rounded bg-black/85 px-1 text-[10px] font-medium text-white tabular-nums'

/** Durée vidéo en − valeur + : pas des valeurs proposées par le modèle, saisie bornée. */
function durationControl(prop: JsonSchemaProp | undefined, raw: unknown) {
  if (!prop) return null
  const values = (
    prop.enum
      ? prop.enum.map(Number)
      : prop.type === 'integer' &&
          prop.minimum !== undefined &&
          prop.maximum !== undefined
        ? Array.from(
            { length: prop.maximum - prop.minimum + 1 },
            (_, i) => prop.minimum! + i,
          )
        : []
  ).filter(Number.isFinite)
  if (!values.length) return null
  const fallback = Number(
    appDefault('duration_seconds', prop) ??
      values.find((v) => v > 0) ??
      values[0],
  )
  const value = typeof raw === 'number' && values.includes(raw) ? raw : fallback
  const i = values.indexOf(value)
  const real = values.filter((v) => v > 0)
  return {
    value,
    prev: () => (i > 0 ? values[i - 1] : null),
    next: () => (i >= 0 && i < values.length - 1 ? values[i + 1] : null),
    // Au-delà du maximum : on prend le maximum ; sinon la valeur proposée la plus proche.
    normalize: (v: number) => {
      if (v >= Math.max(...real)) return Math.max(...real)
      return real.reduce(
        (best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best),
        real[0],
      )
    },
  }
}

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
    catalogQuery(Boolean(settings?.hasApiKey)),
  )
  const { data: personas = [], status: personasStatus } =
    useQuery(personasQuery())
  const { data: contexts = [] } = useQuery(presetsQuery())
  const persona = personas.find((p) => p.id === personaId) ?? null
  const families = catalog?.families ?? []

  const personasLoaded = personasStatus === 'success'
  const usable = (id: string | null | undefined, media: MediaKind) =>
    id && families.some((f) => f.id === id && f.available && f.media === media)
      ? id
      : null
  // Modèle par défaut, dans l'ordre : dernier modèle du fil > modèle du persona
  // > dernier choix dans ce fil (type photo / vidéo) > modèle économique de l'app
  // > premier dispo. Le choix fait dans le fil lui-même est repris en premier
  // (cf. enterThread), cette cascade ne sert que s'il n'y en a pas.
  const pickFamily = (
    media: MediaKind,
    { memory = true, suggested = true } = {},
  ) =>
    (suggested ? usable(suggestedFamily, media) : null) ??
    usable(
      media === 'image'
        ? persona?.defaultImageFamily
        : persona?.defaultVideoFamily,
      media,
    ) ??
    (memory ? usable(state.familyByMedia[media], media) : null) ??
    usable(APP_DEFAULT_FAMILY[media], media) ??
    families.find((f) => f.media === media && f.available)?.id ??
    null

  // Le modèle choisi est propre à chaque fil (déclaré avant la cascade ci-dessous).
  // Garde : en développement, React monte deux fois chaque composant ; le
  // brouillon ne doit être chargé qu'une fois par fil affiché.
  const enteredFor = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (enteredFor.current === (threadId ?? null)) return
    enteredFor.current = threadId ?? null
    composer.enterThread(threadId ?? null, personaId)
  }, [threadId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Jamais sans modèle : si le modèle courant manque ou n'est plus disponible
  // (catalogue pas encore chargé, modèle retiré…), on applique la cascade.
  useEffect(() => {
    if (!catalog || !personasLoaded) return
    const current = families.find((f) => f.id === state.family)
    if (current?.available) return
    const pick = pickFamily(current?.media ?? 'image')
    if (pick) composer.setFamily(pick)
  }, [catalog, personasLoaded, state.family]) // eslint-disable-line react-hooks/exhaustive-deps

  // Changer de persona reprend son modèle par défaut (le choix manuel ne vaut
  // que pour le persona en cours).
  const lastPersona = useRef(personaId)
  useEffect(() => {
    // Dans un fil, le persona est fixe : seul un nouveau fil change de persona.
    if (threadId) return
    if (lastPersona.current === personaId || !catalog || !personasLoaded) return
    lastPersona.current = personaId
    // Demande commencée : on garde le modèle choisi avec elle.
    if (!isEmptyDraft(state)) return
    const current = families.find((f) => f.id === state.family)
    const pick = pickFamily(current?.media ?? 'image', {
      memory: false,
      suggested: false,
    })
    if (pick && pick !== state.family) composer.setFamily(pick)
  }, [personaId, catalog, personasLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.focusTick) textareaRef.current?.focus()
  }, [state.focusTick])

  const family = families.find((f) => f.id === state.family)
  const media: MediaKind = family?.media ?? 'image'
  // Bascule photo / vidéo : même cascade, pour le nouveau type.
  const switchMedia = (next: MediaKind) => {
    if (next === media) return
    const pick = pickFamily(next, { suggested: false })
    if (pick) composer.setFamily(pick)
  }
  const params = (state.family && state.paramsByFamily[state.family]) || {}
  const counts = {
    images: state.attachments.filter((a) => a.mediaType === 'image').length,
    videos: state.attachments.filter((a) => a.mediaType === 'video').length,
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
  // Vidéo à partir d'images : les deux premières sont le début et la fin.
  const startEnd = family?.media === 'video' && task === 'image-to-video'
  // Numéro d'une image jointe parmi les images (l'ordre d'envoi au modèle).
  const imageNumber = (i: number) =>
    state.attachments.slice(0, i + 1).filter((a) => a.mediaType === 'image')
      .length
  const schema = task ? family?.tasks[task]?.schema : undefined
  const requiresPrompt = schema?.required?.includes('prompt') ?? true
  const supportsLoras = schemaSupportsLoras(schema)
  // LoRA du persona pour ce modèle : rien n'est coché d'office, 3 max.
  const personaLoras = supportsLoras
    ? (persona?.loras.filter((l) => l.family === state.family && l.path) ?? [])
    : []
  const activeLoras = personaLoras
    .filter((l) => l.id in state.loras)
    .slice(0, MAX_LORAS_PER_GENERATION)
  // Nombre réel d'images acceptées par le modèle choisi (compteur « n / max »).
  const imageInfo = family
    ? imageInputInfo(family.media, family.tasks, state.refMode)
    : { max: 0, mode: 'none' as const }
  // Plus d'images que le modèle n'en accepte : envoi bloqué (jamais d'image
  // ignorée sans que la personne le décide).
  const extraImages =
    imageInfo.max > 0
      ? Math.max(0, state.attachments.length - imageInfo.max)
      : 0
  // Vidéo : le modèle sait animer une image de départ ET partir de références.
  const canChooseRefMode = Boolean(
    family?.media === 'video' &&
    counts.videos === 0 &&
    family.tasks['image-to-video'] &&
    family.tasks['reference-to-video'],
  )
  // Sans persona (pas de menu « Réf. »), le choix reste dans la barre dès qu'une image est jointe.
  const showRefToggle = canChooseRefMode && !persona && counts.images > 0

  // Contextes envoyés : ceux qui sont actifs ET proposés pour ce type de média.
  const activeContextIds = contexts
    .filter(
      (c) =>
        c.enabled &&
        (c.personaId === null || c.personaId === personaId) &&
        state.contextIds.includes(c.id) &&
        (c.media === 'all' || c.media === (family?.media ?? 'image')),
    )
    .map((c) => c.id)

  const request: GenerationRequest | null = family
    ? {
        threadId: threadId ?? null,
        personaId,
        family: family.id,
        refMode: state.refMode,
        prompt: state.prompt,
        params,
        referenceAssetIds: state.attachments.map((a) => a.id),
        // Image posée par « Éditer », toujours en position 1.
        editAssetId:
          state.editAssetId && state.attachments[0]?.id === state.editAssetId
            ? state.editAssetId
            : undefined,
        contextIds: activeContextIds,
        // Séries ×N : photo uniquement.
        count: family.media === 'image' ? state.count : 1,
        loraIds: activeLoras.map((l) => l.id),
        loraWords: Object.fromEntries(
          activeLoras.map((l) => [l.id, state.loras[l.id] ?? []]),
        ),
      }
    : null

  const canQuote = Boolean(
    settings?.hasApiKey &&
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
      if (!threadId) composer.adoptNewThread(thread.id)
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

  const onFiles = async (files: FileList | File[] | null) => {
    const all = Array.from(files ?? [])
    const isMedia = (f: File) =>
      f.type.startsWith('image/') || f.type.startsWith('video/')
    // Ni image ni vidéo : même message que le serveur pour un format refusé.
    for (const f of all.filter((f) => !isMedia(f))) {
      toast.error(
        `${f.name} : Formats acceptés : JPEG, PNG, WebP, GIF, MP4, WebM.`,
      )
    }
    const list = all.filter(isMedia)
    if (!list.length) {
      if (fileRef.current) fileRef.current.value = ''
      return
    }
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
    if (!request || !canQuote || create.isPending || extraImages > 0) return
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

  const setParam = (key: string, v: unknown) =>
    state.family && composer.setParam(state.family, key, v)
  // Réglages rapides de la barre (les autres restent dans le panneau Paramètres).
  const resolutionProp = schema?.properties?.resolution
  const ratioProp = schema?.properties?.aspect_ratio
  const duration = durationControl(
    schema?.properties?.duration_seconds,
    params.duration_seconds,
  )
  const quoteError = quote.error ? (quote.error as Error).message : null
  const notices: { text: string; tone: 'error' | 'warn' }[] = []
  if (catalogError)
    notices.push({ text: (catalogError as Error).message, tone: 'error' })
  if (resolution && !resolution.ok)
    notices.push({ text: resolution.reason, tone: 'warn' })
  if (extraImages > 0) {
    notices.push({
      text: `Trop d'images pour ce modèle (${imageInfo.max} au maximum) : retire-en ${extraImages} pour envoyer.`,
      tone: 'warn',
    })
  } else if (quoteIsCurrent && quote.data && quote.data.dropped > 0) {
    notices.push({
      text: `${quote.data.dropped} fichier(s) ignoré(s) : trop de références pour ce modèle`,
      tone: 'warn',
    })
  }
  if (quoteError) notices.push({ text: quoteError, tone: 'error' })

  return (
    <div className="shrink-0 px-4 pt-2 pb-5">
      <div
        className="mx-auto max-w-[810px]"
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
        <ContextChips
          media={family?.media ?? 'image'}
          personaId={personaId}
          activeIds={state.contextIds}
          onToggle={composer.toggleContext}
          loras={personaLoras}
          activeLoras={state.loras}
          onToggleLora={composer.toggleLora}
          onToggleLoraWord={composer.toggleLoraWord}
        />

        <div
          className={cn(
            'relative flex flex-col rounded-3xl border bg-muted/50 shadow-[0_2px_8px_rgba(0,0,0,0.2)] backdrop-blur-sm transition-colors',
            dragging ? 'border-brand/70 bg-brand/5' : 'border-border/60',
          )}
        >
          {/* Pièces jointes */}
          {(state.attachments.length > 0 || uploading > 0) && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {state.attachments.map((a, i) => (
                <div
                  key={a.id}
                  data-testid="attachment"
                  className="group relative overflow-hidden rounded-xl border border-border/30"
                >
                  <AssetThumb asset={a} className="h-20 w-20" />
                  {/* En bas à gauche : Début / Fin (vidéo), sinon le numéro de
                      l'image tel que le prompt peut le citer (« image 2 »), ou le
                      crayon sur l'image à modifier. */}
                  {startEnd && i < 2 ? (
                    <span data-testid="attachment-tag" className={THUMB_TAG}>
                      {i === 0 ? 'Début' : 'Fin'}
                    </span>
                  ) : a.mediaType === 'image' && !startEnd ? (
                    <span
                      data-testid="attachment-tag"
                      className={cn(
                        THUMB_TAG,
                        // Crayon : pastille carrée, comme celle d'un numéro.
                        a.id === state.editAssetId && i === 0 && 'w-4 px-0',
                      )}
                      title={
                        a.id === state.editAssetId
                          ? 'Image à modifier'
                          : `Image ${imageNumber(i)}`
                      }
                    >
                      {a.id === state.editAssetId && i === 0 ? (
                        <Pencil className="size-2" strokeWidth={2.5} />
                      ) : (
                        imageNumber(i)
                      )}
                    </span>
                  ) : null}
                  {a.mediaType === 'video' && (
                    <Film className="absolute top-1 left-1 h-3.5 w-3.5 text-white drop-shadow" />
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
                ? 'Décris la scène ou ajoute des références'
                : 'Décris l’image ou ajoute des références'
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
              {/* Ajouter un fichier, avec le compteur d'images du modèle (n / max). */}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'flex h-8 shrink-0 items-center justify-center gap-1 rounded-full text-[13px] text-foreground/80 shadow-[inset_0_0_0_1px_var(--color-border)] transition-colors hover:bg-accent/60',
                  imageInfo.max > 0 ? 'px-2.5' : 'w-8',
                )}
                title={
                  imageInfo.max > 0
                    ? `Ajouter des images (${imageInfo.max} au maximum pour ce modèle)`
                    : 'Ajouter un fichier'
                }
                aria-label="Ajouter un fichier"
              >
                <Plus className="size-3.5" />
                {imageInfo.max > 0 && (
                  <span
                    className={cn(
                      'tabular-nums',
                      state.attachments.length > imageInfo.max &&
                        'text-amber-300',
                    )}
                  >
                    {state.attachments.length}/{imageInfo.max}
                  </span>
                )}
              </button>
              {persona && (
                <ReferencePicker
                  persona={persona}
                  info={imageInfo}
                  refMode={
                    canChooseRefMode
                      ? { value: state.refMode, onChange: composer.setRefMode }
                      : undefined
                  }
                  selectedIds={state.attachments.map((a) => a.id)}
                  onToggle={(a) =>
                    state.attachments.some((x) => x.id === a.id)
                      ? composer.removeAttachment(a.id)
                      : composer.addAttachments([a])
                  }
                />
              )}
              <MediaSwitch value={media} onChange={switchMedia} />
              <ModelPicker
                media={media}
                families={families}
                value={state.family}
                onChange={composer.setFamily}
                // Pastille seulement si ce persona a des LoRA pour ce modèle.
                lora={
                  personaLoras.length
                    ? {
                        active: activeLoras.flatMap((l) =>
                          state.loras[l.id]?.length
                            ? state.loras[l.id]
                            : [l.label],
                        ),
                      }
                    : null
                }
              />
              {resolutionProp?.enum && (
                <ResolutionToggle
                  values={resolutionProp.enum}
                  value={
                    params.resolution ??
                    appDefault('resolution', resolutionProp) ??
                    resolutionProp.enum[0]
                  }
                  onChange={(v) => setParam('resolution', v)}
                />
              )}
              {ratioProp?.enum && (
                <AspectRatioPicker
                  values={ratioProp.enum}
                  value={
                    params.aspect_ratio ??
                    appDefault('aspect_ratio', ratioProp) ??
                    ratioProp.enum[0]
                  }
                  onChange={(v) => setParam('aspect_ratio', v)}
                />
              )}
              {duration && (
                <Stepper
                  label="Durée"
                  value={duration.value}
                  format={(v) => (v === -1 ? 'Auto' : `${v}s`)}
                  prev={duration.prev}
                  next={duration.next}
                  normalize={duration.normalize}
                  onChange={(v) => setParam('duration_seconds', v)}
                />
              )}
              {/* Série : nombre d'images (photo), un clic passe à x1, x4 puis x8. */}
              {media === 'image' && (
                <ResolutionToggle
                  name="Nombre d'images"
                  bars={false}
                  values={SERIES_SIZES}
                  value={SERIES_SIZES.includes(state.count) ? state.count : 1}
                  format={(v) => `x${v}`}
                  onChange={(v) => composer.setCount(v as number)}
                />
              )}
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
                      {m === 'start-frame' ? 'Début / Fin' : 'Références'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Générer : prix à gauche du bouton, sans infobulle. */}
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-foreground/80 tabular-nums">
                {canQuote && (quote.isFetching || !quoteIsCurrent) ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                ) : quoteIsCurrent && quote.data ? (
                  <>≈ {formatUsd(quote.data.estimatedCost)}</>
                ) : null}
              </span>
              <Button
                type="button"
                size="icon"
                onClick={send}
                disabled={
                  !canQuote ||
                  extraImages > 0 ||
                  create.isPending ||
                  !quoteIsCurrent ||
                  !quote.data
                }
                variant="primary"
                className="h-9 w-9 rounded-full brand-gradient hover:opacity-90"
                aria-label={
                  quoteIsCurrent && quote.data
                    ? `Générer pour ${formatUsd(quote.data.estimatedCost)}`
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
          </div>
        </div>

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
