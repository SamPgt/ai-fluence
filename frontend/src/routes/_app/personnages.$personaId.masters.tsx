import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Settings2 } from 'lucide-react'

import { personasQuery } from '@/lib/queries'
import { PersonaAvatar } from '@/components/personas/PersonaAvatar'
import { MastersScreen } from '@/components/characters/MastersScreen'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/_app/personnages/$personaId/masters')({
  // `planche` : arrivée juste après la création du personnage, la planche de références part toute seule.
  validateSearch: (search: Record<string, unknown>): { planche?: boolean } => (search.planche ? { planche: true } : {}),
  component: PersonaMastersPage,
})

function PersonaMastersPage() {
  const { personaId } = Route.useParams()
  const { planche } = Route.useSearch()
  const navigate = useNavigate()
  const { data: personas, isLoading } = useQuery(personasQuery())
  const persona = personas?.find((p) => p.id === personaId)
  if (isLoading) return null
  if (!persona) return <p className="p-10 text-center text-sm text-muted-foreground">Persona introuvable.</p>
  return (
    <MastersScreen
      key={persona.id}
      owner={{ ...persona, kind: 'character' }}
      persona={persona}
      autoSheet={Boolean(planche)}
      // Une seule fois : un rechargement de la page ne relance pas la planche.
      onAutoSheetStarted={() => navigate({ to: '.', search: {}, replace: true })}
      header={
        <>
          <PersonaAvatar persona={persona} size={24} className="rounded-md" />
          <span className="truncate text-sm font-medium">Images master de {persona.name}</span>
        </>
      }
      headerRight={
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" asChild>
          <Link to="/personas/$personaId" params={{ personaId: persona.id }}>
            <Settings2 className="h-3.5 w-3.5" /> Paramétrage
          </Link>
        </Button>
      }
    />
  )
}
