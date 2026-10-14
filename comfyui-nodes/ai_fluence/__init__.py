"""
Nœuds ComfyUI d'AI Fluence. À copier dans `ComfyUI/custom_nodes/ai_fluence` (cf. README, « Corriger visages, mains
et pieds »), puis redémarrer ComfyUI.

AIFluenceDetectParts : repère les visages, les mains et les pieds d'une image et renvoie leurs cadres en JSON
([{"kind": "face", "x": .., "y": .., "width": .., "height": .., "conf": ..}], en pixels de l'image).
- visages et mains : modèles du projet ADetailer (`models/ultralytics/bbox/face_yolov8s.pt`, `hand_yolov8s.pt`) ;
- pieds : aucun détecteur fiable n'existe ; on part du modèle de pose officiel d'Ultralytics
  (`models/ultralytics/pose/yolov8s-pose.pt`) : le pied est sous la cheville, dimensionné d'après le tibia.
Calcul sur le processeur (une fraction de seconde) : la VRAM reste aux modèles d'image.
"""
import json
import os

import numpy as np
from PIL import Image

import folder_paths

_MODELS = {}


def _model(path):
    if path not in _MODELS:
        from ultralytics import YOLO

        _MODELS[path] = YOLO(path)
    return _MODELS[path]


def _boxes(model_path, image, conf, kind):
    out = []
    for box in _model(model_path)(image, conf=conf, device='cpu', verbose=False)[0].boxes:
        x0, y0, x1, y1 = box.xyxy[0].tolist()
        out.append({'kind': kind, 'x': x0, 'y': y0, 'width': x1 - x0, 'height': y1 - y0, 'conf': float(box.conf[0])})
    return out


def _feet(model_path, image, conf):
    """Un cadre par cheville visible (points 15 et 16 du format COCO), sous la cheville, à l'échelle du tibia."""
    out = []
    result = _model(model_path)(image, conf=conf, device='cpu', verbose=False)[0]
    if result.keypoints is None:
        return out
    w_img, h_img = image.size
    for person, person_box in zip(result.keypoints.data.tolist(), result.boxes.xyxy.tolist()):
        person_h = person_box[3] - person_box[1]
        for ankle, knee in ((15, 13), (16, 14)):
            ax, ay, ac = person[ankle]
            if ac < 0.5:
                continue
            kx, ky, kc = person[knee]
            shin = ((ax - kx) ** 2 + (ay - ky) ** 2) ** 0.5 if kc >= 0.5 else person_h * 0.22
            size = max(48.0, shin * 0.85)
            x0 = max(0.0, ax - size * 0.6)
            y0 = max(0.0, ay - size * 0.25)
            x1 = min(float(w_img), ax + size * 0.6)
            y1 = min(float(h_img), ay + size * 0.75)
            out.append({'kind': 'foot', 'x': x0, 'y': y0, 'width': x1 - x0, 'height': y1 - y0, 'conf': float(ac)})
    return out


class AIFluenceDetectParts:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'image': ('IMAGE',),
                'parts': ('STRING', {'default': 'face,hand,foot'}),
                'confidence': ('FLOAT', {'default': 0.3, 'min': 0.05, 'max': 0.95, 'step': 0.05}),
            }
        }

    RETURN_TYPES = ('STRING',)
    FUNCTION = 'detect'
    CATEGORY = 'AI Fluence'

    def detect(self, image, parts, confidence):
        base = os.path.join(folder_paths.models_dir, 'ultralytics')
        pil = Image.fromarray(np.clip(image[0].cpu().numpy() * 255.0, 0, 255).astype(np.uint8))
        wanted = {p.strip() for p in parts.split(',') if p.strip()}
        found = []
        if 'face' in wanted:
            found += _boxes(os.path.join(base, 'bbox', 'face_yolov8s.pt'), pil, confidence, 'face')
        if 'hand' in wanted:
            # Des faux positifs existent (un sac en cuir vu comme une main à 0,70, plus haut qu'une vraie main à
            # 0,40) : l'app montre les zones et l'utilisateur décoche les fausses avant la correction.
            found += _boxes(os.path.join(base, 'bbox', 'hand_yolov8s.pt'), pil, confidence, 'hand')
        if 'foot' in wanted:
            found += _feet(os.path.join(base, 'pose', 'yolov8s-pose.pt'), pil, confidence)
        return (json.dumps({'width': pil.width, 'height': pil.height, 'parts': found}),)


