/**
 * Créateur de personnage : fiche d'identité (un emplacement par catégorie de la zone Personnage),
 * lots de variantes (un tirage par variante), vue Grille ou Comparer, puis « Garder ce personnage ».
 */
import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dice5, ImageIcon, Loader2, Lock, LockOpen, Sparkles, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import type { CharacterDraft, CharacterSlot, Gender, Generation, GenerationRequest, LibraryOption } from '@ai-fluence/shared'

import { charactersApi, generationsApi } from '@/lib/api'
import { catalogQuery, libraryCategoriesQuery, libraryOptionsQuery, libraryThumbnailsQuery, qk, threadQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { useUiPref } from '@/components/providers/ui-prefs'
import { PageHeader } from '@/components/layout/PageHeader'
import { NewPersonaDialog } from '@/components/personas/NewPersonaDialog'
import { TraitPicker } from '@/components/composer/TraitPicker'
import { groupLots, isPending, LotProgress, LotTabs, VariantCard } from '@/components/characters/Lots'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/_app/personnages/nouveau')({
  component: CharacterCreatorPage,
})

const DRAFT_KEY = ['character-draft'] as const
const LOT_SIZES = [4, 8, 12]

/** Tire une option au hasard (pondérée) parmi celles qui conviennent au genre. */
function draw(options: LibraryOption[]): LibraryOption | null {
  if (!options.length) return null
  const total = options.reduce((n, o) => n + (o.weight || 1), 0)
  let r = Math.random() * total
  for (const o of options) {
    r -= o.weight || 1
    if (r <= 0) return o
  }
  return options.at(-1)!
}

function CharacterCreatorPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [, setPersonaId] = useUiPref('personaId')
  const { data: draft } = useQuery({ queryKey: DRAFT_KEY, queryFn: () => charactersApi.current().then((r) => r.draft) })
  const [quickCreate, setQuickCreate] = useState(false)

  const setDraft = (next: CharacterDraft) => queryClient.setQueryData(DRAFT_KEY, next)
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof charactersApi.update>[1]) => charactersApi.update(draft!.id, patch),
    onError: (e) => toast.error((e as Error).message),
  })
  /** Modifie la fiche tout de suite à l'écran, puis l'enregistre. */
  const change = (patch: Parameters<typeof charactersApi.update>[1]) => {
    if (!draft) return
    setDraft({ ...draft, ...patch })
    update.mutate(patch)
  }
  const restart = useMutation({
    mutationFn: (start: 'blank' | 'random') => charactersApi.create(start),
    onSuccess: ({ draft: next }) => setDraft(next),
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <>
      <PageHeader
        right={
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setQuickCreate(true)}>
            <UserPlus className="h-3.5 w-3.5" /> Création rapide
          </Button>
        }
      >
        <span className="px-1.5 text-sm text-muted-foreground">
          Personnages / <span className="font-medium text-foreground">Nouveau personnage</span>
        </span>
      </PageHeader>
      {draft ? (
        <Creator
          key={draft.id}
          draft={draft}
          onChange={change}
          onRestart={(start) => restart.mutate(start)}
          restarting={restart.isPending}
          onKept={(personaId) => {
            queryClient.invalidateQueries({ queryKey: qk.personas })
            queryClient.removeQueries({ queryKey: DRAFT_KEY })
            setPersonaId(personaId)
            // Suite logique : les images master du nouveau personnage.
            navigate({ to: '/personnages/$personaId/masters', params: { personaId } })
          }}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <NewPersonaDialog open={quickCreate} onOpenChange={setQuickCreate} />
    </>
  )
}

function Creator({
  draft,
  onChange,
  onRestart,
  restarting,
  onKept,
}: {
  draft: CharacterDraft
  onChange: (patch: Parameters<typeof charactersApi.update>[1]) => void
  onRestart: (start: 'blank' | 'random') => void
  restarting: boolean
  onKept: (personaId: string) => void
}) {
  const queryClient = useQueryClient()
  const { data: categories = [] } = useQuery(libraryCategoriesQuery())
  const { data: catalog } = useQuery(catalogQuery())
  const { data: thread } = useQuery(threadQuery(draft.threadId))

  // Fiche : une ligne par catégorie de la zone Personnage (les nouvelles catégories arrivent vides).
  const sheetCategories = categories.filter((c) => c.zone === 'character' && c.optionCount > 0)
  const slotOf = (categoryId: string): CharacterSlot =>
    draft.slots.find((s) => s.categoryId === categoryId) ?? { categoryId, mode: 'empty', optionId: null, pool: [], locked: false }
  const setSlot = (slot: CharacterSlot) =>
    onChange({ slots: [...draft.slots.filter((s) => s.categoryId !== slot.categoryId), slot] })

  const optionQueries = useQueries({ queries: sheetCategories.map((c) => libraryOptionsQuery(c.id)) })
  const thumbQueries = useQueries({ queries: sheetCategories.map((c) => libraryThumbnailsQuery(c.id)) })
  const optionsOf = (categoryId: string): LibraryOption[] => {
    const i = sheetCategories.findIndex((c) => c.id === categoryId)
    return (optionQueries[i]?.data ?? []).filter((o) => !o.gender || o.gender === draft.gender)
  }
  const thumbOf = (categoryId: string, optionId: string): string | null => {
    const i = sheetCategories.findIndex((c) => c.id === categoryId)
    const thumbs = (thumbQueries[i]?.data ?? []).filter((t) => t.optionId === optionId && t.url)
    return (thumbs.find((t) => t.gender === draft.gender) ?? thumbs.find((t) => t.gender === 'any') ?? thumbs[0])?.url ?? null
  }

  // Modèle : local par défaut.
  const families = (catalog?.families ?? []).filter((f) => f.media === 'image' && f.available && f.tasks['text-to-image'])
  const family = families.find((f) => f.id === draft.family) ?? families.find((f) => f.provider === 'comfy') ?? families[0]
  // Le modèle affiché par défaut est enregistré : il devient le modèle par défaut du persona gardé.
  useEffect(() => {
    if (family && !draft.family) onChange({ family: family.id })
  }, [family?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [lotSize, setLotSize] = useState(8)
  const [editingPreview, setEditingPreview] = useState(false)
  const [picker, setPicker] = useState<string | null>(null)

  // Lots : une série = un lot ; le plus récent est affiché par défaut.
  const lots = useMemo(() => groupLots(thread?.generations ?? []), [thread?.generations])
  const [lotIndex, setLotIndex] = useState<number | null>(null)
  const lot = lots[lotIndex ?? lots.length - 1] ?? []
  useEffect(() => setLotIndex(null), [lots.length])
  const [view, setView] = useState<'grid' | 'compare'>('grid')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = lot.find((g) => g.id === selectedId) ?? null

  const generate = useMutation({
    mutationFn: () => {
      // Un tirage par variante : option choisie, tirée au hasard, ou rien.
      const draws = Array.from({ length: lotSize }, () =>
        sheetCategories.flatMap((c) => {
          const slot = slotOf(c.id)
          if (slot.mode === 'chosen' && slot.optionId) return [slot.optionId]
          if (slot.mode === 'random') {
            const pool = optionsOf(c.id).filter((o) => !slot.pool.length || slot.pool.includes(o.id))
            const pick = draw(pool)
            return pick ? [pick.id] : []
          }
          return []
        }),
      )
      const aspect = family?.tasks['text-to-image']?.schema.properties?.aspect_ratio?.enum?.includes('4:5')
      const request: GenerationRequest = {
        family: family!.id,
        threadId: draft.threadId,
        prompt: draft.previewPrompt,
        params: aspect ? { aspect_ratio: '4:5' } : {},
        referenceAssetIds: [],
        count: lotSize,
        traitDraws: draws,
        gender: draft.gender,
      }
      return generationsApi.create(request)
    },
    onSuccess: () => {
      setSelectedId(null)
      setLotIndex(null)
      queryClient.invalidateQueries({ queryKey: qk.thread(draft.threadId) })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const cancelLot = useMutation({
    mutationFn: () => Promise.allSettled(lot.filter(isPending).map((g) => generationsApi.remove(g.id))),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.thread(draft.threadId) }),
  })

  /** Recopie les traits d'une variante dans la fiche (seulement les emplacements non verrouillés). */
  const takeTraits = (g: Generation, onlyCategoryId?: string) => {
    const slots = sheetCategories.map((c) => {
      const slot = slotOf(c.id)
      if (onlyCategoryId ? c.id !== onlyCategoryId : slot.locked) return slot
      const trait = g.traits.find((t) => t.categoryId === c.id)
      return trait ? { ...slot, mode: 'chosen' as const, optionId: trait.optionId } : slot
    })
    onChange({ slots })
  }

  const pending = lot.filter(isPending)
  const done = lot.filter((g) => !isPending(g))
  const randomCount = sheetCategories.filter((c) => slotOf(c.id).mode === 'random').length
  const lockedCount = sheetCategories.filter((c) => slotOf(c.id).locked).length
  const [keeping, setKeeping] = useState<Generation | null>(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Barre de commande */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border/40 px-5 py-3">
        <h1 className="mr-auto text-lg font-semibold">Créer un personnage</h1>
        <span className="text-xs text-muted-foreground">Départ</span>
        <div className="flex h-8 items-center rounded-full border border-border/60 bg-background/40 p-0.5 text-xs">
          {(['blank', 'random'] as const).map((s) => (
            <button
              key={s}
              disabled={restarting}
              onClick={() => onRestart(s)}
              className="h-full rounded-full px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Nouvelle création (les lots actuels restent dans leur fil)"
            >
              {s === 'blank' ? 'Vierge' : 'Aléatoire complet'}
            </button>
          ))}
        </div>
        <div className="flex h-8 items-center rounded-full border border-border/60 bg-background/40 p-0.5 text-xs">
          {(['female', 'male'] as Gender[]).map((g) => (
            <button
              key={g}
              onClick={() => onChange({ gender: g })}
              className={cn('h-full rounded-full px-3 transition-colors', draft.gender === g ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {g === 'female' ? 'Femme' : 'Homme'}
            </button>
          ))}
        </div>
        <Select value={family?.id} onValueChange={(id) => onChange({ family: id })}>
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
          disabled={!family || !sheetCategories.length || generate.isPending || pending.length > 0}
          onClick={() => generate.mutate()}
        >
          {generate.isPending || pending.length > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {pending.length > 0 ? `Génération · ${done.length} / ${lot.length}` : `Générer ${lotSize} variantes`}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        {/* Fiche d'identité */}
        <section className="flex w-[360px] shrink-0 flex-col overflow-hidden rounded-xl border border-border/40 bg-card">
          <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
            <span className="text-sm font-semibold">Identité</span>
            <span className="text-[11px] text-muted-foreground">
              {randomCount} aléatoire(s) · {lockedCount} verrouillé(s)
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7 gap-1.5 text-xs"
              onClick={() =>
                onChange({
                  slots: sheetCategories.map((c) => {
                    const slot = slotOf(c.id)
                    return slot.locked ? slot : { ...slot, mode: 'random' as const, optionId: null }
                  }),
                })
              }
              title="Passe en aléatoire tous les traits non verrouillés"
            >
              <Dice5 className="h-3.5 w-3.5" /> Tout aléatoire
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {sheetCategories.length === 0 && (
              <p className="p-4 text-xs leading-relaxed text-muted-foreground">
                La fiche se construit à partir des catégories de la zone <b>Personnage</b> de ta bibliothèque (coiffures, yeux,
                peau…). Importe des wildcards dans cette zone pour commencer.
              </p>
            )}
            {sheetCategories.map((c) => {
              const slot = slotOf(c.id)
              const option = slot.optionId ? optionsOf(c.id).find((o) => o.id === slot.optionId) : null
              const thumb = option ? thumbOf(c.id, option.id) : null
              return (
                <div key={c.id} className="flex items-center gap-2 border-b border-border/30 px-4 py-2 last:border-0">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">{c.label}</span>
                  <button
                    onClick={() => setPicker(c.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent"
                    title="Choisir dans la grille"
                  >
                    {slot.mode === 'chosen' && option ? (
                      <>
                        {thumb ? <img src={thumb} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" /> : <span className="h-8 w-8 shrink-0 rounded-md bg-secondary" />}
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium">{option.label ?? option.fragment}</span>
                          <span className="block truncate font-mono text-[10px] text-muted-foreground">{option.fragment}</span>
                        </span>
                      </>
                    ) : slot.mode === 'random' ? (
                      <span className="flex items-center gap-1.5 text-[13px]">
                        <span className="rounded border border-brand/40 bg-brand/10 px-1.5 text-[10px] font-medium text-brand">Aléatoire</span>
                        {slot.pool.length ? `${slot.pool.length} sur ${optionsOf(c.id).length}` : `Toute la liste (${optionsOf(c.id).length})`}
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">Vide</span>
                    )}
                  </button>
                  {slot.mode !== 'empty' && (
                    <button
                      onClick={() => setSlot({ ...slot, mode: 'empty', optionId: null })}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Vider : le modèle décide"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => setSlot({ ...slot, mode: 'random', optionId: null })}
                    className={cn('rounded p-1 hover:bg-accent', slot.mode === 'random' ? 'text-brand' : 'text-muted-foreground hover:text-foreground')}
                    title="Aléatoire : tiré pour chaque variante"
                  >
                    <Dice5 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setSlot({ ...slot, locked: !slot.locked })}
                    className={cn('rounded p-1 hover:bg-accent', slot.locked ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                    title={slot.locked ? 'Verrouillé : épargné par « Tout aléatoire » et « Reprendre ces traits »' : 'Verrouiller'}
                  >
                    {slot.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )
            })}
          </div>
          {/* Aperçu neutre */}
          <div className="m-3 rounded-lg bg-secondary/40 px-3 py-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Aperçu neutre (cadrage, fond, lumière)</span>
              <button className="text-brand hover:underline" onClick={() => setEditingPreview((v) => !v)}>
                {editingPreview ? 'Fermer' : 'Modifier'}
              </button>
            </div>
            {editingPreview ? (
              <Textarea
                rows={3}
                defaultValue={draft.previewPrompt}
                onBlur={(e) => e.target.value.trim() && e.target.value !== draft.previewPrompt && onChange({ previewPrompt: e.target.value.trim() })}
                className="mt-1.5 font-mono text-[11px]"
              />
            ) : (
              <p className="mt-0.5 line-clamp-2 font-mono text-[11px] text-foreground/80">{draft.previewPrompt}</p>
            )}
          </div>
        </section>

        {/* Variantes */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/40 bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-4 py-2.5">
            <span className="text-sm font-semibold">Variantes</span>
            <LotTabs
              lots={lots}
              current={lot}
              onPick={(i) => {
                setLotIndex(i)
                setSelectedId(null)
              }}
            />
            {lot.length > 0 && (
              <div className="ml-auto flex h-7 items-center rounded-md border border-input p-0.5 text-[11px]">
                {(['grid', 'compare'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={cn('h-full rounded px-2.5 transition-colors', view === v ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                  >
                    {v === 'grid' ? 'Grille' : 'Comparer'}
                  </button>
                ))}
              </div>
            )}
          </div>

          <LotProgress lot={lot} onCancel={() => cancelLot.mutate()} />

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {lot.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-semibold">Aucune variante pour l'instant</p>
                <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                  Règle la fiche à gauche, puis lance un lot. En local, les images arrivent une par une ; chacune fait son propre
                  tirage pour les traits en aléatoire.
                </p>
              </div>
            ) : view === 'grid' ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
                {lot.map((g) => (
                  <VariantCard
                    key={g.id}
                    generation={g}
                    selected={g.id === selectedId}
                    queuePosition={lot.filter((x) => x.status === 'queued').indexOf(g) + 1}
                    caption={g.traits.map((t) => t.label ?? t.fragment).join(' · ')}
                    onSelect={() => setSelectedId(g.id === selectedId ? null : g.id)}
                  />
                ))}
              </div>
            ) : (
              <CompareTable
                lot={lot}
                categories={sheetCategories.map((c) => ({ id: c.id, label: c.label }))}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onTakeTrait={(g, categoryId) => takeTraits(g, categoryId)}
              />
            )}
          </div>

          {selected && selected.status === 'succeeded' && (
            <div className="flex flex-wrap items-center gap-4 border-t border-border/40 px-4 py-3">
              <span className="text-sm font-semibold">#{selected.batchIndex + 1}</span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1 text-xs">
                {selected.traits.map((t) => (
                  <span key={t.optionId}>
                    <span className="text-muted-foreground">{t.categoryLabel} </span>
                    <span className="text-brand">{t.label ?? t.fragment}</span>
                  </span>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => takeTraits(selected)}>
                Reprendre ces traits
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setKeeping(selected)}>
                <UserPlus className="h-3.5 w-3.5" /> Garder ce personnage
              </Button>
            </div>
          )}
        </section>
      </div>

      <TraitPicker
        open={picker !== null}
        title="Choisir un trait"
        categoryIds={picker ? [picker] : undefined}
        initialCategoryId={picker}
        gender={draft.gender}
        selected={sheetCategories.flatMap((c) => {
          const slot = slotOf(c.id)
          const option = slot.mode === 'chosen' ? optionsOf(c.id).find((o) => o.id === slot.optionId) : null
          return option
            ? [{ optionId: option.id, categoryId: c.id, categoryLabel: c.label, zone: c.zone, label: option.label, fragment: option.fragment, thumbnailUrl: null }]
            : []
        })}
        onPick={(trait) => {
          setSlot({ ...slotOf(trait.categoryId), mode: 'chosen', optionId: trait.optionId })
          setPicker(null)
        }}
        onClose={() => setPicker(null)}
      />
      <KeepDialog draft={draft} generation={keeping} onClose={() => setKeeping(null)} onKept={onKept} />
    </div>
  )
}

function CompareTable({
  lot,
  categories,
  selectedId,
  onSelect,
  onTakeTrait,
}: {
  lot: Generation[]
  categories: { id: string; label: string }[]
  selectedId: string | null
  onSelect: (id: string) => void
  onTakeTrait: (g: Generation, categoryId: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="w-28" />
            {lot.map((g) => (
              <th key={g.id} className="p-1 align-bottom">
                <button
                  onClick={() => onSelect(g.id)}
                  className={cn('block w-full overflow-hidden rounded-lg border', g.id === selectedId ? 'border-brand ring-1 ring-brand' : 'border-border/40')}
                >
                  {g.outputs[0] ? (
                    <img src={g.outputs[0].url} alt="" className="aspect-[4/5] w-full object-cover" />
                  ) : (
                    <span className="flex aspect-[4/5] items-center justify-center text-muted-foreground">…</span>
                  )}
                </button>
                <span className="text-[10px] font-semibold">#{g.batchIndex + 1}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => {
            const values = lot.map((g) => g.traits.find((t) => t.categoryId === c.id))
            const varies = new Set(values.map((v) => v?.optionId ?? '')).size > 1
            return (
              <tr key={c.id} className="border-t border-border/30">
                <td className="py-1.5 pr-2 text-muted-foreground">{c.label}</td>
                {lot.map((g, i) => {
                  const v = values[i]
                  return (
                    <td key={g.id} className="p-1 text-center">
                      {v ? (
                        <button
                          onClick={() => onTakeTrait(g, c.id)}
                          title="Reprendre ce trait seul dans la fiche"
                          className={cn('rounded px-1 hover:bg-accent', varies ? 'font-semibold text-brand' : 'text-muted-foreground')}
                        >
                          {v.label ?? v.fragment}
                        </button>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-muted-foreground">
        <span className="font-semibold text-brand">Couleur de marque</span> : varie d'une image à l'autre · gris : trait fixe ·
        clic sur une case : reprendre ce trait seul dans la fiche.
      </p>
    </div>
  )
}

function KeepDialog({
  draft,
  generation,
  onClose,
  onKept,
}: {
  draft: CharacterDraft
  generation: Generation | null
  onClose: () => void
  onKept: (personaId: string) => void
}) {
  const [name, setName] = useState(draft.name)
  const keep = useMutation({
    mutationFn: () => charactersApi.keep(draft.id, generation!.id, name.trim()),
    onSuccess: ({ persona }) => {
      toast.success(`${persona.name} est créé·e`)
      onKept(persona.id)
    },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <Dialog open={generation !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Garder ce personnage</DialogTitle>
          <DialogDescription>
            Le persona est créé avec cette image comme avatar et première référence, et ses traits comme fiche d'identité :
            ils seront ajoutés en bulles dans le composer.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          {generation?.outputs[0] && <img src={generation.outputs[0].url} alt="" className="h-20 w-16 rounded-lg object-cover" />}
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du personnage" maxLength={40} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!name.trim() || keep.isPending} onClick={() => keep.mutate()}>
            {keep.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Garder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
