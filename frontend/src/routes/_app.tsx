import { useEffect } from 'react'
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'

import { sessionQueryOptions } from '@/server/auth'
import type { User } from '@sublime/shared'
import { uiPrefsQueryOptions } from '@/server/ui-prefs'
import { settingsQuery } from '@/lib/queries'
import { isMac, isTypingTarget } from '@/lib/platform'
import { UiPrefsProvider, useUiPref } from '@/components/providers/ui-prefs'
import { AppSidebar } from '@/components/layout/AppSidebar'

/**
 * Layout des routes authentifiées : sidebar unique (repliable, état en cookie) + contenu.
 * Dans l'éditeur de workflow, la palette des nœuds prend la place de la sidebar.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(
      sessionQueryOptions(),
    )
    if (!user) throw redirect({ to: '/connexion' })
    const uiPrefs = await context.queryClient.ensureQueryData(
      uiPrefsQueryOptions(),
    )
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
  const { data } = useQuery({
    ...sessionQueryOptions(),
    initialData: initialUser,
  })
  const user = data ?? initialUser
  const [collapsed, setCollapsed] = useUiPref('sidebarCollapsed')
  const { data: settings } = useQuery(settingsQuery())
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()

  // Largeur de la colonne de gauche, pour centrer les modales sur le reste de l'écran
  // (cf. ui/dialog) : sidebar 288 px ou 48 px repliée ; palette de l'éditeur 288 px ou rien.
  const editor = isWorkflowEditor(pathname)
  const sidebarWidth = collapsed ? (editor ? 0 : 48) : 288
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-w',
      `${sidebarWidth}px`,
    )
  }, [sidebarWidth])

  // ⌘B / Ctrl+B : replier le panneau des fils.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'b' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCollapsed(!collapsed)
      }
      // Nouveau fil : ⌘L sur Mac (prend le pas sur la barre d'adresse),
      // Maj+L ailleurs, sauf pendant la saisie (sinon taper un « L » majuscule ouvrirait un fil).
      const newThread = isMac()
        ? e.metaKey && !e.shiftKey && !e.altKey && e.code === 'KeyL'
        : e.shiftKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.metaKey &&
          e.code === 'KeyL' &&
          !isTypingTarget(e.target)
      if (newThread) {
        e.preventDefault()
        navigate({ to: '/nouveau' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [collapsed, setCollapsed, navigate])

  return (
    <div className="flex h-full w-full overflow-hidden">
      {!isWorkflowEditor(pathname) && <AppSidebar user={user} />}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {settings &&
          !settings.hasApiKey &&
          !pathname.startsWith('/parametres') && (
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

/** Éditeur d'un workflow (pas la liste) : sa palette remplace la sidebar. */
const isWorkflowEditor = (pathname: string) =>
  /^\/workflows\/[^/]+/.test(pathname)
