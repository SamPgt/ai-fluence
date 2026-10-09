import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, FileUp, ImageIcon, Library, Loader2, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  LIBRARY_ZONES,
  getZone,
  type Gender,
  type LibraryCategory,
  type LibraryOption,
  type LibraryThumbnail,
  type LibraryZone,
  type ThumbnailGender,
} from '@ai-fluence/shared'

import { libraryApi } from '@/lib/api'
import { libraryCategoriesQuery, libraryOptionsQuery, libraryThumbnailsQuery, qk } from '@/lib/queries'
import { formatDuration } from '@/lib/format'
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
                const items = categories.filter((c) => c.zone === zone.id)
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
                              selected?.id === c.id
                                ? 'bg-accent text-foreground'
                                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                            )}
                          >
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
            <CategoryPanel key={selected.id} category={selected} onChanged={() => refresh(selected.id)} onDeleted={() => setSelectedId(null)} />
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
  onChanged,
  onDeleted,
}: {
  category: LibraryCategory
  onChanged: () => void
  onDeleted: () => void
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
  const expected = options.reduce((n, o) => n + (category.gendered && !o.gender ? 2 : 1), 0)
  const ready = thumbnails.filter((t) => t.status === 'ready' || (t.url && t.status !== 'failed')).length
  const pending = thumbnails.filter((t) => t.status === 'queued' || t.status === 'running')
  const durations = thumbnails.map((t) => t.durationMs).filter((d): d is number => d !== null)
  const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null
  const [showTemplate, setShowTemplate] = useState(false)
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.fragment.toLowerCase().includes(q) || o.label?.toLowerCase().includes(q))
  }, [options, search])
  const untranslated = options.filter((o) => !o.label).length

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
          <p className="text-xs text-muted-foreground">
            <code className="text-foreground/70">__{category.key}__</code> · {options.length} option(s)
            {untranslated > 0 && ` · ${untranslated} sans libellé français`}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={category.zone} onValueChange={(zone) => update.mutate({ zone: zone as LibraryZone })}>
            <SelectTrigger size="sm" className="w-44" title="Zone de la catégorie">
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
                <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={() => setShowTemplate((v) => !v)}>
                  Gabarit
                </Button>
                {ready > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" disabled={generate.isPending} onClick={() => generate.mutate('all')}>
                    Tout régénérer
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-7 gap-1.5"
                  disabled={generate.isPending || ready >= expected}
                  onClick={() => generate.mutate('missing')}
                  title="Générées en local par ComfyUI, l'une après l'autre, en basse résolution"
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
                hairstyle ». Vide : le fragment tel quel.
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
                  <code>{'{option}'}</code> : le fragment de l'option · <code>{'{subject}'}</code> : une personne tirée au hasard (version
                  femme / homme selon la miniature). S'applique aux prochaines miniatures.
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

      {/* Recherche */}
      {options.length > 12 && (
        <div className="relative max-w-sm">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" className="h-8 pl-8 text-xs" />
        </div>
      )}

      {/* Options */}
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Aucune option. Ajoute-en une au-dessus, ou importe un fichier wildcard (une option par ligne).
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
        description={`La catégorie et ses ${options.length} option(s) seront supprimées de la bibliothèque.`}
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}

function OptionCard({
  option,
  gendered,
  thumbnail,
  thumbnailGender,
  onChanged,
  onThumbnailQueued,
}: {
  option: LibraryOption
  gendered: boolean
  thumbnail: LibraryThumbnail | null
  thumbnailGender: ThumbnailGender
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

  return (
    <div className="group overflow-hidden rounded-xl border border-border/40 bg-card">
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
        {gendered && option.gender && (
          <span
            className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 text-[10px] font-semibold text-white"
            title={`Option ${GENDER_LABEL[option.gender].toLowerCase()}`}
          >
            {option.gender === 'female' ? 'F' : 'H'}
          </span>
        )}
        {!editing && (
          <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
          <Input value={fragment} onChange={(e) => setFragment(e.target.value)} placeholder="Fragment (EN)" className="h-7 font-mono text-[11px]" />
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
        <button onClick={() => setEditing(true)} className="block w-full space-y-0.5 p-2 text-left" title={option.source ? `Importé de ${option.source}` : undefined}>
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
