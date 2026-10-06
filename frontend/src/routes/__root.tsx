import { HeadContent, Scripts, createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { Toaster } from 'sonner'

import appCss from '../styles.css?url'
import { TooltipProvider } from '@/components/ui/tooltip'

import type { QueryClient as QueryClientType } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClientType
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'AI Fluence' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Geist:wght@300..700&display=swap' },
    ],
  }),
  component: RootDocument,
})

function RootDocument() {
  // Dark mode uniquement.
  return (
    <html lang="fr" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background antialiased font-sans">
        <TooltipProvider delayDuration={300}>
          <div className="flex h-screen flex-col">
            <Outlet />
          </div>
        </TooltipProvider>
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
        <Scripts />
      </body>
    </html>
  )
}
