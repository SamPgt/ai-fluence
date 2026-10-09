import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Loader2, Plus, Star, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { MODEL_FAMILIES, type Gender, type MediaKind, type Persona, type PersonaLora } from '@ai-fluence/shared'

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/_app/personas/$personaId')({
  component: PersonaPage,
})

const LORA_FAMILIES = MODEL_FAMILIES.filter((f) => f.badges.includes('LORA'))

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-card/50 p-5">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
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
  if (!persona) return <p className="p-10 text-center text-sm text-muted-foreground">Persona introuvable.</p>
  return <PersonaEditor key={persona.id} persona={persona} />
}

function PersonaEditor({ persona }: { persona: Persona }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [, setSelected] = useUiPref('personaId')
  const [draft, setDraft] = useState<Persona>(persona)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const avatarRef = useRef<HTMLInputElement>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(persona)

  useEffect(() => setDraft(persona), [persona])
  const set = <K extends keyof Persona>(key: K, value: Persona[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const save = useMutation({
    mutationFn: () =>
      personasApi.update(persona.id, {
        name: draft.name,
        kind: draft.kind,
        gender: draft.gender,
        color: draft.color,
        avatarAssetId: draft.avatarAssetId,
        description: draft.description,
        personality: draft.personality,
        promptSuffix: draft.promptSuffix,
        triggerWord: draft.triggerWord,
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
    set('loras', draft.loras.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  return (
    <>
      <PageHeader
        right={
          <>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" asChild>
              <Link to="/personnages/$personaId/masters" params={{ personaId: persona.id }}>
                <Star className="h-3.5 w-3.5" /> Images master
              </Link>
            </Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending || !draft.name.trim()} className="brand-gradient">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enregistrer'}
            </Button>
          </>
        }
      >
        <PersonaAvatar persona={draft} size={24} className="rounded-md" />
        <span className="truncate text-sm font-medium">Paramétrage de {persona.name}</span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
          <Card title="Identité">
            <div className="flex items-start gap-5">
              <button
                type="button"
                onClick={() => avatarRef.current?.click()}
                className="group relative overflow-hidden rounded-2xl"
                aria-label="Changer l’avatar"
              >
                <PersonaAvatar persona={draft} size={88} />
                <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
                  <Camera className="h-5 w-5 text-white" />
                </span>
              </button>
              <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadAvatar(e.target.files?.[0])} />
              <div className="flex-1 space-y-3">
                <div className="space-y-1.5">
                  <Label>Nom</Label>
                  <Input value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={40} />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Select value={draft.kind} onValueChange={(v) => set('kind', v as Persona['kind'])}>
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="influencer">Influenceur</SelectItem>
                      <SelectItem value="art">Page art</SelectItem>
                    </SelectContent>
                  </Select>
                  {/* Genre : accorde le prompt et choisit les miniatures (version femme ou homme) de la bibliothèque. */}
                  <Select value={draft.gender ?? '__none'} onValueChange={(v) => set('gender', v === '__none' ? null : (v as Gender))}>
                    <SelectTrigger size="sm" title="Genre du personnage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="female">Femme</SelectItem>
                      <SelectItem value="male">Homme</SelectItem>
                      <SelectItem value="__none">Genre non précisé</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex gap-1.5">
                    {PERSONA_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => set('color', c)}
                        style={{ backgroundColor: c }}
                        className={cn('h-6 w-6 rounded-full ring-offset-2 ring-offset-background', draft.color === c && 'ring-2 ring-white')}
                        aria-label={`Couleur ${c}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                rows={2}
                placeholder={draft.kind === 'art' ? 'La DA de la page : sujets, palette, ambiance…' : 'Qui est-ce ? Âge, style, univers…'}
                value={draft.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
          </Card>

          <Card
            title="Personnalité et comportement"
            description="Utilisé par le bouton « Reformuler » : façon de parler, attitude, habitudes. Le prompt est réécrit en cohérence."
          >
            <Textarea
              rows={4}
              placeholder="Ex. : solaire, ironique, toujours en mouvement, adore le café et les rooftops, poses naturelles jamais figées…"
              value={draft.personality}
              onChange={(e) => set('personality', e.target.value)}
            />
          </Card>

          <Card title="Prompts automatiques" description="Ajoutés à chaque génération de ce persona.">
            <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
              <div className="space-y-1.5">
                <Label>Mot déclencheur LoRA</Label>
                <Input placeholder="ex. ohwx woman" value={draft.triggerWord} onChange={(e) => set('triggerWord', e.target.value)} />
                <p className="text-[11px] text-muted-foreground">Placé au début, seulement si une LoRA est appliquée.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Suffixe (DA, apparence)</Label>
                <Textarea
                  rows={2}
                  placeholder="ex. long auburn hair, freckles, film photography look"
                  value={draft.promptSuffix}
                  onChange={(e) => set('promptSuffix', e.target.value)}
                />
              </div>
            </div>
          </Card>

          <Card
            title="LoRA"
            description="Lien https direct vers le .safetensors (Hugging Face, Civitai). Chaque LoRA ne marche que sur le modèle pour lequel elle a été entraînée."
          >
            <div className="space-y-3">
              {draft.loras.map((l) => (
                <div key={l.id} className="space-y-2 rounded-lg border border-border/60 p-3">
                  <div className="flex gap-2">
                    <Input placeholder="Nom (optionnel)" value={l.label} onChange={(e) => updateLora(l.id, { label: e.target.value })} className="w-40" />
                    <Input
                      placeholder="https://huggingface.co/…/resolve/main/lora.safetensors"
                      value={l.path}
                      onChange={(e) => updateLora(l.id, { path: e.target.value })}
                      className="flex-1 font-mono text-xs"
                    />
                    <Button variant="ghost" size="icon" onClick={() => set('loras', draft.loras.filter((x) => x.id !== l.id))} aria-label="Retirer">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Select value={l.family} onValueChange={(v) => updateLora(l.id, { family: v })}>
                      <SelectTrigger size="sm" className="w-56">
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
                        onChange={(e) => updateLora(l.id, { scale: Number(e.target.value) })}
                        className="w-28 accent-brand"
                      />
                      <span className="w-8 tabular-nums">{l.scale.toFixed(2)}</span>
                    </label>
                    {l.family === 'alibaba/wan-2.2-lora' && (
                      <Select value={l.noise ?? 'both'} onValueChange={(v) => updateLora(l.id, { noise: v as PersonaLora['noise'] })}>
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
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  set('loras', [
                    ...draft.loras,
                    { id: crypto.randomUUID(), label: '', path: '', scale: 1, family: LORA_FAMILIES[0].id },
                  ])
                }
              >
                <Plus className="h-4 w-4" /> Ajouter une LoRA
              </Button>
            </div>
          </Card>

          <References persona={persona} />

          <Card title="Modèles par défaut" description="Sélectionnés automatiquement dans le composer pour ce persona.">
            <div className="grid gap-4 sm:grid-cols-2">
              <DefaultFamily media="image" value={draft.defaultImageFamily} onChange={(v) => set('defaultImageFamily', v)} />
              <DefaultFamily media="video" value={draft.defaultVideoFamily} onChange={(v) => set('defaultVideoFamily', v)} />
            </div>
          </Card>

          <div className="flex justify-end pb-6">
            <Button
              variant="ghost"
              className="text-destructive-foreground"
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 className="h-4 w-4" /> Supprimer le persona
            </Button>
          </div>
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

function DefaultFamily({ media, value, onChange }: { media: MediaKind; value: string | null; onChange: (v: string | null) => void }) {
  const { data: catalog } = useQuery(catalogQuery())
  const families = catalog?.families.filter((f) => f.media === media) ?? MODEL_FAMILIES.filter((f) => f.media === media)
  return (
    <div className="space-y-1.5">
      <Label>{media === 'image' ? 'Photo' : 'Vidéo'}</Label>
      <Select value={value ?? '__none'} onValueChange={(v) => onChange(v === '__none' ? null : v)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">Comme les paramètres généraux</SelectItem>
          {families.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              <span className="flex items-center gap-2">
                {f.label}
                {f.badges.map((b) => <ModelBadge key={b} badge={b} />)}
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
    mutationFn: (assetId: string) => assetsApi.setReference(assetId, persona.id, false),
    onSuccess: refresh,
  })

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files)) await assetsApi.upload(f, { personaId: persona.id, isReference: true })
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
          <div key={a.id} className="group relative aspect-square overflow-hidden rounded-lg">
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
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-5 w-5" />}
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
