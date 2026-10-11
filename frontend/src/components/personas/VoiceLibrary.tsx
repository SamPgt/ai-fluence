/**
 * Voix des personas : catalogue ElevenLabs (grande fenêtre en tableau, filtres,
 * recherche par mots, écoute des extraits), lignes des voix choisies, et lecture
 * d'un seul extrait à la fois dans toute l'app.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  AudioLines,
  Check,
  KeyRound,
  Loader2,
  Mars,
  NonBinary,
  Pause,
  Play,
  Plus,
  Search,
  Users,
  Venus,
  X,
} from 'lucide-react'
import type { PersonaVoice, VoiceLibraryItem } from '@ai-fluence/shared'

import { voicesApi, type VoiceLibraryQuery } from '@/lib/api'
import { settingsQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { FilterGroup, FilterOption } from '@/components/lora/CivitaiBrowser'

// ── Lecture : un seul extrait à la fois, dans toute l'app ─────

let audio: HTMLAudioElement | null = null
let playing: string | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function toggle(url: string) {
  if (typeof window === 'undefined') return
  if (!audio) {
    audio = new Audio()
    audio.addEventListener('ended', () => {
      playing = null
      emit()
    })
  }
  if (playing === url) {
    audio.pause()
    playing = null
  } else {
    audio.src = url
    void audio.play().catch(() => {
      playing = null
      emit()
    })
    playing = url
  }
  emit()
}

/** Arrête l'extrait en cours (fenêtre fermée, page quittée). */
export function stopVoicePreview() {
  if (audio && playing) {
    audio.pause()
    playing = null
    emit()
  }
}

function usePlaying(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => playing,
    () => null,
  )
}

// ── Pastille d'une voix : dégradé texturé, lecture au survol ──

/** Nombre de dégradés `.voice-orb-N` (styles.css). Même ordre sur toutes les pages. */
const ORBS = 12

/**
 * Pastille colorée d'une voix. Le bouton lecture apparaît au survol de la ligne
 * (classe `group/voice` sur le parent) et reste visible pendant la lecture.
 */
export function VoiceOrb({
  index,
  url,
  name,
  size = 'md',
}: {
  index: number
  url: string | null
  name: string
  size?: 'sm' | 'md'
}) {
  const current = usePlaying()
  const active = Boolean(url) && current === url
  return (
    <button
      type="button"
      disabled={!url}
      onClick={(e) => {
        e.stopPropagation()
        if (url) toggle(url)
      }}
      aria-label={
        active ? `Arrêter l’extrait de ${name}` : `Écouter l’extrait de ${name}`
      }
      title={url ? (active ? 'Arrêter' : 'Écouter l’extrait') : 'Pas d’extrait'}
      className={cn(
        'voice-orb relative grid shrink-0 place-items-center overflow-hidden rounded-full text-white disabled:cursor-default',
        `voice-orb-${index % ORBS}`,
        size === 'sm' ? 'size-6' : 'size-7',
      )}
    >
      <span
        className={cn(
          'grid size-full place-items-center bg-black/35 transition-opacity',
          active ? 'opacity-100' : 'opacity-0 group-hover/voice:opacity-100',
          !url && 'hidden',
        )}
      >
        {active ? (
          <Pause className="size-3 fill-current" />
        ) : (
          <Play className="size-3 translate-x-px fill-current" />
        )}
      </span>
    </button>
  )
}

// ── Caractéristiques : pays, drapeau, libellés français ───────

/** Drapeaux disponibles (public/flags, flag-icons, MIT). */
const FLAGS = new Set(
  'fr be ch ca gb us au ie nz za in es mx ar co de at it pt br nl pl ru ua jp cn kr tr se no dk fi gr cz ro hu sa ae eg ma il id ph vn th my sg'.split(
    ' ',
  ),
)

