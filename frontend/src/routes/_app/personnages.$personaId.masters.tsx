import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Settings2 } from 'lucide-react'

import { personasQuery } from '@/lib/queries'
import { PersonaAvatar } from '@/components/personas/PersonaAvatar'
import { MastersScreen } from '@/components/characters/MastersScreen'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/_app/personnages/$personaId/masters')({
  component: PersonaMastersPage,
})

function PersonaMastersPage() {
  const { personaId } = Route.useParams()
  const { data: personas, isLoading } = useQuery(personasQuery())
  const persona = personas?.find((p) => p.id === personaId)
  if (isLoading) return null
  if (!persona) return <p className="p-10 text-center text-sm text-muted-foreground">Persona introuvable.</p>
  return (
    <MastersScreen
      key={persona.id}
      owner={{ ...persona, kind: 'character' }}
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
