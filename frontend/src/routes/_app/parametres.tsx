import { useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Camera,
  ExternalLink,
  FolderOpen,
  KeyRound,
  Loader2,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { assetsApi, authApi, settingsApi } from '@/lib/api'
import { qk, settingsQuery } from '@/lib/queries'
import { formatUsd } from '@/lib/format'
import { SESSION_QUERY_KEY, sessionQueryOptions } from '@/server/auth'
import { initials } from '@/components/personas/PersonaAvatar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { UpdateSettingsRequest } from '@sublime/shared'
import { DictationModelField } from '@/components/settings/DictationModelField'
import { DefaultFamily } from '@/components/settings/DefaultFamily'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const TABS = ['account', 'credits', 'storage', 'api-key'] as const
type Tab = (typeof TABS)[number]

export const Route = createFileRoute('/_app/parametres')({
  validateSearch: (search: Record<string, unknown>): { tab: Tab } => ({
    // `models` : ancien onglet, aujourd'hui dans Général (`account`).
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : 'account',
  }),
  component: SettingsPage,
})

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-card/50 p-5">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
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
        <div className="mx-auto max-w-[830px] px-6 py-6">
          <Tabs
            value={tab}
            onValueChange={(v) => navigate({ search: { tab: v as Tab } })}
            className="gap-6"
          >
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="account">Général</TabsTrigger>
              <TabsTrigger value="credits">Crédits</TabsTrigger>
              <TabsTrigger value="storage">Stockage</TabsTrigger>
              <TabsTrigger value="api-key">Clés API</TabsTrigger>
            </TabsList>
            <TabsContent value="api-key">
              <ApiKeyTab />
            </TabsContent>
            <TabsContent value="storage">
              <StorageTab />
            </TabsContent>
            <TabsContent value="credits">
              <CreditsTab />
            </TabsContent>
            {/* Général : le compte, puis les modèles par défaut et la dictée. */}
            <TabsContent value="account" className="space-y-5">
              <AccountTab />
              <ModelsTab />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  )
}

function useSettingsMutation<T>(
  fn: (v: T) => Promise<unknown>,
  success: string,
) {
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

/** Modèles proposés par défaut dans le composer (un nouveau fil, ou après une réinitialisation). */
function ModelsTab() {
  const { data: settings } = useQuery(settingsQuery())
  const save = useSettingsMutation(
    (patch: UpdateSettingsRequest) => settingsApi.update(patch),
    'Préférence enregistrée',
  )
  return (
    <div className="space-y-5">
      <Section
        title="Modèles par défaut"
        description="Sélectionnés automatiquement dans le composer pour un nouveau fil."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <DefaultFamily
            media="image"
            value={settings?.defaultImageFamily ?? null}
            onChange={(v) => save.mutate({ defaultImageFamily: v })}
          />
          <DefaultFamily
            media="video"
            value={settings?.defaultVideoFamily ?? null}
            onChange={(v) => save.mutate({ defaultVideoFamily: v })}
          />
        </div>
      </Section>
      <Section
        title="Dictée"
        description="Modèle du micro du composer (⌥M). Le texte s’écrit pendant que tu parles."
      >
        <div className="max-w-sm space-y-1.5">
          <Label>Modèle</Label>
          <DictationModelField
            value={settings?.dictationProvider ?? 'elevenlabs'}
            available={settings?.dictationProviders ?? ['elevenlabs']}
            onChange={(v) => save.mutate({ dictationProvider: v })}
          />
        </div>
      </Section>
    </div>
  )
}

function ApiKeyTab() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery(settingsQuery())
  const refreshSpicy = () => {
    queryClient.invalidateQueries({ queryKey: qk.settings })
    queryClient.invalidateQueries({ queryKey: qk.catalog })
    queryClient.invalidateQueries({ queryKey: qk.balance })
  }

  return (
    <div className="space-y-5">
      <ApiKeySection
        title="SpicyAPI"
        description="API de génération photos et vidéos."
        hint={settings?.hasApiKey ? settings.apiKeyHint : null}
        placeholder="sk-spicy-…"
        consoleUrl="https://spicyapi.ai/console/keys"
        consoleLabel="Créer une clé dans la console SpicyAPI"
        removeDescription="Tu ne pourras plus générer tant que tu n’as pas ajouté une nouvelle clé."
        onSave={settingsApi.setApiKey}
        onRemove={settingsApi.removeApiKey}
        onChanged={refreshSpicy}
      />
      <ApiKeySection
        title="ElevenLabs"
        description="Voix des personas : catalogue de voix, écoute des extraits et génération de voix."
        hint={settings?.hasElevenLabsKey ? settings.elevenLabsKeyHint : null}
        placeholder="sk_…"
        consoleUrl="https://elevenlabs.io/app/settings/api-keys"
        consoleLabel="Créer une clé dans ElevenLabs"
        removeDescription="Le catalogue de voix ne sera plus disponible tant que tu n’as pas ajouté une nouvelle clé."
        onSave={settingsApi.setElevenLabsKey}
        onRemove={settingsApi.removeElevenLabsKey}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: qk.settings })
          queryClient.invalidateQueries({ queryKey: ['voice-library'] })
        }}
      />
      <p className="px-1 text-xs text-muted-foreground">
        Les clés sont vérifiées, puis stockées chiffrées en base. Elles ne
        repartent jamais vers le navigateur.
      </p>
    </div>
  )
}