class AIFluenceColorMatch:
    """
    Ramène les couleurs d'une zone refaite à celles de la zone d'origine (moyenne et écart-type par canal, mesurés
    dans le masque) : klein repeint la peau avec sa propre teinte, d'où deux tons de peau visibles au raccord
    (vu le 2026-10-14 sur des pieds refaits). Les formes ne bougent pas, seule la dérive de couleur est corrigée.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'image': ('IMAGE',),
                'reference': ('IMAGE',),
                'mask': ('MASK',),
                'strength': ('FLOAT', {'default': 1.0, 'min': 0.0, 'max': 1.0, 'step': 0.05}),
            }
        }

    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'match'
    CATEGORY = 'AI Fluence'

    def match(self, image, reference, mask, strength):
        import torch

        m = mask.reshape(-1, mask.shape[-2], mask.shape[-1])[0].to(image.device)
        if m.shape != image.shape[1:3]:
            m = torch.nn.functional.interpolate(m[None, None], size=image.shape[1:3], mode='bilinear')[0, 0]
        w = (m > 0.5).float()[..., None]
        n = w.sum()
        if n < 16:
            return (image,)
        out = image.clone()
        for b in range(image.shape[0]):
            src, ref = image[b], reference[min(b, reference.shape[0] - 1)]
            mean_s = (src * w).sum((0, 1)) / n
            mean_r = (ref * w).sum((0, 1)) / n
            std_s = (((src - mean_s) ** 2 * w).sum((0, 1)) / n).sqrt().clamp(min=1e-4)
            std_r = (((ref - mean_r) ** 2 * w).sum((0, 1)) / n).sqrt()
            matched = ((src - mean_s) / std_s * std_r + mean_r).clamp(0, 1)
            out[b] = src + (matched - src) * w * strength
        return (out,)


# Squelette au format OpenPose (18 points, couleurs standard) : ce que la LoRA « Union Control » de LTX 2.3 sait lire.
# COCO 17 (Ultralytics) → OpenPose 18 : le cou (1) est le milieu des épaules.
_COCO_TO_OPENPOSE = [0, None, 6, 8, 10, 5, 7, 9, 12, 14, 16, 11, 13, 15, 2, 1, 4, 3]
_LIMBS = [(1, 2), (1, 5), (2, 3), (3, 4), (5, 6), (6, 7), (1, 8), (8, 9), (9, 10), (1, 11), (11, 12), (12, 13), (1, 0), (0, 14), (14, 16), (0, 15), (15, 17)]
_COLORS = [(255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0), (170, 255, 0), (85, 255, 0), (0, 255, 0), (0, 255, 85), (0, 255, 170),
           (0, 255, 255), (0, 170, 255), (0, 85, 255), (0, 0, 255), (85, 0, 255), (170, 0, 255), (255, 0, 255), (255, 0, 170), (255, 0, 85)]


def _openpose_points(kp):
    """Points OpenPose (x, y) ou None, depuis les 17 points COCO (x, y, confiance)."""
    pts = []
    for src in _COCO_TO_OPENPOSE:
        if src is None:
            a, b = kp[5], kp[6]
            pts.append(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) if a[2] > 0.3 and b[2] > 0.3 else None)
        else:
            x, y, c = kp[src]
            pts.append((x, y) if c > 0.3 else None)
    return pts


def _draw_pose(canvas, pts, scale):
    import cv2
    import math

    stick = max(2, int(4 * scale))
    for i, (a, b) in enumerate(_LIMBS):
        if pts[a] is None or pts[b] is None:
            continue
        (x0, y0), (x1, y1) = pts[a], pts[b]
        length = math.hypot(x1 - x0, y1 - y0)
        angle = math.degrees(math.atan2(y1 - y0, x1 - x0))
        poly = cv2.ellipse2Poly((int((x0 + x1) / 2), int((y0 + y1) / 2)), (int(length / 2), stick), int(angle), 0, 360, 1)
        layer = canvas.copy()
        cv2.fillConvexPoly(layer, poly, [int(v * 0.6) for v in _COLORS[i]])
        canvas[:] = cv2.addWeighted(canvas, 0.4, layer, 0.6, 0)
    for i, p in enumerate(pts):
        if p is not None:
            cv2.circle(canvas, (int(p[0]), int(p[1])), max(3, int(4 * scale)), _COLORS[i], -1)


class AIFluencePoseVideo:
    """
    Vidéo de mouvement (l'utilisateur se filme) → squelettes OpenPose, au rythme et au cadrage de la vidéo LTX. Guide la
    LoRA « Union Control » de LTX 2.3 : le personnage reprend les mouvements, sans la silhouette de la personne filmée
    (contrairement à une carte de profondeur). Pose : modèle officiel d'Ultralytics (`models/ultralytics/pose`).
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'images': ('IMAGE',),
                'fps': ('FLOAT', {'default': 30.0, 'min': 1.0, 'max': 240.0}),
                'target_fps': ('FLOAT', {'default': 25.0, 'min': 1.0, 'max': 120.0}),
                'frames': ('INT', {'default': 121, 'min': 1, 'max': 2000}),
                'width': ('INT', {'default': 704, 'min': 64, 'max': 4096}),
                'height': ('INT', {'default': 1248, 'min': 64, 'max': 4096}),
            }
        }

    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'pose'
    CATEGORY = 'AI Fluence'

    def pose(self, images, fps, target_fps, frames, width, height):
        import torch

        model = _model(os.path.join(folder_paths.models_dir, 'ultralytics', 'pose', 'yolov8s-pose.pt'))
        device = 0 if torch.cuda.is_available() else 'cpu'
        total = images.shape[0]
        out = []
        last = None
        for i in range(frames):
            src = int(round(i * fps / target_fps))
            if src >= total:
                out.append(last if last is not None else np.zeros((height, width, 3), np.uint8))
                continue
            frame = Image.fromarray(np.clip(images[src].cpu().numpy() * 255.0, 0, 255).astype(np.uint8))
            # Recadrage au centre aux proportions de la vidéo LTX, puis mise à la taille.
            scale = max(width / frame.width, height / frame.height)
            frame = frame.resize((round(frame.width * scale), round(frame.height * scale)), Image.LANCZOS)
            left, top = (frame.width - width) // 2, (frame.height - height) // 2
            frame = frame.crop((left, top, left + width, top + height))
            canvas = np.zeros((height, width, 3), np.uint8)
            result = model(frame, conf=0.3, device=device, verbose=False)[0]
            if result.keypoints is not None:
                for kp in result.keypoints.data.tolist():
                    _draw_pose(canvas, _openpose_points(kp), width / 704)
            last = canvas
            out.append(canvas)
        return (torch.from_numpy(np.stack(out).astype(np.float32) / 255.0),)


