import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { personasQuery } from '@/lib/queries'
import { useUiPref } from '@/components/providers/ui-prefs'
import { PageHeader } from '@/components/layout/PageHeader'
import { LogoMark } from '@/components/ui/logo-mark'
import { PersonaAvatar } from '@/components/personas/PersonaAvatar'
import { Composer } from '@/components/composer/Composer'

export const Route = createFileRoute('/_app/')({
  component: NewThread,
})

function NewThread() {
  const [personaId] = useUiPref('personaId')
  const { data: personas = [] } = useQuery(personasQuery())
  const persona = personas.find((p) => p.id === personaId) ?? null

  return (
    <>
      <PageHeader>
        <span className="text-sm font-medium">Nouveau fil</span>
        {persona && (
          <span className="text-sm text-muted-foreground">
            · {persona.name}
          </span>
        )}
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        {persona ? (
          <PersonaAvatar
            persona={persona}
            size={64}
            className="mb-4 rounded-2xl"
          />
        ) : (
          <LogoMark className="mb-4 h-14 w-14 select-none" />
        )}
        <h1 className="text-2xl font-semibold">
          {persona ? persona.name : 'Que veux-tu créer ?'}
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {persona
            ? 'Que veux-tu créer aujourd’hui ?'
            : 'Photo ou vidéo : choisis un modèle, ajoute des références si besoin, et décris la scène.'}
        </p>
      </div>
      <Composer personaId={persona?.id ?? null} />
    </>
  )
}
