import { createFileRoute } from '@tanstack/react-router'

import { PageHeader } from '@/components/layout/PageHeader'
import { LogoMark } from '@/components/ui/logo-mark'
import { Composer } from '@/components/composer/Composer'

export const Route = createFileRoute('/_app/')({
  // `workflow` : ouvre le formulaire de ce workflow au-dessus du composer (▶ depuis l'Accueil).
  validateSearch: (search: Record<string, unknown>): { workflow?: string } =>
    typeof search.workflow === 'string' && search.workflow ? { workflow: search.workflow } : {},
  component: NewThread,
})

/** Nouveau fil : il n'appartient à aucun persona, on y joint les références voulues. */
function NewThread() {
  const { workflow } = Route.useSearch()
  return (
    <>
      <PageHeader>
        <span className="text-sm font-medium">Nouveau fil</span>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <LogoMark className="mb-4 h-14 w-14 select-none" />
        <h1 className="text-2xl font-semibold">Que veux-tu créer ?</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Photo ou vidéo : choisis un modèle, ajoute des références si besoin, et décris la scène.
        </p>
      </div>
      <Composer initialWorkflowId={workflow} />
    </>
  )
}
