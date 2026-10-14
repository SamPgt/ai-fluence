/**
 * Général : ce qui n'appartient à aucun persona. Ses références, ses LoRA, et les
 * raccourcis (tous généraux).
 */
import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Layers } from 'lucide-react'
import { toast } from 'sonner'
import type { PersonaLora } from '@ai-fluence/shared'

import { settingsApi } from '@/lib/api'
import { qk, settingsQuery } from '@/lib/queries'
import { PageHeader } from '@/components/layout/PageHeader'
import { LoraSection } from '@/components/personas/LoraSection'
import { ReferencesSection } from '@/components/personas/ReferencesSection'
import { ShortcutsTab } from '@/components/settings/ShortcutsTab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const TABS = ['references', 'lora', 'shortcuts'] as const
type Tab = (typeof TABS)[number]

export const Route = createFileRoute('/_app/bibliotheque_/general')({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
  }),
  component: GeneralPage,
})

const GENERAL = { id: 'general', name: 'Général' }

function GeneralPage() {
  const { tab = 'references' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: settings } = useQuery(settingsQuery())
  return (
    <>
      <PageHeader>
        <Link
          to="/bibliotheque"
          aria-label="Retour à la bibliothèque"
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <span className="grid h-6 w-6 place-items-center rounded-md bg-muted text-muted-foreground">
          <Layers className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-medium">Général</span>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[830px] px-6 py-6">
          <p className="mb-5 text-sm text-muted-foreground">
            Ce qui n’appartient à aucun persona : disponible dans tous les fils.
          </p>
          <Tabs
            value={tab}
            onValueChange={(v) => navigate({ search: { tab: v as Tab } })}
            className="gap-5"
          >
            <TabsList className="w-full justify-start">
              <TabsTrigger value="references">Références</TabsTrigger>
              <TabsTrigger value="lora">LoRA</TabsTrigger>
              <TabsTrigger value="shortcuts">Raccourcis</TabsTrigger>
            </TabsList>
            <TabsContent value="references">
              <ReferencesSection owner={GENERAL} />
            </TabsContent>
            <TabsContent value="lora">
              {settings && <GeneralLoras initial={settings.loras} />}
            </TabsContent>
            <TabsContent value="shortcuts">
              <ShortcutsTab />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  )
}

/** LoRA de Général : enregistrées dans Paramétrage, peu après chaque modification. */
function GeneralLoras({ initial }: { initial: PersonaLora[] }) {
  const queryClient = useQueryClient()
  const [loras, setLoras] = useState(initial)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef(loras)
  latest.current = loras
  const dirty = useRef(false)

  const save = () => {
    if (!dirty.current) return
    dirty.current = false
    // Les lignes encore sans lien ne partent pas (le serveur exige un lien https).
    settingsApi
      .update({ loras: latest.current.filter((l) => l.path.trim()) })
      .then(() => queryClient.invalidateQueries({ queryKey: qk.settings }))
      .catch((e) => toast.error((e as Error).message))
  }
  // En quittant la page, la dernière modification part quand même.
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      save()
    },
    [],
  ) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LoraSection
      loras={loras}
      onChange={(next) => {
        setLoras(next)
        dirty.current = true
        clearTimeout(timer.current)
        timer.current = setTimeout(save, 600)
      }}
      emptyText="Aucune LoRA dans Général."
    />
  )
}
