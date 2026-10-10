import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'

import { placesQuery } from '@/lib/queries'
import { MastersScreen } from '@/components/characters/MastersScreen'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/_app/lieux/$placeId/masters')({
  component: PlaceMastersPage,
})

function PlaceMastersPage() {
  const { placeId } = Route.useParams()
  const { data: places, isLoading } = useQuery(placesQuery())
  const place = places?.find((p) => p.id === placeId)
  if (isLoading) return null
  if (!place) return <p className="p-10 text-center text-sm text-muted-foreground">Lieu introuvable.</p>
  return (
    <MastersScreen
      key={place.id}
      owner={{ ...place, kind: 'place' }}
      header={
        <>
          {place.avatarUrl ? (
            <img src={place.avatarUrl} alt="" className="h-6 w-9 rounded-md object-cover" />
          ) : (
            <MapPin className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-medium">Images master de {place.name}</span>
        </>
      }
      headerRight={
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" asChild>
          <Link to="/lieux">
            <MapPin className="h-3.5 w-3.5" /> Tous les lieux
          </Link>
        </Button>
      }
    />
  )
}
