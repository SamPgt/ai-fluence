import { queryOptions } from '@tanstack/react-query'
import { catalogApi, comfyApi, libraryApi, personasApi, placesApi, presetsApi, scenesApi, settingsApi, threadsApi } from './api'

export const qk = {
  catalog: ['catalog'] as const,
  settings: ['settings'] as const,
  balance: ['balance'] as const,
  credits: ['credits'] as const,
  comfy: ['comfy'] as const,
  libraryCategories: ['library', 'categories'] as const,
  libraryOptions: (categoryId: string) => ['library', 'options', categoryId] as const,
  libraryThumbnails: (categoryId: string) => ['library', 'thumbnails', categoryId] as const,
  personas: ['personas'] as const,
  presets: ['presets'] as const,
  threads: (personaId: string | null) => ['threads', personaId ?? 'all'] as const,
  threadsAll: ['threads'] as const,
  thread: (id: string) => ['thread', id] as const,
  references: (personaId: string) => ['references', personaId] as const,
  masters: (id: string) => ['masters', id] as const,
  places: ['places'] as const,
  scenes: ['scenes'] as const,
  gallery: (personaId: string | null, media: string | null) => ['gallery', personaId ?? 'all', media ?? 'all'] as const,
}

export const settingsQuery = () =>
  queryOptions({ queryKey: qk.settings, queryFn: () => settingsApi.get().then((r) => r.settings), staleTime: 60_000 })

export const catalogQuery = (enabled = true) =>
  queryOptions({
    queryKey: qk.catalog,
    queryFn: () => catalogApi.get(),
    staleTime: 10 * 60_000,
    enabled,
    retry: false,
  })

export const balanceQuery = (enabled = true) =>
  queryOptions({
    queryKey: qk.balance,
    queryFn: () => settingsApi.balance().then((r) => r.balance),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled,
    retry: false,
  })

export const comfyStatusQuery = () =>
  queryOptions({
    queryKey: qk.comfy,
    queryFn: () => comfyApi.status().then((r) => r.status),
    // Rapide pendant un démarrage/arrêt, lent sinon (ComfyUI peut être lancé ou coupé hors de l'app).
    refetchInterval: (q) => {
      const s = q.state.data
      if (!s?.enabled) return false
      return s.state === 'starting' || s.state === 'stopping' ? 1500 : 15_000
    },
    retry: false,
  })

export const libraryCategoriesQuery = () =>
  queryOptions({
    queryKey: qk.libraryCategories,
    queryFn: () => libraryApi.categories().then((r) => r.categories),
    staleTime: 60_000,
  })

export const libraryOptionsQuery = (categoryId: string) =>
  queryOptions({
    queryKey: qk.libraryOptions(categoryId),
    queryFn: () => libraryApi.options(categoryId).then((r) => r.options),
    staleTime: 60_000,
  })

export const libraryThumbnailsQuery = (categoryId: string) =>
  queryOptions({
    queryKey: qk.libraryThumbnails(categoryId),
    queryFn: () => libraryApi.thumbnails(categoryId).then((r) => r.thumbnails),
    // Suivi rapproché tant que des miniatures sont en file ou en cours.
    refetchInterval: (q) => (q.state.data?.some((t) => t.status === 'queued' || t.status === 'running') ? 1500 : false),
  })

export const personasQuery = () =>
  queryOptions({ queryKey: qk.personas, queryFn: () => personasApi.list().then((r) => r.personas), staleTime: 60_000 })

export const placesQuery = () => queryOptions({ queryKey: qk.places, queryFn: () => placesApi.list().then((r) => r.places) })

export const scenesQuery = () => queryOptions({ queryKey: qk.scenes, queryFn: () => scenesApi.list().then((r) => r.scenes) })

export const presetsQuery = () =>
  queryOptions({ queryKey: qk.presets, queryFn: () => presetsApi.list().then((r) => r.presets), staleTime: 5 * 60_000 })

export const threadsQuery = (personaId: string | null) =>
  queryOptions({
    queryKey: qk.threads(personaId),
    queryFn: () => threadsApi.list(personaId).then((r) => r.threads),
    staleTime: 15_000,
  })

export const threadQuery = (id: string) =>
  queryOptions({
    queryKey: qk.thread(id),
    queryFn: () => threadsApi.get(id),
    // Tant qu'une génération tourne, on rafraîchit le fil.
    refetchInterval: (q) =>
      q.state.data?.generations.some((g) => g.status === 'queued' || g.status === 'running') ? 2500 : false,
  })
