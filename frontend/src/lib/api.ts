/**
 * Transport HTTP unique vers le backend Hono.
 * Navigateur : `/api` (proxy Vite, cookies same-site). Throw on error.
 */
import type {
  Asset,
  PersonaLocalVoice,
  CharacterDraft,
  CreatorKind,
  AuthResponse,
  CatalogResponse,
  ComfyStatus,
  DictationTokenResponse,
  CivitaiSearchResponse,
  CivitaiWildcardListsResponse,
  CivitaiWildcardSearchResponse,
  ListRewriteQuoteResponse,
  ListRewriteResponse,
  CivitaiSort,
  CreateGenerationResponse,
  CreditsResponse,
  AssistStatus,
  RewritePromptRequest,
  RewritePromptResponse,
  EnhancePromptRequest,
  EnhancePromptResponse,
  Generation,
  Gender,
  GenerationRequest,
  LibraryCategory,
  LibraryImportResult,
  LibraryMoveResult,
  LibraryOption,
  LibraryThumbnail,
  ThumbnailGender,
  ThumbnailQuote,
  LoginRequest,
  MastersResponse,
  LocalModelsResponse,
  Persona,
  ReferencePose,
  PersonaInput,
  Place,
  PromptPreset,
  QuoteResponse,
  Scene,
  SearchResult,
  Settings,
  SignupRequest,
  VariationRequest,
  Thread,
  TrashResponse,
  ThreadDetailResponse,
  UpdateSettingsRequest,
  UpscaleRequest,
  Balance,
  LibrarySearchResponse,
  LibrarySource,
  LibraryStatus,
  User,
  VoiceLibraryResponse,
  Workflow,
  WorkflowQuoteResponse,
  WorkflowRunRequest,
  WorkflowRunStartResponse,
  WorkflowStateResponse,
  WorkflowSummary,
  UpdateWorkflowRequest,
} from '@sublime/shared'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message)
  }
}

type Query = Record<string, string | number | boolean | undefined | null>

async function apiFetch<T>(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown; query?: Query } = {},
): Promise<T> {
  const { body, query, headers, ...rest } = init
  const qs = query
    ? new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : ''
  // FormData ou Blob (audio) : envoyés tels quels, avec leur propre type.
  const isForm = body instanceof FormData || body instanceof Blob
  const res = await fetch(`/api${path}${qs ? `?${qs}` : ''}`, {
    credentials: 'include',
    ...rest,
    headers: isForm || body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error) ||
      (data && typeof data === 'object' && 'success' in data && 'error' in data
        ? 'Données invalides.'
        : // Réponse sans JSON du backend : il redémarre ou ne répond pas (proxy Vite).
          res.status >= 502 && res.status <= 504
          ? 'Le serveur ne répond pas pour le moment, réessaie dans quelques secondes.'
          : `Erreur ${res.status}`)
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
      window.location.href = '/connexion'
    }
    throw new ApiError(message, res.status, data)
  }
  return data as T
}

export const authApi = {
  me: () => apiFetch<{ user: User | null }>('/auth/me'),
  login: (body: LoginRequest) => apiFetch<AuthResponse>('/auth/login', { method: 'POST', body }),
  signup: (body: SignupRequest) => apiFetch<AuthResponse>('/auth/signup', { method: 'POST', body }),
  logout: () => apiFetch<{ ok: true }>('/auth/logout', { method: 'POST' }),
  updateMe: (body: { name?: string; avatarAssetId?: string | null }) => apiFetch<AuthResponse>('/auth/me', { method: 'PATCH', body }),
}

export const settingsApi = {
  get: () => apiFetch<{ settings: Settings }>('/settings'),
  update: (body: UpdateSettingsRequest) => apiFetch<{ settings: Settings }>('/settings', { method: 'PATCH', body }),
  setApiKey: (apiKey: string) =>
    apiFetch<{ settings: Settings }>('/settings/api-key', { method: 'PUT', body: { apiKey } }),
  removeApiKey: () => apiFetch<{ settings: Settings }>('/settings/api-key', { method: 'DELETE' }),
  setElevenLabsKey: (apiKey: string) =>
    apiFetch<{ settings: Settings }>('/settings/elevenlabs-key', { method: 'PUT', body: { apiKey } }),
  removeElevenLabsKey: () => apiFetch<{ settings: Settings }>('/settings/elevenlabs-key', { method: 'DELETE' }),
  openMediaDir: () => apiFetch<{ ok: true }>('/settings/open-media-dir', { method: 'POST' }),
  balance: () => apiFetch<{ balance: Balance | null }>('/settings/balance'),
  credits: () => apiFetch<CreditsResponse>('/settings/credits'),
  /** Modèles locaux : fichiers de diffusion de ComfyUI, leur type et leur visibilité. */
  localModels: () => apiFetch<LocalModelsResponse>('/settings/local-models'),
  setLocalModel: (body: { file: string; family?: string | null; hidden?: boolean }) =>
    apiFetch<LocalModelsResponse>('/settings/local-models', { method: 'PATCH', body }),
}

