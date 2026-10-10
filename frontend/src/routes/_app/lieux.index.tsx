/**
 * Lieux récurrents : la chambre de Léa, son café… Chacun a une fiche, une image de référence et des images master,
 * et se rattache à un ou plusieurs personnages (le panneau Scène les proposera).
 */
import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, MapPin, Plus, Star, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import type { Place } from '@ai-fluence/shared'

import { placesApi } from '@/lib/api'
import { personasQuery, placesQuery, qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { PersonaAvatar } from '@/components/personas/PersonaAvatar'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { InlineEdit } from '@/components/ui/inline-edit'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export const Route = createFileRoute('/_app/lieux/')({
  component: PlacesPage,
})

function PlacesPage() {
  const { data: places = [], isLoading } = useQuery(placesQuery())
  return (
    <>
      <PageHeader
        right={
          <Button size="sm" className="gap-1.5" asChild>
            <Link to="/lieux/nouveau">
              <Plus className="h-3.5 w-3.5" /> Créer un lieu
            </Link>
          </Button>
        }
      >
        <span className="flex items-center gap-2 px-1.5 text-sm font-medium">
          <MapPin className="h-4 w-4" /> Lieux
        </span>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {!isLoading && places.length === 0 ? (
          <div className="mx-auto mt-24 max-w-md space-y-3 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-secondary">
              <MapPin className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">Aucun lieu pour l'instant</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Un lieu récurrent (la chambre de gameuse de Léa, son café préféré…) se crée comme un personnage : une fiche tirée de
              la zone <b>Lieu & décor</b> de ta bibliothèque, des variantes, puis des images master pour le retrouver d'une scène à
              l'autre.
            </p>
            <Button size="sm" className="gap-1.5" asChild>
              <Link to="/lieux/nouveau">
                <Plus className="h-3.5 w-3.5" /> Créer un lieu
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
            {places.map((p) => (
              <PlaceCard key={p.id} place={p} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function PlaceCard({ place }: { place: Place }) {
  const queryClient = useQueryClient()
  const { data: personas = [] } = useQuery(personasQuery())
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.places })
  const update = useMutation({
    mutationFn: (body: Parameters<typeof placesApi.update>[1]) => placesApi.update(place.id, body),
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: () => placesApi.remove(place.id),
    onSuccess: () => {
      setConfirmDelete(false)
      refresh()
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const attached = personas.filter((p) => place.personaIds.includes(p.id))
  const togglePersona = (id: string) =>
    update.mutate({ personaIds: place.personaIds.includes(id) ? place.personaIds.filter((x) => x !== id) : [...place.personaIds, id] })

  return (
    <div className="group overflow-hidden rounded-xl border border-border/40 bg-card">
      <Link to="/lieux/$placeId/masters" params={{ placeId: place.id }} className="relative block aspect-[3/2] bg-secondary/40">
        {place.avatarUrl ? (
          <img src={place.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <MapPin className="absolute inset-0 m-auto h-6 w-6 text-muted-foreground/50" />
        )}
        <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">
          <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {place.masterCount} master(s)
        </span>
      </Link>
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          {renaming ? (
            <InlineEdit
              value={place.name}
              maxLength={40}
              onSubmit={(name) => {
                setRenaming(false)
                if (name.trim() && name !== place.name) update.mutate({ name })
              }}
              onCancel={() => setRenaming(false)}
              className="text-sm font-semibold"
            />
          ) : (
            <button onClick={() => setRenaming(true)} className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:text-brand" title="Renommer">
              {place.name}
            </button>
          )}
          <button
            onClick={() => setConfirmDelete(true)}
            className="rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
            title="Supprimer le lieu"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {place.identity.length > 0 && (
          <p className="line-clamp-2 text-[11px] text-muted-foreground" title={place.identity.map((t) => t.fragment).join(', ')}>
            {place.identity.map((t) => t.label ?? t.fragment).join(' · ')}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
                <Users className="h-3 w-3" />
                {attached.length ? (
                  <span className="flex -space-x-1.5">
                    {attached.slice(0, 4).map((p) => (
                      <PersonaAvatar key={p.id} persona={p} size={16} className="rounded-full ring-1 ring-card" />
                    ))}
                  </span>
                ) : (
                  'Rattacher à un personnage'
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-60 p-1.5">
              <p className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground">Personnages qui fréquentent ce lieu</p>
              {personas.map((p) => {
                const on = place.personaIds.includes(p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => togglePersona(p.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent"
                  >
                    <PersonaAvatar persona={p} size={20} className="rounded-md" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <Check className={cn('h-3.5 w-3.5 text-brand', !on && 'invisible')} />
                  </button>
                )
              })}
              {personas.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Aucun personnage.</p>}
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" asChild>
            <Link to="/lieux/$placeId/masters" params={{ placeId: place.id }}>
              Images master
            </Link>
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Supprimer « ${place.name} » ?`}
        description="Le lieu est retiré de l'app. Ses images restent dans ton dossier local."
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
