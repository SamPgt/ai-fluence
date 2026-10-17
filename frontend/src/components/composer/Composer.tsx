/**
 * Composer de génération (évolution du ChatInput du fork) : prompt, pièces
 * jointes, modèle, paramètres, devis en direct et envoi.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSelector } from '@tanstack/react-store'
import { ArrowUp, Check, Circle, Dice5, Film, FolderOpen, Footprints, Info, Loader2, MapPinned, Mic, Pencil, Plus, ScanText, Shapes, Sparkles, Square, Upload, Volume2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  imageInputInfo,
  resolveTask,
  schemaSupportsLoras,
  MAX_LORAS_PER_GENERATION,
  appDefault,
  audioInputInfo,
  APP_DEFAULT_FAMILY,
  PROVIDERS,
  dictationKeyterms,
  type Asset,
  type Generation,
  type GenerationRequest,
  type ThreadDetailResponse,
  type JsonSchemaProp,
  type MediaKind,

  type RewritePromptResponse,
  type TaskKind,
} from '@sublime/shared'

import { assetsApi, assistApi, generationsApi, personasApi } from '@/lib/api'
import { playValidateSound, useDictation } from './useDictation'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { LoadingValue } from '@/components/ui/loading-value'
import { composer, composerStore, isEmptyDraft } from '@/lib/composer-store'
import {
  assistStatusQuery,
  catalogQuery,
  comfyStatusQuery,
  personasQuery,
  presetsQuery,
  qk,
  settingsQuery,
} from '@/lib/queries'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { startRecording, toWav } from '@/lib/recording'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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
import { LibraryBrowser } from './LibraryBrowser'
import { VoicePicker } from './VoicePicker'
import { WorkflowForm, WorkflowPickerButton } from './WorkflowForm'
import { VOICE_ENABLED } from '@/lib/features'
import { MediaViewer } from '@/components/thread/MediaViewer'

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
  /** Personas dont une référence a déjà servi dans le fil (leurs LoRA sont proposées). */
  threadPersonaIds?: string[]
  /** Modèle proposé par défaut (ex. celui de la dernière génération du fil). */
  suggestedFamily?: string | null
  /** Workflow dont le formulaire s'ouvre d'emblée (▶ depuis l'Accueil). */
  initialWorkflowId?: string
}

/** Temps de calcul estimé d'une vidéo LTX (en minutes) : ~40 s par seconde de vidéo en 512p, le double en 720p. */
function videoMinutes(speechSeconds: number, resolution: string): number {
  const seconds = speechSeconds + 1
  return Math.max(1, Math.round((seconds * (resolution === '720p' ? 80 : 40)) / 60))
}