export const comfyApi = {
  status: () => apiFetch<{ status: ComfyStatus }>('/comfy/status'),
  start: () => apiFetch<{ status: ComfyStatus }>('/comfy/start', { method: 'POST' }),
  stop: () => apiFetch<{ status: ComfyStatus }>('/comfy/stop', { method: 'POST' }),
}

type LibraryCategoryInput = Pick<LibraryCategory, 'label'> &
  Partial<Pick<LibraryCategory, 'key' | 'description' | 'zone' | 'gendered' | 'thumbnailTemplate' | 'phrase' | 'parentId' | 'thumbnailFamily'>>
type LibraryOptionInput = Pick<LibraryOption, 'fragment'> & Partial<Pick<LibraryOption, 'label' | 'gender' | 'tags' | 'weight' | 'favorite' | 'hidden'>>

export const traitsApi = {
  categories: () => apiFetch<{ categories: LibraryCategory[] }>('/traits/categories'),
  createCategory: (body: LibraryCategoryInput) =>
    apiFetch<{ category: LibraryCategory }>('/traits/categories', { method: 'POST', body }),
  updateCategory: (id: string, body: Partial<LibraryCategoryInput>) =>
    apiFetch<{ category: LibraryCategory }>(`/traits/categories/${id}`, { method: 'PATCH', body }),
  removeCategory: (id: string) => apiFetch<{ ok: true }>(`/traits/categories/${id}`, { method: 'DELETE' }),
  options: (categoryId: string) => apiFetch<{ options: LibraryOption[] }>(`/traits/categories/${categoryId}/options`),
  addOption: (categoryId: string, body: LibraryOptionInput) =>
    apiFetch<{ option: LibraryOption }>(`/traits/categories/${categoryId}/options`, { method: 'POST', body }),
  importText: (categoryId: string, text: string, source: string, gender: Gender | null = null) =>
    apiFetch<{ result: LibraryImportResult }>(`/traits/categories/${categoryId}/import`, {
      method: 'POST',
      body: { text, source, gender },
    }),
  updateOption: (id: string, body: Partial<LibraryOptionInput>) =>
    apiFetch<{ option: LibraryOption }>(`/traits/options/${id}`, { method: 'PATCH', body }),
  removeOption: (id: string) => apiFetch<{ ok: true }>(`/traits/options/${id}`, { method: 'DELETE' }),
  moveOptions: (optionIds: string[], categoryId: string) =>
    apiFetch<{ result: LibraryMoveResult }>('/traits/options/move', { method: 'POST', body: { optionIds, categoryId } }),
  flagOptions: (optionIds: string[], flags: { favorite?: boolean; hidden?: boolean }) =>
    apiFetch<{ updated: number }>('/traits/options/flag', { method: 'POST', body: { optionIds, ...flags } }),
  removeOptions: (optionIds: string[]) =>
    apiFetch<{ deleted: number }>('/traits/options/delete', { method: 'POST', body: { optionIds } }),
  thumbnails: (categoryId: string) => apiFetch<{ thumbnails: LibraryThumbnail[] }>(`/traits/categories/${categoryId}/thumbnails`),
  generateThumbnails: (categoryId: string, mode: 'missing' | 'all') =>
    apiFetch<{ queued: number }>(`/traits/categories/${categoryId}/thumbnails`, { method: 'POST', body: { mode } }),
  quoteThumbnails: (categoryId: string, mode: 'missing' | 'all') =>
    apiFetch<{ quote: ThumbnailQuote }>(`/traits/categories/${categoryId}/thumbnails/quote`, { method: 'POST', body: { mode } }),
  cancelThumbnails: (categoryId: string) =>
    apiFetch<{ cancelled: number }>(`/traits/categories/${categoryId}/thumbnails/cancel`, { method: 'POST' }),
  regenerateThumbnail: (optionId: string, gender?: ThumbnailGender) =>
    apiFetch<{ queued: number }>(`/traits/options/${optionId}/thumbnails`, { method: 'POST', body: { gender } }),
}

