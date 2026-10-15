import { VOICE_ENABLED } from '@/lib/features'
import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Check, ChevronLeft, Loader2, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { undoToast } from '@/lib/undo-toast'
import { type Persona, type PersonaVoice } from '@sublime/shared'
import { assetsApi, personasApi, trashApi } from '@/lib/api'
import { personasQuery, qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, LoraSection } from '@/components/personas/LoraSection'
import { ReferencesSection } from '@/components/personas/ReferencesSection'
import { PERSONA_COLORS } from '@/components/personas/NewPersonaDialog'
import { PersonaAvatar } from '@/components/personas/PersonaAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  PersonaVoiceRow,
  VoiceLibraryDialog,
  stopVoicePreview,
} from '@/components/personas/VoiceLibrary'

const PERSONA_TABS = ['general', 'lora'] as const
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

/** Corps envoyé au serveur (les blocs et LoRA vides ne sont pas conservés). */
function toPayload(p: Persona) {
  return {
    name: p.name,
    kind: p.kind,
    color: p.color,
    avatarAssetId: p.avatarAssetId,
    contextBlocks: p.contextBlocks.filter(
      (b) => b.title.trim() || b.text.trim(),
    ),
    loras: p.loras.filter((l) => l.path.trim()),
    defaultImageFamily: p.defaultImageFamily,
    defaultVideoFamily: p.defaultVideoFamily,
    voices: p.voices,
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
  // Le premier bloc de contexte est toujours présent : il invite à décrire le persona.
  const base = persona
  const [draft, setDraft] = useState<Persona>(base)
  const [confirmRemove, setConfirmRemove] = useState(false)
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
    const incoming = persona
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
      // Les fils restent : seules ses références et ses LoRA partent avec lui.
      const refresh = () => {
        queryClient.invalidateQueries({ queryKey: qk.personas })
        queryClient.invalidateQueries({ queryKey: qk.threadsAll })
        queryClient.invalidateQueries({ queryKey: qk.trash })
      }
      refresh()
      navigate({ to: '/bibliotheque' })
      toast.success(`${persona.name} mis à la corbeille`, {
        description: 'Avec ses références et ses LoRA.',
        ...undoToast(() => trashApi.restorePersona(persona.id).then(refresh)),
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
        <Link
          to="/bibliotheque"
          aria-label="Retour à la bibliothèque"
          title="Retour à la bibliothèque"
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <PersonaAvatar persona={draft} size={24} className="rounded-md" />
        <span className="truncate text-sm font-medium">
          Paramétrage de {persona.name}
        </span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[830px] space-y-5 px-6 py-6">
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
                    aria-label="Nom du persona"
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
              <TabsTrigger value="general">Références</TabsTrigger>
              <TabsTrigger value="lora">LoRA</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-5">
              <ReferencesSection owner={persona} />

              {/* Voix : seulement pour un persona influenceur. PROCHAINEMENT : ajout de la voix (VOICE_ENABLED). */}
              {VOICE_ENABLED && draft.kind !== 'artistic' && (
                <PersonaVoices
                  voices={draft.voices}
                  onChange={(voices) => set('voices', voices)}
                />
              )}

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
              <LoraSection
                loras={draft.loras}
                onChange={(loras) => set('loras', loras)}
                emptyText="Aucune LoRA pour ce persona."
              />
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

/** Voix de référence : voix ElevenLabs choisies dans leur catalogue, à écouter. */
function PersonaVoices({
  voices,
  onChange,
}: {
  voices: PersonaVoice[]
  onChange: (voices: PersonaVoice[]) => void
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => () => stopVoicePreview(), [])
  return (
    <Card
      title="Voix de référence"
      description="Voix utilisable en référence pour les modèles vidéos le prennant en charge."
      action={
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Ajouter une voix
        </Button>
      }
    >
      {voices.length ? (
        <div className="space-y-2">
          {voices.map((v, i) => (
            <PersonaVoiceRow
              key={v.id}
              voice={v}
              index={i}
              onRemove={() => onChange(voices.filter((x) => x.id !== v.id))}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Aucune voix pour l’instant. Ajoute une voix du catalogue ElevenLabs
          après avoir écouté son extrait.
        </p>
      )}
      <VoiceLibraryDialog
        open={open}
        onOpenChange={setOpen}
        chosenIds={voices.map((v) => v.voiceId)}
        onAdd={(v) =>
          onChange([
            ...voices,
            {
              id: crypto.randomUUID(),
              voiceId: v.voiceId,
              ...(v.publicOwnerId ? { publicOwnerId: v.publicOwnerId } : {}),
              name: v.name,
              previewUrl: v.previewUrl,
              labels: v.labels,
              ...(v.description ? { description: v.description } : {}),
            },
          ])
        }
        onRemove={(voiceId) =>
          onChange(voices.filter((x) => x.voiceId !== voiceId))
        }
      />
    </Card>
  )
}