export function Composer({
  threadId,
  threadPersonaIds = [],
  suggestedFamily,
  initialWorkflowId,
}: ComposerProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [addOpen, setAddOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  // Pièce jointe ouverte dans la visionneuse (son id).
  const [viewing, setViewing] = useState<string | null>(null)

  const state = useSelector(composerStore, (s) => s)
  const { data: settings } = useQuery(settingsQuery())
  const { data: comfyStatus } = useQuery(comfyStatusQuery())
  // Prompt inversé en cours (id de l'image décrite).
  const [describing, setDescribing] = useState<string | null>(null)
  const describe = async (assetId: string) => {
    setDescribing(assetId)
    try {
      const { prompt } = await assetsApi.describe(assetId)
      const current = composerStore.state.prompt.trim()
      composer.setPrompt(current ? `${current}

${prompt}` : prompt)
      toast.success('Image décrite : adapte le prompt à ton personnage.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDescribing(null)
    }
  }
  /**
   * « Placer le personnage dans cette photo » (testé le 2026-10-14 : klein 9B garde la vraie photo à l'identique et y
   * place le personnage avec la bonne lumière ; Qwen Edit remplaçait le décor, les modèles sans références le
   * réinventaient) : la photo en image 1, sa planche de références ensuite, aux proportions de la photo, et un prompt
   * à compléter (ce qu'il fait, sa tenue).
   */
  const placeInPhoto = async (photo: Asset) => {
    if (!persona) return
    const klein = ['local/flux2-klein-9b', 'local/flux2-klein-4b'].find((id) => families.find((f) => f.id === id)?.available)
    if (!klein) {
      toast.error('Il faut FLUX.2 klein en local (ComfyUI démarré).')
      return
    }
    try {
      const refs = await queryClient.fetchQuery({
        queryKey: qk.references(persona.id),
        queryFn: () => assetsApi.references(persona.id).then((r) => r.assets),
      })
      const poses = persona.referencePoses
      const ids = [poses.front, poses.threeQuarter].filter((id): id is string => Boolean(id))
      if (!ids.length && persona.avatarAssetId) ids.push(persona.avatarAssetId)
      const personaRefs = ids.flatMap((id) => refs.filter((a) => a.id === id))
      if (!personaRefs.length) {
        toast.error(`${persona.name} n’a pas encore d’image de référence.`)
        return
      }
      // Proportions de la photo : la plus proche parmi celles du modèle.
      const size = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => reject(new Error('Photo illisible.'))
        img.src = photo.url
      })
      const ratios = families.find((f) => f.id === klein)?.tasks['image-to-image']?.schema.properties?.aspect_ratio?.enum ?? []
      const ratio = (ratios as string[])
        .map((r) => ({ r, d: Math.abs(Math.log(Number(r.split(':')[0]) / Number(r.split(':')[1]) / (size.w / size.h))) }))
        .sort((a, b) => a.d - b.d)[0]?.r
      const who = persona.gender === 'male' ? 'young man' : persona.gender === 'female' ? 'young woman' : 'person'
      const many = personaRefs.length > 1 ? 'images 2 and 3' : 'image 2'
      composer.load({
        family: klein,
        attachments: [photo, ...personaRefs],
        prompt:
          `The ${who} from image 2 (same face and same hair as in ${many}) is [ce qu’elle fait, sa tenue] in the place of image 1. ` +
          'Keep the place, the objects and the lighting of image 1 exactly as they are. Natural candid smartphone photo, realistic skin texture.',
      })
      if (ratio) composer.setParam(klein, 'aspect_ratio', ratio)
      toast.success(`Remplace « [ce qu’elle fait, sa tenue] » dans le prompt (en anglais de préférence), puis génère.`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  // Catalogue chargé même sans clé SpicyAPI : les modèles locaux (ComfyUI) suffisent à générer.
  const { data: catalog, error: catalogError } = useQuery(
    catalogQuery(Boolean(settings)),
  )
  const { data: personas = [], isSuccess: personasLoaded } = useQuery(personasQuery())
  const { data: contexts = [] } = useQuery(presetsQuery())
  const families = catalog?.families ?? []
  // Personas présents : ceux du fil et ceux des images jointes (dans l'ordre de la Bibliothèque).
  const presentIds = new Set([
    ...threadPersonaIds,
    ...state.attachments.map((a) => a.personaId).filter(Boolean),
  ])
  const present = personas.filter((p) => presentIds.has(p.id))
  // Personnage actif : celui posé sur le brouillon, sinon le premier présent (fil ou image jointe). Il apporte son
  // genre (phrase des traits), sa voix (« Texte dit »), sa planche de références et ses lieux ; le fil reste libre.
  const persona = personas.find((p) => p.id === state.personaId) ?? present[0] ?? null

  const settingsLoaded = Boolean(settings)
  const usable = (id: string | null | undefined, media: MediaKind) =>
    id && families.some((f) => f.id === id && f.available && f.media === media)
      ? id
      : null
  // Modèle par défaut, dans l'ordre : dernier modèle du fil > modèle par défaut (Paramétrage)
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
        ? settings?.defaultImageFamily
        : settings?.defaultVideoFamily,
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
    composer.enterThread(threadId ?? null)
  }, [threadId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Jamais sans modèle : si le modèle courant manque ou n'est plus disponible
  // (catalogue pas encore chargé, modèle retiré…), on applique la cascade.
  useEffect(() => {
    if (!catalog || !settingsLoaded) return
    const current = families.find((f) => f.id === state.family)
    if (current?.available) return
    const pick = pickFamily(current?.media ?? 'image')
    if (pick) composer.setFamily(pick)
  }, [catalog, settingsLoaded, state.family]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Réinitialiser : visible dès qu'il y a du contenu (texte ou image), pas pour un simple réglage.
  const defaultFamily = pickFamily(media, { memory: false })
  const canReset = !isEmptyDraft(state)
  // Workflow lancé depuis le fil : son formulaire s'affiche au-dessus du composer.
  const [workflowFormId, setWorkflowFormId] = useState<string | null>(
    initialWorkflowId ?? null,
  )
  useEffect(
    () => setWorkflowFormId(initialWorkflowId ?? null),
    [threadId, initialWorkflowId],
  )
  const [undoReset, setUndoReset] = useState<ReturnType<
    typeof composer.reset
  > | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hideUndoLater = () => {
    clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setUndoReset(null), 2500)
  }
  // Dictée en cours (déclarée plus bas) : arrêtée avant de vider, sans rien garder.
  const stopDictationRef = useRef<() => void>(() => {})
  const resetComposer = () => {
    stopDictationRef.current()
    setUndoReset(composer.reset(defaultFamily))
    hideUndoLater()
  }
  // Changement de fil : l'annulation ne vaut que pour le brouillon réinitialisé.
  useEffect(() => {
    clearTimeout(undoTimer.current)
    setUndoReset(null)
  }, [threadId])
  useEffect(() => () => clearTimeout(undoTimer.current), [])
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
  // LoRA pour ce modèle, de Général et des personas présents : rien n'est coché d'office, 3 max.
  const personaLoras = supportsLoras
    ? [...(settings?.loras ?? []), ...present.flatMap((p) => p.loras)].filter(
        (l) => l.family === state.family && l.path,
      )
    : []
  const activeLoras = personaLoras
    .filter((l) => l.id in state.loras)
    .slice(0, MAX_LORAS_PER_GENERATION)
  // Nombre réel d'images acceptées par le modèle choisi (compteur « n / max »).
  const imageInfo = family
    ? imageInputInfo(family.media, family.tasks, state.refMode)
    : { max: 0, mode: 'none' as const }
  // Persona créé avec le créateur : sa fiche d'identité arrive en bulles (une fois par fil, si aucune n'est posée),
  // seulement pour un modèle qui ne reprend pas les références du persona. Un modèle à références (klein, Qwen Edit)
  // ou une vidéo (l'image porte le personnage) suit mieux ses images : des bulles de traits tireraient son visage
  // vers un visage « type ». Une bulle reste ajoutable à la main (changer sa coupe…).
  // Le modèle est lu dans le store : les effets de choix du modèle, déclarés plus haut, viennent de le fixer.
  const identitySeeded = useRef<string | null>(null)
  useEffect(() => {
    if (!persona || !catalog || !personasLoaded) return
    const current = families.find((f) => f.id === composerStore.state.family)
    if (!current) return
    const key = `${persona.id}:${state.threadKey}`
    if (identitySeeded.current === key) return
    identitySeeded.current = key
    const info = imageInputInfo(current.media, current.tasks)
    const followsReferences = current.media === 'video' || info.mode === 'reference'
    if (!followsReferences && persona.identity.length && composerStore.state.traits.length === 0) {
      composer.load({ traits: persona.identity })
    }
    // Modèle à références : la planche du persona (face, trois-quarts, profil ; à défaut son avatar) est jointe
    // d'office, sauf si des images sont déjà jointes. Celles d'un autre persona (changement de persona dans un
    // nouveau fil) sont remplacées.
    const attached = composerStore.state.attachments
    const othersOnly = attached.length > 0 && attached.every((a) => a.personaId && a.personaId !== persona.id)
    if (current.media !== 'image' || info.mode !== 'reference' || (attached.length && !othersOnly)) return
    const poses = persona.referencePoses
    const ids = [poses.front, poses.threeQuarter, poses.profile].filter((id): id is string => Boolean(id))
    if (!ids.length && persona.avatarAssetId) ids.push(persona.avatarAssetId)
    if (!ids.length) return
    void queryClient
      .fetchQuery({ queryKey: qk.references(persona.id), queryFn: () => assetsApi.references(persona.id).then((r) => r.assets) })
      .then((refs) => {
        const picked = ids.flatMap((id) => refs.filter((a) => a.id === id)).slice(0, info.max || ids.length)
        if (picked.length) composer.load({ attachments: picked })
      })
      .catch(() => undefined)
  }, [persona?.id, state.threadKey, state.family, catalog, personasLoaded]) // eslint-disable-line react-hooks/exhaustive-deps
  // Voix de référence : modèles vidéo qui en acceptent (Wan 3.0, Seedance…).
  const voiceInfo =
    family?.media === 'video'
      ? audioInputInfo(family.tasks)
      : { max: 0, mode: 'none' as const }
  // PROCHAINEMENT : ajout de la voix (VOICE_ENABLED) ; en pause, aucune voix n'est choisie ni envoyée.
  // Voix proposées : celles du premier persona présent (la voix reviendra avec sa propre logique).
  const voicePersona = present.find((p) => p.kind !== 'artistic') ?? null
  const selectedVoice = VOICE_ENABLED
    ? (voicePersona?.voices.find((v) => v.id === state.voiceId) ?? null)
    : null
  // La voix part comme référence audio : modèles qui en acceptent une, en mode références.
  const voiceSent =
    Boolean(selectedVoice) &&
    voiceInfo.mode === 'reference' &&
    task === 'reference-to-video'
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

  // Contextes envoyés : ceux qui sont actifs ET proposés pour ce type de média.
  const activeContextIds = contexts
    .filter(
      (c) =>
        c.enabled &&
        state.contextIds.includes(c.id) &&
        (c.media === 'all' || c.media === (family?.media ?? 'image')),
    )
    .map((c) => c.id)

  const request: GenerationRequest | null = family
    ? {
        threadId: threadId ?? null,
        // Personnage actif : son genre, sa voix (« Texte dit »).
        personaId: persona?.id ?? null,
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
        voiceId: voiceSent ? selectedVoice!.id : undefined,
      }
    : null

  const canQuote = Boolean(
    (settings?.hasApiKey || isLocal) &&
    family?.available &&
    resolution?.ok &&
    (!requiresPrompt || state.prompt.trim()) &&
    !uploading,
  )
  // Devis : le texte du prompt ne change pas le prix, seuls les réglages comptent.
  // On ne garde que « prompt vide ou non », pour ne pas redemander un prix à chaque frappe.
  const priceRequest = request
    ? {
        ...request,
        prompt: request.prompt.trim() ? 'prompt' : '',
        threadId: null,
      }
    : null
  const debounced = useDebounced(canQuote ? priceRequest : null, 600)
  const quoteKey = useMemo(
    () => (debounced ? JSON.stringify(debounced) : null),
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
    canQuote && quoteKey !== null && JSON.stringify(priceRequest) === quoteKey

  // Ce qui a été envoyé et d'où : le brouillon est vidé dès l'envoi (jamais après
  // la réponse, sinon partir pendant l'envoi garderait l'ancienne demande).
  const sent = useRef<{
    threadKey: string | null
    draft: { prompt: string; attachments: Asset[]; editAssetId: string | null }
  } | null>(null)
  // Générations « en attente » affichées avant la réponse du serveur.
  const optimistic = useRef<string[]>([])
  const showOptimistic = (
    id: string,
    body: GenerationRequest,
    mediaKind: MediaKind,
    taskKind: TaskKind | null,
  ): string[] => {
    const n = mediaKind === 'image' ? Math.max(1, body.count ?? 1) : 1
    const stamp = crypto.randomUUID()
    const batchId = n > 1 ? `optimistic-batch-${stamp}` : null
    const now = new Date().toISOString()
    const items: Generation[] = Array.from({ length: n }, (_, i) => ({
      id: `optimistic-${stamp}-${i}`,
      threadId: id,
      workflowId: null,
      workflowNodeId: null,
      voiceId: body.voiceId ?? null,
      personaId: body.personaId ?? null,
      face: null,
      traits: [],
      variation: null,
      durationMs: null,
      runtime: families.find((f) => f.id === body.family)?.runtime ?? 'spicy',
      prompt: body.prompt,
      finalPrompt: body.prompt,
      family: body.family,
      modelId: '',
      task: taskKind ?? 'text-to-image',
      params: body.params,
      refMode: body.refMode ?? 'start-frame',
      references: composerStore.state.attachments,
      batchId,
      batchIndex: i,
      contexts: [],
      loras: [],
      lorasApplied: 0,
      status: 'queued',
      errorCode: null,
      errorMessage: null,
      estimatedCost: null,
      cost: null,
      settled: false,
      seed: null,
      outputs: [],
      spicyTaskId: null,
      createdAt: now,
      completedAt: null,
      removedAt: null,
    }))
    void queryClient.cancelQueries({ queryKey: qk.thread(id) })
    queryClient.setQueryData<ThreadDetailResponse>(qk.thread(id), (old) =>
      old ? { ...old, generations: [...old.generations, ...items] } : old,
    )
    return items.map((g) => g.id)
  }
  const dropOptimistic = (id: string, ids: string[]) =>
    queryClient.setQueryData<ThreadDetailResponse>(qk.thread(id), (old) =>
      old
        ? {
            ...old,
            generations: old.generations.filter((g) => !ids.includes(g.id)),
          }
        : old,
    )
  const create = useMutation({
    mutationFn: (body: GenerationRequest) => generationsApi.create(body),
    onSuccess: ({ thread }) => {
      queryClient.invalidateQueries({ queryKey: qk.threadsAll })
      queryClient.invalidateQueries({ queryKey: qk.thread(thread.id) })
      queryClient.invalidateQueries({ queryKey: qk.balance })
      // Nouveau fil : on ne l'ouvre que si la personne est restée sur le nouveau fil.
      if (
        sent.current?.threadKey === 'new' &&
        composerStore.state.threadKey === 'new'
      ) {
        composer.adoptNewThread(thread.id)
        navigate({ to: '/t/$threadId', params: { threadId: thread.id } })
      }
    },
    onError: (err, body) => {
      if (body.threadId && optimistic.current.length) {
        dropOptimistic(body.threadId, optimistic.current)
        optimistic.current = []
      }
      if (sent.current)
        composer.restoreAfterError(sent.current.threadKey, sent.current.draft)
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
        const { asset } = await assetsApi.upload(f)
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
    // Le prix n'est jamais bloquant : sans devis à jour, la demande part quand même.
    if (!request || !canQuote || create.isPending || extraImages > 0) return
    const s = composerStore.state
    sent.current = {
      threadKey: s.threadKey,
      draft: {
        prompt: s.prompt,
        attachments: s.attachments,
        editAssetId: s.editAssetId,
      },
    }
    // Affichage optimiste : la demande apparaît tout de suite dans le fil, sans
    // attendre la réponse du serveur (remplacée par la vraie, retirée en cas d'erreur).
    if (threadId && family) {
      optimistic.current = showOptimistic(threadId, request, family.media, task)
    }
    // Le devis n'est qu'indicatif : jamais de prix attendu envoyé, donc jamais
    // de refus « le prix a changé » (Relancer et Upscale, eux, confirment un prix).
    create.mutate(request)
    composer.clearAfterSend()
  }

  // ── Dictée ───────────────────────────────────────────────────
  // Le texte dicté s'insère à la dernière position connue du curseur (sinon à la fin),
  // en gris tant qu'il n'est pas validé : Entrée (ou le micro) valide, Échap annule.
  const dictation = useDictation()
  const caret = useRef<{ start: number; end: number } | null>(null)
  const dictationBase = useRef<{
    before: string
    after: string
    prompt: string
  } | null>(null)
  const rememberCaret = () => {
    const t = textareaRef.current
    if (t) caret.current = { start: t.selectionStart, end: t.selectionEnd }
  }
  // Morceaux affichés : texte avant, texte dicté (gris), texte après.
  const dictated = (() => {
    const base = dictationBase.current
    if (!base || !dictation.text) return null
    const lead = base.before && !/\s$/.test(base.before) ? ' ' : ''
    const tail = base.after && !/^\s/.test(base.after) ? ' ' : ''
    return {
      before: base.before,
      text: `${lead}${dictation.text}${tail}`,
      after: base.after,
    }
  })()
  useEffect(() => {
    if (dictation.active && dictated)
      composer.setPrompt(dictated.before + dictated.text + dictated.after)
  }, [dictation.text]) // eslint-disable-line react-hooks/exhaustive-deps

  const startDictation = () => {
    const prompt = composerStore.state.prompt
    const at = caret.current ?? { start: prompt.length, end: prompt.length }
    dictationBase.current = {
      before: prompt.slice(0, at.start),
      after: prompt.slice(at.end),
      prompt,
    }
    // Vocabulaire à bien transcrire : personas, jargon de l'app, fournisseurs, modèles.
    void dictation.start(
      settings?.dictationProvider ?? 'elevenlabs',
      (provider) =>
        dictationKeyterms(provider, {
          personas: personas.map((p) => p.name),
          providers: Object.values(PROVIDERS).map((p) => p.label),
          models: families.map((f) => f.label),
        }),
    )
  }
  /** Valide le texte dicté : petit son, fin de l'écoute, curseur juste après. */
  const validateDictation = async () => {
    const base = dictationBase.current
    const text = await dictation.finish()
    dictationBase.current = null
    if (!base || !text.trim()) {
      if (base) composer.setPrompt(base.prompt)
      return
    }
    const lead = base.before && !/\s$/.test(base.before) ? ' ' : ''
    const tail = base.after && !/^\s/.test(base.after) ? ' ' : ''
    const head = base.before + lead + text + tail
    composer.setPrompt(head + base.after)
    playValidateSound()
    caret.current = { start: head.length, end: head.length }
    requestAnimationFrame(() => {
      const t = textareaRef.current
      t?.focus()
      t?.setSelectionRange(head.length, head.length)
    })
  }
  const cancelDictation = () => {
    const base = dictationBase.current
    dictation.cancel()
    dictationBase.current = null
    if (base) composer.setPrompt(base.prompt)
  }
  stopDictationRef.current = cancelDictation

  const toggleDictation = () =>
    dictation.active ? void validateDictation() : startDictation()
  // ⌥M (Alt+M) : lancer ou valider la dictée, depuis n'importe où dans l'app.
  const toggleRef = useRef(toggleDictation)
  toggleRef.current = toggleDictation
  // Pendant la dictée, Entrée et Échap lui reviennent, où que soit le focus.
  const dictationKeys = useRef({
    prefetch: () => {},
    active: false,
    validate: () => {},
    cancel: () => {},
  })
  dictationKeys.current = {
    prefetch: dictation.prefetch,
    active: dictation.active,
    validate: validateDictation,
    cancel: cancelDictation,
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = dictationKeys.current
      // ⌥ seul (début de ⌥M) : jeton préparé pendant que le doigt cherche le M.
      if (e.key === 'Alt' && !d.active) d.prefetch()
      if (d.active && (e.key === 'Enter' || e.key === 'Escape')) {
        // Phase de capture : avant le champ, un bouton ou une modale qui aurait le focus.
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Enter') d.validate()
        else d.cancel()
        return
      }
      // Par le caractère (« µ » pour ⌥M sur Mac, « m » ailleurs) : marche en AZERTY
      // comme en QWERTY, où la touche M n'est pas au même endroit (e.code).
      const isM =
        e.key === 'µ' || e.key.toLowerCase() === 'm' || e.code === 'KeyM'
      if (e.altKey && !e.metaKey && !e.ctrlKey && isM) {
        e.preventDefault()
        toggleRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  // Changement de fil : la dictée en cours est abandonnée.
  useEffect(() => () => cancelDictation(), [threadId]) // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Pendant la dictée, Entrée et Échap sont pris plus haut (écouteur global).
    if (dictation.active) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const setParam = (key: string, v: unknown) =>
    state.family && composer.setParam(state.family, key, v)

  // Recette « réalisme » de Z-Image : la LoRA Realistic Snapshot si elle est installée dans ComfyUI.
  const realismLora = (schema?.properties?.lora?.enum as string[] | undefined)?.find((l) => /realistic[-_ ]?snapshot/i.test(l))
  const applyRealism = () => {
    if (!realismLora) return
    setParam('lora', realismLora)
    setParam('lora_strength', 0.7)
    // Réglée même sans image jointe : elle servira dès qu'une image passe Z-Image en image → image.
    setParam('strength', 0.25)
    toast.success(
      schema?.properties?.strength
        ? 'Réalisme : LoRA à 0,7 et force 0,25 (l’image jointe est retravaillée légèrement).'
        : 'Réalisme : LoRA à 0,7. Joins une image (ex. un résultat Qwen) pour la retravailler à force 0,25.',
    )
  }

  // Texte dit (vidéo parlée) : la piste écoutée avant la vidéo, reprise telle quelle à l'envoi.
  const [speechInfo, setSpeechInfo] = useState<{ assetId: string; url: string; seconds: number } | null>(null)
  const [listening, setListening] = useState(false)
  const speechAudioRef = useRef<HTMLAudioElement | null>(null)
  // Expressivité de cette vidéo : celle de la voix du personnage par défaut, modifiable ici.
  const { data: personaVoice } = useQuery({
    queryKey: qk.voice(persona?.id ?? ''),
    queryFn: () => personasApi.voice(persona!.id).then((r) => r.voice),
    enabled: Boolean(persona && schema?.properties?.speech_exaggeration),
  })
  const speechExaggeration =
    typeof params.speech_exaggeration === 'number' ? params.speech_exaggeration : (personaVoice?.exaggeration ?? null)
  // Conversion de voix : la phrase dite par l'utilisateur (micro ou fichier) redite avec la voix du personnage. Son
  // jeu (rythme, pauses, rire, chuchotement) est gardé : c'est elle qui sert de « Texte dit », telle quelle.
  const [recorder, setRecorder] = useState<{ stop: () => Promise<Blob>; cancel: () => void; since: number } | null>(null)
  const [converting, setConverting] = useState(false)
  const voiceFileRef = useRef<HTMLInputElement>(null)
  const convertVoice = async (wav: Blob) => {
    if (!persona) return
    setConverting(true)
    try {
      const info = await personasApi.convertSpeech(persona.id, wav)
      setSpeechInfo(info)
      setParam('speech', 'Voix enregistrée (convertie)')
      setParam('speech_audio', info.assetId)
      speechAudioRef.current?.pause()
      const audio = new Audio(info.url)
      speechAudioRef.current = audio
      void audio.play()
      toast.success(`Ta phrase, avec la voix de ${persona.name} : c’est elle qui sera utilisée.`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setConverting(false)
    }
  }
  const toggleRecording = async () => {
    if (recorder) {
      setRecorder(null)
      try {
        await convertVoice(await recorder.stop())
      } catch (e) {
        toast.error((e as Error).message)
      }
      return
    }
    try {
      setRecorder({ ...(await startRecording()), since: Date.now() })
    } catch {
      toast.error('Micro inaccessible : autorise-le dans le navigateur.')
    }
  }
  const { data: assist } = useQuery(assistStatusQuery())
  // Reformulation (Ollama, local) : l'idée réécrite pour le modèle choisi, en anglais (envoyée) et en français (à relire).
  const [rewrite, setRewrite] = useState<(RewritePromptResponse & { original: string }) | null>(null)
  const [rewriting, setRewriting] = useState(false)
  const rewritePrompt = async () => {
    const text = state.prompt.trim()
    if (!text) return
    setRewriting(true)
    try {
      const res = await assistApi.rewrite({
        text,
        media,
        familyId: family?.id ?? null,
        modelLabel: family?.label ?? null,
        attachments: imageAttachments.length,
        gender: persona?.gender ?? null,
      })
      setRewrite({ ...res, original: text })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRewriting(false)
    }
  }
  const listenSpeech = async () => {
    const text = typeof params.speech === 'string' ? params.speech.trim() : ''
    if (!persona || !text) return
    speechAudioRef.current?.pause()
    let url = speechInfo && params.speech_audio === speechInfo.assetId ? speechInfo.url : null
    if (!url && typeof params.speech_audio === 'string') url = `/api/media/${params.speech_audio}`
    if (!url) {
      setListening(true)
      try {
        const info = await personasApi.listenSpeech(persona.id, text, speechExaggeration ?? undefined)
        setSpeechInfo(info)
        setParam('speech_audio', info.assetId)
        url = info.url
      } catch (e) {
        toast.error((e as Error).message)
        return
      } finally {
        setListening(false)
      }
    }
    const audio = new Audio(url)
    speechAudioRef.current = audio
    void audio.play()
  }
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
  if (quoteIsCurrent && quote.data?.unknownWildcards.length) {
    notices.push({
      text: `Catégorie inconnue, laissée telle quelle : ${quote.data.unknownWildcards.map((k) => `__${k}__`).join(', ')}`,
      tone: 'warn',
    })
  }
  // Voix choisie mais pas envoyée : on dit pourquoi.
  if (selectedVoice && voiceInfo.max > 0 && !voiceSent) {
    notices.push({
      text:
        voiceInfo.mode === 'lipsync'
          ? `Voix « ${selectedVoice.name} » : la synchronisation des lèvres sur une voix arrive bientôt, elle n’est pas envoyée à ce modèle.`
          : `Voix « ${selectedVoice.name} » : elle part en mode Références (ajoute une image de référence et choisis ce mode).`,
      tone: 'warn',
    })
  }

  return (
    <div className="shrink-0 px-4 pt-2 pb-5">
      <div
        className="mx-auto max-w-[855px]"
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
        {/* Workflow choisi : son formulaire prend la place de la rangée des raccourcis. */}
        {workflowFormId ? (
          <WorkflowForm
            workflowId={workflowFormId}
            threadId={threadId}
            onClose={() => setWorkflowFormId(null)}
          />
        ) : (
          <ContextChips
            media={family?.media ?? 'image'}
            activeIds={state.contextIds}
            onToggle={composer.toggleContext}
            loras={personaLoras}
            activeLoras={state.loras}
            onToggleLora={composer.toggleLora}
            onToggleLoraWord={composer.toggleLoraWord}
          />
        )}

        <div
          className={cn(
            'relative flex flex-col rounded-3xl border bg-muted/50 shadow-[0_2px_8px_rgba(0,0,0,0.2)] backdrop-blur-sm transition-colors',
            dragging ? 'border-brand/70 bg-brand/5' : 'border-border/60',
          )}
        >
          {/* Annulation de la réinitialisation : centrée juste au-dessus du composer. */}
          {undoReset && (
            <div
              role="status"
              // Souris dessus : la personne hésite peut-être à annuler, on garde l'annulation.
              onMouseEnter={() => clearTimeout(undoTimer.current)}
              onMouseLeave={hideUndoLater}
              className="absolute bottom-full left-1/2 z-10 mb-2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border/60 bg-popover py-1 pr-1 pl-3.5 text-[13px] shadow-lg"
            >
              <Check className="h-4 w-4 text-emerald-400" />
              <span className="whitespace-nowrap">Réinitialisé</span>
              <button
                type="button"
                onClick={() => {
                  composer.restore(undoReset)
                  clearTimeout(undoTimer.current)
                  setUndoReset(null)
                }}
                className="rounded-full bg-accent px-3 py-1 text-[12px] font-medium hover:bg-accent/70"
              >
                Annuler
              </button>
            </div>
          )}
          {canReset && (
            <button
              type="button"
              onClick={resetComposer}
              aria-label="Réinitialiser le composer"
              title="Réinitialiser le composer"
              className="absolute top-3 right-3 z-[1] grid h-7 w-7 place-items-center rounded-full bg-white/[0.06] text-muted-foreground transition-colors hover:bg-white/[0.12] hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {/* Pièces jointes */}
          {(state.attachments.length > 0 || uploading > 0) && (
            <div
              className={cn(
                'flex flex-wrap gap-2 px-3 pt-3',
                canReset && 'pr-14',
              )}
            >
              <MediaViewer
                asset={state.attachments.find((x) => x.id === viewing) ?? null}
                onClose={() => setViewing(null)}
                onPrev={(() => {
                  const i = state.attachments.findIndex((x) => x.id === viewing)
                  return i > 0
                    ? () => setViewing(state.attachments[i - 1].id)
                    : undefined
                })()}
                onNext={(() => {
                  const i = state.attachments.findIndex((x) => x.id === viewing)
                  return i >= 0 && i < state.attachments.length - 1
                    ? () => setViewing(state.attachments[i + 1].id)
                    : undefined
                })()}
              />
              {state.attachments.map((a, i) => (
                <div
                  key={a.id}
                  data-testid="attachment"
                  className="group relative overflow-hidden rounded-xl border border-border/30"
                >
                  {/* Clic : aperçu en grand, flèches entre les images jointes. */}
                  <button
                    type="button"
                    onClick={() => setViewing(a.id)}
                    aria-label={`Voir l’image ${i + 1} en grand`}
                    className="block"
                  >
                    <AssetThumb asset={a} className="h-20 w-20" />
                  </button>
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
                  {/* LTX : une vidéo jointe (soi-même filmé) peut donner le mouvement, repris par le personnage. */}
                  {a.mediaType === 'video' && schema?.properties?.mouvement && (
                    <button
                      type="button"
                      onClick={() => {
                        setParam('mouvement', { video: `asset:${a.id}` })
                        composer.removeAttachment(a.id)
                      }}
                      className="absolute right-1 bottom-1 flex items-center gap-0.5 rounded bg-black/70 px-1 py-0.5 text-[10px] font-semibold text-white/90 hover:text-white"
                      title="Reprendre les mouvements de cette vidéo (squelettes) : le personnage de l’image de départ les refait"
                    >
                      <Footprints className="h-2.5 w-2.5" />
                      Mouvement
                    </button>
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
                  {/* Une photo d'un lieu (pas une référence du personnage) : y placer le personnage (klein). */}
                  {persona && a.mediaType === 'image' && a.personaId !== persona.id && (
                    <button
                      type="button"
                      onClick={() => placeInPhoto(a)}
                      className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-black/70 px-1 py-0.5 text-[10px] font-semibold text-white/90 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white"
                      title={`Placer ${persona.name} dans cette photo (klein garde la photo telle quelle)`}
                    >
                      <MapPinned className="h-2.5 w-2.5" />
                      Placer
                    </button>
                  )}
                  {/* Prompt inversé (JoyCaption, local) : la photo devient un prompt réutilisable. */}
                  {comfyStatus?.canDescribe && a.mediaType === 'image' && (
                    <button
                      type="button"
                      onClick={() => describe(a.id)}
                      disabled={describing !== null}
                      className={cn(
                        'absolute right-1 bottom-1 flex items-center gap-0.5 rounded bg-black/70 px-1 py-0.5 text-[10px] font-semibold text-white/90 transition-opacity hover:text-white',
                        describing === a.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      )}
                      title="Décrire l’image : en faire un prompt (lieu, tenue, pose, lumière), sans l’identité de la personne"
                    >
                      {describing === a.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <ScanText className="h-2.5 w-2.5" />}
                      Décrire
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
              <button
                type="button"
                onClick={composer.clearBubbles}
                className="flex h-7 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Retirer toutes les bulles"
              >
                <X className="h-3 w-3" />
                Tout effacer
              </button>
            </div>
          )}

          {rewrite && (
            <div className="mx-3 mt-3 rounded-2xl border border-brand/40 bg-brand/5 p-3 text-sm">
              <p className="leading-relaxed">{rewrite.fr || rewrite.en}</p>
              <details className="mt-1.5 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none">Texte envoyé au modèle (anglais)</summary>
                <p className="mt-1 leading-relaxed">{rewrite.en}</p>
              </details>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 rounded-full text-xs"
                  onClick={() => {
                    composer.setPrompt(rewrite.en)
                    setRewrite(null)
                  }}
                >
                  Utiliser
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 rounded-full text-xs" onClick={rewritePrompt} disabled={rewriting}>
                  {rewriting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Autre version'}
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 rounded-full text-xs" onClick={() => setRewrite(null)}>
                  Garder mon texte
                </Button>
                <span className="ml-auto text-[11px] text-muted-foreground/70">{rewrite.model.split('/').pop()}</span>
              </div>
            </div>
          )}
          {/* Pendant la dictée, le texte s'affiche par-dessus le champ : le dicté en gris. */}
          <div className="relative">
            {dictated && (
              <div
                aria-hidden
                data-testid="dictation-preview"
                className={cn(
                  'pointer-events-none absolute inset-0 overflow-hidden px-4 pt-3.5 pb-2 text-[15px] leading-normal break-words whitespace-pre-wrap',
                  canReset &&
                    state.attachments.length === 0 &&
                    uploading === 0 &&
                    'pr-14',
                )}
              >
                {dictated.before}
                <span className="text-muted-foreground/60">
                  {dictated.text}
                </span>
                {dictated.after}
              </div>
            )}
            <textarea
              ref={textareaRef}
              data-testid="composer-prompt"
              value={state.prompt}
              readOnly={dictation.active}
              onChange={(e) => composer.setPrompt(e.target.value)}
              onSelect={rememberCaret}
              onBlur={rememberCaret}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files)
                if (files.length) {
                  e.preventDefault()
                  onFiles(files)
                }
              }}
              // Pendant la dictée, jamais de placeholder : du texte arrive.
              placeholder={
                dictation.active
                  ? ''
                  : schema?.properties?.speech
                    ? // LTX : le prompt décrit un plan de cinéma ; guider sa structure améliore nettement le rendu.
                      'En anglais, dans l’ordre : le plan (medium shot, close-up…), la lumière, puis l’action pas à pas (« she smiles, waves, then takes a sip »), l’émotion par le corps (sourire, regard, gestes), ce que fait la caméra (fixe, suit, se rapproche) et les sons. Pas besoin de décrire la personne ni le lieu : l’image de départ les donne.'
                    : family?.media === 'video'
                      ? 'Décris la scène ou ajoute des références'
                      : 'Décris l’image ou ajoute des références'
              }
              className={cn(
                'field-sizing-content max-h-[220px] min-h-[52px] w-full resize-none border-0 bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-normal placeholder:text-muted-foreground/50 focus:ring-0 focus:outline-none',
                dictated && 'text-transparent caret-transparent',
                // Place du bouton Réinitialiser quand il est sur la ligne du texte.
                canReset &&
                  state.attachments.length === 0 &&
                  uploading === 0 &&
                  'pr-14',
              )}
              rows={1}
            />
          </div>

          {/* Mouvement repris d'une vidéo (LTX) : aperçu et retrait. */}
          {schema?.properties?.mouvement && typeof (params.mouvement as { video?: string } | undefined)?.video === 'string' && (
            <div className="mx-3 mb-1 flex items-center gap-2 rounded-xl border border-border/50 bg-background/40 px-3 py-1.5 text-xs">
              <Footprints className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <video
                src={`/api/media/${(params.mouvement as { video: string }).video.slice('asset:'.length)}`}
                muted
                loop
                autoPlay
                playsInline
                className="h-10 w-8 rounded object-cover"
              />
              <span className="min-w-0 flex-1 text-muted-foreground">
                Mouvement repris de cette vidéo. Dans le prompt, décris plutôt la scène et l’apparence : les gestes viennent de la vidéo.
                Une seule passe : 15 s au plus en 512p, 9 s en 720p.
              </span>
              <button
                type="button"
                onClick={() => setParam('mouvement', undefined)}
                className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Retirer le mouvement"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {/* Vidéo parlée (LTX local) : le personnage dit ce texte avec sa voix, les lèvres suivent. */}
          {schema?.properties?.speech && (
            <div className="mx-3 mb-1 flex items-center gap-2 rounded-xl border border-border/50 bg-background/40 px-3 py-1.5">
              <Mic className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={typeof params.speech === 'string' ? params.speech : ''}
                onChange={(e) => {
                  setParam('speech', e.target.value || undefined)
                  // La piste écoutée ne correspond plus au texte : elle sera refaite.
                  if (params.speech_audio) setParam('speech_audio', undefined)
                }}
                onKeyDown={onKeyDown}
                placeholder={
                  persona
                    ? `Texte dit par ${persona.name}, avec sa voix (facultatif)`
                    : 'Texte dit par le personnage, avec sa voix (facultatif)'
                }
                title={schema.properties.speech.description}
                className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground/50 focus:outline-none"
                maxLength={2000}
              />
              {/* Expressivité de cette vidéo (celle de la voix par défaut) : changer refait la piste. */}
              {schema.properties.speech_exaggeration && persona && speechExaggeration !== null && (
                <label
                  className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground"
                  title={`Expressivité pour cette vidéo : de calme (0,2) à très expressive (1,2). Celle de la voix de ${persona.name} : ${personaVoice?.exaggeration.toFixed(2) ?? '—'}`}
                >
                  Calme
                  <input
                    type="range"
                    min={0.2}
                    max={1.2}
                    step={0.05}
                    value={speechExaggeration}
                    onChange={(e) => {
                      setParam('speech_exaggeration', Number(e.target.value))
                      if (params.speech_audio) setParam('speech_audio', undefined)
                    }}
                    className="w-20 accent-brand"
                    aria-label="Expressivité"
                  />
                  Expressive
                </label>
              )}
              {speechInfo && params.speech_audio === speechInfo.assetId && (
                <span className="shrink-0 text-[11px] text-muted-foreground" title="Durée de la piste, temps de calcul estimé de la vidéo">
                  {speechInfo.seconds.toFixed(1)} s · vidéo ≈ {videoMinutes(speechInfo.seconds, String(params.resolution ?? '512p'))} min
                </span>
              )}
              <button
                type="button"
                onClick={listenSpeech}
                disabled={!persona || !(typeof params.speech === 'string' && params.speech.trim()) || listening}
                className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                title={
                  persona
                    ? 'Écouter la piste avant de lancer la vidéo : c’est elle qui sera utilisée, telle quelle'
                    : 'Choisis un personnage (sa voix)'
                }
              >
                {listening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
                Écouter
              </button>
              {/* Ma voix : dire la phrase soi-même (micro), avec l'émotion voulue ; elle est redite avec la voix du personnage. */}
              <button
                type="button"
                onClick={toggleRecording}
                disabled={!persona || converting}
                className={cn(
                  'flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs hover:bg-accent disabled:opacity-40',
                  recorder ? 'text-red-400' : 'text-muted-foreground hover:text-foreground',
                )}
                title={
                  recorder
                    ? 'Arrêter : ta phrase est redite avec la voix du personnage'
                    : 'Dire la phrase toi-même au micro, avec l’émotion voulue (rire, chuchotement…) : elle est redite avec la voix du personnage'
                }
              >
                {converting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : recorder ? (
                  <Square className="h-3 w-3 fill-current" />
                ) : (
                  <Circle className="h-3 w-3 fill-red-500 text-red-500" />
                )}
                {recorder ? <RecordingTime since={recorder.since} /> : 'Ma voix'}
              </button>
              <button
                type="button"
                onClick={() => voiceFileRef.current?.click()}
                disabled={!persona || converting || Boolean(recorder)}
                className="flex h-7 shrink-0 items-center rounded-full px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                title="Importer un enregistrement de ta phrase (MP3, WAV, M4A…) : il est redit avec la voix du personnage"
              >
                <Upload className="h-3.5 w-3.5" />
              </button>
              <input
                ref={voiceFileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  try {
                    await convertVoice(await toWav(file))
                  } catch {
                    toast.error('Fichier audio illisible.')
                  }
                }}
              />
            </div>
          )}
          {schema?.properties?.speech && typeof params.speech === 'string' && params.speech.trim() && (
            <p className="mx-4 mb-1 text-[11px] text-muted-foreground">
              Pauses exactes : <code>[2s]</code> au début, entre deux phrases ou à la fin. La vidéo dure au moins la durée
              choisie (voix plus courte : complétée par du silence).
            </p>
          )}
          {/* Vidéo longue (clips enchaînés) : le prompt peut raconter une suite, un passage par ligne « --- ». */}
          {schema?.properties?.speech &&
            (Number(params.duration_seconds) > 15 || (typeof params.speech === 'string' && params.speech.length > 200)) && (
              <p className="mx-4 mb-1 text-[11px] text-muted-foreground">
                Vidéo longue : sépare les passages du prompt par une ligne <code>---</code> pour raconter une suite (sinon, le même
                prompt pour toute la vidéo). Compte ~40 s de calcul par seconde de vidéo en 512p.
              </p>
            )}

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
              {/* Ajouter : depuis l'ordinateur ou une librairie, avec le compteur d'images du modèle (n / max). */}
              <Popover open={addOpen} onOpenChange={setAddOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
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
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  className="w-auto min-w-56 rounded-2xl p-1.5"
                >
                  <AddMenuItem
                    icon={<Upload className="size-4" />}
                    label="Importer un fichier"
                    onClick={() => {
                      setAddOpen(false)
                      fileRef.current?.click()
                    }}
                  />
                  <AddMenuItem
                    icon={<FolderOpen className="size-4" />}
                    label="Choisir depuis une librairie"
                    onClick={() => {
                      setAddOpen(false)
                      setLibraryOpen(true)
                    }}
                  />
                </PopoverContent>
              </Popover>
              <LibraryBrowser
                open={libraryOpen}
                onOpenChange={setLibraryOpen}
                personaId={null}
                onImport={(asset) => composer.addAttachments([asset])}
              />
              {/* Références de tous les personas et de Général (un titre par section). */}
              <ReferencePicker
                personas={personas}
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
              <button
                type="button"
                onClick={() => setTraitPicker('')}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-foreground/80 shadow-[inset_0_0_0_1px_var(--color-border)] transition-colors hover:bg-accent/60"
                aria-label="Trait"
                title="Trait : coiffure, tenue, pose, lieu… (page Traits)"
              >
                <Shapes className="h-3.5 w-3.5" />
              </button>
              <PlaceButton persona={persona} placeId={state.placeId} />
              <ScenesButton />
              {persona && family?.supportsFace && <FaceButton persona={persona} faceId={faceId} />}
              <MediaSwitch value={media} onChange={switchMedia} />
              <ModelPicker
                media={media}
                families={families}
                value={state.family}
                model={typeof params.model === 'string' ? params.model : null}
                onChange={(id, file) => {
                  composer.setFamily(id)
                  // Variante d'un modèle local, choisie sous sa ligne dans le menu.
                  if (file) composer.setParam(id, 'model', file)
                }}
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
              {/* Voix du persona, juste à droite du modèle : seulement pour un modèle vidéo qui accepte une voix. */}
              {VOICE_ENABLED && voicePersona && voiceInfo.max > 0 && (
                <VoicePicker
                  persona={voicePersona}
                  value={selectedVoice?.id ?? null}
                  onChange={composer.setVoice}
                />
              )}
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
              {/* Z-Image : recette « réalisme » (peau, grain, lumière naturelle), par ex. après Qwen Edit. */}
              {realismLora && (
                <button
                  type="button"
                  onClick={applyRealism}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-foreground/80 shadow-[inset_0_0_0_1px_var(--color-border)] transition-colors hover:bg-accent/60"
                  aria-label="Réalisme"
                  title={`Réalisme : LoRA ${realismLora.replace(/\.safetensors$/, '')} à 0,7, et avec une image jointe force 0,25 (garde le personnage et la scène, retrouve la peau et la lumière naturelle)`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </button>
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
              <WorkflowPickerButton
                onPick={setWorkflowFormId}
                active={Boolean(workflowFormId)}
              />
            </div>

            {/* Générer : prix à gauche du bouton, sans infobulle. */}
            <div className="flex shrink-0 items-center gap-2">
              {assist?.rewrite && (
                <button
                  type="button"
                  onClick={rewritePrompt}
                  disabled={rewriting || dictation.active || !state.prompt.trim()}
                  aria-label="Reformuler"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                  title={`Reformuler pour ${family?.label ?? 'ce modèle'} : l'idée détaillée selon ses règles d'écriture, en anglais (envoyé) et en français (à relire). En local, par ${assist.model?.split('/').pop() ?? 'Ollama'} ; le premier appel charge le modèle (~20 s).`}
                >
                  {rewriting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                </button>
              )}
              <span className="text-xs text-foreground/80 tabular-nums">
                {/* Recalcul : l'ancien prix reste, estompé ; trois points au tout premier prix du fil. */}
                <LoadingValue
                  key={threadId ?? 'new'}
                  loading={canQuote && (quote.isFetching || !quoteIsCurrent)}
                  value={
                    canQuote && quoteIsCurrent && quote.data
                      ? isLocal ? 'Local' : `≈ ${formatUsd(quote.data.estimatedCost)}`
                      : null
                  }
                  variant="dots"
                  keepValue
                />
              </span>
              {/* Dictée : à gauche de l'envoi. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleDictation}
                    // Jeton préparé dès le survol : au clic, il ne reste que la connexion.
                    onMouseEnter={dictation.prefetch}
                    onFocus={dictation.prefetch}
                    aria-label={
                      dictation.active ? 'Valider la dictée' : 'Dicter'
                    }
                    aria-pressed={dictation.active}
                    data-status={dictation.status}
                    className={cn(
                      'grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                      dictation.active &&
                        'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 hover:text-blue-200',
                    )}
                  >
                    {dictation.status === 'connecting' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="flex items-center gap-2">
                  {dictation.active ? 'Entrée valide, Échap annule' : 'Dicter'}
                  <kbd className="rounded bg-white/10 px-1 font-sans text-[11px]">
                    ⌥M
                  </kbd>
                </TooltipContent>
              </Tooltip>
              <Button
                type="button"
                size="icon"
                onClick={dictation.active ? () => void validateDictation() : send}
                disabled={!canQuote || extraImages > 0 || create.isPending}
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

/** Durée de l'enregistrement en cours (m:ss). */
function RecordingTime({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  const s = Math.floor((now - since) / 1000)
  return <span className="tabular-nums">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
}

/** Entrée du menu du bouton + : icône dans une pastille, libellé. */
function AddMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center gap-3 rounded-xl px-2.5 text-left text-sm whitespace-nowrap text-foreground outline-none hover:bg-white/[0.05] focus-visible:bg-white/[0.05]"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-muted-foreground">
        {icon}
      </span>
      {label}
    </button>
  )
}