export const charactersApi = {
  current: (kind: CreatorKind = 'character') =>
    apiFetch<{ draft: CharacterDraft }>('/characters/drafts/current', { query: { kind } }),
  create: (start: 'blank' | 'random', kind: CreatorKind = 'character') =>
    apiFetch<{ draft: CharacterDraft }>('/characters/drafts', { method: 'POST', body: { start, kind } }),
  update: (id: string, body: Partial<Pick<CharacterDraft, 'name' | 'gender' | 'slots' | 'previewPrompt' | 'family'>>) =>
    apiFetch<{ draft: CharacterDraft }>(`/characters/drafts/${id}`, { method: 'PATCH', body }),
  /** Crée le persona (personnage) ou le lieu depuis une variante. */
  keep: (id: string, generationId: string, name: string) =>
    apiFetch<{ persona?: Persona; place?: Place }>(`/characters/drafts/${id}/keep`, { method: 'POST', body: { generationId, name } }),
}

export const catalogApi = {
  get: (refresh = false) => apiFetch<CatalogResponse>('/catalog', { query: { refresh: refresh || undefined } }),
}

export const assetsApi = {
  upload: (file: File, opts: { personaId?: string | null; isReference?: boolean } = {}) => {
    const form = new FormData()
    form.append('file', file)
    if (opts.personaId) form.append('personaId', opts.personaId)
    if (opts.isReference) form.append('isReference', 'true')
    return apiFetch<{ asset: Asset }>('/assets', { method: 'POST', body: form })
  },
  references: (personaId: string) => apiFetch<{ assets: Asset[] }>('/assets/references', { query: { personaId } }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/assets/${id}`, { method: 'DELETE' }),
  /** Prompt inversé : JoyCaption (local) décrit l'image en un prompt anglais. */
  describe: (id: string) => apiFetch<{ prompt: string }>(`/assets/${id}/describe`, { method: 'POST' }),
  reorderReferences: (personaId: string, ids: string[]) =>
    apiFetch<{ ok: true }>('/assets/references/order', { method: 'PUT', body: { personaId, ids } }),
  setReference: (assetId: string, personaId: string, isReference: boolean) =>
    apiFetch<{ asset: Asset }>(`/assets/${assetId}/reference`, { method: 'PATCH', body: { personaId, isReference } }),
  gallery: (query: { personaId?: string; media?: 'image' | 'video'; before?: string }) =>
    apiFetch<{
      items: {
        asset: Asset
        /** Demande d'origine : dans un fil, ou résultat d'un workflow. */
        generation: { id: string; threadId: string | null; workflowId: string | null; prompt: string; family: string } | null
      }[]
      nextBefore: string | null
    }>('/assets/gallery', { query }),
}

export const personasApi = {
  list: () => apiFetch<{ personas: Persona[] }>('/personas'),
  create: (body: Partial<PersonaInput> & { name: string }) =>
    apiFetch<{ persona: Persona }>('/personas', { method: 'POST', body }),
  update: (id: string, body: Partial<PersonaInput>) =>
    apiFetch<{ persona: Persona }>(`/personas/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/personas/${id}`, { method: 'DELETE' }),
  reorder: (ids: string[]) => apiFetch<{ ok: true }>('/personas/order', { method: 'PUT', body: { ids } }),
  voice: (id: string) => apiFetch<{ voice: PersonaLocalVoice }>(`/personas/${id}/voice`),
  createVoice: (id: string, description: string, resolution: '512p' | '720p', language: 'fr' | 'en') =>
    apiFetch<{ voice: PersonaLocalVoice }>(`/personas/${id}/voice/create`, { method: 'POST', body: { description, resolution, language } }),
  voices: () => apiFetch<{ voices: { personaId: string; name: string; url: string }[] }>('/personas/voices'),
  importVoice: (id: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<{ voice: PersonaLocalVoice }>(`/personas/${id}/voice/import`, { method: 'POST', body: form })
  },
  copyVoice: (id: string, fromPersonaId: string) =>
    apiFetch<{ voice: PersonaLocalVoice }>(`/personas/${id}/voice/copy`, { method: 'POST', body: { fromPersonaId } }),
  cancelVoice: (id: string) => apiFetch<{ voice: PersonaLocalVoice }>(`/personas/${id}/voice/cancel`, { method: 'POST' }),
  decideVoice: (id: string, keep: boolean) =>
    apiFetch<{ voice: PersonaLocalVoice }>(`/personas/${id}/voice/candidate`, { method: 'POST', body: { keep } }),
  updateVoice: (id: string, body: { exaggeration?: number; clearJob?: boolean }) =>
    apiFetch<{ voice: PersonaLocalVoice }>(`/personas/${id}/voice`, { method: 'PATCH', body }),
  /** Texte dit écouté avant la vidéo : la piste est gardée et reprise telle quelle par la génération. */
  listenSpeech: (id: string, text: string, exaggeration?: number) =>
    apiFetch<{ assetId: string; url: string; seconds: number }>(`/personas/${id}/voice/speech`, {
      method: 'POST',
      body: { text, exaggeration },
    }),
  /** Conversion de voix : la phrase enregistrée (WAV) redite avec la voix du personnage. */
  convertSpeech: (id: string, wav: Blob) => {
    const form = new FormData()
    form.append('file', wav, 'enregistrement.wav')
    return apiFetch<{ assetId: string; url: string; seconds: number }>(`/personas/${id}/voice/convert`, { method: 'POST', body: form })
  },
  /** Essai de la voix : un WAV à écouter tout de suite (rien n'est enregistré). */
  previewVoice: async (id: string, body: { text: string; exaggeration?: number; candidate?: boolean }): Promise<Blob> => {
    const res = await fetch(`/api/personas/${id}/voice/preview`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      throw new ApiError(data?.error ?? `Erreur ${res.status}`, res.status, data)
    }
    return res.blob()
  },
}

export const civitaiApi = {
  status: () => apiFetch<{ enabled: boolean }>('/civitai/status'),
  search: (q: { family?: string; query?: string; sort: CivitaiSort; nsfw: boolean; cursor?: string }) =>
    apiFetch<CivitaiSearchResponse>('/civitai/search', { query: q }),
  wildcards: (q: { query?: string; cursor?: string }) =>
    apiFetch<CivitaiWildcardSearchResponse>('/civitai/wildcards', { query: q }),
  wildcardLists: (versionId: number) => apiFetch<CivitaiWildcardListsResponse>(`/civitai/wildcards/${versionId}`),
}

export const listsApi = {
  rewriteQuote: (items: string[]) =>
    apiFetch<ListRewriteQuoteResponse>('/lists/rewrite/quote', { method: 'POST', body: { items } }),
  rewrite: (items: string[]) => apiFetch<ListRewriteResponse>('/lists/rewrite', { method: 'POST', body: { items } }),
}

export const libraryApi = {
  status: () => apiFetch<LibraryStatus>('/library/status'),
  search: (source: LibrarySource, q: { query?: string; page: number }) =>
    apiFetch<LibrarySearchResponse>(`/library/${source}/search`, { query: q }),
  import: (source: LibrarySource, photoId: string, personaId?: string | null) =>
    apiFetch<{ asset: Asset }>(`/library/${source}/import`, { method: 'POST', body: { photoId, personaId: personaId ?? null } }),
}

export interface VoiceLibraryQuery {
  /** all : les deux ; default : voix proposées par ElevenLabs ; library : bibliothèque communautaire. */
  source?: 'all' | 'default' | 'library'
  search?: string
  gender?: string
  age?: string
  accent?: string
  language?: string
  useCase?: string
  page?: number
}

export const voicesApi = {
  /** Catalogue de voix ElevenLabs (avec extraits à écouter). */
  library: (query: VoiceLibraryQuery) =>
    apiFetch<VoiceLibraryResponse>('/voices/library', {
      query: Object.fromEntries(
        Object.entries(query).filter(([, v]) => v !== undefined && v !== ''),
      ) as Record<string, string>,
    }),
}

export const trashApi = {
  list: () => apiFetch<TrashResponse>('/trash'),
  restorePersona: (id: string) => apiFetch<{ ok: true }>(`/trash/personas/${id}/restore`, { method: 'POST' }),
  restoreThread: (id: string) => apiFetch<{ ok: true }>(`/trash/threads/${id}/restore`, { method: 'POST' }),
  purgePersona: (id: string) => apiFetch<unknown>(`/trash/personas/${id}`, { method: 'DELETE' }),
  purgeThread: (id: string) => apiFetch<unknown>(`/trash/threads/${id}`, { method: 'DELETE' }),
  restoreWorkflow: (id: string) => apiFetch<{ ok: true }>(`/trash/workflows/${id}/restore`, { method: 'POST' }),
  purgeWorkflow: (id: string) => apiFetch<unknown>(`/trash/workflows/${id}`, { method: 'DELETE' }),
  empty: () => apiFetch<unknown>('/trash', { method: 'DELETE' }),
}

/** Images master d'un persona (`character`) ou d'un lieu (`place`). */
const mastersBase = (kind: CreatorKind, id: string) => `/${kind === 'place' ? 'places' : 'personas'}/${id}`
export const mastersApi = {
  list: (kind: CreatorKind, id: string) => apiFetch<MastersResponse>(`${mastersBase(kind, id)}/masters`),
  set: (kind: CreatorKind, id: string, assetId: string, isMaster: boolean) =>
    apiFetch<{ asset: Asset }>(`${mastersBase(kind, id)}/masters/${assetId}`, { method: 'PATCH', body: { isMaster } }),
  generate: (kind: CreatorKind, id: string, body: VariationRequest) =>
    apiFetch<{ threadId: string }>(`${mastersBase(kind, id)}/variations`, { method: 'POST', body }),
  /** Planche de références : retient une image pour une pose (null : la retire). */
  setPose: (personaId: string, pose: ReferencePose, assetId: string | null) =>
    apiFetch<{ persona: Persona }>(`/personas/${personaId}/reference-poses`, { method: 'PUT', body: { pose, assetId } }),
}

export const scenesApi = {
  list: () => apiFetch<{ scenes: Scene[] }>('/scenes'),
  create: (body: Omit<Scene, 'id' | 'createdAt'>) => apiFetch<{ scene: Scene }>('/scenes', { method: 'POST', body }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/scenes/${id}`, { method: 'DELETE' }),
}

