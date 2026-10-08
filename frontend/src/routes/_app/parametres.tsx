import { useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, ExternalLink, FolderOpen, KeyRound, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { MediaKind } from '@ai-fluence/shared'

import { assetsApi, authApi, settingsApi } from '@/lib/api'
import { catalogQuery, qk, settingsQuery } from '@/lib/queries'
import { formatUsd } from '@/lib/format'
import { SESSION_QUERY_KEY, sessionQueryOptions } from '@/server/auth'
import { initials } from '@/components/personas/PersonaAvatar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ModelBadge } from '@/components/ui/model-badge'
import { ContextsTab } from '@/components/settings/ShortcutsTab'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const TABS = ['account', 'models', 'contexts', 'credits', 'storage', 'api-key'] as const
type Tab = (typeof TABS)[number]

export const Route = createFileRoute('/_app/parametres')({
  validateSearch: (search: Record<string, unknown>): { tab: Tab } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : 'account',
  }),
  component: SettingsPage,
})

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
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

function SettingsPage() {
  const { tab } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  return (
    <>
      <PageHeader>
        <span className="text-sm font-medium">Paramétrage</span>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v as Tab } })} className="gap-6">
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="account">Compte</TabsTrigger>
              <TabsTrigger value="models">Modèles</TabsTrigger>
              <TabsTrigger value="contexts">Contextes</TabsTrigger>
              <TabsTrigger value="credits">Crédits</TabsTrigger>
              <TabsTrigger value="storage">Stockage</TabsTrigger>
              <TabsTrigger value="api-key">Clé API</TabsTrigger>
            </TabsList>
            <TabsContent value="api-key">
              <ApiKeyTab />
            </TabsContent>
            <TabsContent value="storage">
              <StorageTab />
            </TabsContent>
            <TabsContent value="models">
              <ModelsTab />
            </TabsContent>
            <TabsContent value="credits">
              <CreditsTab />
            </TabsContent>
            <TabsContent value="contexts">
              <ContextsTab />
            </TabsContent>
            <TabsContent value="account">
              <AccountTab />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  )
}

function useSettingsMutation<T>(fn: (v: T) => Promise<unknown>, success: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.settings })
      toast.success(success)
    },
    onError: (e) => toast.error((e as Error).message),
  })
}