class AIFluencePhoneLook:
    """
    Rendu « photo de téléphone » : les images générées sont trop propres. Ajoute un grain de capteur fin (plus fort dans
    les ombres, comme un vrai capteur), un léger vignetage et une compression JPEG de téléphone. `strength` de 0 à 1.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'image': ('IMAGE',),
                'strength': ('FLOAT', {'default': 0.6, 'min': 0.0, 'max': 1.0, 'step': 0.05}),
            }
        }

    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'apply'
    CATEGORY = 'AI Fluence'

    def apply(self, image, strength):
        import io

        import torch

        out = []
        for b in range(image.shape[0]):
            img = image[b].cpu().numpy().astype(np.float32)
            h, w, _ = img.shape
            rng = np.random.default_rng()
            luma = img.mean(axis=2, keepdims=True)
            # Grain : bruit de luminance, plus fort dans les ombres, un soupçon de bruit de couleur.
            grain = rng.normal(0, 0.035 * strength, (h, w, 1)) * (1.25 - luma)
            chroma = rng.normal(0, 0.008 * strength, (h, w, 3))
            img = img + grain + chroma
            # Vignetage léger.
            yy, xx = np.mgrid[0:h, 0:w]
            r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
            img = img * (1 - 0.18 * strength * r[..., None] ** 2)
            pil = Image.fromarray(np.clip(img * 255.0, 0, 255).astype(np.uint8))
            # Compression JPEG de téléphone (qualité ~85 → ~70 selon la force).
            buf = io.BytesIO()
            pil.save(buf, format='JPEG', quality=int(round(88 - 18 * strength)), subsampling=2)
            pil = Image.open(io.BytesIO(buf.getvalue())).convert('RGB')
            out.append(np.asarray(pil).astype(np.float32) / 255.0)
        return (torch.from_numpy(np.stack(out)),)


NODE_CLASS_MAPPINGS = {
    'AIFluenceDetectParts': AIFluenceDetectParts,
    'AIFluenceColorMatch': AIFluenceColorMatch,
    'AIFluencePoseVideo': AIFluencePoseVideo,
    'AIFluencePhoneLook': AIFluencePhoneLook,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    'AIFluenceDetectParts': 'AI Fluence · Détecter visages, mains, pieds',
    'AIFluenceColorMatch': 'AI Fluence · Raccorder les couleurs',
    'AIFluencePoseVideo': 'AI Fluence · Squelettes d’une vidéo (mouvement)',
    'AIFluencePhoneLook': 'AI Fluence · Rendu photo de téléphone',
}
