/**
 * Connexions de dictée en direct, une par fournisseur, derrière la même petite interface :
 * `onPartial` (segment en cours, réécrit au fil de la parole), `onCommit` (segment validé),
 * `onError`. Le navigateur parle directement au fournisseur avec un jeton temporaire.
 */
import type { DictationProvider } from '@sublime/shared'

export interface DictationHandlers {
  onReady: () => void
  onPartial: (text: string) => void
  onCommit: (text: string) => void
  onError: (message: string) => void
}

export interface DictationSession {
  close: () => void
}

/**
 * Fournisseurs à qui l'on envoie nous-mêmes l'audio : le micro peut s'ouvrir avant la
 * connexion (audio mis en attente, rien de perdu), donc « écoute » s'affiche tout de suite
 * sans mentir. ElevenLabs ouvre lui-même le micro une fois connecté : pas d'avance possible.
 */
export const MIC_FIRST: ReadonlySet<DictationProvider> = new Set([
  'deepgram',
  'cartesia',
])

/**
 * `keyterms` : vocabulaire à privilégier (déjà coupé selon les limites du fournisseur).
 * `mic` : micro déjà ouvert (fournisseurs de MIC_FIRST), sinon il est ouvert ici.
 */
export async function connectDictation(
  provider: DictationProvider,
  token: string,
  handlers: DictationHandlers,
  keyterms: string[] = [],
  mic?: MicBuffer,
): Promise<DictationSession> {
  if (provider === 'elevenlabs') {
    mic?.stop()
    return connectElevenLabs(token, handlers, keyterms)
  }
  const m = mic ?? (await openMicBuffer())
  return provider === 'deepgram'
    ? connectDeepgram(token, handlers, keyterms, m)
    : connectCartesia(token, handlers, keyterms, m)
}

/** `&keyterm=…` répété, un par mot-clé (Deepgram, Cartesia). */
const keytermParams = (terms: string[]) =>
  terms.map((t) => `&keyterm=${encodeURIComponent(t)}`).join('')

// ── ElevenLabs Scribe v2 Realtime (SDK) ──────────────────────

async function connectElevenLabs(
  token: string,
  h: DictationHandlers,
  keyterms: string[],
): Promise<DictationSession> {
  const { Scribe, RealtimeEvents, CommitStrategy } =
    await import('@elevenlabs/client')
  const conn = Scribe.connect({
    token,
    modelId: 'scribe_v2_realtime',
    keyterms,
    // Un segment est validé à chaque pause ; la langue est détectée (français, anglais…).
    commitStrategy: CommitStrategy.VAD,
    microphone: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
  conn.on(RealtimeEvents.SESSION_STARTED, () => h.onReady())
  conn.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (d) => h.onPartial(d.text))
  conn.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (d) => h.onCommit(d.text))
  conn.on(RealtimeEvents.ERROR, (e) => {
    const err = e as { error?: string; message?: string }
    h.onError(err.error ?? err.message ?? '')
  })
  return { close: () => conn.close() }
}

// ── Deepgram Flux (WebSocket direct) ─────────────────────────

