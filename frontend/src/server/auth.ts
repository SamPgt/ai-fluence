/**
 * Server function : lit la session côté serveur (SSR) en transmettant le
 * cookie de la requête au backend Hono. Utilisée par les guards `beforeLoad`.
 */
import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import type { User } from '@ai-fluence/shared'

export const SESSION_QUERY_KEY = ['session'] as const

const BACKEND_URL =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof process !== 'undefined' && (process as any)?.env?.VITE_BACKEND_URL) ||
  import.meta.env.VITE_BACKEND_URL ||
  'http://localhost:3470'

export const fetchSession = createServerFn({ method: 'GET' }).handler(async (): Promise<User | null> => {
  const request = getRequest()
  const cookie = request?.headers.get('cookie') ?? ''
  if (!cookie) return null
  const res = await fetch(`${BACKEND_URL}/auth/me`, { headers: { cookie } }).catch(() => null)
  if (!res?.ok) return null
  const data = (await res.json().catch(() => null)) as { user: User | null } | null
  return data?.user ?? null
})

/** Session en cache 5 min : la nav ne refait pas de roundtrip à chaque clic. */
export const sessionQueryOptions = () =>
  queryOptions({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => fetchSession(),
    staleTime: 5 * 60_000,
  })
