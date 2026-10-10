/**
 * Outils de scène du composer : lieu récurrent (sa fiche entre dans le prompt, une de ses images peut servir de départ),
 * visage du personnage en un clic (ReActor) et scènes enregistrées.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Loader2, MapPin, ScanFace, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Persona, Place } from '@ai-fluence/shared'

import { assetsApi, mastersApi, scenesApi } from '@/lib/api'
import { composer, composerStore } from '@/lib/composer-store'
import { placesQuery, qk, scenesQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const toolButton =
  'flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-3 text-xs font-medium transition-colors hover:bg-accent'

/** Bouton « Lieu » : choisir un lieu, ceux du personnage en premier. */
export function PlaceButton({ persona, placeId }: { persona: Persona | null; placeId: string | null }) {
  const { data: places = [] } = useQuery(placesQuery())
  const [open, setOpen] = useState(false)
  if (!places.length) return null
  const mine = persona ? places.filter((p) => p.personaIds.includes(persona.id)) : []
  const others = places.filter((p) => !mine.includes(p))
  const row = (p: Place) => (
    <button
      key={p.id}
      onClick={() => {
        composer.setPlace(p.id === placeId ? null : p.id)
        setOpen(false)
      }}
      className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent', p.id === placeId && 'bg-accent')}
    >
      {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="h-7 w-10 rounded object-cover" /> : <MapPin className="h-4 w-4" />}
      <span className="min-w-0 flex-1 truncate">{p.name}</span>
    </button>
  )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={toolButton} title="Lieu récurrent : sa fiche entre dans le prompt">
          <MapPin className="h-3.5 w-3.5" /> Lieu
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-1.5">
        {mine.length > 0 && <p className="px-2 pt-1 pb-1 text-[11px] text-muted-foreground">Lieux de {persona!.name}</p>}
        {mine.map(row)}
        {others.length > 0 && (
          <p className="px-2 pt-2 pb-1 text-[11px] text-muted-foreground">{mine.length ? 'Autres lieux' : 'Lieux'}</p>
        )}
        {others.map(row)}
      </PopoverContent>
    </Popover>
  )
}

/** Bulle du lieu choisi : retirer, ou prendre une de ses images master comme image de départ. */
export function PlaceBubble({ placeId }: { placeId: string }) {
  const { data: places = [] } = useQuery(placesQuery())
  const place = places.find((p) => p.id === placeId)
  const { data: masters } = useQuery({
    queryKey: qk.masters(placeId),
    queryFn: () => mastersApi.list('place', placeId),
    enabled: Boolean(place),
  })
  if (!place) return null
  return (
    <span className="flex h-7 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/[0.06] pr-1 pl-0.5 text-xs" title="Lieu : sa fiche entre dans le prompt">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="flex items-center gap-1.5">
            {place.avatarUrl ? <img src={place.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" /> : <MapPin className="ml-1 h-3.5 w-3.5" />}
            <span className="max-w-40 truncate">{place.name}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-80 space-y-2">
          <p className="text-xs text-muted-foreground">
            Sa fiche ({place.identity.map((t) => t.label ?? t.fragment).join(', ') || 'vide'}) entre dans le prompt. Pour un lieu plus
            fidèle, pars d'une de ses images (image → image) :
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {(masters?.masters ?? []).map((m) => (
              <button
                key={m.asset.id}
                onClick={() => composer.addAttachments([m.asset])}
                className="overflow-hidden rounded-md border border-border/40 hover:border-brand"
                title="Utiliser comme image de départ"
              >
                <img src={m.asset.url} alt="" className="aspect-[3/2] w-full object-cover" />
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <button type="button" onClick={() => composer.setPlace(null)} className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Retirer le lieu">
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

/** « Visage de … » : joint l'avatar du personnage en rôle Visage (modèles locaux avec ReActor). */
export function FaceButton({ persona, faceId }: { persona: Persona; faceId: string | null }) {
  const [loading, setLoading] = useState(false)
  if (!persona.avatarAssetId || faceId === persona.avatarAssetId) return null
  return (
    <button
      type="button"
      disabled={loading}
      className={toolButton}
      title={`Applique le visage de ${persona.name} au résultat (ReActor)`}
      onClick={async () => {
        setLoading(true)
        try {
          const { assets } = await assetsApi.references(persona.id)
          const avatar = assets.find((a) => a.id === persona.avatarAssetId)
          if (!avatar) throw new Error('Avatar introuvable dans les références du personnage.')
          composer.addAttachments([avatar])
          composer.setFace(avatar.id)
        } catch (e) {
          toast.error((e as Error).message)
        } finally {
          setLoading(false)
        }
      }}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanFace className="h-3.5 w-3.5" />} Visage de {persona.name}
    </button>
  )
}

/** Scènes enregistrées : charger, enregistrer la combinaison actuelle, supprimer. */
export function ScenesButton() {
  const queryClient = useQueryClient()
  const { data: scenes = [] } = useQuery(scenesQuery())
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const save = useMutation({
    mutationFn: () => {
      const s = composerStore.state
      return scenesApi.create({
        name: name.trim(),
        // L'identité du personnage n'appartient pas à la scène : elle reste celle du persona actif.
        traits: s.traits.filter((t) => t.zone !== 'character'),
        slots: s.slots.filter((x) => x.zone !== 'character'),
        placeId: s.placeId,
        prompt: s.prompt.trim(),
      })
    },
    onSuccess: ({ scene }) => {
      setName('')
      queryClient.invalidateQueries({ queryKey: qk.scenes })
      toast.success(`Scène « ${scene.name} » enregistrée`)
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => scenesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.scenes }),
  })
  const summary = (s: (typeof scenes)[number]) =>
    [
      ...s.traits.map((t) => t.label ?? t.fragment),
      ...s.slots.map((x) => `🎲 ${x.categoryLabel}`),
      s.prompt && `« ${s.prompt.slice(0, 40)} »`,
    ]
      .filter(Boolean)
      .join(' · ')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={toolButton} title="Scènes enregistrées : tenue, action, lieu, photo…">
          <Bookmark className="h-3.5 w-3.5" /> Scènes
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 space-y-2 p-2">
        {scenes.length === 0 && (
          <p className="px-1 text-xs text-muted-foreground">
            Aucune scène. Compose une scène (bulles de tenue, d'action, 🎲, lieu, texte), puis enregistre-la : elle servira pour
            n'importe quel personnage.
          </p>
        )}
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {scenes.map((s) => (
            <div key={s.id} className="group flex items-center gap-1 rounded-md hover:bg-accent">
              <button
                onClick={() => {
                  composer.loadScene(s)
                  setOpen(false)
                }}
                className="min-w-0 flex-1 px-2 py-1.5 text-left"
              >
                <span className="block truncate text-[13px] font-medium">{s.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{summary(s) || 'vide'}</span>
              </button>
              <button
                onClick={() => remove.mutate(s.id)}
                className="mr-1 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                title="Supprimer la scène"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <form
          className="flex gap-1.5 border-t border-border/40 pt-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) save.mutate()
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom (ex. Courses du samedi)" className="h-8 text-xs" />
          <Button type="submit" size="sm" className="h-8 shrink-0" disabled={!name.trim() || save.isPending}>
            Enregistrer
          </Button>
        </form>
        <p className="px-1 text-[10px] text-muted-foreground">
          Enregistre les bulles hors personnage (tenue, action, lieu & décor, photo), les 🎲, le lieu et le texte.
        </p>
      </PopoverContent>
    </Popover>
  )
}
