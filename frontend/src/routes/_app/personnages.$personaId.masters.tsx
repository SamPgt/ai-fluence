/**
 * Images master d'un persona : lots de variations proches de son image de référence (un axe par lot),
 * étoile sur celles qui « matchent », diversité par axe en vue d'un jeu d'entraînement de LoRA.
 */
import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageIcon, Loader2, Settings2, Sparkles, Star, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  MASTER_AXES,
  MASTER_TARGET,
  MASTER_TARGET_PER_AXIS,
  type Asset,
  type MasterAxis,
  type Persona,
  type PersonaMaster,
} from '@ai-fluence/shared'

import { generationsApi, mastersApi } from '@/lib/api'
import { catalogQuery, personasQuery, qk, threadQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { PersonaAvatar } from '@/components/personas/PersonaAvatar'
import { groupLots, isPending, LotProgress, LotTabs, VariantCard } from '@/components/characters/Lots'
import { MediaViewer } from '@/components/thread/MediaViewer'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export const Route = createFileRoute('/_app/personnages/$personaId/masters')({
  component: MastersPage,
})

const LOT_SIZES = [4, 8, 12]
const axisLabel = (axis: MasterAxis | null) => MASTER_AXES.find((a) => a.id === axis)?.label ?? 'Autres'

function MastersPage() {
  const { personaId } = Route.useParams()
  const { data: personas, isLoading } = useQuery(personasQuery())
  const persona = personas?.find((p) => p.id === personaId)
  if (isLoading) return null
  if (!persona) return <p className="p-10 text-center text-sm text-muted-foreground">Persona introuvable.</p>
  return <Masters key={persona.id} persona={persona} />
}

function Masters({ persona }: { persona: Persona }) {
  const queryClient = useQueryClient()
  const { data: catalog } = useQuery(catalogQuery())
  const { data: mastersData } = useQuery({ queryKey: qk.masters(persona.id), queryFn: () => mastersApi.list(persona.id) })
  const threadId = mastersData?.threadId ?? null
  const { data: thread } = useQuery({ ...threadQuery(threadId ?? ''), enabled: Boolean(threadId) })
  const masters = mastersData?.masters ?? []
  const masterIds = new Set(masters.map((m) => m.asset.id))

  // Modèle : celui du persona, sinon le premier modèle local.
  const families = (catalog?.families ?? []).filter((f) => f.media === 'image' && f.available && f.tasks['text-to-image'])
  const [familyId, setFamilyId] = useState<string | null>(null)
  const family =
    families.find((f) => f.id === familyId) ??
    families.find((f) => f.id === persona.defaultImageFamily) ??
    families.find((f) => f.provider === 'comfy') ??
    families[0]
  const canFace = Boolean(family?.supportsFace && persona.avatarAssetId)
  const [face, setFace] = useState(true)
  const [axis, setAxis] = useState<MasterAxis | 'mix'>('angles')
  const [lotSize, setLotSize] = useState(8)
  const [viewing, setViewing] = useState<Asset | null>(null)

  const lots = useMemo(() => groupLots(thread?.generations ?? []), [thread?.generations])
  const [lotIndex, setLotIndex] = useState<number | null>(null)
  const lot = lots[lotIndex ?? lots.length - 1] ?? []
  useEffect(() => setLotIndex(null), [lots.length])
  const pending = lot.filter(isPending)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.masters(persona.id) })
    queryClient.invalidateQueries({ queryKey: qk.references(persona.id) })
    queryClient.invalidateQueries({ queryKey: qk.personas })
  }
  const generate = useMutation({
    mutationFn: () => {
      const aspect = family?.tasks['text-to-image']?.schema.properties?.aspect_ratio?.enum?.includes('4:5')
      return mastersApi.generate(persona.id, {
        axis,
        count: lotSize,
        family: family!.id,
        face: canFace && face,
        params: aspect ? { aspect_ratio: '4:5' } : {},
      })
    },
    onSuccess: ({ threadId: id }) => {
      setLotIndex(null)
      queryClient.invalidateQueries({ queryKey: qk.masters(persona.id) })
      queryClient.invalidateQueries({ queryKey: qk.thread(id) })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const cancelLot = useMutation({
    mutationFn: () => Promise.allSettled(lot.filter(isPending).map((g) => generationsApi.remove(g.id))),
    onSuccess: () => threadId && queryClient.invalidateQueries({ queryKey: qk.thread(threadId) }),
  })
  const toggle = useMutation({
    mutationFn: ({ assetId, isMaster }: { assetId: string; isMaster: boolean }) => mastersApi.set(persona.id, assetId, isMaster),
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <>
      <PageHeader
        right={
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" asChild>
            <Link to="/personas/$personaId" params={{ personaId: persona.id }}>
              <Settings2 className="h-3.5 w-3.5" /> Paramétrage
            </Link>
          </Button>
        }
      >
        <PersonaAvatar persona={persona} size={24} className="rounded-md" />
        <span className="truncate text-sm font-medium">Images master de {persona.name}</span>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Barre de commande */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border/40 px-5 py-3">
          <div className="mr-auto flex flex-wrap items-center gap-1.5">
            {MASTER_AXES.map((a) => (
              <button
                key={a.id}
                onClick={() => setAxis(a.id)}
                title={a.hint}
                className={cn(
                  'h-8 rounded-full border px-3 text-xs transition-colors',
                  axis === a.id ? 'border-brand/50 bg-brand/10 text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground',
                )}
              >
                {a.label}
              </button>
            ))}
            <button
              onClick={() => setAxis('mix')}
              title="Une variante tirée dans tous les axes pour chaque image"
              className={cn(
                'h-8 rounded-full border px-3 text-xs transition-colors',
                axis === 'mix' ? 'border-brand/50 bg-brand/10 text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground',
              )}
            >
              Mélange
            </button>
          </div>
          <Select value={family?.id} onValueChange={setFamilyId}>
            <SelectTrigger size="sm" className="h-8 w-48 rounded-full text-xs">
              <SelectValue placeholder="Modèle" />
            </SelectTrigger>
            <SelectContent>
              {families.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label
            className={cn('flex items-center gap-2 text-xs', canFace ? 'text-muted-foreground' : 'text-muted-foreground/50')}
            title={
              !persona.avatarAssetId
                ? 'Le persona n’a pas d’image de référence'
                : !family?.supportsFace
                  ? 'Ce modèle ne sait pas appliquer un visage (local avec ReActor seulement)'
                  : 'Applique le visage de l’image de référence à chaque variation (ReActor)'
            }
          >
            <Switch checked={canFace && face} disabled={!canFace} onCheckedChange={setFace} />
            Visage de la référence
          </label>
          <div className="flex h-8 items-center rounded-full border border-border/60 bg-background/40 p-0.5 text-xs">
            {LOT_SIZES.map((n) => (
              <button
                key={n}
                onClick={() => setLotSize(n)}
                className={cn('h-full rounded-full px-2.5 tabular-nums transition-colors', lotSize === n ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {n}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 rounded-full"
            disabled={!family || generate.isPending || pending.length > 0}
            onClick={() => generate.mutate()}
          >
            {generate.isPending || pending.length > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {pending.length > 0 ? `Génération · ${lot.length - pending.length} / ${lot.length}` : `Générer ${lotSize} variations`}
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 gap-4 p-4">
          <MastersPanel persona={persona} masters={masters} onView={setViewing} onRemove={(assetId) => toggle.mutate({ assetId, isMaster: false })} />

          {/* Variations */}
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/40 bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-4 py-2.5">
              <span className="text-sm font-semibold">Variations</span>
              <LotTabs lots={lots} current={lot} onPick={setLotIndex} />
            </div>
            <LotProgress lot={lot} onCancel={() => cancelLot.mutate()} />
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {lot.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm font-semibold">Aucune variation pour l'instant</p>
                  <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                    Choisis un axe (angles, expressions…) et lance un lot : chaque image garde l'identité de {persona.name} et varie
                    sur cet axe. Marque d'une étoile celles qui lui ressemblent vraiment.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
                  {lot.map((g) => {
                    const image = g.outputs[0]
                    const starred = Boolean(image && masterIds.has(image.id))
                    return (
                      <VariantCard
                        key={g.id}
                        generation={g}
                        selected={starred}
                        queuePosition={lot.filter((x) => x.status === 'queued').indexOf(g) + 1}
                        caption={g.variation ? `${axisLabel(g.variation.axis)} · ${g.variation.label}` : ''}
                        onSelect={() => image && setViewing(image)}
                        corner={
                          image && (
                            <button
                              onClick={() => toggle.mutate({ assetId: image.id, isMaster: !starred })}
                              className={cn(
                                'rounded-full bg-black/60 p-1.5 transition-colors',
                                starred ? 'text-amber-400' : 'text-white/80 hover:text-amber-300',
                              )}
                              title={starred ? 'Retirer des images master' : 'Garder comme image master'}
                            >
                              <Star className={cn('h-3.5 w-3.5', starred && 'fill-current')} />
                            </button>
                          )
                        }
                      />
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      <MediaViewer
        asset={viewing}
        onClose={() => setViewing(null)}
        // Les images du lot affiché, puis les masters (le panneau de gauche).
        assets={[...lot.flatMap((g) => g.outputs), ...masters.map((m) => m.asset)].filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i)}
        onNavigate={setViewing}
      />
    </>
  )
}

/** Images master retenues : total vers le repère d'une LoRA et diversité par axe. */
function MastersPanel({
  persona,
  masters,
  onView,
  onRemove,
}: {
  persona: Persona
  masters: PersonaMaster[]
  onView: (asset: Asset) => void
  onRemove: (assetId: string) => void
}) {
  const others = masters.filter((m) => !m.axis).length
  return (
    <section className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded-xl border border-border/40 bg-card">
      <div className="space-y-3 border-b border-border/40 px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold">Images master</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            <span className="font-semibold text-foreground">{masters.length}</span> / {MASTER_TARGET} recommandées
          </span>
        </div>
        <span className="block h-1.5 overflow-hidden rounded-full bg-secondary">
          <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (masters.length / MASTER_TARGET) * 100)}%` }} />
        </span>
        <div className="space-y-1.5">
          {MASTER_AXES.map((a) => {
            const n = masters.filter((m) => m.axis === a.id).length
            return (
              <div key={a.id} className="flex items-center gap-2 text-[11px]">
                <span className="w-20 text-muted-foreground">{a.label}</span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                  <span
                    className={cn('block h-full rounded-full', n >= MASTER_TARGET_PER_AXIS ? 'bg-emerald-500' : 'bg-brand/70')}
                    style={{ width: `${Math.min(100, (n / MASTER_TARGET_PER_AXIS) * 100)}%` }}
                  />
                </span>
                <span className="w-8 text-right text-muted-foreground tabular-nums">
                  {n} / {MASTER_TARGET_PER_AXIS}
                </span>
              </div>
            )
          })}
          {others > 0 && <p className="text-[11px] text-muted-foreground">+ {others} hors axe (image de référence…)</p>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {masters.length === 0 ? (
          <p className="p-1 text-xs leading-relaxed text-muted-foreground">
            Aucune image master. {persona.avatarAssetId ? 'Lance des variations et garde les meilleures d’une étoile.' : 'Ajoute d’abord une image de référence (avatar) au persona.'}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {masters.map((m) => (
              <div key={m.asset.id} className="group relative">
                <button onClick={() => onView(m.asset)} className="block w-full overflow-hidden rounded-lg border border-border/40">
                  <img src={m.asset.url} alt="" className="aspect-[4/5] w-full object-cover" />
                </button>
                <button
                  onClick={() => onRemove(m.asset.id)}
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
                  title="Retirer des images master"
                >
                  <X className="h-3 w-3" />
                </button>
                <p className="truncate pt-0.5 text-[10px] text-muted-foreground">{m.asset.id === persona.avatarAssetId ? 'Référence (visage)' : (m.variantLabel ?? axisLabel(m.axis))}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="border-t border-border/40 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        Les masters rejoignent les références de {persona.name}. Elles serviront plus tard de jeu d'entraînement à sa LoRA.
      </p>
    </section>
  )
}
