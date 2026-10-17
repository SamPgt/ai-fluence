/**
 * Planche de références d'un personnage : une image de face, de trois-quarts et de profil, générées à partir de son
 * image de référence par un modèle à références (klein, Qwen Edit), puis choisies une par une. Les trois sont jointes
 * d'office aux demandes faites avec un modèle à références : il suit le visage sous tous les angles.
 * Relancer une pose ajoute des propositions sans toucher à l'image retenue.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, Loader2, Maximize2, Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  poseOfVariant,
  REFERENCE_POSES,
  type Asset,
  type CatalogFamily,
  type Generation,
  type Persona,
  type ReferencePose,
} from '@sublime/shared'

import { assetsApi, mastersApi } from '@/lib/api'
import { qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { isPending } from '@/components/characters/Lots'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/** Modèles conseillés pour tourner la tête en gardant le visage, du meilleur au moins bon. */
const PREFERRED = ['local/flux2-klein-9b', 'local/qwen-image-edit-2511', 'local/flux2-klein-4b']

export function ReferenceSheet({
  persona,
  generations,
  families,
  autoStart,
  onAutoStarted,
  onLaunched,
  onView,
}: {
  persona: Persona
  /** Générations du fil des images master (les variantes « Angles » alimentent la planche). */
  generations: Generation[]
  families: CatalogFamily[]
  /** Lancer la planche complète à l'arrivée (juste après la création du personnage). */
  autoStart: boolean
  onAutoStarted: () => void
  onLaunched: (threadId: string) => void
  onView: (asset: Asset) => void
}) {
  const queryClient = useQueryClient()
  const refFamilies = families.filter((f) => f.badges.includes('REF') && f.tasks['image-to-image'])
  const [familyId, setFamilyId] = useState<string | null>(null)
  const family =
    refFamilies.find((f) => f.id === familyId) ??
    PREFERRED.map((id) => refFamilies.find((f) => f.id === id)).find(Boolean) ??
    refFamilies[0]
  const poses = persona.referencePoses
  const chosenCount = REFERENCE_POSES.filter((p) => poses[p.id]).length
  const [open, setOpen] = useState(chosenCount < REFERENCE_POSES.length)

  // L'image retenue peut venir d'ailleurs que des propositions (une ancienne référence) : on la lit dans les références.
  const { data: refs = [] } = useQuery({
    queryKey: qk.references(persona.id),
    queryFn: () => assetsApi.references(persona.id).then((r) => r.assets),
  })

  const candidatesOf = (pose: ReferencePose) =>
    generations.filter((g) => g.variation?.axis === 'angles' && poseOfVariant(g.variation.variantId) === pose).reverse()

  const launch = useMutation({
    mutationFn: (variants: string[]) => {
      const aspect = family?.tasks['text-to-image']?.schema.properties?.aspect_ratio?.enum?.includes('4:5')
      return mastersApi.generate('character', persona.id, {
        axis: 'angles',
        count: variants.length,
        variants,
        family: family!.id,
        face: false,
        reference: true,
        params: aspect ? { aspect_ratio: '4:5' } : {},
      })
    },
    onSuccess: ({ threadId }) => onLaunched(threadId),
    onError: (e) => toast.error((e as Error).message),
  })
  const choose = useMutation({
    mutationFn: ({ pose, assetId }: { pose: ReferencePose; assetId: string | null }) => mastersApi.setPose(persona.id, pose, assetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.personas })
      queryClient.invalidateQueries({ queryKey: qk.masters(persona.id) })
      queryClient.invalidateQueries({ queryKey: qk.references(persona.id) })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const canLaunch = Boolean(family && persona.avatarAssetId) && !launch.isPending
  const allVariants = REFERENCE_POSES.flatMap((p) => p.variants)

  // Juste après la création : la planche part toute seule (une fois).
  const autoDone = useRef(false)
  useEffect(() => {
    if (!autoStart || autoDone.current || !family || !persona.avatarAssetId) return
    autoDone.current = true
    onAutoStarted()
    launch.mutate(allVariants)
  }, [autoStart, family?.id, persona.avatarAssetId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="shrink-0 rounded-xl border border-border/40 bg-card">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-sm font-semibold">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Planche de références
          <span className="text-xs font-normal text-muted-foreground tabular-nums">{chosenCount} / 3</span>
        </button>
        {!open && (
          <div className="flex gap-1.5">
            {REFERENCE_POSES.map((p) => {
              const asset = refs.find((a) => a.id === poses[p.id])
              return asset ? (
                <img key={p.id} src={asset.url} alt={p.label} title={p.label} className="h-9 w-7 rounded object-cover" />
              ) : (
                <span key={p.id} className="h-9 w-7 rounded border border-dashed border-border" title={`${p.label} : à choisir`} />
              )
            })}
          </div>
        )}
        <span className="mr-auto hidden text-[11px] text-muted-foreground lg:inline">
          Une image par pose : jointes d'office aux demandes avec un modèle à références.
        </span>
        {open && (
          <>
            {refFamilies.length ? (
              <Select value={family?.id} onValueChange={setFamilyId}>
                <SelectTrigger size="sm" className="h-8 w-48 rounded-full text-xs">
                  <SelectValue placeholder="Modèle" />
                </SelectTrigger>
                <SelectContent>
                  {refFamilies.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-xs text-muted-foreground">Aucun modèle à références disponible (klein, Qwen Edit).</span>
            )}
            <Button size="sm" className="h-8 gap-1.5 rounded-full" disabled={!canLaunch} onClick={() => launch.mutate(allVariants)}>
              {launch.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Générer la planche ({allVariants.length})
            </Button>
          </>
        )}
      </div>

      {open && (
        <div className="grid gap-3 border-t border-border/40 p-3 md:grid-cols-3">
          {REFERENCE_POSES.map((p) => {
            const candidates = candidatesOf(p.id)
            const chosenId = poses[p.id]
            const chosenOutside = chosenId && !candidates.some((g) => g.outputs[0]?.id === chosenId) ? refs.find((a) => a.id === chosenId) : null
            return (
              <div key={p.id} className="min-w-0 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold">{p.label}</span>
                  {chosenId ? (
                    <span className="flex items-center gap-1 text-emerald-500">
                      <Check className="h-3 w-3" /> retenue
                    </span>
                  ) : (
                    <span className="text-muted-foreground">clique sur l'image à garder</span>
                  )}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {chosenOutside && <Thumb asset={chosenOutside} chosen onView={onView} />}
                  {candidates.map((g) => {
                    const image = g.outputs[0]
                    if (isPending(g) || !image) {
                      return (
                        <div
                          key={g.id}
                          className="flex aspect-[4/5] h-36 shrink-0 items-center justify-center rounded-lg border border-dashed border-border/60 text-[10px] text-muted-foreground"
                        >
                          {isPending(g) ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : (g.errorMessage ?? 'Échec')}
                        </div>
                      )
                    }
                    const chosen = image.id === chosenId
                    return (
                      <Thumb
                        key={g.id}
                        asset={image}
                        chosen={chosen}
                        onView={onView}
                        onPick={() => choose.mutate({ pose: p.id, assetId: chosen ? null : image.id })}
                      />
                    )
                  })}
                  <button
                    disabled={!canLaunch}
                    onClick={() => launch.mutate(p.variants)}
                    className="flex aspect-[4/5] h-36 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border/60 text-[11px] text-muted-foreground transition-colors hover:border-brand/60 hover:text-foreground disabled:opacity-50"
                    title={`Deux nouvelles propositions de ${p.label.toLowerCase()} (l'image retenue reste)`}
                  >
                    <Plus className="h-4 w-4" />
                    {candidates.length ? 'Relancer' : 'Générer'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Thumb({ asset, chosen, onPick, onView }: { asset: Asset; chosen: boolean; onPick?: () => void; onView: (asset: Asset) => void }) {
  return (
    <div className="group relative shrink-0">
      <button
        onClick={onPick}
        disabled={!onPick}
        title={chosen ? 'Image retenue (clic : la retirer)' : 'Garder cette image pour la pose'}
        className={cn(
          'block aspect-[4/5] h-36 overflow-hidden rounded-lg border',
          chosen ? 'border-emerald-500 ring-2 ring-emerald-500' : 'border-border/40 hover:border-brand/60',
        )}
      >
        <img src={asset.url} alt="" className="h-full w-full object-cover" />
      </button>
      {chosen && (
        <span className="absolute top-1 left-1 rounded-full bg-emerald-500 p-0.5 text-white">
          <Check className="h-3 w-3" />
        </span>
      )}
      <button
        onClick={() => onView(asset)}
        className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
        title="Agrandir"
      >
        <Maximize2 className="h-3 w-3" />
      </button>
    </div>
  )
}