/** Une clé à la fois : pour en changer, on supprime d'abord l'actuelle. */
function ApiKeySection({
  title,
  description,
  hint,
  placeholder,
  consoleUrl,
  consoleLabel,
  removeDescription,
  onSave,
  onRemove,
  onChanged,
}: {
  title: string
  description: string
  hint: string | null
  placeholder: string
  consoleUrl: string
  consoleLabel: string
  removeDescription: string
  onSave: (key: string) => Promise<unknown>
  onRemove: () => Promise<unknown>
  onChanged: () => void
}) {
  const [key, setKey] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const save = useMutation({
    mutationFn: () => onSave(key.trim()),
    onSuccess: () => {
      setKey('')
      onChanged()
      toast.success('Clé vérifiée et enregistrée')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: onRemove,
    onSuccess: () => {
      setConfirmRemove(false)
      onChanged()
      toast.success('Clé supprimée')
    },
  })

  return (
    <Section title={title} description={description}>
      {hint ? (
        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5">
          <span className="flex items-center gap-2 font-mono text-sm">
            <KeyRound className="h-4 w-4 text-emerald-400" />
            {hint}
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
      ) : (
        <>
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
              placeholder={placeholder}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              aria-label={`Clé ${title}`}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!key.trim() || save.isPending}
            >
              {save.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Enregistrer'
              )}
            </Button>
          </form>
          <a
            href={consoleUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {consoleLabel} <ExternalLink className="h-3 w-3" />
          </a>
        </>
      )}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Supprimer la clé ${title} ?`}
        description={removeDescription}
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </Section>
  )
}

function StorageTab() {
  const { data: settings } = useQuery(settingsQuery())
  const [dir, setDir] = useState<string | null>(null)
  const save = useSettingsMutation(
    (mediaDir: string | null) => settingsApi.update({ mediaDir }),
    'Dossier mis à jour',
  )
  const value = dir ?? settings?.mediaDir ?? ''

  return (
    <Section
      title="Dossier des médias"
      description="Les images et vidéos générées sont téléchargées ici, rangées par persona puis par jour. Les références importées vont dans « references »."
    >
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setDir(e.target.value)}
          className="font-mono text-xs"
        />
        <Button
          variant="outline"
          onClick={() => save.mutate(value.trim() || null)}
          disabled={!dir || save.isPending}
        >
          Enregistrer
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => settingsApi.openMediaDir()}
        >
          <FolderOpen className="h-4 w-4" /> Ouvrir dans le Finder
        </Button>
        {settings && settings.mediaDir !== settings.defaultMediaDir && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDir(null)
              save.mutate(null)
            }}
          >
            Revenir au dossier par défaut
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Les fichiers déjà générés restent à leur emplacement actuel. Supprimer
        un fil ne supprime jamais les fichiers.
      </p>
    </Section>
  )
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-border/60 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      )}
    </div>
  )
}

function CreditsTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: qk.credits,
    queryFn: () => settingsApi.credits(),
  })
  if (isLoading)
    return (
      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
    )
  if (error)
    return (
      <p className="text-sm text-destructive-foreground">
        {(error as Error).message}
      </p>
    )
  if (!data) return null
  return (
    <Section title="Crédits et consommation">
      {!data.balance && (
        <p className="text-sm text-muted-foreground">
          Ajoute une clé API pour voir ton solde.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {data.balance && (
          <Stat
            label="En cours"
            value={formatUsd(data.balance.held)}
            hint="Réservé par les générations en cours"
          />
        )}
        {data.balance && (
          <Stat
            label="Disponible"
            value={formatUsd(data.balance.available, 'balance')}
          />
        )}
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
    mutationFn: (body: { name?: string; avatarAssetId?: string | null }) =>
      authApi.updateMe(body),
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

  // Nom affiché : enregistré en quittant le champ (ou avec Entrée), jamais vide.
  const saveName = () => {
    const next = name.trim()
    if (!next) return setName(user.name)
    if (next !== user.name) update.mutate({ name: next })
  }

  return (
    <Section title="Compte">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-secondary"
          aria-label="Changer la photo de profil"
        >
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-lg font-semibold">
              {initials(user.name)}
            </span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            ) : (
              <Camera className="h-4 w-4 text-white" />
            )}
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{user.name}</div>
          <div className="truncate text-sm text-muted-foreground">
            {user.email}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            Changer la photo
          </Button>
          {user.avatarUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => update.mutate({ avatarAssetId: null })}
            >
              Retirer
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => onAvatar(e.target.files?.[0])}
        />
      </div>
      <div className="space-y-1.5 border-t border-border/40 pt-5">
        <Label htmlFor="account-name">Nom affiché</Label>
        <Input
          id="account-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          maxLength={60}
        />
      </div>
    </Section>
  )
}
