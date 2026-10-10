import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  CornerDownRight,
  Eye,
  EyeOff,
  FileUp,
  FolderInput,
  ImageIcon,
  Library,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  LIBRARY_ZONES,
  getZone,
  orderCategories,
  SPLIT_RULES,
  suggestSplit,
  type Gender,
  type LibraryCategory,
  type LibraryOption,
  type LibraryThumbnail,
  type LibraryZone,
  type ThumbnailGender,
} from '@ai-fluence/shared'

import { libraryApi } from '@/lib/api'
import { catalogQuery, libraryCategoriesQuery, libraryOptionsQuery, libraryThumbnailsQuery, qk } from '@/lib/queries'
import { formatDuration, formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { InlineEdit } from '@/components/ui/inline-edit'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/_app/bibliotheque')({
  component: LibraryPage,
})

/** Au-delà, la grille propose « Afficher plus » (un pack peut compter des milliers d'options). */
const PAGE_SIZE = 120

const GENDER_LABEL: Record<Gender, string> = { female: 'Femme', male: 'Homme' }

/** Demande à qui s'adressent les options d'un fichier avant de l'importer. */
function ImportGenderDialog({
  file,
  onChoose,
  onClose,
}: {
  file: File | null
  onChoose: (gender: Gender | null) => void
  onClose: () => void
}) {
  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Importer « {file?.name} »</DialogTitle>
          <DialogDescription>
            Ces options sont pour qui ? Une coiffure femme n'aura qu'une miniature femme et ne sera proposée qu'aux personnages
            féminins.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" onClick={() => onChoose('female')}>Femme</Button>
          <Button variant="outline" onClick={() => onChoose('male')}>Homme</Button>
          <Button variant="outline" onClick={() => onChoose(null)}>Les deux</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Choix du genre d'une option (catégories genrées). */
function GenderSelect({ value, onChange }: { value: Gender | null; onChange: (g: Gender | null) => void }) {
  return (
    <div className="flex h-8 shrink-0 items-center rounded-md border border-input p-0.5 text-[11px]">
      {([['female', 'F'], ['male', 'H'], [null, 'F + H']] as const).map(([g, label]) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(g)}
          title={g ? GENDER_LABEL[g] : 'Pour les deux'}
          className={cn(
            'h-full rounded px-2 transition-colors',
            value === g ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Libellé lisible d'un nom de fichier : `hair_styles-v3.txt` → `Hair styles v3`. */
function labelFromFile(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
  return base ? base[0].toUpperCase() + base.slice(1) : 'Nouvelle catégorie'
}

function LibraryPage() {
  const queryClient = useQueryClient()
  const { data: categories = [], isLoading } = useQuery(libraryCategoriesQuery())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = categories.find((c) => c.id === selectedId) ?? categories[0] ?? null
  const fileRef = useRef<HTMLInputElement>(null)
  /**
   * Zone dans laquelle on importe, choisie avant d'ouvrir le sélecteur de fichier. Une ref (lue au choix
   * du fichier, sans attendre un rendu) et un état (pour le spinner du bon bouton).
   */
  const importZoneRef = useRef<LibraryZone>('character')
  const [importZone, setImportZone] = useState<LibraryZone>('character')
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const refresh = (categoryId?: string) => {
    queryClient.invalidateQueries({ queryKey: qk.libraryCategories })
    if (categoryId) queryClient.invalidateQueries({ queryKey: qk.libraryOptions(categoryId) })
  }

  const create = useMutation({
    mutationFn: (zone: LibraryZone) => libraryApi.createCategory({ label: 'Nouvelle catégorie', zone }),
    onSuccess: ({ category }) => {
      refresh()
      setSelectedId(category.id)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  // Import d'un fichier comme nouvelle catégorie de la zone, nommée d'après le fichier.
  const importAsCategory = useMutation({
    mutationFn: async ({ file, zone, gender }: { file: File; zone: LibraryZone; gender: Gender | null }) => {
      const text = await file.text()
      const { category } = await libraryApi.createCategory({ label: labelFromFile(file.name), zone, gendered: gender !== null })
      const { result } = await libraryApi.importText(category.id, text, file.name, gender)
      return { category, result }
    },
    onSuccess: ({ category, result }) => {
      refresh(category.id)
      setSelectedId(category.id)
      toast.success(`${result.added} option(s) importée(s) dans « ${category.label} »`)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const startImport = (zone: LibraryZone) => {
    importZoneRef.current = zone
    setImportZone(zone)
    fileRef.current?.click()
  }

  return (
    <>
      <PageHeader>
        <span className="flex items-center gap-2 px-1.5 text-sm font-medium">
          <Library className="h-4 w-4" /> Bibliothèque
        </span>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        {/* Zones et leurs catégories */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-border/40">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-3">
            {isLoading && <Loader2 className="mx-auto mt-6 h-4 w-4 animate-spin text-muted-foreground" />}
            {!isLoading &&
              LIBRARY_ZONES.map((zone) => {
                const items = orderCategories(categories.filter((c) => c.zone === zone.id))
                return (
                  <div key={zone.id}>
                    <div className="group flex items-center gap-1 px-2 pb-1">
                      <span className="flex-1 text-[11px] font-bold tracking-wide text-zinc-300 uppercase">{zone.label}</span>
                      <button
                        onClick={() => startImport(zone.id)}
                        disabled={importAsCategory.isPending}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        title={`Importer un fichier wildcard dans « ${zone.label} »`}
                        aria-label={`Importer dans ${zone.label}`}
                      >
                        {importAsCategory.isPending && importZone === zone.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FileUp className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => create.mutate(zone.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        title={`Nouvelle catégorie dans « ${zone.label} »`}
                        aria-label={`Nouvelle catégorie dans ${zone.label}`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {items.length === 0 ? (
                      <p className="px-2.5 py-1 text-[11px] leading-snug text-muted-foreground/70">{zone.hint}</p>
                    ) : (
                      <div className="space-y-0.5">
                        {items.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => setSelectedId(c.id)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors',
                              c.depth === 1 && 'pl-5',
                              selected?.id === c.id
                                ? 'bg-accent text-foreground'
                                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                            )}
                          >
                            {c.depth === 1 && <CornerDownRight className="h-3 w-3 shrink-0 opacity-50" />}
                            <span className="min-w-0 flex-1 truncate">{c.label}</span>
                            <span className="text-[11px] tabular-nums">{c.optionCount}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
          <p className="border-t border-border/40 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
            Import : un fichier <code>.txt</code>, une option par ligne. Il devient une catégorie de la zone choisie.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Zones Personnage et Tenue : on demande à qui s'adressent les options ; ailleurs, import direct.
              if (file) {
                const zone = importZoneRef.current
                if (getZone(zone).gender === 'ask') setPendingFile(file)
                else importAsCategory.mutate({ file, zone, gender: null })
              }
              e.target.value = ''
            }}
          />
          <ImportGenderDialog
            file={pendingFile}
            onClose={() => setPendingFile(null)}
            onChoose={(gender) => {
              if (pendingFile) importAsCategory.mutate({ file: pendingFile, zone: importZoneRef.current, gender })
              setPendingFile(null)
            }}
          />
        </aside>

        {/* Catégorie sélectionnée */}
        <section className="min-w-0 flex-1 overflow-y-auto">
          {selected ? (
            <CategoryPanel
              key={selected.id}
              category={selected}
              categories={categories}
              onChanged={() => refresh(selected.id)}
              onDeleted={() => setSelectedId(null)}
              onOpen={setSelectedId}
            />
          ) : (
            !isLoading && (
              <div className="mx-auto mt-24 max-w-md space-y-3 px-6 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-secondary">
                  <Library className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-semibold">Ta bibliothèque est vide</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Choisis une zone à gauche (Personnage, Tenue, Lieu & décor…) et importe un fichier wildcard, par exemple un pack
                  de coiffures téléchargé sur Civitai : chaque ligne devient une option. Tu pourras ensuite lui donner un libellé en
                  français et générer sa miniature.
                </p>
              </div>
            )
          )}
        </section>
      </div>
    </>
  )
}

function CategoryPanel({
  category,
  categories,
  onChanged,
  onDeleted,
  onOpen,
}: {
  category: LibraryCategory
  categories: LibraryCategory[]
  onChanged: () => void
  onDeleted: () => void
  /** Ouvre une autre catégorie (sous-catégorie créée…). */
  onOpen: (categoryId: string) => void
}) {
  const queryClient = useQueryClient()
  const { data: options = [], isLoading } = useQuery(libraryOptionsQuery(category.id))
  const [editingTitle, setEditingTitle] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [draft, setDraft] = useState<{ label: string; fragment: string; gender: Gender | null }>({
    label: '',
    fragment: '',
    gender: null,
  })
  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  useEffect(() => setLimit(PAGE_SIZE), [search])

  // Miniatures : une par option (et par version femme / homme dans une catégorie genrée).
  const { data: thumbnails = [] } = useQuery(libraryThumbnailsQuery(category.id))
  const [preview, setPreview] = useState<Gender>('female')
  const thumbByKey = useMemo(() => new Map(thumbnails.map((t) => [`${t.optionId}:${t.gender}`, t])), [thumbnails])
  /** Version affichée d'une option : la sienne si elle est réservée à un genre, sinon celle de l'aperçu. */
  const shownGender = (o: LibraryOption): ThumbnailGender => (!category.gendered ? 'any' : (o.gender ?? preview))
  const refreshThumbnails = () => queryClient.invalidateQueries({ queryKey: qk.libraryThumbnails(category.id) })
  const generate = useMutation({
    mutationFn: (mode: 'missing' | 'all') => libraryApi.generateThumbnails(category.id, mode),
    onSuccess: ({ queued }) => {
      refreshThumbnails()
      if (!queued) toast.info('Toutes les miniatures existent déjà.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const cancel = useMutation({
    mutationFn: () => libraryApi.cancelThumbnails(category.id),
    onSuccess: refreshThumbnails,
    onError: (e) => toast.error((e as Error).message),
  })

  // Compteurs : versions attendues (2 pour une option « les deux » d'une catégorie genrée) et versions prêtes.
  const shownOptionIds = useMemo(() => new Set(options.filter((o) => !o.hidden).map((o) => o.id)), [options])
  const expected = options.reduce((n, o) => n + (o.hidden ? 0 : category.gendered && !o.gender ? 2 : 1), 0)
  const ready = thumbnails.filter((t) => shownOptionIds.has(t.optionId) && (t.status === 'ready' || (t.url && t.status !== 'failed'))).length
  const pending = thumbnails.filter((t) => t.status === 'queued' || t.status === 'running')
  const durations = thumbnails.map((t) => t.durationMs).filter((d): d is number => d !== null)
  const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null
  const [showTemplate, setShowTemplate] = useState(false)
  // Modèle des miniatures : Z-Image en local par défaut ; un modèle API est payant (devis avant de lancer).
  const { data: catalog } = useQuery(catalogQuery())
  const thumbFamilies = (catalog?.families ?? []).filter((f) => f.media === 'image' && f.tasks['text-to-image'])
  const thumbFamilyId = category.thumbnailFamily ?? 'local/z-image-turbo'
  const thumbFamily = thumbFamilies.find((f) => f.id === thumbFamilyId)
  const thumbIsApi = thumbFamily ? thumbFamily.runtime !== 'comfy' : false
  /** Lancement à confirmer : tout régénérer, ou des miniatures payantes (modèle API). */
  const [confirmGenerate, setConfirmGenerate] = useState<'missing' | 'all' | null>(null)
  const thumbQuote = useQuery({
    queryKey: ['thumbnail-quote', category.id, thumbFamilyId, confirmGenerate],
    queryFn: () => libraryApi.quoteThumbnails(category.id, confirmGenerate!).then((r) => r.quote),
    enabled: confirmGenerate !== null && thumbIsApi,
    retry: false,
  })
  const [template, setTemplate] = useState(category.thumbnailTemplate)
  const [phrase, setPhrase] = useState(category.phrase)
  const defaultTemplate = getZone(category.zone).thumbnailTemplate

  const update = useMutation({
    mutationFn: (body: Parameters<typeof libraryApi.updateCategory>[1]) => libraryApi.updateCategory(category.id, body),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: () => libraryApi.removeCategory(category.id),
    onSuccess: () => {
      setConfirmDelete(false)
      queryClient.invalidateQueries({ queryKey: qk.libraryCategories })
      onDeleted()
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const add = useMutation({
    mutationFn: () =>
      libraryApi.addOption(category.id, {
        fragment: draft.fragment,
        label: draft.label || null,
        gender: category.gendered ? draft.gender : null,
      }),
    onSuccess: () => {
      setDraft((d) => ({ ...d, label: '', fragment: '' }))
      onChanged()
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const importFile = useMutation({
    mutationFn: async ({ file, gender }: { file: File; gender: Gender | null }) =>
      libraryApi.importText(category.id, await file.text(), file.name, gender),
    onSuccess: ({ result }) => {
      onChanged()
      toast.success(
        `${result.added} option(s) ajoutée(s)` + (result.duplicates ? ` · ${result.duplicates} déjà présente(s)` : ''),
      )
    },
    onError: (e) => toast.error((e as Error).message),
  })

  // Vue : options visibles (sans les masquées), favorites, ou masquées.
  const [view, setView] = useState<'visible' | 'favorites' | 'hidden'>('visible')
  const counts = {
    visible: options.filter((o) => !o.hidden).length,
    favorites: options.filter((o) => o.favorite && !o.hidden).length,
    hidden: options.filter((o) => o.hidden).length,
  }
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return options
      .filter((o) => (view === 'hidden' ? o.hidden : !o.hidden && (view === 'visible' || o.favorite)))
      .filter((o) => !q || o.fragment.toLowerCase().includes(q) || o.label?.toLowerCase().includes(q))
  }, [options, search, view])
  const untranslated = options.filter((o) => !o.label).length

  // Sous-catégories : deux niveaux au plus.
  const parent = categories.find((c) => c.id === category.parentId) ?? null
  const children = categories.filter((c) => c.parentId === category.id)
  const parentChoices = categories.filter((c) => !c.parentId && c.id !== category.id && c.zone === category.zone)
  const addChild = useMutation({
    mutationFn: () => libraryApi.createCategory({ label: 'Nouvelle sous-catégorie', parentId: category.id }),
    onSuccess: ({ category: child }) => {
      queryClient.invalidateQueries({ queryKey: qk.libraryCategories })
      onOpen(child.id)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  // Sélection multiple : clic sur la case, Maj+clic pour une plage (dans l'ordre affiché).
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const canSplit = Boolean(SPLIT_RULES[category.zone]) && !category.parentId && options.length >= 10
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const toggleOption = (id: string, range: boolean) => {
    setSelection((prev) => {
      const next = new Set(prev)
      const from = anchor ? filtered.findIndex((o) => o.id === anchor) : -1
      const to = filtered.findIndex((o) => o.id === id)
      if (range && from >= 0 && to >= 0) {
        for (const o of filtered.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(o.id)
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setAnchor(id)
  }
  const clearSelection = () => {
    setSelection(new Set())
    setAnchor(null)
  }
  const afterBulk = () => {
    clearSelection()
    queryClient.invalidateQueries({ queryKey: qk.libraryCategories })
    queryClient.invalidateQueries({ queryKey: ['library', 'options'] })
    queryClient.invalidateQueries({ queryKey: ['library', 'thumbnails'] })
  }
  const flag = useMutation({
    mutationFn: (flags: { favorite?: boolean; hidden?: boolean }) => libraryApi.flagOptions([...selection], flags),
    onSuccess: (_, flags) => {
      clearSelection()
      onChanged()
      if (flags.hidden !== undefined) toast.success(flags.hidden ? 'Masquées : hors du sélecteur et des tirages' : 'Réaffichées')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const selectionAllFavorite = options.filter((o) => selection.has(o.id)).every((o) => o.favorite)
  const bulkDelete = useMutation({
    mutationFn: () => libraryApi.removeOptions([...selection]),
    onSuccess: ({ deleted }) => {
      setConfirmBulkDelete(false)
      afterBulk()
      toast.success(`${deleted} option(s) supprimée(s)`)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div className="space-y-5 px-6 py-5">
      {/* En-tête de la catégorie */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {editingTitle ? (
            <InlineEdit
              value={category.label}
              maxLength={60}
              onSubmit={(label) => {
                setEditingTitle(false)
                if (label.trim() && label !== category.label) update.mutate({ label })
              }}
              onCancel={() => setEditingTitle(false)}
              className="text-lg font-semibold"
            />
          ) : (
            <button onClick={() => setEditingTitle(true)} className="block text-left text-lg font-semibold hover:text-brand" title="Renommer">
              {category.label}
            </button>
          )}
          {parent && (
            <button onClick={() => onOpen(parent.id)} className="block text-xs text-muted-foreground hover:text-foreground">
              {parent.label} ›
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            <code className="text-foreground/70">__{category.key}__</code> · {options.length} option(s)
            {untranslated > 0 && ` · ${untranslated} sans libellé français`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {children.length === 0 && (
            <Select value={category.parentId ?? '__root'} onValueChange={(v) => update.mutate({ parentId: v === '__root' ? null : v })}>
              <SelectTrigger size="sm" className="w-48" title="Ranger dans une autre catégorie (sous-catégorie)">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__root">Catégorie principale</SelectItem>
                {parentChoices.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    Sous-catégorie de {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!category.parentId && (
            <Button variant="outline" size="sm" className="gap-1.5" disabled={addChild.isPending} onClick={() => addChild.mutate()}>
              <Plus className="h-3.5 w-3.5" /> Sous-catégorie
            </Button>
          )}
          {canSplit && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setSplitting(true)}
              title="Ranger les options en sous-catégories (robes, hauts, bas…) d'après leurs mots-clés"
            >
              <Wand2 className="h-3.5 w-3.5" /> Proposer un découpage
            </Button>
          )}
          <Select value={category.zone} disabled={Boolean(category.parentId)} onValueChange={(zone) => update.mutate({ zone: zone as LibraryZone })}>
            <SelectTrigger
              size="sm"
              className="w-44"
              title={category.parentId ? 'Une sous-catégorie suit la zone de sa catégorie' : 'Zone de la catégorie (et de ses sous-catégories)'}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIBRARY_ZONES.map((z) => (
                <SelectItem key={z.id} value={z.id}>
                  {z.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {getZone(category.zone).gender !== 'none' && (
            <label
              className="flex items-center gap-2 text-xs text-muted-foreground"
              title="Options réservées aux femmes ou aux hommes : miniatures dans la bonne version, proposées selon le genre du personnage."
            >
              <Switch checked={category.gendered} onCheckedChange={(gendered) => update.mutate({ gendered })} />
              Femme / homme
            </label>
          )}
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Supprimer
          </Button>
        </div>
      </div>

      {/* Miniatures */}
      {options.length > 0 && (
        <div className="space-y-2 rounded-xl border border-border/40 bg-card/50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-medium">Miniatures</span>
            <span className="text-muted-foreground tabular-nums">
              {ready} / {expected} prêtes
            </span>
            {pending.length > 0 ? (
              <>
                <span className="h-1 w-32 overflow-hidden rounded-full bg-secondary">
                  <span className="block h-full rounded-full bg-brand transition-[width]" style={{ width: `${(ready / expected) * 100}%` }} />
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {pending.length} en file{avgMs !== null && ` · reste ≈ ${formatDuration(avgMs * pending.length)}`}
                </span>
                <Button variant="ghost" size="sm" className="ml-auto h-7" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                  Annuler
                </Button>
              </>
            ) : (
              <div className="ml-auto flex items-center gap-2">
                {category.gendered && (
                  <div className="flex h-7 items-center rounded-md border border-input p-0.5 text-[11px]" title="Version affichée">
                    {(['female', 'male'] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setPreview(g)}
                        className={cn(
                          'h-full rounded px-2 transition-colors',
                          preview === g ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {GENDER_LABEL[g]}
                      </button>
                    ))}
                  </div>
                )}
                <Select
                  value={thumbFamilyId}
                  onValueChange={(v) => update.mutate({ thumbnailFamily: v === 'local/z-image-turbo' ? null : v })}
                >
                  <SelectTrigger size="sm" className="h-7 w-44 text-xs" title="Modèle qui génère les miniatures de cette catégorie">
                    <SelectValue placeholder="Modèle" />
                  </SelectTrigger>
                  <SelectContent>
                    {thumbFamilies.map((f) => (
                      <SelectItem key={f.id} value={f.id} disabled={!f.available}>
                        {f.label}
                        {f.runtime !== 'comfy' && ' · payant'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={() => setShowTemplate((v) => !v)}>
                  Gabarit
                </Button>
                {ready > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" disabled={generate.isPending} onClick={() => setConfirmGenerate('all')}>
                    Tout régénérer
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-7 gap-1.5"
                  disabled={generate.isPending || ready >= expected}
                  onClick={() => (thumbIsApi ? setConfirmGenerate('missing') : generate.mutate('missing'))}
                  title={
                    thumbIsApi
                      ? `Générées par ${thumbFamily?.label} (SpicyAPI, payant) : le coût s'affiche avant de lancer`
                      : "Générées en local par ComfyUI, l'une après l'autre, en basse résolution"
                  }
                >
                  {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {ready >= expected ? 'Miniatures à jour' : `Générer les ${expected - ready} miniatures manquantes`}
                </Button>
              </div>
            )}
          </div>
          {showTemplate && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="w-44 shrink-0">Tournure dans le prompt</span>
                <Input
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  placeholder="{option}  (ex. {option} hairstyle)"
                  className="h-7 font-mono text-[11px]"
                />
                <Button size="sm" className="h-7" disabled={phrase.trim() === category.phrase} onClick={() => update.mutate({ phrase: phrase.trim() })}>
                  Enregistrer
                </Button>
              </div>
              <p className="pb-1 text-[11px] text-muted-foreground">
                Comment l'option s'insère dans la phrase du prompt : avec <code>{'{option} hairstyle'}</code>, « bob » devient « a woman with bob
                hairstyle ». S'applique aussi aux miniatures. Vide : le fragment tel quel.
              </p>
              <span className="text-[11px] text-muted-foreground">Gabarit des miniatures</span>
              <Textarea
                rows={2}
                value={template || defaultTemplate}
                onChange={(e) => setTemplate(e.target.value)}
                className="font-mono text-[11px]"
              />
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="flex-1">
                  <code>{'{option}'}</code> : l'option, avec la tournure si elle en a une (« black » → « black skin ») ·{' '}
                  <code>{'{subject}'}</code> : une personne d'origine tirée au
                  hasard · <code>{'{person}'}</code> : une femme ou un homme, sans origine (couleur de peau, des yeux…) ·{' '}
                  <code>{'{femme: … | homme: …}'}</code> : un passage différent selon la version de la miniature (ex.{' '}
                  <code>{'{femme: wearing a crop top | homme: shirtless}'}</code>). S'applique aux prochaines miniatures.
                </span>
                {category.thumbnailTemplate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    onClick={() => {
                      setTemplate('')
                      update.mutate({ thumbnailTemplate: '' })
                    }}
                  >
                    Gabarit par défaut
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-7"
                  disabled={(template || defaultTemplate) === (category.thumbnailTemplate || defaultTemplate)}
                  onClick={() => update.mutate({ thumbnailTemplate: template.trim() === defaultTemplate ? '' : template.trim() })}
                >
                  Enregistrer
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ajout et import */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (draft.fragment.trim()) add.mutate()
          }}
        >
          <Input
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="Libellé (FR) : Coupe au bol"
            className="h-8 max-w-56 text-xs"
          />
          <Input
            value={draft.fragment}
            onChange={(e) => setDraft((d) => ({ ...d, fragment: e.target.value }))}
            placeholder="Fragment (EN) : a short bowl cut"
            className="h-8 min-w-0 flex-1 font-mono text-xs"
          />
          {category.gendered && <GenderSelect value={draft.gender} onChange={(gender) => setDraft((d) => ({ ...d, gender }))} />}
          <Button type="submit" size="sm" className="h-8 gap-1" disabled={!draft.fragment.trim() || add.isPending}>
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </Button>
        </form>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={importFile.isPending} onClick={() => fileRef.current?.click()}>
          {importFile.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
          Importer dans cette catégorie
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            // Catégorie non genrée (lieux, objets…) : import direct ; genrée : on demande à qui s'adressent les options.
            if (file) {
              if (category.gendered) setPendingFile(file)
              else importFile.mutate({ file, gender: null })
            }
            e.target.value = ''
          }}
        />
        <ImportGenderDialog
          file={pendingFile}
          onClose={() => setPendingFile(null)}
          onChoose={(gender) => {
            if (pendingFile) importFile.mutate({ file: pendingFile, gender })
            setPendingFile(null)
          }}
        />
      </div>

      {/* Recherche et sélection */}
      {options.length > 0 && (
        <div className="sticky top-0 z-10 -mx-6 flex flex-wrap items-center gap-2 bg-background/95 px-6 py-2 backdrop-blur">
          <div className="flex h-8 items-center rounded-md border border-input p-0.5 text-[11px]">
            {(
              [
                ['visible', 'Toutes'],
                ['favorites', '★ Favoris'],
                ['hidden', 'Masquées'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setView(v)
                  clearSelection()
                }}
                className={cn('h-full rounded px-2.5 tabular-nums transition-colors', view === v ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {label} · {counts[v]}
              </button>
            ))}
          </div>
          {options.length > 12 && (
            <div className="relative w-full max-w-sm">
              <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher… (ex. dress, jeans)" className="h-8 pl-8 text-xs" />
            </div>
          )}
          {selection.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium tabular-nums">{selection.size} sélectionnée(s)</span>
              {filtered.some((o) => !selection.has(o.id)) && (
                <Button variant="ghost" size="sm" className="h-7" onClick={() => setSelection(new Set([...selection, ...filtered.map((o) => o.id)]))}>
                  {search.trim() ? `+ les ${filtered.length} résultats` : `Tout sélectionner (${filtered.length})`}
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={clearSelection}>
                Désélectionner
              </Button>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5" disabled={flag.isPending} onClick={() => flag.mutate({ favorite: !selectionAllFavorite })}>
                <Star className={cn('h-3.5 w-3.5', !selectionAllFavorite && 'text-amber-400')} />
                {selectionAllFavorite ? 'Retirer des favoris' : 'Favoris'}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5" disabled={flag.isPending} onClick={() => flag.mutate({ hidden: view !== 'hidden' })}>
                {view === 'hidden' ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                {view === 'hidden' ? 'Réafficher' : 'Masquer'}
              </Button>
              <Button size="sm" className="h-7 gap-1.5" onClick={() => setMoving(true)}>
                <FolderInput className="h-3.5 w-3.5" /> Déplacer vers…
              </Button>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-muted-foreground hover:text-destructive" onClick={() => setConfirmBulkDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Supprimer
              </Button>
            </div>
          ) : (
            filtered.length > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setSelection(new Set(filtered.map((o) => o.id)))}>
                {search.trim() ? `Sélectionner les ${filtered.length} résultats` : 'Tout sélectionner'}
              </Button>
            )
          )}
        </div>
      )}

      {/* Options */}
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Aucune option. Ajoute-en une au-dessus, ou importe un fichier wildcard (une option par ligne).
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {search.trim()
            ? 'Aucun résultat.'
            : view === 'favorites'
              ? 'Aucun favori : ⭐ sur une carte (ou sur une sélection) pour garder tes options préférées sous la main.'
              : view === 'hidden'
                ? 'Aucune option masquée. Masquer retire une option du sélecteur et des tirages sans la supprimer.'
                : 'Toutes les options sont masquées.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {filtered.slice(0, limit).map((o) => (
              <OptionCard
                key={o.id}
                option={o}
                gendered={category.gendered}
                thumbnail={thumbByKey.get(`${o.id}:${shownGender(o)}`) ?? null}
                thumbnailGender={shownGender(o)}
                selected={selection.has(o.id)}
                selecting={selection.size > 0}
                onToggle={(range) => toggleOption(o.id, range)}
                onChanged={onChanged}
                onThumbnailQueued={refreshThumbnails}
              />
            ))}
          </div>
          {filtered.length > limit && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                Afficher plus ({filtered.length - limit} restantes)
              </Button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Supprimer « ${category.label} » ?`}
        description={
          `La catégorie et ses ${options.length} option(s) seront supprimées de la bibliothèque.` +
          (children.length ? ` Ses ${children.length} sous-catégorie(s) et leurs options sont conservées et remontent au premier niveau.` : '')
        }
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
      <ConfirmDialog
        open={confirmGenerate !== null}
        onOpenChange={(open) => !open && setConfirmGenerate(null)}
        title={confirmGenerate === 'all' ? `Régénérer les ${expected} miniatures ?` : `Générer les ${expected - ready} miniatures manquantes ?`}
        description={
          (confirmGenerate === 'all'
            ? `Les ${ready} miniatures existantes seront remplacées. Pour une seule miniature ratée, utilise plutôt « Régénérer » sur sa carte. `
            : '') +
          (!thumbIsApi
            ? `En local avec ${thumbFamily?.label ?? 'Z-Image'}, environ ${formatDuration((avgMs ?? 11_000) * (confirmGenerate === 'all' ? expected : expected - ready))}.`
            : thumbQuote.isLoading
              ? 'Calcul du coût…'
              : thumbQuote.data
                ? `Avec ${thumbFamily?.label} (SpicyAPI) : ${thumbQuote.data.count} miniature(s) ≈ ${formatUsd(thumbQuote.data.totalCost)} (${formatUsd(thumbQuote.data.unitCost)} chacune), facturées sur ton solde.`
                : `Coût indisponible : ${(thumbQuote.error as Error | null)?.message ?? 'erreur'}.`)
        }
        confirmLabel={confirmGenerate === 'all' ? 'Tout régénérer' : 'Générer'}
        pending={generate.isPending || (thumbIsApi && !thumbQuote.data)}
        onConfirm={() => {
          const mode = confirmGenerate!
          setConfirmGenerate(null)
          generate.mutate(mode)
        }}
      />
      <ConfirmDialog
        open={confirmBulkDelete}
        onOpenChange={setConfirmBulkDelete}
        title={`Supprimer ${selection.size} option(s) ?`}
        description="Elles et leurs miniatures sont retirées de la bibliothèque. Les images déjà générées ne changent pas."
        pending={bulkDelete.isPending}
        onConfirm={() => bulkDelete.mutate()}
      />
      {splitting && (
        <SplitDialog
          category={category}
          categories={categories}
          options={options}
          onClose={() => setSplitting(false)}
          onDone={() => {
            setSplitting(false)
            afterBulk()
          }}
        />
      )}
      <MoveDialog
        open={moving}
        category={category}
        categories={categories}
        optionIds={[...selection]}
        onClose={() => setMoving(false)}
        onMoved={(targetId) => {
          setMoving(false)
          afterBulk()
          if (targetId) onOpen(targetId)
        }}
      />
    </div>
  )
}

/**
 * Découpage automatique : sous-catégories proposées d'après les mots-clés des fragments, à valider.
 * Un groupe dont le nom existe déjà en sous-catégorie y est fusionné.
 */
function SplitDialog({
  category,
  categories,
  options,
  onClose,
  onDone,
}: {
  category: LibraryCategory
  categories: LibraryCategory[]
  options: LibraryOption[]
  onClose: () => void
  onDone: () => void
}) {
  const proposal = useMemo(() => suggestSplit(category.zone, options), [category.zone, options])
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options])
  const children = categories.filter((c) => c.parentId === category.id)
  const [groups, setGroups] = useState(() => proposal.groups.map((g) => ({ ...g, include: true })))
  const [expanded, setExpanded] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const included = groups.filter((g) => g.include && g.label.trim())
  const total = included.reduce((n, g) => n + g.optionIds.length, 0)
  const existingOf = (label: string) => children.find((c) => c.label.trim().toLowerCase() === label.trim().toLowerCase())

  const apply = useMutation({
    mutationFn: async () => {
      let moved = 0
      for (const g of included) {
        setProgress(g.label)
        const id = existingOf(g.label)?.id ?? (await libraryApi.createCategory({ label: g.label.trim(), parentId: category.id })).category.id
        moved += (await libraryApi.moveOptions(g.optionIds, id)).result.moved
      }
      return moved
    },
    onSuccess: (moved) => {
      toast.success(`${moved} option(s) rangée(s) en ${included.length} sous-catégorie(s)`)
      onDone()
    },
    onError: (e) => {
      setProgress(null)
      toast.error((e as Error).message)
    },
  })

  return (
    <Dialog open onOpenChange={(v) => !v && !apply.isPending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Découper « {category.label} »</DialogTitle>
          <DialogDescription>
            Proposition d'après les mots-clés anglais des fragments (« sweater dress » va dans Robes, « dress shirt » dans Hauts).
            Renomme ou décoche un groupe ; tu pourras corriger une option ensuite avec « Déplacer vers… ».
          </DialogDescription>
        </DialogHeader>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun mot-clé reconnu dans ces options.</p>
        ) : (
          <div className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
            {groups.map((g, i) => {
              const merge = existingOf(g.label)
              const isOpen = expanded === g.label
              const shown = isOpen ? g.optionIds : g.optionIds.slice(0, 5)
              return (
                <div key={i} className={cn('rounded-lg border border-border/40 px-3 py-2', !g.include && 'opacity-50')}>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={g.include}
                      onCheckedChange={(include) => setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, include } : x)))}
                    />
                    <Input
                      value={g.label}
                      onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                      className="h-7 max-w-52 text-xs"
                    />
                    <span className="text-xs text-muted-foreground tabular-nums">{g.optionIds.length}</span>
                    {merge && <span className="text-[11px] text-brand">fusion avec la sous-catégorie existante</span>}
                  </div>
                  <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {shown.map((id) => byId.get(id)?.fragment).join(' · ')}
                    {g.optionIds.length > 5 && (
                      <button className="ml-1.5 text-brand hover:underline" onClick={() => setExpanded(isOpen ? null : g.label)}>
                        {isOpen ? 'réduire' : `+ ${g.optionIds.length - 5}`}
                      </button>
                    )}
                  </p>
                </div>
              )
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {proposal.unmatched.length} option(s) sans mot-clé reconnu restent dans « {category.label} ».
        </p>
        <div className="flex items-center justify-end gap-2">
          {progress && apply.isPending && <span className="mr-auto text-xs text-muted-foreground">Rangement : {progress}…</span>}
          <Button variant="ghost" onClick={onClose} disabled={apply.isPending}>
            Annuler
          </Button>
          <Button disabled={!total || apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Ranger {total} option(s) en {included.length} sous-catégorie(s)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** « Déplacer vers… » : une catégorie existante, ou une nouvelle sous-catégorie créée à la volée. */
function MoveDialog({
  open,
  category,
  categories,
  optionIds,
  onClose,
  onMoved,
}: {
  open: boolean
  category: LibraryCategory
  categories: LibraryCategory[]
  optionIds: string[]
  onClose: () => void
  onMoved: (targetId: string | null) => void
}) {
  const root = categories.find((c) => c.id === (category.parentId ?? category.id)) ?? category
  const [name, setName] = useState('')
  const [follow, setFollow] = useState(false)
  useEffect(() => {
    if (open) setName('')
  }, [open])
  const move = useMutation({
    mutationFn: async (target: { id: string } | { label: string }) => {
      const id = 'id' in target ? target.id : (await libraryApi.createCategory({ label: target.label, parentId: root.id })).category.id
      return { id, ...(await libraryApi.moveOptions(optionIds, id)).result }
    },
    onSuccess: ({ id, moved, duplicates }) => {
      toast.success(`${moved} option(s) déplacée(s)` + (duplicates ? ` · ${duplicates} déjà présente(s), laissée(s) en place` : ''))
      onMoved(follow ? id : null)
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const targets = orderCategories(categories).filter((c) => c.id !== category.id)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Déplacer {optionIds.length} option(s)</DialogTitle>
          <DialogDescription>Leurs miniatures suivent. Une option déjà présente dans la destination reste ici.</DialogDescription>
        </DialogHeader>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) move.mutate({ label: name.trim() })
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`Nouvelle sous-catégorie de ${root.label}`} className="h-8 text-xs" />
          <Button type="submit" size="sm" className="h-8 shrink-0" disabled={!name.trim() || move.isPending}>
            {move.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Créer et déplacer'}
          </Button>
        </form>
        <div className="max-h-72 space-y-3 overflow-y-auto">
          {LIBRARY_ZONES.map((zone) => {
            const items = targets.filter((c) => c.zone === zone.id)
            if (!items.length) return null
            return (
              <div key={zone.id}>
                <div className="pb-1 text-[11px] font-bold tracking-wide text-zinc-300 uppercase">{zone.label}</div>
                {items.map((c) => (
                  <button
                    key={c.id}
                    disabled={move.isPending}
                    onClick={() => move.mutate({ id: c.id })}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                      c.depth === 1 && 'pl-6',
                    )}
                  >
                    {c.depth === 1 && <CornerDownRight className="h-3 w-3 shrink-0 opacity-50" />}
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    <span className="text-[11px] tabular-nums">{c.optionCount}</span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={follow} onCheckedChange={setFollow} />
          Ouvrir la destination après le déplacement
        </label>
      </DialogContent>
    </Dialog>
  )
}

function OptionCard({
  option,
  gendered,
  thumbnail,
  thumbnailGender,
  selected,
  selecting,
  onToggle,
  onChanged,
  onThumbnailQueued,
}: {
  option: LibraryOption
  gendered: boolean
  thumbnail: LibraryThumbnail | null
  thumbnailGender: ThumbnailGender
  selected: boolean
  /** Une sélection est en cours : un clic sur la carte sélectionne au lieu de modifier. */
  selecting: boolean
  onToggle: (range: boolean) => void
  onChanged: () => void
  onThumbnailQueued: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(option.label ?? '')
  const [fragment, setFragment] = useState(option.fragment)
  const [gender, setGender] = useState<Gender | null>(option.gender)

  const save = useMutation({
    mutationFn: () =>
      libraryApi.updateOption(option.id, { label: label.trim() || null, fragment: fragment.trim(), gender: gendered ? gender : null }),
    onSuccess: () => {
      setEditing(false)
      onChanged()
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: () => libraryApi.removeOption(option.id),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  })
  const regenerate = useMutation({
    mutationFn: () => libraryApi.regenerateThumbnail(option.id, thumbnailGender),
    onSuccess: onThumbnailQueued,
    onError: (e) => toast.error((e as Error).message),
  })
  const busy = thumbnail?.status === 'queued' || thumbnail?.status === 'running'
  const flag = useMutation({
    mutationFn: (flags: { favorite?: boolean; hidden?: boolean }) => libraryApi.updateOption(option.id, flags),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div
      className={cn(
        'group overflow-hidden rounded-xl border bg-card',
        selected ? 'border-brand ring-1 ring-brand' : 'border-border/40',
        option.hidden && !selected && 'opacity-60',
      )}
    >
      {/* Miniature (l'ancienne reste affichée pendant une régénération) */}
      <div className="relative flex aspect-[4/5] items-center justify-center bg-secondary/40">
        {thumbnail?.url ? (
          <img src={thumbnail.url} alt={option.label ?? option.fragment} loading="lazy" className={cn('h-full w-full object-cover', busy && 'opacity-40')} />
        ) : thumbnail?.status === 'failed' ? (
          <AlertTriangle className="h-5 w-5 text-destructive-foreground" />
        ) : !busy ? (
          <ImageIcon className="h-5 w-5 text-muted-foreground/50" />
        ) : null}
        {busy && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            {thumbnail.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : null}
            {thumbnail.status === 'running' ? 'En cours' : 'En file'}
          </span>
        )}
        {thumbnail?.status === 'failed' && (
          <span className="absolute inset-x-1.5 bottom-1.5 line-clamp-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white" title={thumbnail.error ?? undefined}>
            {thumbnail.error ?? 'Échec'}
          </span>
        )}
        {/* Sélection en cours : un clic n'importe où sur l'image sélectionne */}
        {selecting && <button className="absolute inset-0" onClick={(e) => onToggle(e.shiftKey)} aria-hidden tabIndex={-1} />}
        {/* Case de sélection (Maj+clic : toute la plage) */}
        <button
          onClick={(e) => onToggle(e.shiftKey)}
          className={cn(
            'absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-md border transition-opacity',
            selected ? 'border-brand bg-brand text-white' : 'border-white/70 bg-black/40 text-transparent hover:text-white/70',
            selected || selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          title="Sélectionner (Maj+clic : plage)"
          aria-label="Sélectionner"
        >
          <Check className="h-3 w-3" />
        </button>
        {gendered && option.gender && (
          <span
            className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 text-[10px] font-semibold text-white"
            title={`Option ${GENDER_LABEL[option.gender].toLowerCase()}`}
          >
            {option.gender === 'female' ? 'F' : 'H'}
          </span>
        )}
        {/* Favori : toujours visible quand il est actif */}
        {!selecting && (
          <button
            onClick={() => flag.mutate({ favorite: !option.favorite })}
            className={cn(
              'absolute right-1.5 bottom-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 transition-opacity',
              option.favorite ? 'text-amber-400 opacity-100' : 'text-white opacity-0 group-hover:opacity-100 hover:text-amber-300',
            )}
            title={option.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          >
            <Star className={cn('h-3 w-3', option.favorite && 'fill-current')} />
          </button>
        )}
        {option.hidden && (
          <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[11px] font-semibold text-white drop-shadow">Masquée</span>
        )}
        {!editing && !selecting && (
          <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => flag.mutate({ hidden: !option.hidden })}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              title={option.hidden ? 'Réafficher' : 'Masquer (hors du sélecteur et des tirages, sans supprimer)'}
            >
              {option.hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </button>
            <button
              onClick={() => regenerate.mutate()}
              disabled={busy || regenerate.isPending}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-40"
              title={thumbnail?.url ? 'Régénérer la miniature' : 'Générer la miniature'}
            >
              <RefreshCw className="h-3 w-3" />
            </button>
            <button
              onClick={() => setEditing(true)}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              title="Modifier"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={() => remove.mutate()}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-destructive"
              title="Supprimer"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <form
          className="space-y-1.5 p-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (fragment.trim()) save.mutate()
          }}
        >
          <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Libellé (FR)" className="h-7 text-xs" />
          {/* Sur plusieurs lignes : un fragment se lit en entier sans faire défiler. */}
          <Textarea
            value={fragment}
            onChange={(e) => setFragment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            placeholder="Fragment (EN)"
            rows={3}
            className="min-h-0 resize-none px-2 py-1 font-mono text-[11px] leading-snug"
          />
          {gendered && <GenderSelect value={gender} onChange={setGender} />}
          <div className="flex justify-end gap-1">
            <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(false)} aria-label="Annuler">
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button type="submit" size="icon" className="h-6 w-6" disabled={save.isPending} aria-label="Enregistrer">
              <Check className="h-3.5 w-3.5" />
            </Button>
          </div>
        </form>
      ) : (
        <button
          onClick={(e) => (selecting ? onToggle(e.shiftKey) : setEditing(true))}
          className="block w-full space-y-0.5 p-2 text-left"
          title={[option.label, option.fragment].filter(Boolean).join('\n')}
        >
          <span className="flex items-center gap-1.5 text-[13px] font-medium">
            <span className="truncate">{option.label ?? option.fragment}</span>
            {!option.label && <span className="shrink-0 rounded bg-secondary px-1 text-[9px] font-semibold text-muted-foreground">EN</span>}
          </span>
          <span className="line-clamp-2 font-mono text-[10px] text-muted-foreground">{option.fragment}</span>
        </button>
      )}
    </div>
  )
}
