/**
 * Transport HTTP unique vers le backend Hono.
 * Navigateur : `/api` (proxy Vite, cookies same-site). Throw on error.
 */
import type {
  Asset,
  AuthResponse,
  CatalogResponse,
  CreateGenerationResponse,
  CreditsResponse,
  EnhancePromptRequest,
  EnhancePromptResponse,
  Generation,
  GenerationRequest,
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
  updateMe: (body: { name: string }) => apiFetch<AuthResponse>('/auth/me', { method: 'PATCH', body }),
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
}

export const presetsApi = {
  list: () => apiFetch<{ presets: PromptPreset[] }>('/presets'),
  create: (body: Omit<PromptPreset, 'id' | 'position'>) =>
    apiFetch<{ preset: PromptPreset }>('/presets', { method: 'POST', body }),
  update: (id: string, body: Partial<Omit<PromptPreset, 'id' | 'position'>>) =>
    apiFetch<{ preset: PromptPreset }>(`/presets/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/presets/${id}`, { method: 'DELETE' }),
}

export const promptsApi = {
  enhance: (body: EnhancePromptRequest) =>
    apiFetch<EnhancePromptResponse>('/prompts/enhance', { method: 'POST', body }),
}
