import { queryOptions } from '@tanstack/react-query'
import { catalogApi, personasApi, presetsApi, settingsApi, threadsApi } from './api'

export const qk = {
  catalog: ['catalog'] as const,
  settings: ['settings'] as const,
  balance: ['balance'] as const,
  credits: ['credits'] as const,
  personas: ['personas'] as const,
  presets: ['presets'] as const,
  threads: (personaId: string | null) => ['threads', personaId ?? 'all'] as const,
  threadsAll: ['threads'] as const,
  thread: (id: string) => ['thread', id] as const,
  references: (personaId: string) => ['references', personaId] as const,
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

export const personasQuery = () =>
  queryOptions({ queryKey: qk.personas, queryFn: () => personasApi.list().then((r) => r.personas), staleTime: 60_000 })

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