// Accent → pays (les voix ElevenLabs n'ont souvent qu'un accent).
const ACCENT_COUNTRY: Record<string, string> = {
  american: 'us',
  british: 'gb',
  english: 'gb',
  scottish: 'gb',
  australian: 'au',
  irish: 'ie',
  canadian: 'ca',
  indian: 'in',
  'south african': 'za',
  'new zealand': 'nz',
  french: 'fr',
  parisian: 'fr',
  parisien: 'fr',
  quebecois: 'ca',
  belgian: 'be',
  swiss: 'ch',
  spanish: 'es',
  castilian: 'es',
  mexican: 'mx',
  argentine: 'ar',
  argentinian: 'ar',
  colombian: 'co',
  german: 'de',
  austrian: 'at',
  italian: 'it',
  portuguese: 'pt',
  brazilian: 'br',
  dutch: 'nl',
  polish: 'pl',
  russian: 'ru',
  ukrainian: 'ua',
  japanese: 'jp',
  chinese: 'cn',
  mandarin: 'cn',
  korean: 'kr',
  turkish: 'tr',
  swedish: 'se',
  norwegian: 'no',
  danish: 'dk',
  finnish: 'fi',
  greek: 'gr',
  czech: 'cz',
  romanian: 'ro',
  hungarian: 'hu',
  arabic: 'sa',
  egyptian: 'eg',
  moroccan: 'ma',
  hebrew: 'il',
  indonesian: 'id',
  filipino: 'ph',
  vietnamese: 'vn',
  thai: 'th',
}
// Langue → pays le plus courant.
const LANGUAGE_COUNTRY: Record<string, string> = {
  fr: 'fr',
  en: 'us',
  es: 'es',
  de: 'de',
  it: 'it',
  pt: 'pt',
  nl: 'nl',
  pl: 'pl',
  ru: 'ru',
  uk: 'ua',
  ja: 'jp',
  zh: 'cn',
  ko: 'kr',
  tr: 'tr',
  sv: 'se',
  no: 'no',
  da: 'dk',
  fi: 'fi',
  el: 'gr',
  cs: 'cz',
  ro: 'ro',
  hu: 'hu',
  ar: 'sa',
  he: 'il',
  hi: 'in',
  id: 'id',
  fil: 'ph',
  vi: 'vn',
  th: 'th',
  ms: 'my',
}

/** Pays d'une voix : région de la langue (fr-FR), sinon accent, sinon langue. */
export function countryOf(labels: Record<string, string>): string | null {
  const region = labels.locale?.split(/[-_]/)[1]?.toLowerCase()
  if (region && region.length === 2) return region
  const accent = labels.accent?.toLowerCase().trim()
  if (accent && ACCENT_COUNTRY[accent]) return ACCENT_COUNTRY[accent]
  const lang = (labels.language ?? labels.locale)
    ?.split(/[-_]/)[0]
    ?.toLowerCase()
  return (lang && LANGUAGE_COUNTRY[lang]) || null
}

let regionNames: Intl.DisplayNames | null = null
export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(['fr'], { type: 'region' })
    return regionNames.of(code.toUpperCase()) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

export function Flag({
  code,
  className,
}: {
  code: string
  className?: string
}) {
  if (!FLAGS.has(code)) return null
  return (
    <img
      src={`/flags/${code}.svg`}
      alt=""
      className={cn('size-4 shrink-0 rounded-full', className)}
    />
  )
}

// Libellés français des caractéristiques courantes ; les autres restent tels quels.
const LABELS: Record<string, string> = {
  male: 'Homme',
  female: 'Femme',
  neutral: 'Neutre',
  non_binary: 'Neutre',
  young: 'Jeune',
  middle_aged: 'Âge moyen',
  'middle-aged': 'Âge moyen',
  old: 'Âgé',
  conversational: 'Conversation',
  social_media: 'Réseaux sociaux',
  narrative_story: 'Narration',
  narration: 'Narration',
  characters_animation: 'Personnages',
  entertainment_tv: 'Divertissement',
  advertisement: 'Publicité',
  informative_educational: 'Éducatif',
  calm: 'Calme',
  confident: 'Assurée',
  warm: 'Chaleureuse',
  deep: 'Grave',
  soft: 'Douce',
  professional: 'Professionnelle',
  casual: 'Décontractée',
  energetic: 'Énergique',
  seductive: 'Séduisante',
  husky: 'Rauque',
  raspy: 'Éraillée',
  whispery: 'Chuchotée',
}
const fr = (value: string) =>
  LABELS[value.toLowerCase()] ?? value.replace(/_/g, ' ')

