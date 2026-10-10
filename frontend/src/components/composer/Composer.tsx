/**
 * Composer de génération (évolution du ChatInput du fork) : prompt, pièces
 * jointes, modèle, paramètres, devis en direct et envoi.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSelector } from '@tanstack/react-store'
import { ArrowUp, Dice5, Film, Info, Loader2, Pencil, Plus, Shapes, X } from 'lucide-react'
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
import { TraitPicker } from './TraitPicker'
import { FaceButton, PlaceBubble, PlaceButton, ScenesButton } from './SceneTools'

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
  // Catalogue chargé même sans clé SpicyAPI : les modèles locaux (ComfyUI) suffisent à générer.
  const { data: catalog, error: catalogError } = useQuery(
    catalogQuery(Boolean(settings)),
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
  useEffect(() => {
    composer.enterThread(threadId ?? null)
  }, [threadId])

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

  // Persona créé avec le créateur : sa fiche d'identité arrive en bulles, si aucune n'est déjà posée.
  useEffect(() => {
    if (persona?.identity.length && composerStore.state.traits.length === 0) composer.load({ traits: persona.identity })
  }, [persona?.id, state.threadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const family = families.find((f) => f.id === state.family)
  const media: MediaKind = family?.media ?? 'image'
  // Bascule photo / vidéo : même cascade, pour le nouveau type.
  const switchMedia = (next: MediaKind) => {
    if (next === media) return
    const pick = pickFamily(next, { suggested: false })
    if (pick) composer.setFamily(pick)
  }
  const params = (state.family && state.paramsByFamily[state.family]) || {}
  const isLocal = family?.runtime === 'comfy'
  // Visage (modèles locaux avec ReActor) : une image jointe peut servir de visage plutôt que d'entrée.
  const imageAttachments = state.attachments.filter((a) => a.mediaType === 'image')
  const faceId =
    !family?.supportsFace || state.faceChoice === 'none'
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
  // Vidéo à partir d'images : les deux premières sont le début et la fin.
  const startEnd = family?.media === 'video' && task === 'image-to-video'
  // Numéro d'une image jointe parmi les images (l'ordre d'envoi au modèle).
  const imageNumber = (i: number) =>
    state.attachments.slice(0, i + 1).filter((a) => a.mediaType === 'image')
      .length
  const schema = task ? family?.tasks[task]?.schema : undefined
  // Des bulles (traits, 🎲, lieu) suffisent à faire un prompt : le texte libre devient facultatif.
  const hasTraits = state.traits.length > 0 || state.slots.length > 0 || Boolean(state.placeId)
  const requiresPrompt = (schema?.required?.includes('prompt') ?? true) && !hasTraits
  // Fenêtre des traits : null = fermée ; sinon la catégorie à ouvrir (« '' » = la première).
  const [traitPicker, setTraitPicker] = useState<string | null>(null)
  // Bulle 🎲 ouverte : choisir parmi quoi tirer (toute la liste, favoris, sélection).
  const [slotPicker, setSlotPicker] = useState<string | null>(null)
  const openSlot = state.slots.find((x) => x.categoryId === slotPicker) ?? null
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
        referenceAssetIds: inputs.map((a) => a.id),
        faceAssetId: faceId,
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
        traitIds: state.traits.map((t) => t.optionId),
        traitSlots: state.slots.map(({ categoryId, drawFrom, pool }) => ({ categoryId, drawFrom, pool })),
        placeId: state.placeId,
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
  if (quoteIsCurrent && quote.data && quote.data.dropped > 0) {
    notices.push({
      text: `${quote.data.dropped} fichier(s) ignoré(s) : trop de références pour ce modèle`,
      tone: 'warn',
    })
  }
  if (quoteError) notices.push({ text: quoteError, tone: 'error' })
  if (quoteIsCurrent && quote.data?.unknownWildcards.length) {
    notices.push({
      text: `Catégorie inconnue, laissée telle quelle : ${quote.data.unknownWildcards.map((k) => `__${k}__`).join(', ')}`,
      tone: 'warn',
    })
  }

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
                  className="group relative overflow-hidden rounded-xl border border-border/30"
                >
                  <AssetThumb asset={a} className="h-20 w-20" />
                  {/* En bas à gauche : Début / Fin (vidéo), sinon le numéro de
                      l'image tel que le prompt peut le citer (« image 2 »), ou le
                      crayon sur l'image à modifier. */}
                  {startEnd && i < 2 ? (
                    <span className={THUMB_TAG}>
                      {i === 0 ? 'Début' : 'Fin'}
                    </span>
                  ) : a.mediaType === 'image' && !startEnd ? (
                    <span
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
                  {/* Modèle local avec ReActor : clic pour passer l'image en « Visage » (appliqué au résultat) ou en entrée. */}
                  {family?.supportsFace && a.mediaType === 'image' && (
                    <button
                      type="button"
                      onClick={() => composer.setFace(a.id === faceId ? 'none' : a.id)}
                      className={cn(
                        'absolute top-1 left-1 rounded px-1 text-[10px] font-semibold',
                        a.id === faceId ? 'bg-brand text-white' : 'bg-black/70 text-white/80 hover:text-white',
                      )}
                      title={a.id === faceId ? 'Visage appliqué au résultat (ReActor). Clic : image d’entrée' : 'Image d’entrée. Clic : utiliser comme visage'}
                    >
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

          {/* Traits de la bibliothèque : une bulle par catégorie ; 🎲 : tirée au hasard ; lieu */}
          {hasTraits && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {state.placeId && <PlaceBubble placeId={state.placeId} />}
              {state.slots.map((x) => (
                <span
                  key={x.categoryId}
                  className="group flex h-7 items-center gap-1.5 rounded-full border border-dashed border-brand/50 bg-brand/[0.04] pr-1 pl-2 text-xs"
                  title="Tirée au hasard pour chaque image. Clic : choisir parmi quoi tirer."
                >
                  <button type="button" onClick={() => setSlotPicker(x.categoryId)} className="flex items-center gap-1.5">
                    <Dice5 className="h-3.5 w-3.5 text-brand" />
                    <span className="max-w-40 truncate">
                      {x.categoryLabel}
                      <span className="text-muted-foreground">
                        {x.drawFrom === 'favorites' ? ' · favoris' : x.drawFrom === 'pool' ? ` · ${x.pool.length} au choix` : ' · au hasard'}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => composer.removeSlot(x.categoryId)}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={`Retirer ${x.categoryLabel}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
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
              <button
                type="button"
                onClick={() => setTraitPicker('')}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] text-foreground/80 shadow-[inset_0_0_0_1px_var(--color-border)] transition-colors hover:bg-accent/60"
                title="Choisir un trait dans la bibliothèque (coiffure, tenue, lieu…)"
              >
                <Shapes className="h-3.5 w-3.5" /> Trait
              </button>
              <PlaceButton persona={persona} placeId={state.placeId} />
              <ScenesButton />
              {persona && family?.supportsFace && <FaceButton persona={persona} faceId={faceId} />}
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

        <TraitPicker
          open={traitPicker !== null}
          initialCategoryId={traitPicker || null}
          gender={persona?.gender ?? null}
          selected={state.traits}
          onPick={(trait) => {
            composer.setTrait(trait)
            setTraitPicker(null)
          }}
          onPickRandom={(c) => {
            composer.setSlot({ categoryId: c.id, categoryLabel: c.label, zone: c.zone, drawFrom: 'all', pool: [] })
            setTraitPicker(null)
          }}
          onClose={() => setTraitPicker(null)}
        />
        <TraitPicker
          open={openSlot !== null}
          title={openSlot ? `${openSlot.categoryLabel} : tirer au hasard parmi…` : ''}
          categoryIds={openSlot ? [openSlot.categoryId] : undefined}
          initialCategoryId={openSlot?.categoryId ?? null}
          gender={persona?.gender ?? null}
          selected={[]}
          onPick={() => undefined}
          pool={
            openSlot
              ? { drawFrom: openSlot.drawFrom, ids: openSlot.pool, onChange: (drawFrom, ids) => composer.setSlot({ ...openSlot, drawFrom, pool: ids }) }
              : undefined
          }
          onClose={() => setSlotPicker(null)}
        />

        {/* Aperçu du prompt réellement envoyé, quand des traits ou des tirages l'assemblent */}
        {(hasTraits || quote.data?.randomized) && quoteIsCurrent && quote.data && (
          <p className="mt-2 line-clamp-2 px-3 font-mono text-[11px] text-muted-foreground" title={quote.data.finalPrompt}>
            <span className="font-sans font-medium text-foreground/70">
              {quote.data.randomized ? 'Exemple de prompt (nouveau tirage à chaque image) : ' : 'Prompt envoyé : '}
            </span>
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
