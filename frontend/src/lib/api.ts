/**
 * Transport HTTP unique vers le backend Hono.
 * Navigateur : `/api` (proxy Vite, cookies same-site). Throw on error.
 */
import type {
  Asset,
  AuthResponse,
  CatalogResponse,
  ComfyStatus,
  CreateGenerationResponse,
  CreditsResponse,
  EnhancePromptRequest,
  EnhancePromptResponse,
  Generation,
  Gender,
  GenerationRequest,
  LibraryCategory,
  LibraryImportResult,
  LibraryOption,
  LibraryThumbnail,
  ThumbnailGender,
  LoginRequest,
  Persona,
  PersonaInput,
  PromptPreset,
  QuoteResponse,
  SearchResult,
  Settings,
  SignupRequest,
  Thread,
  ThreadDetailResponse,
  UpdateSettingsRequest,
  UpscaleRequest,
  Balance,
  User,
} from '@ai-fluence/shared'

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
  const isForm = body instanceof FormData
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
  openMediaDir: () => apiFetch<{ ok: true }>('/settings/open-media-dir', { method: 'POST' }),
  balance: () => apiFetch<{ balance: Balance | null }>('/settings/balance'),
  credits: () => apiFetch<CreditsResponse>('/settings/credits'),
}

export const comfyApi = {
  status: () => apiFetch<{ status: ComfyStatus }>('/comfy/status'),
  start: () => apiFetch<{ status: ComfyStatus }>('/comfy/start', { method: 'POST' }),
  stop: () => apiFetch<{ status: ComfyStatus }>('/comfy/stop', { method: 'POST' }),
}

type LibraryCategoryInput = Pick<LibraryCategory, 'label'> &
  Partial<Pick<LibraryCategory, 'key' | 'description' | 'zone' | 'gendered' | 'thumbnailTemplate' | 'phrase'>>
type LibraryOptionInput = Pick<LibraryOption, 'fragment'> & Partial<Pick<LibraryOption, 'label' | 'gender' | 'tags' | 'weight'>>

export const libraryApi = {
  categories: () => apiFetch<{ categories: LibraryCategory[] }>('/library/categories'),
  createCategory: (body: LibraryCategoryInput) =>
    apiFetch<{ category: LibraryCategory }>('/library/categories', { method: 'POST', body }),
  updateCategory: (id: string, body: Partial<LibraryCategoryInput>) =>
    apiFetch<{ category: LibraryCategory }>(`/library/categories/${id}`, { method: 'PATCH', body }),
  removeCategory: (id: string) => apiFetch<{ ok: true }>(`/library/categories/${id}`, { method: 'DELETE' }),
  options: (categoryId: string) => apiFetch<{ options: LibraryOption[] }>(`/library/categories/${categoryId}/options`),
  addOption: (categoryId: string, body: LibraryOptionInput) =>
    apiFetch<{ option: LibraryOption }>(`/library/categories/${categoryId}/options`, { method: 'POST', body }),
  importText: (categoryId: string, text: string, source: string, gender: Gender | null = null) =>
    apiFetch<{ result: LibraryImportResult }>(`/library/categories/${categoryId}/import`, {
      method: 'POST',
      body: { text, source, gender },
    }),
  updateOption: (id: string, body: Partial<LibraryOptionInput>) =>
    apiFetch<{ option: LibraryOption }>(`/library/options/${id}`, { method: 'PATCH', body }),
  removeOption: (id: string) => apiFetch<{ ok: true }>(`/library/options/${id}`, { method: 'DELETE' }),
  thumbnails: (categoryId: string) => apiFetch<{ thumbnails: LibraryThumbnail[] }>(`/library/categories/${categoryId}/thumbnails`),
  generateThumbnails: (categoryId: string, mode: 'missing' | 'all') =>
    apiFetch<{ queued: number }>(`/library/categories/${categoryId}/thumbnails`, { method: 'POST', body: { mode } }),
  cancelThumbnails: (categoryId: string) =>
    apiFetch<{ cancelled: number }>(`/library/categories/${categoryId}/thumbnails/cancel`, { method: 'POST' }),
  regenerateThumbnail: (optionId: string, gender?: ThumbnailGender) =>
    apiFetch<{ queued: number }>(`/library/options/${optionId}/thumbnails`, { method: 'POST', body: { gender } }),
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
  setReference: (assetId: string, personaId: string, isReference: boolean) =>
    apiFetch<{ asset: Asset }>(`/assets/${assetId}/reference`, { method: 'PATCH', body: { personaId, isReference } }),
  gallery: (query: { personaId?: string; media?: 'image' | 'video'; before?: string }) =>
    apiFetch<{
      items: { asset: Asset; generation: { id: string; threadId: string; prompt: string; family: string } | null }[]
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
}

export const threadsApi = {
  list: (personaId?: string | null) => apiFetch<{ threads: Thread[] }>('/threads', { query: { personaId } }),
  get: (id: string) => apiFetch<ThreadDetailResponse>(`/threads/${id}`),
  update: (id: string, body: { title?: string; isPinned?: boolean; personaId?: string | null }) =>
    apiFetch<{ thread: Thread }>(`/threads/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/threads/${id}`, { method: 'DELETE' }),
  search: (q: string) => apiFetch<{ results: SearchResult[] }>('/threads/search', { query: { q } }),
}

export const generationsApi = {
  quote: (body: GenerationRequest) =>
    apiFetch<{ quote: QuoteResponse }>('/generations/quote', { method: 'POST', body }),
  create: (body: GenerationRequest) =>
    apiFetch<CreateGenerationResponse>('/generations', { method: 'POST', body }),
  get: (id: string) => apiFetch<{ generation: Generation }>(`/generations/${id}`),
  remove: (id: string) => apiFetch<{ ok: true }>(`/generations/${id}`, { method: 'DELETE' }),
  upscaleQuote: (body: UpscaleRequest) =>
    apiFetch<{ quote: QuoteResponse }>('/generations/upscale/quote', { method: 'POST', body }),
  upscale: (body: UpscaleRequest) =>
    apiFetch<CreateGenerationResponse>('/generations/upscale', { method: 'POST', body }),
}

export const presetsApi = {
  list: () => apiFetch<{ presets: PromptPreset[] }>('/presets'),
  create: (body: Pick<PromptPreset, 'label' | 'text' | 'media'> & { enabled?: boolean }) =>
    apiFetch<{ preset: PromptPreset }>('/presets', { method: 'POST', body }),
  update: (id: string, body: Partial<Pick<PromptPreset, 'label' | 'text' | 'media' | 'enabled'>>) =>
    apiFetch<{ preset: PromptPreset }>(`/presets/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/presets/${id}`, { method: 'DELETE' }),
}

export const promptsApi = {
  enhance: (body: EnhancePromptRequest) =>
    apiFetch<EnhancePromptResponse>('/prompts/enhance', { method: 'POST', body }),
}
