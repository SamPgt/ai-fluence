import { useEffect } from 'react'
import { createFileRoute, Link, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'

import { sessionQueryOptions } from '@/server/auth'
import type { User } from '@ai-fluence/shared'
import { uiPrefsQueryOptions } from '@/server/ui-prefs'
import { settingsQuery } from '@/lib/queries'
import { UiPrefsProvider, useUiPref } from '@/components/providers/ui-prefs'
import { PersonaRail } from '@/components/layout/PersonaRail'
import { ThreadPanel } from '@/components/layout/ThreadPanel'

/**
 * Layout des routes authentifiées : barre de bulles personas + panneau des
 * fils (repliable, état en cookie) + contenu.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions())
    if (!user) throw redirect({ to: '/connexion' })
    const uiPrefs = await context.queryClient.ensureQueryData(uiPrefsQueryOptions())
    return { user, uiPrefs }
  },
  component: AppLayout,
})

function AppLayout() {
  const { user, uiPrefs } = Route.useRouteContext()
  return (
    <UiPrefsProvider initial={uiPrefs}>
      <AppShell user={user} />
    </UiPrefsProvider>
  )
}

function AppShell({ user: initialUser }: { user: User }) {
  // La session en cache se met à jour après un changement de nom ou de photo.
  const { data } = useQuery({ ...sessionQueryOptions(), initialData: initialUser })
  const user = data ?? initialUser
  const [collapsed, setCollapsed] = useUiPref('sidebarCollapsed')
  const { data: settings } = useQuery(settingsQuery())
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // ⌘B / Ctrl+B : replier le panneau des fils.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'b' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCollapsed(!collapsed)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [collapsed, setCollapsed])

  return (
    <div className="flex h-full w-full overflow-hidden">
      <PersonaRail user={user} />
      <ThreadPanel collapsed={collapsed} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {settings && !settings.hasApiKey && !pathname.startsWith('/parametres') && (
          <Link
            to="/parametres"
            search={{ tab: 'api-key' }}
            className="flex items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-200 hover:bg-amber-500/15"
          >
            <KeyRound className="h-4 w-4" />
            Ajoute ta clé API SpicyAPI pour commencer à générer →
          </Link>
        )}
        <Outlet />
      </main>
    </div>
  )
}
