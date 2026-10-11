import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Mic, Play, Sparkles, Square, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Persona, PersonaVoice } from '@ai-fluence/shared'
import { personasApi } from '@/lib/api'
import { qk } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const SAMPLE = 'Salut les petits chats ! Aujourd’hui, je vous montre ma recette de pâtes préférée. Vous allez adorer !'

/** Temps écoulé depuis le lancement, en minutes et secondes. */
function useElapsed(since: string | null): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!since) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [since])
  if (!since) return ''
  const s = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000))
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
}

/**
 * Voix du personnage pour les vidéos parlées (outil local) : créée une fois par LTX-2.3 à partir de son image,
 * essayée sur quelques phrases, puis réutilisée par le « Texte dit » des vidéos LTX.
 */
export function PersonaVoiceCard({ persona }: { persona: Persona }) {
  const queryClient = useQueryClient()
  const { data: voice } = useQuery({
    queryKey: qk.voice(persona.id),
    queryFn: () => personasApi.voice(persona.id).then((r) => r.voice),
    // Création en cours : on relit son état (le backend le rapatrie de ComfyUI une fois prêt).
    refetchInterval: (q) => (q.state.data?.job?.state === 'running' ? 4000 : false),
  })
  const [description, setDescription] = useState('')
  const [text, setText] = useState(SAMPLE)
  const [exaggeration, setExaggeration] = useState<number | null>(null)
  const [playing, setPlaying] = useState<'current' | 'candidate' | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const elapsed = useElapsed(voice?.job?.state === 'running' ? voice.job.startedAt : null)

  const setVoice = (v: PersonaVoice) => queryClient.setQueryData(qk.voice(persona.id), v)
  const onError = (e: Error) => toast.error(e.message)

  const create = useMutation({
    mutationFn: () => personasApi.createVoice(persona.id, description),
    onSuccess: (r) => setVoice(r.voice),
    onError,
  })
  const cancel = useMutation({
    mutationFn: () => personasApi.cancelVoice(persona.id),
    onSuccess: (r) => setVoice(r.voice),
    onError,
  })
  const decide = useMutation({
    mutationFn: (keep: boolean) => personasApi.decideVoice(persona.id, keep),
    onSuccess: (r, keep) => {
      setVoice(r.voice)
      if (keep) toast.success(`C’est la voix de ${persona.name}.`)
    },
    onError,
  })
  const update = useMutation({
    mutationFn: (body: { exaggeration?: number; clearJob?: boolean }) => personasApi.updateVoice(persona.id, body),
    onSuccess: (r) => setVoice(r.voice),
    onError,
  })
  const preview = useMutation({
    mutationFn: (candidate: boolean) =>
      personasApi.previewVoice(persona.id, { text, exaggeration: exaggeration ?? voice?.exaggeration, candidate }),
    onSuccess: (blob, candidate) => {
      audioRef.current?.pause()
      const audio = new Audio(URL.createObjectURL(blob))
      audioRef.current = audio
      setPlaying(candidate ? 'candidate' : 'current')
      audio.onended = () => setPlaying(null)
      void audio.play()
    },
    onError,
  })

  useEffect(() => () => audioRef.current?.pause(), [])

  if (!voice?.enabled) return null
  const running = voice.job?.state === 'running'
  const level = exaggeration ?? voice.exaggeration
  const canTry = Boolean(voice.url || voice.candidate)

  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-card/50 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Mic className="h-4 w-4" /> Voix
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          La voix de {persona.name} pour les vidéos parlées (LTX-2.3, en local) : créée une fois à partir de son image,
          puis réutilisée par le « Texte dit » de chaque vidéo.
        </p>
      </div>

      {voice.url ? (
        <div className="flex items-center gap-3">
          <audio controls src={voice.url} className="h-9 flex-1" />
          {voice.durationSeconds && <span className="text-xs text-muted-foreground">{voice.durationSeconds.toFixed(1)} s</span>}
        </div>
      ) : (
        !voice.candidate && !running && <p className="text-sm text-muted-foreground">Pas encore de voix.</p>
      )}

      {voice.candidate && (
        <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm font-medium">Voix proposée</p>
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            {voice.candidate.videoUrl && (
              <video controls src={voice.candidate.videoUrl} className="w-full rounded-md bg-black" />
            )}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                La vidéo de création (les mots y sont approximatifs, seul le timbre compte) et l’extrait gardé comme voix.
              </p>
              <audio controls src={voice.candidate.audioUrl} className="h-9 w-full" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => decide.mutate(true)} disabled={decide.isPending}>
                  <Check className="h-4 w-4" /> Garder cette voix
                </Button>
                <Button size="sm" variant="ghost" onClick={() => decide.mutate(false)} disabled={decide.isPending}>
                  <X className="h-4 w-4" /> Écarter
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {running ? (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 p-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Création de la voix dans ComfyUI… {elapsed} (environ 5 min)
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            <Square className="h-3.5 w-3.5" /> Arrêter
          </Button>
        </div>
      ) : voice.job?.state === 'failed' ? (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-500/40 p-3 text-sm">
          <span className="text-red-400">La création a échoué : {voice.job.error}</span>
          <Button size="sm" variant="ghost" onClick={() => update.mutate({ clearJob: true })}>
            OK
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="voice-description">Décris sa voix (facultatif)</Label>
          <div className="flex gap-2">
            <Input
              id="voice-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="voix douce et posée, légèrement grave…"
              maxLength={300}
            />
            <Button variant="outline" onClick={() => create.mutate()} disabled={create.isPending || !persona.avatarAssetId}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {voice.url ? 'Créer une autre voix' : 'Créer une voix'}
            </Button>
          </div>
          {!persona.avatarAssetId && (
            <p className="text-xs text-muted-foreground">Il faut d’abord une image de référence (avatar) au personnage.</p>
          )}
        </div>
      )}

      {canTry && (
        <div className="space-y-3 border-t border-border/40 pt-4">
          <Label htmlFor="voice-text">Essayer la voix</Label>
          <Textarea id="voice-text" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={400} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Calme
              <input
                type="range"
                min={0.25}
                max={1}
                step={0.05}
                value={level}
                onChange={(e) => setExaggeration(Number(e.target.value))}
                onPointerUp={() => exaggeration !== null && update.mutate({ exaggeration })}
                onKeyUp={() => exaggeration !== null && update.mutate({ exaggeration })}
                className="w-32 accent-primary"
              />
              Expressive
            </label>
            <div className="ml-auto flex gap-2">
              {voice.candidate && (
                <Button size="sm" variant="outline" onClick={() => preview.mutate(true)} disabled={preview.isPending || !text.trim()}>
                  {preview.isPending && preview.variables ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {playing === 'candidate' ? 'Lecture…' : 'Écouter (voix proposée)'}
                </Button>
              )}
              {voice.url && (
                <Button size="sm" onClick={() => preview.mutate(false)} disabled={preview.isPending || !text.trim()}>
                  {preview.isPending && !preview.variables ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {playing === 'current' ? 'Lecture…' : 'Écouter'}
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Quelques secondes par phrase (un peu plus au premier essai, le temps de charger le modèle). L’expressivité
            réglée ici sert aussi aux vidéos.
          </p>
        </div>
      )}
    </section>
  )
}