export const placesApi = {
  list: () => apiFetch<{ places: Place[] }>('/places'),
  update: (id: string, body: Partial<Pick<Place, 'name' | 'defaultImageFamily' | 'personaIds'>>) =>
    apiFetch<{ place: Place }>(`/places/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/places/${id}`, { method: 'DELETE' }),
}

export const threadsApi = {
  list: (personaId?: string | null) => apiFetch<{ threads: Thread[] }>('/threads', { query: { personaId } }),
  get: (id: string) => apiFetch<ThreadDetailResponse>(`/threads/${id}`),
  update: (id: string, body: { title?: string; isPinned?: boolean; personaId?: string | null }) =>
    apiFetch<{ thread: Thread }>(`/threads/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/threads/${id}`, { method: 'DELETE' }),
  search: (q: string) => apiFetch<{ results: SearchResult[] }>('/threads/search', { query: { q } }),
}

export type AutofixKind = 'face' | 'hand' | 'foot'
/** Zone repérée par la correction automatique, en pixels de l'image. */
export interface AutofixPart {
  kind: AutofixKind
  x: number
  y: number
  width: number
  height: number
  conf?: number
}

export const generationsApi = {
  /** Supprime le résultat du fil (tout le lot avec `batch`) ; réversible. */
  remove: (id: string, batch: boolean) =>
    apiFetch<{ ids: string[] }>(`/generations/${id}`, { method: 'DELETE', query: { batch } }),
  restore: (id: string, batch: boolean) =>
    apiFetch<{ ids: string[] }>(`/generations/${id}/restore`, { method: 'POST', query: { batch } }),
  quote: (body: GenerationRequest) =>
    apiFetch<{ quote: QuoteResponse }>('/generations/quote', { method: 'POST', body }),
  create: (body: GenerationRequest) =>
    apiFetch<CreateGenerationResponse>('/generations', { method: 'POST', body }),
  get: (id: string) => apiFetch<{ generation: Generation }>(`/generations/${id}`),
  /** Arrête une génération locale en cours (annulée dans ComfyUI) et la retire du fil. */
  cancel: (id: string) => apiFetch<{ ok: true }>(`/generations/${id}/cancel`, { method: 'POST' }),
  upscaleQuote: (body: UpscaleRequest) =>
    apiFetch<{ quote: QuoteResponse }>('/generations/upscale/quote', { method: 'POST', body }),
  upscale: (body: UpscaleRequest) =>
    apiFetch<CreateGenerationResponse>('/generations/upscale', { method: 'POST', body }),
  /** Correction automatique (local), étape 1 : zones repérées (visages, mains, pieds), à confirmer. */
  detectParts: (assetId: string, kinds: AutofixKind[]) =>
    apiFetch<{ width: number; height: number; parts: AutofixPart[] }>('/generations/autofix/detect', { method: 'POST', body: { assetId, kinds } }),
  /** Étape 2 : les zones gardées sont refaites par klein. */
  autofix: (assetId: string, parts: AutofixPart[]) =>
    apiFetch<CreateGenerationResponse & { found: string }>('/generations/autofix', { method: 'POST', body: { assetId, parts } }),
  /** Retouche au pinceau (local) : masque PNG à la taille de l'image, blanc = zone à refaire. */
  retouch: (assetId: string, prompt: string, mask: Blob, box: { x: number; y: number; width: number; height: number }) => {
    const form = new FormData()
    form.append('assetId', assetId)
    form.append('prompt', prompt)
    form.append('box', JSON.stringify(box))
    form.append('mask', mask, 'masque.png')
    return apiFetch<CreateGenerationResponse>('/generations/retouch', { method: 'POST', body: form })
  },
}