/** Micro en PCM 16 bits, 16 kHz, par paquets de 80 ms (taille conseillée par Deepgram). */
const PCM_WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(1280); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]))
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer])
        this.buf = new Int16Array(1280); this.n = 0
      }
    }
    return true
  }
}
registerProcessor('pcm16', Pcm16)
`

/** Micro capté en PCM 16 kHz : `onChunk` reçoit chaque paquet de 80 ms. */
async function openMic(onChunk: (chunk: ArrayBuffer) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
  // Le navigateur rééchantillonne le micro à 16 kHz.
  const ctx = new AudioContext({ sampleRate: 16000 })
  const workletUrl = URL.createObjectURL(
    new Blob([PCM_WORKLET], { type: 'application/javascript' }),
  )
  await ctx.audioWorklet.addModule(workletUrl)
  URL.revokeObjectURL(workletUrl)
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'pcm16')
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(e.data)
  source.connect(node)
  node.connect(ctx.destination)
  return () => {
    node.port.onmessage = null
    source.disconnect()
    node.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }
}

/** Micro ouvert dont l'audio attend une connexion : envoyé dès qu'elle est prête. */
export interface MicBuffer {
  attach: (ws: WebSocket) => void
  stop: () => void
}

/**
 * Ouvre le micro tout de suite et garde l'audio en attente : il part sur la connexion
 * dès qu'elle est ouverte (`attach`), rien n'est perdu au démarrage.
 */
export async function openMicBuffer(): Promise<MicBuffer> {
  const queued: ArrayBuffer[] = []
  let target: WebSocket | null = null
  const stopMic = await openMic((chunk) => {
    if (target?.readyState === WebSocket.OPEN) target.send(chunk)
    else queued.push(chunk)
  })
  return {
    attach: (ws) => {
      target = ws
      ws.binaryType = 'arraybuffer'
      const flush = () => queued.splice(0).forEach((b) => ws.send(b))
      if (ws.readyState === WebSocket.OPEN) flush()
      else ws.addEventListener('open', flush)
    },
    stop: stopMic,
  }
}

async function connectDeepgram(
  token: string,
  h: DictationHandlers,
  keyterms: string[],
  mic: MicBuffer,
): Promise<DictationSession> {
  // Français et anglais : la langue est détectée phrase par phrase.
  // `numerals` : les nombres dits sont écrits en chiffres (« quatre images » → « 4 images »).
  const ws = new WebSocket(
    `wss://api.deepgram.com/v2/listen?model=flux-general-multi&encoding=linear16&sample_rate=16000&language_hint=fr&language_hint=en&numerals=true${keytermParams(keyterms)}`,
    ['bearer', token],
  )
  mic.attach(ws)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    mic.stop()
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'CloseStream' }))
    ws.close()
  }
  // La connexion a pu s'ouvrir pendant la mise en route du micro.
  if (ws.readyState === WebSocket.OPEN) h.onReady()
  else ws.onopen = () => h.onReady()
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as {
      type: string
      event?: string
      transcript?: string
      description?: string
    }
    if (msg.type === 'TurnInfo') {
      // Chaque mise à jour redonne tout le tour en cours ; la fin du tour le valide.
      if (msg.event === 'EndOfTurn') h.onCommit(msg.transcript ?? '')
      else h.onPartial(msg.transcript ?? '')
    } else if (msg.type === 'Error') {
      h.onError(msg.description ?? '')
      close()
    }
  }
  ws.onerror = () => {
    if (!closed) h.onError('connexion à Deepgram impossible')
    close()
  }
  ws.onclose = () => {
    if (!closed) close()
  }
  return { close }
}

// ── Cartesia Ink-2 (WebSocket direct) ────────────────────────

async function connectCartesia(
  token: string,
  h: DictationHandlers,
  keyterms: string[],
  mic: MicBuffer,
): Promise<DictationSession> {
  const ws = new WebSocket(
    `wss://api.cartesia.ai/stt/websocket?model=ink-2&encoding=pcm_s16le&sample_rate=16000&cartesia_version=2026-08-14&access_token=${encodeURIComponent(token)}${keytermParams(keyterms)}`,
  )
  mic.attach(ws)
  // Ink-2 envoie le texte validé par petits morceaux, à mettre bout à bout tels quels.
  let text = ''
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    mic.stop()
    if (ws.readyState === WebSocket.OPEN) ws.send('close')
    ws.close()
  }
  // La connexion a pu s'ouvrir pendant la mise en route du micro.
  if (ws.readyState === WebSocket.OPEN) h.onReady()
  else ws.onopen = () => h.onReady()
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as {
      type: string
      is_final?: boolean
      text?: string
      message?: string
    }
    if (msg.type === 'transcript' && msg.is_final && msg.text) {
      text += msg.text
      h.onPartial(text)
    } else if (msg.type === 'error') {
      h.onError(msg.message ?? '')
      close()
    }
  }
  ws.onerror = () => {
    if (!closed) h.onError('connexion à Cartesia impossible')
    close()
  }
  ws.onclose = () => {
    if (!closed) close()
  }
  return { close }
}
