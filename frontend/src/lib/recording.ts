/**
 * Enregistrement au micro et conversion en WAV, dans le navigateur. Le serveur de voix reçoit toujours du WAV : pas
 * besoin de ffmpeg côté serveur pour le WebM du micro ou un MP3 importé (le navigateur sait les décoder).
 */

/** Démarre l'enregistrement ; `stop()` rend l'audio en WAV mono 16 bits. */
export async function startRecording(): Promise<{ stop: () => Promise<Blob>; cancel: () => void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  recorder.start()
  const release = () => stream.getTracks().forEach((t) => t.stop())
  return {
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onstop = async () => {
          release()
          try {
            resolve(await toWav(new Blob(chunks, { type: recorder.mimeType })))
          } catch (e) {
            reject(e)
          }
        }
        recorder.stop()
      }),
    cancel: () => {
      recorder.onstop = release
      recorder.stop()
    },
  }
}

/** Décode un fichier audio (WebM, MP3, M4A, OGG, WAV…) et le réécrit en WAV mono 16 bits. */
export async function toWav(audio: Blob): Promise<Blob> {
  const ctx = new AudioContext()
  try {
    const buffer = await ctx.decodeAudioData(await audio.arrayBuffer())
    const length = buffer.length
    const mono = new Float32Array(length)
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c)
      for (let i = 0; i < length; i++) mono[i] += data[i] / buffer.numberOfChannels
    }
    const view = new DataView(new ArrayBuffer(44 + length * 2))
    const text = (offset: number, s: string) => [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)))
    text(0, 'RIFF')
    view.setUint32(4, 36 + length * 2, true)
    text(8, 'WAVE')
    text(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, buffer.sampleRate, true)
    view.setUint32(28, buffer.sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    text(36, 'data')
    view.setUint32(40, length * 2, true)
    for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, mono[i])) * 0x7fff, true)
    return new Blob([view], { type: 'audio/wav' })
  } finally {
    void ctx.close()
  }
}
