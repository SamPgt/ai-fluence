/**
 * Server function : lit les préférences d'interface depuis le cookie de la
 * requête (SSR), pour un rendu correct dès le premier HTML (cf. lib/ui-prefs).
 */
import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'

import { readUiPrefsFromCookie, type UiPrefs } from '@/lib/ui-prefs'

export const fetchUiPrefs = createServerFn({ method: 'GET' }).handler((): UiPrefs => {
  const request = getRequest()
  return readUiPrefsFromCookie(request?.headers.get('cookie'))
})

/** Seed initial (cookie lu en SSR), ensuite le provider gère l'état. */
export const uiPrefsQueryOptions = () =>
  queryOptions({
    queryKey: ['ui-prefs'],
    queryFn: () => fetchUiPrefs(),
    staleTime: Infinity,
  })