export const presetsApi = {
  list: () => apiFetch<{ presets: PromptPreset[] }>('/presets'),
  create: (body: Pick<PromptPreset, 'label' | 'text' | 'media'> & { enabled?: boolean; personaId?: string | null }) =>
    apiFetch<{ preset: PromptPreset }>('/presets', { method: 'POST', body }),
  update: (id: string, body: Partial<Pick<PromptPreset, 'label' | 'text' | 'media' | 'enabled'>>) =>
    apiFetch<{ preset: PromptPreset }>(`/presets/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/presets/${id}`, { method: 'DELETE' }),
}

/** Aide à l'écriture, en local : dictée (Whisper) et reformulation (Ollama). */
export const assistApi = {
  status: () => apiFetch<{ status: AssistStatus }>('/assist/status'),
  transcribe: (wav: Blob, language?: string, prompt?: string) =>
    apiFetch<{ text: string }>('/assist/transcribe', { method: 'POST', body: wav, query: { language, prompt } }),
  rewrite: (body: RewritePromptRequest) =>
    apiFetch<RewritePromptResponse>('/assist/rewrite', { method: 'POST', body }),
}

/** Dictée : jeton temporaire du fournisseur choisi (`fake` en test : dictée simulée). */
export const dictationApi = {
  token: () => apiFetch<DictationTokenResponse>('/dictation/token', { method: 'POST' }),
}

