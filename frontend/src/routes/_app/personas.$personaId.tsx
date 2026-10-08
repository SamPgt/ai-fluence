import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Camera,
  ExternalLink,
  Globe,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  CONTEXT_BLOCK_MAX,
  MODEL_FAMILIES,
  type MediaKind,
  type Persona,
  type PersonaContextBlock,
  type PersonaLora,
} from '@ai-fluence/shared'

import { assetsApi, personasApi } from '@/lib/api'
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
import {
  CivitaiBrowser,
  toPersonaLoras,
} from '@/components/lora/CivitaiBrowser'
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
  const avatarRef = useRef<HTMLInputElement>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(base)

  useEffect(() => setDraft(withFirstBlock(persona)), [persona])
  const set = <K extends keyof Persona>(key: K, value: Persona[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const save = useMutation({
    mutationFn: () =>
      personasApi.update(persona.id, {
        name: draft.name,
        color: draft.color,
        avatarAssetId: draft.avatarAssetId,
        contextBlocks: draft.contextBlocks.filter(
          (b) => b.title.trim() || b.text.trim(),
        ),
        loras: draft.loras.filter((l) => l.path.trim()),
        defaultImageFamily: draft.defaultImageFamily,
        defaultVideoFamily: draft.defaultVideoFamily,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.personas })
      toast.success('Persona enregistré')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const remove = useMutation({
    mutationFn: () => personasApi.remove(persona.id),
    onSuccess: () => {
      setSelected('')
      queryClient.invalidateQueries({ queryKey: qk.personas })
      queryClient.invalidateQueries({ queryKey: qk.threadsAll })
      navigate({ to: '/' })
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
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending || !draft.name.trim()}
            className="brand-gradient"
          >
            {save.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Enregistrer'
            )}
          </Button>
        }
      >
        <PersonaAvatar persona={draft} size={24} className="rounded-md" />
        <span className="truncate text-sm font-medium">
          Paramétrage de {persona.name}
        </span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
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
                description="Envoyé à chaque génération de ce persona, après ton prompt. Reformuler n’y touche jamais."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      set('contextBlocks', [
                        ...draft.contextBlocks,
                        {
                          id: crypto.randomUUID(),
                          title: '',
                          text: '',
                        },
                      ])
                    }
                  >
                    <Plus className="h-4 w-4" /> Ajouter un bloc
                  </Button>
                }
              >
                <div className="space-y-3">
                  {draft.contextBlocks.map((b, i) => (
                    <div
                      key={b.id}
                      className="group/block rounded-lg border border-transparent bg-background/60 transition-colors focus-within:border-ring/50"
                    >
                      <div className="flex items-center">
                        <input
                          placeholder="Titre (ex. Apparence, Personnalité, DA…)"
                          value={b.title}
                          onChange={(e) =>
                            updateBlock(b.id, { title: e.target.value })
                          }
                          maxLength={60}
                          aria-label="Titre du bloc"
                          className="h-10 min-w-0 flex-1 rounded-tl-lg bg-transparent pl-3 text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
                        />
                        {i > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              set(
                                'contextBlocks',
                                draft.contextBlocks.filter(
                                  (x) => x.id !== b.id,
                                ),
                              )
                            }
                            aria-label="Supprimer le bloc"
                            title="Supprimer le bloc"
                            className="mr-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-red-500/10 hover:text-red-400 focus-visible:opacity-100 group-hover/block:opacity-100 group-focus-within/block:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="mx-3 h-px bg-border/60" />
                      <textarea
                        rows={3}
                        placeholder="Description du bloc.."
                        value={b.text}
                        onChange={(e) =>
                          updateBlock(b.id, { text: e.target.value })
                        }
                        maxLength={CONTEXT_BLOCK_MAX}
                        aria-label="Texte du bloc"
                        className="block min-h-[76px] w-full resize-y bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
                      />
                      <div className="px-3 pb-2 text-right text-[11px] text-muted-foreground tabular-nums">
                        {b.text.length} / {CONTEXT_BLOCK_MAX}
                      </div>
                    </div>
                  ))}
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
                  {draft.loras.map((l) => (
                    <LoraEditor
                      key={l.id}
                      lora={l}
                      onChange={(patch) => updateLora(l.id, patch)}
                      onRemove={() =>
                        set(
                          'loras',
                          draft.loras.filter((x) => x.id !== l.id),
                        )
                      }
                    />
                  ))}
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
                set('loras', [...draft.loras, ...toPersonaLoras(item)])
                toast.success(`${item.name} ajoutée`, {
                  description: 'Pense à enregistrer le persona.',
                })
              }}
              onRemove={(item) => {
                const urls = new Set(item.files.map((f) => f.url))
                set(
                  'loras',
                  draft.loras.filter((l) => !urls.has(l.path)),
                )
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
        title={`Supprimer ${persona.name} ?`}
        description="Ses fils, ses images et ses vidéos sont conservés, seul le persona est retiré."
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
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
  // Saisie libre des mots déclencheurs, découpée aux virgules à la sortie du champ.
  const [words, setWords] = useState(l.triggerWords.join(', '))
  const commitWords = () =>
    onChange({
      triggerWords: [
        ...new Set(
          words
            .split(',')
            .map((w) => w.trim())
            .filter(Boolean),
        ),
      ],
    })

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
        <Input
          placeholder="Mots déclencheurs, séparés par des virgules (ex. ohwx woman, red_dress)"
          value={words}
          onChange={(e) => setWords(e.target.value)}
          onBlur={commitWords}
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
        c'est 3 laura max c'est ça bah en fait là regarde la checkbox du violet
        elle est pas bonne il faut qu'elle soit noir ce qu'on la voit pas je
        parle de l'icône à limite le violet tu peux le faire en un peu plus
        moins opaque en plus de ça parce que là c'est un peu fort comme couleur
        je dirais{' '}
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

function References({ persona }: { persona: Persona }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
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
      description="Photos du personnage ou de la DA. Ajoutables en un clic dans le composer, pour les modèles REF (Seedream, Seedance, Wan 3.0…)."
    >
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {refs.map((a) => (
          <div
            key={a.id}
            className="group relative aspect-square overflow-hidden rounded-lg"
          >
            <AssetThumb asset={a} className="h-full w-full" />
            <button
              onClick={() => unref.mutate(a.id)}
              className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
              aria-label="Retirer de la bibliothèque"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
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
    </Card>
  )
}
