import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  Loader2,
  Plus,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  CONTEXT_BLOCK_MAX,
  MODEL_FAMILIES,
  getFamily,
  type Asset,
  type MediaKind,
  type Persona,
  type PersonaContextBlock,
  type PersonaLora,
} from '@ai-fluence/shared'

import { assetsApi, personasApi, trashApi } from '@/lib/api'
import { catalogQuery, personasQuery, qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { useUiPref } from '@/components/providers/ui-prefs'
import { PageHeader } from '@/components/layout/PageHeader'
import { PERSONA_COLORS } from '@/components/personas/NewPersonaDialog'
import { PersonaAvatar } from '@/components/personas/PersonaAvatar'
import { AssetThumb } from '@/components/composer/ReferencePicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ModelBadge } from '@/components/ui/model-badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ShortcutsTab } from '@/components/settings/ShortcutsTab'
import { MediaViewer } from '@/components/thread/MediaViewer'
import { CivitaiBrowser } from '@/components/lora/CivitaiBrowser'
import { CheckMark } from '@/components/ui/check-mark'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  baseLabel,
  rowsFor,
  toPersonaLoras,
  toUnits,
  type LoraUnit,
} from '@/lib/lora-groups'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const PERSONA_TABS = ['general', 'lora', 'shortcuts'] as const
type PersonaTab = (typeof PERSONA_TABS)[number]

export const Route = createFileRoute('/_app/personas/$personaId')({
  // Onglet optionnel dans l'URL : « Général » par défaut.
  validateSearch: (search: Record<string, unknown>): { tab?: PersonaTab } => ({
    tab: PERSONA_TABS.includes(search.tab as PersonaTab)
      ? (search.tab as PersonaTab)
      : undefined,
  }),
  component: PersonaPage,
})

const LORA_FAMILIES = MODEL_FAMILIES.filter((f) => f.badges.includes('LORA'))
/** Limite du backend (personas.route). */
const MAX_LORAS = 12
/** Limite du backend (personas.route) : blocs de contexte par persona. */
const CONTEXT_BLOCKS_MAX = 10

