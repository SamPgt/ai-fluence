/**
 * Accueil : où en est-on, et où reprendre. Salutation et crédit, les derniers fils (avec
 * leurs images), les dernières générations et les derniers workflows (ouverts dans leur
 * canvas ; ▶ lance dans un fil ceux qui ont des entrées « À fournir »).
 * Page d'arrivée (`/`). Pas de composer ici : « Nouveau fil » ouvre un fil vierge (`/nouveau`).
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  ImageIcon,
  KeyRound,
  Library,
  Play,
  Workflow,
} from 'lucide-react'
import type { Thread, WorkflowSummary } from '@sublime/shared'

import { assetsApi } from '@/lib/api'
import {
  balanceQuery,
  qk,
  settingsQuery,
  threadsQuery,
  workflowsQuery,
} from '@/lib/queries'
import { formatUsd, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { sessionQueryOptions } from '@/server/auth'
import { PageHeader } from '@/components/layout/PageHeader'

export const Route = createFileRoute('/_app/')({
  component: HomePage,
})

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function HomePage() {
  const { data: user } = useQuery(sessionQueryOptions())
  const { data: settings } = useQuery(settingsQuery())
  const { data: balance } = useQuery(balanceQuery(Boolean(settings?.hasApiKey)))
  const { data: threads = [] } = useQuery(threadsQuery(null))
  const { data: workflows = [] } = useQuery(workflowsQuery())
  const gallery = useInfiniteQuery({
    queryKey: qk.gallery(null, 'image'),
    queryFn: ({ pageParam }) =>
      assetsApi.gallery({ media: 'image', before: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
  })
  const latest = gallery.data?.pages[0]?.items.slice(0, 8) ?? []

  const hour = new Date().getHours()
  const greeting = hour >= 5 && hour < 18 ? 'Bonjour' : 'Bonsoir'
  const firstName = user?.name.split(' ')[0] ?? ''
  const thisWeek = threads.filter(
    (t) => Date.now() - Date.parse(t.updatedAt) < WEEK_MS,
  ).length
  const recent = [...threads]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 3)
  const recentWorkflows = [...workflows]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 4)
  const isNew = threads.length === 0

  const generations = threads.reduce((n, t) => n + t.generationCount, 0)
  // « Mercredi 15 octobre ».
  const today = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date())
  const credit =
    settings && !settings.hasApiKey
      ? 'Clé manquante'
      : balance
        ? formatUsd(balance.available, 'balance')
        : '…'

  return (
    <>
      <PageHeader>
        <span className="text-sm font-medium">Accueil</span>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-10 px-8 py-10">
          {/* Salutation et date à gauche, chiffres clés à droite. */}
          <header className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {greeting}
                {firstName && ` ${firstName}`}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground first-letter:uppercase">
                {today}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Crédit" value={credit} />
              <Stat label="Fils cette semaine" value={String(thisWeek)} />
              <Stat label="Générations" value={String(generations)} />
            </div>
          </header>

          {isNew ? (
            <FirstSteps hasApiKey={Boolean(settings?.hasApiKey)} />
          ) : (
            <section className="space-y-3">
              <SectionTitle title="Reprendre" />
              {/* Le dernier fil en grand (trois images), les deux suivants avec leur dernière image. */}
              <div className="grid gap-4 lg:grid-cols-[3fr_2fr_2fr]">
                {recent.map((t, i) => (
                  <ThreadCard key={t.id} thread={t} mosaic={i === 0} />
                ))}
              </div>
            </section>
          )}

          <div className="grid gap-8 lg:grid-cols-[7fr_5fr]">
            <section className="space-y-3">
              <SectionTitle
                title="Dernières générations"
                link={{ to: '/galerie', label: 'Galerie' }}
              />
              {latest.length > 0 ? (
                <div className="grid grid-cols-4 gap-2.5">
                  {latest.map(({ asset, generation }) => (
                    <Link
                      key={asset.id}
                      // La galerie s'ouvre sur cette image.
                      to="/galerie"
                      search={{ a: asset.id }}
                      className="aspect-[4/3] overflow-hidden rounded-xl bg-muted"
                    >
                      <img
                        src={asset.url}
                        alt={generation?.prompt ?? 'Génération'}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform hover:scale-[1.03]"
                      />
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Aucune image pour l’instant.
                </p>
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle
                title="Workflows"
                link={{ to: '/workflows', label: 'Tout voir' }}
              />
              <div className="space-y-2.5">
                {recentWorkflows.map((w) => (
                  <WorkflowRow key={w.id} workflow={w} />
                ))}
                {recentWorkflows.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Aucun workflow pour l’instant.
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  )
}

/** Chiffre clé de l'en-tête. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-36 rounded-xl border border-border/50 bg-card/40 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-medium tabular-nums">{value}</div>
    </div>
  )
}

function SectionTitle({
  title,
  link,
}: {
  title: string
  link?: { to: '/galerie' | '/workflows'; label: string }
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[15px] font-medium">{title}</h2>
      {link && (
        <Link
          to={link.to}
          className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          {link.label} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  )
}

/** Un fil récent : en mosaïque (une grande image et deux petites) ou avec sa dernière image. */
function ThreadCard({ thread, mosaic }: { thread: Thread; mosaic: boolean }) {
  const [big, ...small] = thread.previewUrls
  const tile = 'min-h-0 overflow-hidden rounded-lg bg-white/[0.04]'
  const empty = (
    <span className="grid h-full w-full place-items-center text-muted-foreground/50">
      <ImageIcon className="h-5 w-5" />
    </span>
  )
  const img = (url: string | undefined) =>
    url ? (
      <img src={url} alt="" className="h-full w-full object-cover" />
    ) : (
      empty
    )
  return (
    <Link
      to="/t/$threadId"
      params={{ threadId: thread.id }}
      data-testid="home-thread"
      className="group block min-w-0 rounded-2xl border border-border/50 bg-card/40 p-2 transition-colors hover:border-border hover:bg-card/70"
    >
      {mosaic ? (
        <div className="grid h-56 grid-cols-[2fr_1fr] grid-rows-1 gap-1.5">
          <div className={tile}>{img(big)}</div>
          <div className="grid min-h-0 grid-rows-2 gap-1.5">
            <div className={tile}>{img(small[0])}</div>
            <div className={tile}>{img(small[1])}</div>
          </div>
        </div>
      ) : (
        <div className={cn(tile, 'h-56')}>{img(big)}</div>
      )}
      <div className="px-2 pt-3 pb-1.5">
        <div className="truncate text-[15px] font-medium">{thread.title}</div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          {thread.generationCount} génération
          {thread.generationCount > 1 ? 's' : ''} · {timeAgo(thread.updatedAt)}
        </div>
      </div>
    </Link>
  )
}

/**
 * Workflow : un clic ouvre son canvas. Avec des entrées « À fournir », ▶ le lance dans un
 * fil vierge avec son formulaire.
 */
function WorkflowRow({ workflow: w }: { workflow: WorkflowSummary }) {
  const detail = [
    `${w.nodeCount} nœud${w.nodeCount > 1 ? 's' : ''}`,
    w.usableInThread && `${w.inputCount} entrée${w.inputCount > 1 ? 's' : ''}`,
    timeAgo(w.updatedAt),
  ].filter(Boolean)
  return (
    <div
      data-testid="home-workflow"
      className="group relative flex items-center gap-3 rounded-xl border border-border/50 bg-card/40 p-2.5 transition-colors hover:border-border hover:bg-card/70"
    >
      {/* Toute la ligne ouvre le canvas ; le ▶ passe par-dessus. */}
      <Link
        to="/workflows/$workflowId"
        params={{ workflowId: w.id }}
        aria-label={`Ouvrir ${w.name}`}
        className="absolute inset-0 rounded-xl"
      />
      <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
        {w.coverUrl ? (
          <img src={w.coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Workflow className="h-4 w-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{w.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail.join(' · ')}</span>
      </span>
      {w.usableInThread && (
        <Link
          to="/nouveau"
          search={{ workflow: w.id }}
          aria-label={`Lancer ${w.name} dans un fil`}
          title="Lancer dans un nouveau fil"
          className="relative grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-foreground transition-colors hover:bg-white/[0.16]"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
        </Link>
      )}
    </div>
  )
}

/** Compte neuf : trois premiers pas à la place des fils. */
function FirstSteps({ hasApiKey }: { hasApiKey: boolean }) {
  const steps = [
    {
      done: hasApiKey,
      icon: KeyRound,
      title: 'Ajoute ta clé API',
      text: 'Pour générer des images et des vidéos.',
      link: (
        <Link to="/parametres" search={{ tab: 'api-key' }}>
          Paramétrage
        </Link>
      ),
    },
    {
      done: false,
      icon: Library,
      title: 'Crée un persona',
      text: 'Range ses photos de référence dans la Bibliothèque.',
      link: <Link to="/bibliotheque">Bibliothèque</Link>,
    },
    {
      done: false,
      icon: Workflow,
      title: 'Essaie un workflow',
      text: 'Enchaîne plusieurs étapes, puis lance-le depuis un fil.',
      link: <Link to="/workflows">Workflows</Link>,
    },
  ]
  return (
    <section className="space-y-3">
      <SectionTitle title="Premiers pas" />
      <div className="grid gap-4 sm:grid-cols-3">
        {steps.map(({ done, icon: Icon, title, text, link }) => (
          <div
            key={title}
            className={cn(
              'space-y-2 rounded-2xl border border-border/50 bg-card/40 p-4',
              done && 'opacity-50',
            )}
          >
            <Icon className="h-4 w-4 text-muted-foreground" />
            <div className="text-[14px] font-medium">{title}</div>
            <p className="text-xs text-muted-foreground">{text}</p>
            <div className="text-[13px] text-foreground/80 underline-offset-4 hover:underline">
              {link}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
