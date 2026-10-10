/**
 * Images master d'un personnage ou d'un lieu : lots de variations proches de son image de référence (un axe par lot),
 * étoile sur celles qui « matchent », diversité par axe. Personnage : visage de la référence (ReActor) ;
 * lieu : image → image depuis la référence, pour garder la même pièce.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageIcon, Loader2, Sparkles, Star, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  axesFor,
  masterAxis,
  MASTER_TARGETS,
  type Asset,
  type CreatorKind,
  type MasterAxis,
  type PersonaMaster,
} from '@ai-fluence/shared'

import { generationsApi, mastersApi } from '@/lib/api'
import { catalogQuery, qk, threadQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { groupLots, isPending, LotProgress, LotTabs, VariantCard } from '@/components/characters/Lots'
import { MediaViewer } from '@/components/thread/MediaViewer'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

/** Ce dont la page a besoin, qu'il s'agisse d'un persona ou d'un lieu. */
export interface MastersOwner {
  kind: CreatorKind
  id: string
  name: string
  avatarAssetId: string | null
  defaultImageFamily: string | null
}

const LOT_SIZES = [4, 8, 12]
const axisLabel = (axis: MasterAxis | null) => (axis ? masterAxis(axis).label : 'Autres')

export function MastersScreen({ owner, header, headerRight }: { owner: MastersOwner; header: ReactNode; headerRight?: ReactNode }) {
  const queryClient = useQueryClient()
  const { kind } = owner
  const axes = axesFor(kind)
  const { data: catalog } = useQuery(catalogQuery())
  const { data: mastersData } = useQuery({ queryKey: qk.masters(owner.id), queryFn: () => mastersApi.list(kind, owner.id) })
  const threadId = mastersData?.threadId ?? null
  const { data: thread } = useQuery({ ...threadQuery(threadId ?? ''), enabled: Boolean(threadId) })
  const masters = mastersData?.masters ?? []
  const masterIds = new Set(masters.map((m) => m.asset.id))

  // Modèle : celui du persona ou du lieu, sinon le premier modèle local.
  const families = (catalog?.families ?? []).filter((f) => f.media === 'image' && f.available && f.tasks['text-to-image'])
  const [familyId, setFamilyId] = useState<string | null>(null)
  const family =
    families.find((f) => f.id === familyId) ??
    families.find((f) => f.id === owner.defaultImageFamily) ??
    families.find((f) => f.provider === 'comfy') ??
    families[0]
  // Personnage : visage de la référence (ReActor). Lieu : image → image depuis la référence.
  const canFace = kind === 'character' && Boolean(family?.supportsFace && owner.avatarAssetId)
  const canStart = kind === 'place' && Boolean(family?.tasks['image-to-image'] && owner.avatarAssetId)
  const [useReference, setUseReference] = useState(true)
  const [axis, setAxisState] = useState<MasterAxis | 'mix'>(axes[0].id)
  // Force conseillée par axe (lieu) ; modifiable ensuite.
  const strengthFor = (a: MasterAxis | 'mix') => (a === 'mix' ? 0.75 : (axes.find((x) => x.id === a)?.strength ?? 0.7))
  const [strength, setStrength] = useState(() => strengthFor(axes[0].id))
  const setAxis = (a: MasterAxis | 'mix') => {
    setAxisState(a)
    setStrength(strengthFor(a))
  }
  const [lotSize, setLotSize] = useState(8)
  const [viewing, setViewing] = useState<Asset | null>(null)

  const lots = useMemo(() => groupLots(thread?.generations ?? []), [thread?.generations])
  const [lotIndex, setLotIndex] = useState<number | null>(null)
  const lot = lots[lotIndex ?? lots.length - 1] ?? []
  useEffect(() => setLotIndex(null), [lots.length])
  const pending = lot.filter(isPending)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.masters(owner.id) })
    queryClient.invalidateQueries({ queryKey: kind === 'place' ? qk.places : qk.personas })
    if (kind === 'character') queryClient.invalidateQueries({ queryKey: qk.references(owner.id) })
  }
  const generate = useMutation({
    mutationFn: () => {
      const aspect = family?.tasks['text-to-image']?.schema.properties?.aspect_ratio?.enum?.includes(kind === 'place' ? '3:2' : '4:5')
      return mastersApi.generate(kind, owner.id, {
        axis,
        count: lotSize,
        family: family!.id,
        face: canFace && useReference,
        strength: canStart && useReference ? strength : undefined,
        params: aspect ? { aspect_ratio: kind === 'place' ? '3:2' : '4:5' } : {},
      })
    },
    onSuccess: ({ threadId: id }) => {
      setLotIndex(null)
      queryClient.invalidateQueries({ queryKey: qk.masters(owner.id) })
      queryClient.invalidateQueries({ queryKey: qk.thread(id) })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const cancelLot = useMutation({
    mutationFn: () => Promise.allSettled(lot.filter(isPending).map((g) => generationsApi.remove(g.id))),
    onSuccess: () => threadId && queryClient.invalidateQueries({ queryKey: qk.thread(threadId) }),
  })
  const toggle = useMutation({
    mutationFn: ({ assetId, isMaster }: { assetId: string; isMaster: boolean }) => mastersApi.set(kind, owner.id, assetId, isMaster),
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  })

  const chip = (active: boolean) =>
    cn(
      'h-8 rounded-full border px-3 text-xs transition-colors',
      active ? 'border-brand/50 bg-brand/10 text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground',
    )

  return (
    <>
      <PageHeader right={headerRight}>{header}</PageHeader>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Barre de commande */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border/40 px-5 py-3">
          <div className="mr-auto flex flex-wrap items-center gap-1.5">
            {axes.map((a) => (
              <button key={a.id} onClick={() => setAxis(a.id)} title={a.hint} className={chip(axis === a.id)}>
                {a.label}
              </button>
            ))}
            <button onClick={() => setAxis('mix')} title="Une variante tirée dans tous les axes pour chaque image" className={chip(axis === 'mix')}>
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
          {kind === 'character' ? (
            <label
              className={cn('flex items-center gap-2 text-xs', canFace ? 'text-muted-foreground' : 'text-muted-foreground/50')}
              title={
                !owner.avatarAssetId
                  ? 'Pas d’image de référence'
                  : !family?.supportsFace
                    ? 'Ce modèle ne sait pas appliquer un visage (local avec ReActor seulement)'
                    : 'Applique le visage de l’image de référence à chaque variation (ReActor)'
              }
            >
              <Switch checked={canFace && useReference} disabled={!canFace} onCheckedChange={setUseReference} />
              Visage de la référence
            </label>
          ) : (
            <div
              className={cn('flex items-center gap-2 text-xs', canStart ? 'text-muted-foreground' : 'text-muted-foreground/50')}
              title={
                !owner.avatarAssetId
                  ? 'Pas d’image de référence'
                  : !family?.tasks['image-to-image']
                    ? 'Ce modèle ne sait pas partir d’une image'
                    : 'Chaque variation part de l’image de référence (image → image) pour garder la même pièce. Plus la force est haute, plus elle s’en éloigne.'
              }
            >
              <Switch checked={canStart && useReference} disabled={!canStart} onCheckedChange={setUseReference} />
              Partir de la référence
              {canStart && useReference && (
                <>
                  <input
                    type="range"
                    min={0.4}
                    max={0.9}
                    step={0.05}
                    value={strength}
                    onChange={(e) => setStrength(Number(e.target.value))}
                    className="w-20 accent-brand"
                    aria-label="Force"
                  />
                  <span className="w-8 tabular-nums">{strength.toFixed(2)}</span>
                </>
              )}
            </div>
          )}
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
          <Button size="sm" className="h-8 gap-1.5 rounded-full" disabled={!family || generate.isPending || pending.length > 0} onClick={() => generate.mutate()}>
            {generate.isPending || pending.length > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {pending.length > 0 ? `Génération · ${lot.length - pending.length} / ${lot.length}` : `Générer ${lotSize} variations`}
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 gap-4 p-4">
          <MastersPanel owner={owner} masters={masters} onView={setViewing} onRemove={(assetId) => toggle.mutate({ assetId, isMaster: false })} />

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
                    {kind === 'place'
                      ? `Choisis un axe (angles, moments de la journée…) et lance un lot : chaque image garde la fiche de ${owner.name} et varie sur cet axe. Marque d'une étoile celles où le lieu est bien reconnaissable.`
                      : `Choisis un axe (angles, expressions…) et lance un lot : chaque image garde l'identité de ${owner.name} et varie sur cet axe. Marque d'une étoile celles qui lui ressemblent vraiment.`}
                  </p>
                </div>
              ) : (
                <div className={cn('grid gap-3', kind === 'place' ? 'grid-cols-[repeat(auto-fill,minmax(240px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(170px,1fr))]')}>
                  {lot.map((g) => {
                    const image = g.outputs[0]
                    const starred = Boolean(image && masterIds.has(image.id))
                    return (
                      <VariantCard
                        key={g.id}
                        generation={g}
                        selected={starred}
                        aspect={kind === 'place' ? 'landscape' : 'portrait'}
                        queuePosition={lot.filter((x) => x.status === 'queued').indexOf(g) + 1}
                        caption={g.variation ? `${axisLabel(g.variation.axis)} · ${g.variation.label}` : ''}
                        onSelect={() => image && setViewing(image)}
                        corner={
                          image && (
                            <button
                              onClick={() => toggle.mutate({ assetId: image.id, isMaster: !starred })}
                              className={cn('rounded-full bg-black/60 p-1.5 transition-colors', starred ? 'text-amber-400' : 'text-white/80 hover:text-amber-300')}
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

/** Images master retenues : total vers le repère et diversité par axe. */
function MastersPanel({
  owner,
  masters,
  onView,
  onRemove,
}: {
  owner: MastersOwner
  masters: PersonaMaster[]
  onView: (asset: Asset) => void
  onRemove: (assetId: string) => void
}) {
  const target = MASTER_TARGETS[owner.kind]
  const others = masters.filter((m) => !m.axis).length
  return (
    <section className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded-xl border border-border/40 bg-card">
      <div className="space-y-3 border-b border-border/40 px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold">Images master</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            <span className="font-semibold text-foreground">{masters.length}</span> / {target.total} recommandées
          </span>
        </div>
        <span className="block h-1.5 overflow-hidden rounded-full bg-secondary">
          <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (masters.length / target.total) * 100)}%` }} />
        </span>
        <div className="space-y-1.5">
          {axesFor(owner.kind).map((a) => {
            const n = masters.filter((m) => m.axis === a.id).length
            return (
              <div key={a.id} className="flex items-center gap-2 text-[11px]">
                <span className="w-24 truncate text-muted-foreground">{a.label}</span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                  <span
                    className={cn('block h-full rounded-full', n >= target.perAxis ? 'bg-emerald-500' : 'bg-brand/70')}
                    style={{ width: `${Math.min(100, (n / target.perAxis) * 100)}%` }}
                  />
                </span>
                <span className="w-8 text-right text-muted-foreground tabular-nums">
                  {n} / {target.perAxis}
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
            Aucune image master. {owner.avatarAssetId ? 'Lance des variations et garde les meilleures d’une étoile.' : 'Il faut d’abord une image de référence.'}
          </p>
        ) : (
          <div className={cn('grid gap-2', owner.kind === 'place' ? 'grid-cols-2' : 'grid-cols-3')}>
            {masters.map((m) => (
              <div key={m.asset.id} className="group relative">
                <button onClick={() => onView(m.asset)} className="block w-full overflow-hidden rounded-lg border border-border/40">
                  <img src={m.asset.url} alt="" className={cn('w-full object-cover', owner.kind === 'place' ? 'aspect-[3/2]' : 'aspect-[4/5]')} />
                </button>
                <button
                  onClick={() => onRemove(m.asset.id)}
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
                  title="Retirer des images master"
                >
                  <X className="h-3 w-3" />
                </button>
                <p className="truncate pt-0.5 text-[10px] text-muted-foreground">
                  {m.asset.id === owner.avatarAssetId ? (owner.kind === 'place' ? 'Référence' : 'Référence (visage)') : (m.variantLabel ?? axisLabel(m.axis))}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="border-t border-border/40 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        {owner.kind === 'place'
          ? `Les masters de ${owner.name} serviront à le retrouver d'une scène à l'autre (image → image, modèles à références).`
          : `Les masters rejoignent les références de ${owner.name}. Elles serviront plus tard de jeu d'entraînement à sa LoRA.`}
      </p>
    </section>
  )
}