function ApiKeyTab() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery(settingsQuery())
  const [key, setKey] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: qk.settings })
    queryClient.invalidateQueries({ queryKey: qk.catalog })
    queryClient.invalidateQueries({ queryKey: qk.balance })
  }
  const save = useMutation({
    mutationFn: () => settingsApi.setApiKey(key.trim()),
    onSuccess: () => {
      setKey('')
      refreshAll()
      toast.success('Clé vérifiée et enregistrée')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: () => settingsApi.removeApiKey(),
    onSuccess: () => {
      setConfirmRemove(false)
      refreshAll()
      toast.success('Clé supprimée')
    },
  })

  return (
    <Section
      title="Clé API SpicyAPI"
      description="La clé est vérifiée, puis stockée chiffrée en base. Elle ne repart jamais vers le navigateur."
    >
      {settings?.hasApiKey && (
        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5">
          <span className="flex items-center gap-2 font-mono text-sm">
            <KeyRound className="h-4 w-4 text-emerald-400" />
            {settings.apiKeyHint}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmRemove(true)}
            className="text-muted-foreground"
          >
            <Trash2 className="h-4 w-4" /> Supprimer
          </Button>
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (key.trim()) save.mutate()
        }}
      >
        <Input
          type="password"
          autoComplete="off"
          placeholder={settings?.hasApiKey ? 'Remplacer par une nouvelle clé sk-spicy-…' : 'sk-spicy-…'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button type="submit" disabled={!key.trim() || save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enregistrer'}
        </Button>
      </form>
      <a
        href="https://spicyapi.ai/console/keys"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        Créer une clé dans la console SpicyAPI <ExternalLink className="h-3 w-3" />
      </a>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Supprimer la clé API ?"
        description="Tu ne pourras plus générer tant que tu n’as pas ajouté une nouvelle clé."
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </Section>
  )
}

function StorageTab() {
  const { data: settings } = useQuery(settingsQuery())
  const [dir, setDir] = useState<string | null>(null)
  const save = useSettingsMutation((mediaDir: string | null) => settingsApi.update({ mediaDir }), 'Dossier mis à jour')
  const value = dir ?? settings?.mediaDir ?? ''

  return (
    <Section
      title="Dossier des médias"
      description="Les images et vidéos générées sont téléchargées ici, rangées par persona puis par jour. Les références importées vont dans « references »."
    >
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => setDir(e.target.value)} className="font-mono text-xs" />
        <Button onClick={() => save.mutate(value.trim() || null)} disabled={!dir || save.isPending}>
          Enregistrer
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => settingsApi.openMediaDir()}>
          <FolderOpen className="h-4 w-4" /> Ouvrir dans le Finder
        </Button>
        {settings && settings.mediaDir !== settings.defaultMediaDir && (
          <Button variant="ghost" size="sm" onClick={() => { setDir(null); save.mutate(null) }}>
            Revenir au dossier par défaut
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Les fichiers déjà générés restent à leur emplacement actuel. Supprimer un fil ne supprime jamais les fichiers.
      </p>
    </Section>
  )
}

function FamilySelect({ media, value, onChange }: { media: MediaKind; value: string | null; onChange: (v: string | null) => void }) {
  const { data: catalog } = useQuery(catalogQuery())
  const families = catalog?.families.filter((f) => f.media === media && f.available) ?? []
  return (
    <Select value={value ?? '__none'} onValueChange={(v) => onChange(v === '__none' ? null : v)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">Automatique</SelectItem>
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
  )
}

function ModelsTab() {
  const { data: settings } = useQuery(settingsQuery())
  const { data: catalog } = useQuery(catalogQuery(Boolean(settings)))
  const save = useSettingsMutation(
    (patch: Parameters<typeof settingsApi.update>[0]) => settingsApi.update(patch),
    'Enregistré',
  )
  if (!settings) return null
  return (
    <div className="space-y-4">
      <Section title="Modèles par défaut" description="Utilisés quand un persona n’a pas son propre modèle par défaut.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Photo</Label>
            <FamilySelect media="image" value={settings.defaultImageFamily} onChange={(v) => save.mutate({ defaultImageFamily: v })} />
          </div>
          <div className="space-y-1.5">
            <Label>Vidéo</Label>
            <FamilySelect media="video" value={settings.defaultVideoFamily} onChange={(v) => save.mutate({ defaultVideoFamily: v })} />
          </div>
        </div>
      </Section>
      <Section title="Reformulation du prompt" description="Modèle texte SpicyAPI utilisé par le bouton « Reformuler ».">
        <Select value={settings.enhanceModel} onValueChange={(v) => save.mutate({ enhanceModel: v })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(catalog?.textModels ?? [settings.enhanceModel]).map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/60 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

function CreditsTab() {
  const { data, isLoading, error } = useQuery({ queryKey: qk.credits, queryFn: () => settingsApi.credits() })
  if (isLoading) return <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
  if (error) return <p className="text-sm text-destructive-foreground">{(error as Error).message}</p>
  if (!data) return null
  return (
    <Section title="Crédits et consommation">
      {!data.balance && <p className="text-sm text-muted-foreground">Ajoute une clé API pour voir ton solde.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {data.balance && (
          <Stat label="En cours" value={formatUsd(data.balance.held)} hint="Réservé par les générations en cours" />
        )}
        {data.balance && <Stat label="Disponible" value={formatUsd(data.balance.available)} />}
        {data.usage && (
          <Stat
            label="Dépensé les 30 derniers jours"
            value={formatUsd(data.usage.totalSpend)}
            hint={`${data.usage.tasks} appel(s) avec cette clé`}
          />
        )}
        <Stat
          label="Dépense totale"
          value={formatUsd(data.spentInApp)}
          hint={`${data.generationCount} génération${data.generationCount > 1 ? 's' : ''} réussie${data.generationCount > 1 ? 's' : ''}`}
        />
      </div>
      <a
        href="https://spicyapi.ai/console/billing"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        Recharger dans la console SpicyAPI <ExternalLink className="h-3 w-3" />
      </a>
    </Section>
  )
}

function AccountTab() {
  const queryClient = useQueryClient()
  const { user: ctxUser } = Route.useRouteContext()
  const { data } = useQuery({ ...sessionQueryOptions(), initialData: ctxUser })
  const user = data ?? ctxUser
  const [name, setName] = useState(user.name)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const update = useMutation({
    mutationFn: (body: { name?: string; avatarAssetId?: string | null }) => authApi.updateMe(body),
    onSuccess: ({ user: u }) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, u)
      toast.success('Compte mis à jour')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const onAvatar = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      const { asset } = await assetsApi.upload(file)
      update.mutate({ avatarAssetId: asset.id })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Section title="Compte" description={user.email}>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-secondary"
          aria-label="Changer la photo de profil"
        >
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-lg font-semibold">
              {initials(user.name)}
            </span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin text-white" /> : <Camera className="h-4 w-4 text-white" />}
          </span>
        </button>
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Photo de profil</div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              Choisir une image
            </Button>
            {user.avatarUrl && (
              <Button variant="ghost" size="sm" onClick={() => update.mutate({ avatarAssetId: null })}>
                Retirer
              </Button>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => onAvatar(e.target.files?.[0])}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Nom</Label>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <Button onClick={() => update.mutate({ name })} disabled={!name.trim() || name === user.name}>
            Enregistrer
          </Button>
        </div>
      </div>
    </Section>
  )
}