function Card({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-card/50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Corps envoyé au serveur (les blocs et LoRA vides ne sont pas conservés). */
function toPayload(p: Persona) {
  return {
    name: p.name,
    color: p.color,
    avatarAssetId: p.avatarAssetId,
    contextBlocks: p.contextBlocks.filter(
      (b) => b.title.trim() || b.text.trim(),
    ),
    loras: p.loras.filter((l) => l.path.trim()),
    defaultImageFamily: p.defaultImageFamily,
    defaultVideoFamily: p.defaultVideoFamily,
  }
}

function PersonaPage() {
  const { personaId } = Route.useParams()
  const { data: personas, isLoading } = useQuery(personasQuery())
  const persona = personas?.find((p) => p.id === personaId)
  if (isLoading) return null
  if (!persona)
    return (
      <p className="p-10 text-center text-sm text-muted-foreground">
        Persona introuvable.
      </p>
    )
  return <PersonaEditor key={persona.id} persona={persona} />
}

function PersonaEditor({ persona }: { persona: Persona }) {
  const navigate = useNavigate()
  const { tab = 'general' } = Route.useSearch()
  const queryClient = useQueryClient()
  const [, setSelected] = useUiPref('personaId')
  // Le premier bloc de contexte est toujours présent : il invite à décrire le persona.
  const base = withFirstBlock(persona)
  const [draft, setDraft] = useState<Persona>(base)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  // Bloc tout juste ajouté : son titre prend le focus.
  const [addedBlockId, setAddedBlockId] = useState<string | null>(null)
  const avatarRef = useRef<HTMLInputElement>(null)
  const set = <K extends keyof Persona>(key: K, value: Persona[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  // Sauvegarde automatique : chaque modification part au serveur après une courte pause.
  const lastSaved = useRef(JSON.stringify(toPayload(base)))
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const save = useMutation({
    mutationFn: (body: string) =>
      personasApi.update(persona.id, JSON.parse(body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.personas }),
    onError: (e) => toast.error((e as Error).message),
  })

  // L'indicateur « Sauvegarde » reste visible au moins 500 ms, sinon il passe inaperçu.
  const [showSaving, setShowSaving] = useState(false)
  const savingSince = useRef(0)
  useEffect(() => {
    if (save.isPending) {
      savingSince.current = Date.now()
      setShowSaving(true)
      return
    }
    const t = setTimeout(
      () => setShowSaving(false),
      Math.max(0, 500 - (Date.now() - savingSince.current)),
    )
    return () => clearTimeout(t)
  }, [save.isPending])

  const flush = (leaving = false) => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current)
    pendingTimer.current = null
    const d = draftRef.current
    const body = JSON.stringify(toPayload(d))
    if (body === lastSaved.current || !d.name.trim()) return
    lastSaved.current = body
    if (!leaving) return save.mutate(body)
    personasApi
      .update(persona.id, JSON.parse(body))
      .then(() => queryClient.invalidateQueries({ queryKey: qk.personas }))
      .catch((e) => toast.error((e as Error).message))
  }

  useEffect(() => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current)
    pendingTimer.current = setTimeout(() => flush(), 600)
  }, [draft])

  // En quittant la page, on n'abandonne pas la dernière frappe.
  useEffect(() => () => flush(true), [])

  // Données modifiées ailleurs : on les reprend seulement si rien n'est en attente ici.
  useEffect(() => {
    const incoming = withFirstBlock(persona)
    const body = JSON.stringify(toPayload(incoming))
    if (body === lastSaved.current) return
    if (JSON.stringify(toPayload(draftRef.current)) !== lastSaved.current)
      return
    lastSaved.current = body
    setDraft(incoming)
  }, [persona])

  const remove = useMutation({
    mutationFn: () => personasApi.remove(persona.id),
    onSuccess: () => {
      const refresh = () => {
        queryClient.invalidateQueries({ queryKey: qk.personas })
        queryClient.invalidateQueries({ queryKey: qk.threadsAll })
        queryClient.invalidateQueries({ queryKey: qk.trash })
      }
      setSelected('')
      refresh()
      navigate({ to: '/' })
      toast.success(`${persona.name} mis à la corbeille`, {
        description: 'Avec ses fils et ses médias.',
        action: {
          label: 'Annuler',
          onClick: () =>
            trashApi.restorePersona(persona.id).then(() => {
              refresh()
              setSelected(persona.id)
            }),
        },
      })
    },
  })

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return
    try {
      const { asset } = await assetsApi.upload(file, { personaId: persona.id })
      setDraft((d) => ({ ...d, avatarAssetId: asset.id, avatarUrl: asset.url }))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const updateLora = (id: string, patch: Partial<PersonaLora>) =>
    set(
      'loras',
      draft.loras.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    )
  const updateBlock = (id: string, patch: Partial<PersonaContextBlock>) =>
    set(
      'contextBlocks',
      draft.contextBlocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    )

  return (
    <>
      <PageHeader
        right={
          <span className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
            {showSaving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Sauvegarde
              </>
            ) : save.isError ? (
              <span className="text-destructive">Non sauvegardé</span>
            ) : (
              <>
                <Check className="h-3 w-3" />
                Enregistré
              </>
            )}
          </span>
        }
      >
        <PersonaAvatar persona={draft} size={24} className="rounded-md" />
        <span className="truncate text-sm font-medium">
          Paramétrage de {persona.name}
        </span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[810px] space-y-5 px-6 py-6">
          <Card title="Identité">
            <div className="flex items-start gap-5">
              {/* Avatar : clic pour changer ; au survol, une croix en haut à droite retire la photo. */}
              <div className="group relative shrink-0">
                <button
                  type="button"
                  onClick={() => avatarRef.current?.click()}
                  className="relative block overflow-hidden rounded-2xl"
                  aria-label="Changer l’avatar"
                >
                  <PersonaAvatar persona={draft} size={88} />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
                    <Camera className="h-5 w-5 text-white" />
                  </span>
                </button>
                {draft.avatarUrl && (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        avatarAssetId: null,
                        avatarUrl: null,
                      }))
                    }
                    className="absolute top-1 right-1 hidden h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black group-hover:flex"
                    aria-label="Retirer la photo"
                    title="Retirer la photo"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <input
                ref={avatarRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => uploadAvatar(e.target.files?.[0])}
              />
              <div className="flex-1 space-y-3">
                <div className="space-y-1.5">
                  <Label>Nom</Label>
                  <Input
                    value={draft.name}
                    onChange={(e) => set('name', e.target.value)}
                    maxLength={40}
                  />
                </div>
                {/* Couleur de fond des initiales : seulement sans photo. */}
                {!draft.avatarUrl && (
                  <div className="flex gap-1.5">
                    {PERSONA_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => set('color', c)}
                        style={{ backgroundColor: c }}
                        className={cn(
                          'h-6 w-6 rounded-full ring-offset-2 ring-offset-background',
                          draft.color === c && 'ring-2 ring-white',
                        )}
                        aria-label={`Couleur ${c}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Tabs
            value={tab}
            onValueChange={(v) =>
              navigate({
                to: '/personas/$personaId',
                params: { personaId: persona.id },
                search: { tab: v as PersonaTab },
              })
            }
            className="gap-5"
          >
            <TabsList className="w-full justify-start">
              <TabsTrigger value="general">Général</TabsTrigger>
              <TabsTrigger value="lora">LoRA</TabsTrigger>
              <TabsTrigger value="shortcuts">Raccourcis</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-5">
              <Card
                title="Contexte du persona"
                description="Contexte inséré dans le prompt à chaque génération de ce persona."
              >
                <div className="space-y-3">
                  {draft.contextBlocks.map((b, i) => (
                    <ContextBlockEditor
                      key={b.id}
                      block={b}
                      onChange={(patch) => updateBlock(b.id, patch)}
                      onRemove={
                        // Le premier bloc ne se supprime pas : il invite à décrire le persona.
                        i > 0
                          ? () =>
                              set(
                                'contextBlocks',
                                draft.contextBlocks.filter(
                                  (x) => x.id !== b.id,
                                ),
                              )
                          : undefined
                      }
                      autoFocus={b.id === addedBlockId}
                    />
                  ))}
                  {/* Sous le dernier bloc : on ajoute là où on lit. */}
                  {draft.contextBlocks.length < CONTEXT_BLOCKS_MAX && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const id = crypto.randomUUID()
                        setAddedBlockId(id)
                        set('contextBlocks', [
                          ...draft.contextBlocks,
                          { id, title: '', text: '' },
                        ])
                      }}
                    >
                      <Plus className="h-4 w-4" /> Ajouter un bloc
                    </Button>
                  )}
                </div>
              </Card>

              <References persona={persona} />

              <Card
                title="Modèles par défaut"
                description="Sélectionnés automatiquement dans le composer pour ce persona."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <DefaultFamily
                    media="image"
                    value={draft.defaultImageFamily}
                    onChange={(v) => set('defaultImageFamily', v)}
                  />
                  <DefaultFamily
                    media="video"
                    value={draft.defaultVideoFamily}
                    onChange={(v) => set('defaultVideoFamily', v)}
                  />
                </div>
              </Card>

              <div className="flex justify-end pb-6">
                <Button
                  variant="ghost"
                  className="text-red-500 hover:text-red-400"
                  onClick={() => setConfirmRemove(true)}
                >
                  <Trash2 className="h-4 w-4" /> Supprimer le persona
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="lora">
              <Card
                title="LoRA"
                description="Choisis une LoRA dans la bibliothèque communautaire, ou colle un lien direct vers un .safetensors. Une LoRA ne fonctionne que sur le modèle pour lequel elle a été entraînée. 3 LoRA maximum par génération."
                action={
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="Ajouter une LoRA par lien"
                      title="Ajouter une LoRA par lien"
                      disabled={draft.loras.length >= MAX_LORAS}
                      onClick={() =>
                        set('loras', [
                          ...draft.loras,
                          {
                            id: crypto.randomUUID(),
                            label: '',
                            path: '',
                            scale: 1,
                            family: LORA_FAMILIES[0].id,
                            triggerWords: [],
                          },
                        ])
                      }
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLibraryOpen(true)}
                    >
                      <Globe className="h-4 w-4" /> Bibliothèque
                    </Button>
                  </div>
                }
              >
                <div className="space-y-3">
                  {toUnits(draft.loras).map((u) =>
                    u.kind === 'single' ? (
                      <LoraEditor
                        key={u.lora.id}
                        lora={u.lora}
                        onChange={(patch) => updateLora(u.lora.id, patch)}
                        onRemove={() =>
                          set(
                            'loras',
                            draft.loras.filter((x) => x.id !== u.lora.id),
                          )
                        }
                      />
                    ) : (
                      <LoraGroupEditor
                        key={u.key}
                        unit={u}
                        remaining={MAX_LORAS - draft.loras.length}
                        onChange={(rows) =>
                          setDraft((d) => ({
                            ...d,
                            loras: replaceGroup(d.loras, u.key, rows),
                          }))
                        }
                      />
                    ),
                  )}
                  {draft.loras.length === 0 && (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      Aucune LoRA pour ce persona.
                    </p>
                  )}
                </div>
              </Card>
            </TabsContent>

            <CivitaiBrowser
              open={libraryOpen}
              onOpenChange={setLibraryOpen}
              addedPaths={new Set(draft.loras.map((l) => l.path))}
              remaining={MAX_LORAS - draft.loras.length}
              onAdd={(item) => {
                // Tous les modèles disponibles par défaut ; on décoche ensuite dans la ligne.
                setDraft((d) => ({
                  ...d,
                  loras: [
                    ...d.loras,
                    ...toPersonaLoras(item, MAX_LORAS - d.loras.length),
                  ],
                }))
                toast.success(`${item.name} ajoutée`)
              }}
              onRemove={(item) => {
                const urls = new Set(
                  item.variants.flatMap((v) => v.files.map((f) => f.url)),
                )
                setDraft((d) => ({
                  ...d,
                  loras: d.loras.filter((l) => !urls.has(l.path)),
                }))
              }}
            />

            <TabsContent value="shortcuts">
              <ShortcutsTab personaId={persona.id} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Mettre ${persona.name} à la corbeille ?`}
        description="Il est conservé dans la corbeille pendant 7 jours. Ensuite, il est supprimé définitivement."
        confirmLabel="Mettre à la corbeille"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}

/**
 * Bloc de contexte : en lecture une fois rempli (texte replié, « Voir plus »),
 * en édition pour un bloc vide ou après un clic sur le crayon. Le champ texte
 * grandit tout seul : ni barre de défilement, ni poignée de redimensionnement.
 */
function ContextBlockEditor({
  block: b,
  onChange,
  onRemove,
  autoFocus = false,
}: {
  block: PersonaContextBlock
  onChange: (patch: Partial<PersonaContextBlock>) => void
  onRemove?: () => void
  autoFocus?: boolean
}) {
  const [editing, setEditing] = useState(!b.text.trim())
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const readRef = useRef<HTMLParagraphElement>(null)

  // Hauteur du champ ajustée au texte.
  useLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [b.text, editing])

  // « Voir plus » seulement si le texte replié est vraiment coupé.
  useLayoutEffect(() => {
    const el = readRef.current
    if (!el || editing) return
    const check = () =>
      setOverflows(el.scrollHeight > el.clientHeight + 1 || expanded)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [b.text, editing, expanded])

  const startEditing = () => {
    setEditing(true)
    requestAnimationFrame(() => {
      const el = textRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }

  const iconButton =
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition focus-visible:opacity-100 group-hover/block:opacity-100 group-focus-within/block:opacity-100'

  return (
    <div
      className="group/block rounded-lg border border-transparent bg-background/60 transition-colors focus-within:border-ring/50"
      // En quittant le bloc, un texte rempli repasse en lecture.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget) && b.text.trim()) {
          setEditing(false)
          setExpanded(false)
        }
      }}
    >
      <div className="flex items-center gap-0.5 pr-1.5">
        {editing ? (
          <input
            placeholder="Titre (ex. Apparence, Personnalité, DA…)"
            value={b.title}
            onChange={(e) => onChange({ title: e.target.value })}
            maxLength={60}
            autoFocus={autoFocus}
            aria-label="Titre du bloc"
            className="h-10 min-w-0 flex-1 rounded-tl-lg bg-transparent pl-3 text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
          />
        ) : (
          <span className="flex h-10 min-w-0 flex-1 items-center truncate pl-3 text-sm font-medium">
            {b.title || (
              <span className="font-normal text-muted-foreground">
                Sans titre
              </span>
            )}
          </span>
        )}
        {!editing && (
          <button
            type="button"
            onClick={startEditing}
            aria-label="Modifier le bloc"
            title="Modifier"
            className={cn(iconButton, 'hover:bg-accent hover:text-foreground')}
          >
            <SquarePen className="h-3.5 w-3.5" />
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Supprimer le bloc"
            title="Supprimer le bloc"
            className={cn(iconButton, 'hover:bg-red-500/10 hover:text-red-400')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="mx-3 h-px bg-border/60" />
      {editing ? (
        <textarea
          ref={textRef}
          rows={3}
          placeholder="Description du bloc…"
          value={b.text}
          onChange={(e) => onChange({ text: e.target.value })}
          maxLength={CONTEXT_BLOCK_MAX}
          aria-label="Texte du bloc"
          className="block min-h-[76px] w-full resize-none overflow-hidden bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
        />
      ) : (
        // Marges sur le conteneur : le texte replié est coupé net, sans ligne qui dépasse.
        <div className="px-3 py-2.5">
          <p
            ref={readRef}
            className={cn(
              'text-sm leading-relaxed whitespace-pre-wrap text-foreground/90',
              !expanded && 'line-clamp-2',
            )}
          >
            {b.text}
          </p>
        </div>
      )}
      <div className="flex h-8 items-center justify-between px-3 pb-1.5">
        {!editing && overflows ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="-ml-1 inline-flex items-center gap-1 rounded px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? (
              <>
                Réduire <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                Voir plus <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        ) : (
          <span />
        )}
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {b.text.length} / {CONTEXT_BLOCK_MAX}
        </span>
      </div>
    </div>
  )
}

function withFirstBlock(p: Persona): Persona {
  if (p.contextBlocks.length) return p
  return {
    ...p,
    contextBlocks: [{ id: 'first-block', title: '', text: '' }],
  }
}

function LoraEditor({
  lora: l,
  onChange,
  onRemove,
}: {
  lora: PersonaLora
  onChange: (patch: Partial<PersonaLora>) => void
  onRemove: () => void
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-border/60 p-3">
      {l.previewUrl && (
        <img
          src={l.previewUrl}
          alt=""
          draggable={false}
          className="h-[124px] w-[93px] shrink-0 rounded-md object-cover"
        />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex gap-2">
          <Input
            placeholder="Nom"
            value={l.label}
            onChange={(e) => onChange({ label: e.target.value })}
            className="w-40"
          />
          <Input
            placeholder="https://huggingface.co/…/resolve/main/lora.safetensors"
            value={l.path}
            onChange={(e) => onChange({ path: e.target.value })}
            className="flex-1 font-mono text-xs"
          />
          {l.sourceUrl && (
            <Button variant="ghost" size="icon" asChild>
              <a
                href={l.sourceUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Voir sur Civitai"
                title="Voir sur Civitai"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label="Retirer"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <TriggerWordsEditor
          words={l.triggerWords}
          hidden={l.hiddenWords ?? []}
          onChange={(triggerWords, hiddenWords) =>
            onChange({ triggerWords, hiddenWords })
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={l.family}
            onValueChange={(v) => onChange({ family: v })}
          >
            <SelectTrigger size="sm" className="w-[258px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LORA_FAMILIES.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label} · {f.media === 'video' ? 'vidéo' : 'photo'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Force
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={l.scale}
              onChange={(e) => onChange({ scale: Number(e.target.value) })}
              className="w-28 accent-brand"
            />
            <span className="w-8 tabular-nums">{l.scale.toFixed(2)}</span>
          </label>
          {l.family === 'alibaba/wan-2.2-lora' && (
            <Select
              value={l.noise ?? 'both'}
              onValueChange={(v) =>
                onChange({ noise: v as PersonaLora['noise'] })
              }
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Passes HIGH + LOW</SelectItem>
                <SelectItem value="high">HIGH noise</SelectItem>
                <SelectItem value="low">LOW noise</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Mots déclencheurs d'une LoRA : une case par mot. Un mot décoché reste connu
 * mais n'est jamais proposé dans le composer (ex. un mot NSFW).
 */
function TriggerWordsEditor({
  words,
  hidden,
  onChange,
}: {
  words: string[]
  hidden: string[]
  onChange: (words: string[], hidden: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const fresh = draft
      .split(',')
      .map((w) => w.trim())
      .filter((w) => w && !words.includes(w))
    if (fresh.length) onChange([...new Set([...words, ...fresh])], hidden)
    setDraft('')
  }

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-muted-foreground">
        Mots déclencheurs · décoche ceux à ne jamais proposer
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {words.map((w) => {
          const on = !hidden.includes(w)
          return (
            <span
              key={w}
              className={cn(
                'group/word flex h-7 items-center gap-1.5 rounded-[5px] border pr-1 pl-2 font-mono text-[12px] transition-colors',
                on
                  ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
                  : 'border-border/50 text-muted-foreground line-through',
              )}
            >
              <button
                type="button"
                onClick={() =>
                  onChange(
                    words,
                    on ? [...hidden, w] : hidden.filter((x) => x !== w),
                  )
                }
                aria-pressed={on}
                aria-label={on ? `Ne plus proposer ${w}` : `Proposer ${w}`}
                className="flex items-center gap-1.5"
              >
                <CheckMark checked={on} tone="lora" className="h-3.5 w-3.5" />
                {w}
              </button>
              <button
                type="button"
                onClick={() =>
                  onChange(
                    words.filter((x) => x !== w),
                    hidden.filter((x) => x !== w),
                  )
                }
                aria-label={`Supprimer ${w}`}
                className="grid h-4 w-4 place-items-center rounded-[3px] opacity-0 transition group-hover/word:opacity-100 hover:bg-accent focus-visible:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )
        })}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add()
            }
          }}
          onBlur={add}
          placeholder={
            words.length ? 'Ajouter…' : 'Ajouter un mot (ex. ohwx woman)'
          }
          aria-label="Ajouter un mot déclencheur"
          className="h-7 min-w-28 flex-1 rounded-[5px] bg-transparent px-1.5 text-[12px] outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  )
}

/** Remplace les lignes d'un groupe, à la place du groupe dans la liste. */
function replaceGroup(
  loras: PersonaLora[],
  key: string,
  rows: PersonaLora[],
): PersonaLora[] {
  const at = loras.findIndex((l) => l.group?.key === key)
  const rest = loras.filter((l) => l.group?.key !== key)
  return [...rest.slice(0, at), ...rows, ...rest.slice(at)]
}

const familyText = (id: string) => {
  const f = getFamily(id)
  return f ? `${f.label} · ${f.media === 'video' ? 'vidéo' : 'photo'}` : id
}

/**
 * LoRA Civitai disponible pour plusieurs modèles : une seule ligne, et un menu à
 * cases à cocher limité aux modèles pour lesquels elle existe (un fichier chacun).
 */
function LoraGroupEditor({
  unit,
  remaining,
  onChange,
}: {
  unit: Extract<LoraUnit, { kind: 'group' }>
  remaining: number
  onChange: (rows: PersonaLora[]) => void
}) {
  const first = unit.rows[0]
  const checked = new Set(unit.rows.map((r) => r.family))
  const words = [...new Set(unit.rows.flatMap((r) => r.triggerWords))]
  const hidden = [...new Set(unit.rows.flatMap((r) => r.hiddenWords ?? []))]
  const label = baseLabel(first)
  const shared = {
    label,
    scale: first.scale,
    previewUrl: first.previewUrl,
    sourceUrl: first.sourceUrl,
    group: unit.group,
  }

  // Réglage commun : appliqué à toutes les lignes du groupe.
  const patchAll = (patch: Partial<PersonaLora>) =>
    onChange(unit.rows.map((r) => ({ ...r, ...patch })))

  const toggle = (family: string) => {
    if (checked.has(family)) {
      if (checked.size === 1) return // au moins un modèle
      onChange(unit.rows.filter((r) => r.family !== family))
    } else {
      const a = unit.group.available.find((x) => x.family === family)
      if (a) onChange([...unit.rows, ...rowsFor(shared, a)])
    }
  }

  return (
    <div className="flex gap-3 rounded-lg border border-border/60 p-3">
      {first.previewUrl && (
        <img
          src={first.previewUrl}
          alt=""
          draggable={false}
          className="h-[124px] w-[93px] shrink-0 rounded-md object-cover"
        />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex gap-2">
          <Input
            placeholder="Nom"
            value={label}
            onChange={(e) =>
              onChange(
                unit.rows.map((r) => ({
                  ...r,
                  label: (r.noise
                    ? `${e.target.value} · ${r.noise.toUpperCase()}`
                    : e.target.value
                  ).slice(0, 60),
                })),
              )
            }
            className="flex-1"
          />
          {first.sourceUrl && (
            <Button variant="ghost" size="icon" asChild>
              <a
                href={first.sourceUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Voir sur Civitai"
                title="Voir sur Civitai"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange([])}
            aria-label="Retirer"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <TriggerWordsEditor
          words={words}
          hidden={hidden}
          onChange={(next, nextHidden) => {
            const added = next.filter((w) => !words.includes(w))
            // Chaque modèle garde ses propres mots ; un mot ajouté vaut pour tous.
            onChange(
              unit.rows.map((r) => {
                const own = [
                  ...r.triggerWords.filter((w) => next.includes(w)),
                  ...added,
                ]
                return {
                  ...r,
                  triggerWords: own,
                  hiddenWords: nextHidden.filter((w) => own.includes(w)),
                }
              }),
            )
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-8 w-[258px] items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors hover:bg-accent/50"
              >
                <span className="truncate">
                  {checked.size === 1
                    ? familyText([...checked][0])
                    : `${checked.size} modèles`}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[258px] p-1">
              {unit.group.available.map((a) => {
                const on = checked.has(a.family)
                const blocked =
                  (on && checked.size === 1) ||
                  (!on && a.files.length > remaining)
                return (
                  <button
                    key={a.family}
                    type="button"
                    disabled={blocked}
                    onClick={() => toggle(a.family)}
                    title={
                      on && checked.size === 1
                        ? 'Au moins un modèle'
                        : !on && blocked
                          ? 'Le persona a déjà 12 LoRA.'
                          : undefined
                    }
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <CheckMark checked={on} />
                    <span className="truncate">{familyText(a.family)}</span>
                  </button>
                )
              })}
            </PopoverContent>
          </Popover>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Force
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={first.scale}
              onChange={(e) => patchAll({ scale: Number(e.target.value) })}
              className="w-28 accent-brand"
            />
            <span className="w-8 tabular-nums">{first.scale.toFixed(2)}</span>
          </label>
        </div>
      </div>
    </div>
  )
}

function DefaultFamily({
  media,
  value,
  onChange,
}: {
  media: MediaKind
  value: string | null
  onChange: (v: string | null) => void
}) {
  const { data: catalog } = useQuery(catalogQuery())
  const families =
    catalog?.families.filter((f) => f.media === media) ??
    MODEL_FAMILIES.filter((f) => f.media === media)
  return (
    <div className="space-y-1.5">
      <Label>{media === 'image' ? 'Photo' : 'Vidéo'}</Label>
      <Select
        value={value ?? '__none'}
        onValueChange={(v) => onChange(v === '__none' ? null : v)}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">Comme les paramètres généraux</SelectItem>
          {families.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              <span className="flex items-center gap-2">
                {f.label}
                {f.badges.map((b) => (
                  <ModelBadge key={b} badge={b} />
                ))}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function SortableReference({
  asset,
  onOpen,
  onRemove,
}: {
  asset: Asset
  onOpen: () => void
  onRemove: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: asset.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group relative aspect-square touch-none overflow-hidden rounded-lg',
        isDragging && 'z-10 opacity-80 shadow-lg',
      )}
      {...attributes}
      {...listeners}
      // Un clic (sans glisser) ouvre l'image en grand.
      onClick={onOpen}
    >
      <AssetThumb asset={asset} className="pointer-events-none h-full w-full" />
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        // La croix ne doit pas déclencher le glisser.
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
        aria-label="Retirer de la bibliothèque"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

function References({ persona }: { persona: Persona }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  // Index de la référence ouverte en grand (visionneuse).
  const [viewing, setViewing] = useState<number | null>(null)
  const { data: refs = [] } = useQuery({
    queryKey: qk.references(persona.id),
    queryFn: () => assetsApi.references(persona.id).then((r) => r.assets),
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.references(persona.id) })
    queryClient.invalidateQueries({ queryKey: qk.personas })
  }
  const unref = useMutation({
    mutationFn: (assetId: string) =>
      assetsApi.setReference(assetId, persona.id, false),
    onSuccess: refresh,
  })

  // Glisser-déposer : 5 px avant de démarrer, pour garder le clic sur la croix.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const next = arrayMove(
      refs,
      refs.findIndex((a) => a.id === active.id),
      refs.findIndex((a) => a.id === over.id),
    )
    queryClient.setQueryData(qk.references(persona.id), next)
    assetsApi
      .reorderReferences(
        persona.id,
        next.map((a) => a.id),
      )
      .catch(() =>
        queryClient.invalidateQueries({ queryKey: qk.references(persona.id) }),
      )
  }

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files))
        await assetsApi.upload(f, { personaId: persona.id, isReference: true })
      refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Card
      title="Bibliothèque de références"
      description="Photos du personnage ou de la DA ajoutables lors de l'écriture des prompts."
    >
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={refs.map((a) => a.id)}
            strategy={rectSortingStrategy}
          >
            {refs.map((a, i) => (
              <SortableReference
                key={a.id}
                asset={a}
                onOpen={() => setViewing(i)}
                onRemove={() => unref.mutate(a.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-5 w-5" />
          )}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <MediaViewer
        asset={viewing === null ? null : (refs[viewing] ?? null)}
        onClose={() => setViewing(null)}
        onPrev={
          viewing !== null && viewing > 0
            ? () => setViewing(viewing - 1)
            : undefined
        }
        onNext={
          viewing !== null && viewing < refs.length - 1
            ? () => setViewing(viewing + 1)
            : undefined
        }
      />
    </Card>
  )
}