/** Tags affichés : caractère de la voix d'abord, puis usage, âge, genre, accent. */
function tagsOf(labels: Record<string, string>): string[] {
  const order = [
    'descriptive',
    'description',
    'use_case',
    'age',
    'gender',
    'accent',
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const key of order) {
    const v = labels[key]
    if (!v) continue
    const t = fr(v)
    if (!seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase())
      out.push(t)
    }
  }
  return out
}

export function Tags({
  labels,
  max = 3,
}: {
  labels: Record<string, string>
  max?: number
}) {
  const tags = tagsOf(labels)
  if (!tags.length) return null
  return (
    <span className="flex flex-wrap items-center gap-1">
      {tags.slice(0, max).map((t) => (
        <span
          key={t}
          className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-muted-foreground"
        >
          {t}
        </span>
      ))}
      {tags.length > max && (
        <span
          className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
          title={tags.slice(max).join(', ')}
        >
          +{tags.length - max}
        </span>
      )}
    </span>
  )
}

function Country({ labels }: { labels: Record<string, string> }) {
  const code = countryOf(labels)
  if (!code) return <span className="text-muted-foreground">Non précisé</span>
  return (
    <span className="flex items-center gap-2">
      <Flag code={code} />
      <span className="truncate">{countryName(code)}</span>
    </span>
  )
}

/** Origine d'une voix : catalogue d'ElevenLabs ou bibliothèque communautaire. */
function Source({ source }: { source: VoiceLibraryItem['source'] }) {
  const own = source === 'default'
  return (
    <span
      data-testid="voice-source"
      className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground"
    >
      {own ? (
        <img
          src="/providers/elevenlabs.svg"
          alt=""
          className="size-3 opacity-80"
        />
      ) : (
        <Users className="size-3" />
      )}
      {own ? 'ElevenLabs' : 'Communauté'}
    </span>
  )
}