export const promptsApi = {
  enhance: (body: EnhancePromptRequest) =>
    apiFetch<EnhancePromptResponse>('/prompts/enhance', { method: 'POST', body }),
}

export const workflowsApi = {
  list: () => apiFetch<{ workflows: WorkflowSummary[] }>('/workflows'),
  create: (body: { name?: string } = {}) => apiFetch<{ workflow: Workflow }>('/workflows', { method: 'POST', body }),
  get: (id: string) => apiFetch<{ workflow: Workflow }>(`/workflows/${id}`),
  update: (id: string, body: UpdateWorkflowRequest) =>
    apiFetch<{ workflow: Workflow }>(`/workflows/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/workflows/${id}`, { method: 'DELETE' }),
  /** `template` : devis du formulaire d'un fil avant saisie (valeurs types, prix fixe). */
  quote: (id: string, body: Pick<WorkflowRunRequest, 'graph' | 'nodeIds' | 'inputs'> & { template?: boolean }) =>
    apiFetch<WorkflowQuoteResponse>(`/workflows/${id}/quote`, { method: 'POST', body }),
  run: (id: string, body: WorkflowRunRequest) =>
    apiFetch<WorkflowRunStartResponse>(`/workflows/${id}/runs`, { method: 'POST', body }),
  state: (id: string) => apiFetch<WorkflowStateResponse>(`/workflows/${id}/state`),
  stop: (id: string) => apiFetch<WorkflowStateResponse>(`/workflows/${id}/stop`, { method: 'POST' }),
  /** Résultat d'une exécution lancée depuis un fil : le supprimer du fil, ou le remettre. */
  removeRunResult: (runId: string) => apiFetch<{ ok: true }>(`/workflows/runs/${runId}/result`, { method: 'DELETE' }),
  restoreRunResult: (runId: string) => apiFetch<{ ok: true }>(`/workflows/runs/${runId}/result/restore`, { method: 'POST' }),
}
