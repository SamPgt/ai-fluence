import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Wallet } from 'lucide-react'

import { threadsApi } from '@/lib/api'
import {
  balanceQuery,
  personasQuery,
  qk,
  settingsQuery,
  threadsQuery,
} from '@/lib/queries'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useUiPref } from '@/components/providers/ui-prefs'
import { ChatListItem } from '@/components/chat/ChatListItem'
import { ChatSearchDialog } from '@/components/chat/ChatSearchDialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-3 pb-1 text-xs font-semibold text-muted-foreground/80">
      {children}
    </div>
  )
}

export function ThreadPanel({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const params = useParams({ strict: false }) as { threadId?: string }
  const [personaId] = useUiPref('personaId')
  const { data: personas = [] } = useQuery(personasQuery())
  const persona = personas.find((p) => p.id === personaId)
  const { data: threads = [] } = useQuery(threadsQuery(personaId || null))
  const { data: settings } = useQuery(settingsQuery())
  const { data: balance } = useQuery(balanceQuery(Boolean(settings?.hasApiKey)))

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: qk.threadsAll })

  const remove = useMutation({
    mutationFn: (id: string) => threadsApi.remove(id),
    onSuccess: (_, id) => {
      invalidate()
      if (id === params.threadId) navigate({ to: '/' })
    },
  })
  const togglePin = useMutation({
    mutationFn: (t: { id: string; isPinned: boolean }) =>
      threadsApi.update(t.id, { isPinned: !t.isPinned }),
    onSuccess: invalidate,
  })

  const pinned = threads.filter((t) => t.isPinned)
  const recent = threads.filter((t) => !t.isPinned)

  return (
    <aside
      className={cn(
        'shrink-0 overflow-hidden border-r border-border/40 bg-panel transition-[width] duration-200 ease-out',
        collapsed ? 'w-0 border-r-0' : 'w-72',
      )}
    >
      <div className="flex h-full w-72 flex-col">
        <div className="space-y-3 p-3">
          <div className="flex items-center justify-between px-1">
            <span className="truncate text-sm font-semibold">
              {persona ? persona.name : 'Tous les fils'}
            </span>
            {persona && (
              <Link
                to="/personas/$personaId"
                params={{ personaId: persona.id }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Paramétrer
              </Link>
            )}
          </div>
          <Button
            onClick={() => navigate({ to: '/' })}
            className="w-full gap-1.5 font-medium brand-gradient brand-shadow transition-all duration-150 hover:opacity-90 active:scale-[0.99]"
            size="sm"
          >
            <Plus strokeWidth={2} className="-ml-1 h-4 w-4" />
            Nouveau fil
          </Button>
          <ChatSearchDialog />
        </div>

        {/* Radix met le contenu en display:table, ce qui casse le truncate : on le force en block. */}
        <ScrollArea className="min-h-0 flex-1 px-2 [&_[data-radix-scroll-area-viewport]>div]:!block">
          {pinned.length > 0 && (
            <>
              <GroupLabel>Épinglés</GroupLabel>
              <div className="space-y-0.5">
                {pinned.map((t) => (
                  <ChatListItem
                    key={t.id}
                    thread={t}
                    isActive={params.threadId === t.id}
                    onDelete={() => remove.mutate(t.id)}
                    onTogglePin={() => togglePin.mutate(t)}
                  />
                ))}
              </div>
            </>
          )}
          <GroupLabel>Récents</GroupLabel>
          <div className="space-y-0.5 pb-3">
            {recent.map((t) => (
              <ChatListItem
                key={t.id}
                thread={t}
                isActive={params.threadId === t.id}
                onDelete={() => remove.mutate(t.id)}
                onTogglePin={() => togglePin.mutate(t)}
              />
            ))}
            {threads.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                {/* Aucun fil{persona ? ` pour ${persona.name}` : ''} pour
                l’instant. */}
                Aucun fil pour l’instant.
              </p>
            )}
          </div>
        </ScrollArea>

        <Link
          to="/parametres"
          search={{ tab: 'credits' }}
          className="flex items-center gap-2 border-t border-border/40 px-4 py-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Wallet className="h-3.5 w-3.5" />
          {settings && !settings.hasApiKey ? (
            <span className="text-amber-300">Clé API manquante</span>
          ) : (
            <span>
              {/* Crédit SpicyAPI :{' '} */}
              Crédit :{' '}
              <span className="font-medium text-foreground">
                {balance ? formatUsd(balance.available) : '…'}
              </span>
            </span>
          )}
        </Link>
      </div>
    </aside>
  )
}