/** Ligne d'une voix choisie pour le persona : pastille (écoute), nom, tags, pays, retrait. */
export function PersonaVoiceRow({
  voice,
  index,
  onRemove,
}: {
  voice: PersonaVoice
  index: number
  onRemove: () => void
}) {
  return (
    <div
      data-testid="persona-voice"
      className="group/voice flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 p-2.5"
    >
      <VoiceOrb index={index} url={voice.previewUrl} name={voice.name} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="truncate text-sm font-medium">{voice.name}</div>
        <Tags labels={voice.labels} />
      </div>
      <div className="hidden w-36 text-[13px] sm:block">
        <Country labels={voice.labels} />
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Retirer la voix ${voice.name}`}
        title="Retirer"
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-red-400"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

// ── Catalogue ElevenLabs ──────────────────────────────────────

const SOURCES = [
  { value: 'all', label: 'Tous' },
  { value: 'default', label: 'Voix ElevenLabs' },
  { value: 'library', label: 'Communauté' },
]
const GENDERS = [
  { value: '', label: 'Tous', Icon: Users },
  { value: 'female', label: 'Femme', Icon: Venus },
  { value: 'male', label: 'Homme', Icon: Mars },
  { value: 'neutral', label: 'Neutre', Icon: NonBinary },
]
const AGES = [
  { value: '', label: 'Tous' },
  { value: 'young', label: 'Jeune' },
  { value: 'middle_aged', label: 'Âge moyen' },
  { value: 'old', label: 'Âgé' },
]
const LANGUAGES = [
  { value: '', label: 'Toutes', flag: null },
  { value: 'fr', label: 'Français', flag: 'fr' },
  { value: 'en', label: 'Anglais', flag: 'gb' },
  { value: 'es', label: 'Espagnol', flag: 'es' },
  { value: 'de', label: 'Allemand', flag: 'de' },
  { value: 'it', label: 'Italien', flag: 'it' },
  { value: 'pt', label: 'Portugais', flag: 'pt' },
]
const USE_CASES = [
  { value: '', label: 'Tous' },
  { value: 'conversational', label: 'Conversation' },
  { value: 'social_media', label: 'Réseaux sociaux' },
  { value: 'narrative_story', label: 'Narration' },
  { value: 'characters_animation', label: 'Personnages' },
  { value: 'advertisement', label: 'Publicité' },
]

/** Texte cherché : nom, pays (en français), accent, langue, tags, description. */
function haystack(v: VoiceLibraryItem): string {
  const code = countryOf(v.labels)
  return [
    v.name,
    v.description ?? '',
    ...Object.values(v.labels),
    ...tagsOf(v.labels),
    code ? countryName(code) : '',
  ]
    .join(' ')
    .toLowerCase()
}

type Filters = Omit<VoiceLibraryQuery, 'search' | 'page'>

export function VoiceLibraryDialog({
  open,
  onOpenChange,
  chosenIds,
  onAdd,
  onRemove,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Voix déjà dans le persona (identifiants ElevenLabs). */
  chosenIds: string[]
  onAdd: (voice: VoiceLibraryItem) => void
  onRemove: (voiceId: string) => void
}) {
  const { data: settings } = useQuery(settingsQuery())
  const [text, setText] = useState('')
  const [filters, setFilters] = useState<Filters>({ source: 'all' })
  useEffect(() => {
    if (!open) stopVoicePreview()
  }, [open])

  const hasKey = Boolean(settings?.hasElevenLabsKey)
  const library = useQuery({
    queryKey: ['voice-library', filters],
    queryFn: () => voicesApi.library(filters),
    enabled: open && hasKey,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const setFilter = (key: keyof Filters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value || undefined }))

  // Recherche à l'écran : une voix reste si elle contient au moins un des mots tapés.
  const voices = useMemo(() => {
    const all = library.data?.voices ?? []
    const words = text.toLowerCase().split(/\s+/).filter(Boolean)
    return words.length
      ? all.filter((v) => words.some((w) => haystack(v).includes(w)))
      : all
  }, [library.data, text])

  const options = (
    key: keyof Filters,
    list: { value: string; label: string }[],
    icon?: (o: never) => React.ReactNode,
  ) =>
    list.map((o) => (
      <FilterOption
        key={o.value}
        active={(filters[key] ?? '') === o.value}
        onClick={() => setFilter(key, o.value)}
      >
        {icon?.(o as never)}
        {o.label}
      </FilterOption>
    ))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="inset-0 top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 sm:max-w-none data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100"
      >
        <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col px-8">
          <div className="flex items-center gap-3 border-b border-border/60 py-5">
            <div className="grid size-9 place-items-center rounded-lg bg-white/[0.06]">
              <AudioLines className="size-[18px]" />
            </div>
            <div>
              <DialogTitle className="text-[15px]">Voix ElevenLabs</DialogTitle>
              <p className="text-xs text-muted-foreground">
                Écoute les extraits, puis ajoute au persona les voix qui lui
                ressemblent.
              </p>
            </div>
            <DialogClose
              aria-label="Fermer"
              className="ml-auto grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-[18px]" />
            </DialogClose>
          </div>

          {!hasKey ? (
            <div className="grid flex-1 place-items-center">
              <div className="max-w-sm space-y-3 text-center">
                <KeyRound className="mx-auto size-6 text-muted-foreground" />
                <p className="text-sm">
                  Ajoute ta clé ElevenLabs pour parcourir leurs voix.
                </p>
                <Button asChild variant="outline">
                  <Link
                    to="/parametres"
                    search={{ tab: 'api-key' }}
                    onClick={() => onOpenChange(false)}
                  >
                    Ajouter la clé
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <aside className="w-60 shrink-0 space-y-6 overflow-y-auto border-r border-border/60 py-5 pr-5">
                <FilterGroup title="Source">
                  {options('source', SOURCES)}
                </FilterGroup>
                <FilterGroup title="Genre">
                  {GENDERS.map(({ value, label, Icon }) => (
                    <FilterOption
                      key={value}
                      active={(filters.gender ?? '') === value}
                      onClick={() => setFilter('gender', value)}
                    >
                      <Icon className="mr-2 size-3.5 shrink-0" />
                      {label}
                    </FilterOption>
                  ))}
                </FilterGroup>
                <FilterGroup title="Âge">{options('age', AGES)}</FilterGroup>
                <FilterGroup title="Langue">
                  {LANGUAGES.map((o) => (
                    <FilterOption
                      key={o.value}
                      active={(filters.language ?? '') === o.value}
                      onClick={() => setFilter('language', o.value)}
                    >
                      {o.flag ? (
                        <Flag code={o.flag} className="mr-2 size-3.5" />
                      ) : (
                        <span className="mr-2 size-3.5 shrink-0" />
                      )}
                      {o.label}
                    </FilterOption>
                  ))}
                </FilterGroup>
                <FilterGroup title="Usage">
                  {options('useCase', USE_CASES)}
                </FilterGroup>
              </aside>

              <div className="flex min-w-0 flex-1 flex-col py-5 pl-5">
                <div className="flex items-center justify-between gap-4 pb-3">
                  <div className="relative w-[300px]">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      autoFocus
                      placeholder="Nom, pays, accent ou tag…"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      className="pl-8"
                      aria-label="Rechercher une voix"
                    />
                  </div>
                  {library.data && (
                    <span className="text-[13px] text-muted-foreground tabular-nums">
                      {voices.length} voix
                    </span>
                  )}
                </div>

                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
                  {library.isLoading ? (
                    <div className="grid h-full place-items-center">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : library.error ? (
                    <p className="grid h-full place-items-center text-sm text-muted-foreground">
                      {(library.error as Error).message}
                    </p>
                  ) : !voices.length ? (
                    <p className="grid h-full place-items-center text-sm text-muted-foreground">
                      Aucune voix trouvée.
                    </p>
                  ) : (
                    <table className="w-full table-fixed border-separate border-spacing-y-1 text-[13px]">
                      <thead className="text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                        <tr>
                          <th className="w-12 pb-1 pl-2 font-medium">
                            <span className="sr-only">Écouter</span>
                          </th>
                          <th className="pb-1 font-medium">Nom</th>
                          <th className="w-48 pb-1 font-medium">Pays</th>
                          <th className="pb-1 font-medium">Caractéristiques</th>
                          <th className="w-32 pb-1 font-medium">Source</th>
                          <th className="w-32 pb-1 pr-2 text-right font-medium">
                            <span className="sr-only">Ajouter</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {voices.map((v, i) => {
                          const chosen = chosenIds.includes(v.voiceId)
                          return (
                            <tr
                              key={v.voiceId}
                              data-testid="library-voice"
                              className="group/voice [&>td]:transition-colors hover:[&>td]:bg-white/[0.04]"
                            >
                              <td className="rounded-l-xl py-2 pl-2">
                                <VoiceOrb
                                  index={i}
                                  url={v.previewUrl}
                                  name={v.name}
                                />
                              </td>
                              <td className="py-2 pr-4">
                                <div className="truncate font-medium">
                                  {v.name}
                                </div>
                                {v.description && (
                                  <div
                                    className="truncate text-[11px] text-muted-foreground"
                                    title={v.description}
                                  >
                                    {v.description}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 pr-4">
                                <Country labels={v.labels} />
                              </td>
                              <td className="py-2 pr-4">
                                <Tags labels={v.labels} />
                              </td>
                              <td className="py-2">
                                <Source source={v.source} />
                              </td>
                              <td className="rounded-r-xl py-2 pr-2 text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    chosen ? onRemove(v.voiceId) : onAdd(v)
                                  }
                                  aria-label={
                                    chosen
                                      ? `Retirer ${v.name}`
                                      : `Ajouter ${v.name}`
                                  }
                                  aria-pressed={chosen}
                                  className={cn(
                                    chosen && 'border-foreground/40',
                                  )}
                                >
                                  {chosen ? (
                                    <Check className="size-3.5" />
                                  ) : (
                                    <Plus className="size-3.5" />
                                  )}
                                  {chosen ? 'Ajoutée' : 'Ajouter'}
                                </Button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
