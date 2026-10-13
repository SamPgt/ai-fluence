"""
Serveur de voix local (Chatterbox Multilingual) pour AI Fluence.

Outil local, comme ComfyUI : le backend le lance au besoin (commande `VOICE_LAUNCH` du .env)
et lui parle en HTTP sur `VOICE_URL`. Il tourne dans son propre environnement Python
(Chatterbox impose ses versions de torch et de numpy, incompatibles avec celles de ComfyUI).

Le modèle (~3 Go de VRAM) est chargé à la première demande et libéré après quelques minutes
sans activité, ou à la demande du backend avant une génération vidéo (`POST /unload`).

Les chemins de fichiers reçus sont ceux du disque local, partagé avec le backend.

  GET  /health      → {"ok": true, "loaded": bool}
  POST /tts         {text, reference, exaggeration?, cfg_weight?, seed?, language?} → audio/wav
  POST /reference   {source, output, max_seconds?} → {"duration": float}
  POST /unload      → {"ok": true}
"""
import argparse
import gc
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument('--host', default='127.0.0.1')
parser.add_argument('--port', type=int, default=8190)
parser.add_argument('--idle', type=int, default=300, help='Secondes sans activité avant de libérer la VRAM.')
parser.add_argument('--models', help='Dossier du cache Hugging Face où sont (ou seront) les poids de Chatterbox.')
args = parser.parse_args()

# Avant d'importer Chatterbox : sinon les poids (3 Go) partent dans le cache par défaut, sur le disque système.
if args.models:
    os.environ['HF_HOME'] = args.models

import librosa  # noqa: E402
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import torch  # noqa: E402

model = None
model_lock = threading.Lock()
last_used = time.time()


def get_model():
    global model
    if model is None:
        import huggingface_hub.constants as hf_constants
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        # Hors ligne d'abord : sinon chaque chargement interroge Hugging Face, et une connexion lente ou
        # coupée le bloque plusieurs minutes. En ligne seulement si les poids ne sont pas encore là.
        hf_constants.HF_HUB_OFFLINE = True
        try:
            model = ChatterboxMultilingualTTS.from_pretrained(device=device)
        except Exception:  # noqa: BLE001
            hf_constants.HF_HUB_OFFLINE = False
            model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    return model


def unload():
    global model
    with model_lock:
        if model is not None:
            model = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()


def idle_watcher():
    while True:
        time.sleep(30)
        if model is not None and time.time() - last_used > args.idle:
            unload()


def voiced_ratio(seg: np.ndarray, sr: int) -> float:
    """Part des trames où l'on entend une hauteur de voix (pyin) : ~0,5 à 1 pour un mot, 0 pour un souffle ou un bruit."""
    if len(seg) < int(0.05 * sr):
        return 0.0
    _, flag, _ = librosa.pyin(seg, fmin=70, fmax=500, sr=sr, frame_length=2048, hop_length=sr // 100)
    return float(np.mean(flag))


def drop_stray_tail(wav: np.ndarray, sr: int) -> np.ndarray:
    """
    Chatterbox ajoute parfois un bruit après la dernière phrase, de deux sortes :
    - un « boum » court et fort (≤ 0,5 s) après ≥ 0,35 s de quasi-silence ;
    - un souffle fort et long (jusqu'à ~1,5 s), sans hauteur de voix.
    On retire ces morceaux en fin de piste (trois au plus). Le « quasi-silence » est à 30 dB sous le pic, et une
    consonne finale sourde collée au mot (le « k » de « mec ») est gardée : courte et sans pause avant.
    Testé sur 32 pistes (2026-10-12) : les 9 bruitées sont coupées, aucun mot réel n'est touché, < 1 s de calcul.
    """
    def parts_of(w: np.ndarray) -> np.ndarray:
        return librosa.effects.split(w, top_db=30, frame_length=1024, hop_length=256)

    for _ in range(3):
        parts = parts_of(wav)
        if len(parts) < 2:
            break
        a, b = parts[-1]
        gap = (a - parts[-2][1]) / sr
        length = (b - a) / sr
        burst = gap >= 0.35 and length <= 0.5
        hiss = (length >= 0.3 or gap >= 0.25) and voiced_ratio(wav[a:b], sr) < 0.2
        if not (burst or hiss):
            break
        wav = wav[: parts[-2][1]]
    parts = parts_of(wav)
    end = parts[-1][1] if len(parts) else len(wav)
    return wav[: min(len(wav), end + int(0.15 * sr))]


def tts(body: dict) -> bytes:
    global last_used
    text = str(body.get('text', '')).strip()
    if not text:
        raise ValueError('Texte vide.')
    with model_lock:
        m = get_model()
        torch.manual_seed(int(body.get('seed', 0)))
        wav = m.generate(
            text,
            language_id=str(body.get('language', 'fr')),
            audio_prompt_path=body.get('reference') or None,
            exaggeration=float(body.get('exaggeration', 0.5)),
            cfg_weight=float(body.get('cfg_weight', 0.5)),
        )
        sr = m.sr
        last_used = time.time()
    samples = drop_stray_tail(wav.squeeze(0).cpu().numpy(), sr)
    out = io.BytesIO()
    sf.write(out, samples, sr, format='WAV', subtype='PCM_16')
    return out.getvalue()


def reference(body: dict) -> dict:
    """Extrait de référence d'une voix : sans silences aux bords, mono 24 kHz, 10 s au plus."""
    wav, sr = librosa.load(body['source'], sr=24000, mono=True)
    wav, _ = librosa.effects.trim(wav, top_db=35)
    wav = wav[: int(float(body.get('max_seconds', 10)) * sr)]
    if len(wav) < sr:
        raise ValueError('Pas assez de voix dans l’extrait (moins d’une seconde).')
    sf.write(body['output'], wav, sr, subtype='PCM_16')
    return {'duration': round(len(wav) / sr, 2)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        pass

    def reply(self, code: int, data: bytes, mime: str, headers: dict | None = None):
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def json(self, code: int, obj: dict):
        self.reply(code, json.dumps(obj).encode(), 'application/json')

    def do_GET(self):
        if self.path == '/health':
            return self.json(200, {'ok': True, 'loaded': model is not None})
        self.json(404, {'error': 'Introuvable.'})

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(length) or b'{}')
            if self.path == '/tts':
                return self.reply(200, tts(body), 'audio/wav')
            if self.path == '/reference':
                return self.json(200, reference(body))
            if self.path == '/unload':
                unload()
                return self.json(200, {'ok': True})
            self.json(404, {'error': 'Introuvable.'})
        except Exception as err:  # noqa: BLE001 — l'erreur est renvoyée au backend
            self.json(500, {'error': str(err)})


if __name__ == '__main__':
    threading.Thread(target=idle_watcher, daemon=True).start()
    print(f'Serveur de voix sur http://{args.host}:{args.port}', flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
