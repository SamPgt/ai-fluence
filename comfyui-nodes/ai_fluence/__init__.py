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


NODE_CLASS_MAPPINGS = {'AIFluenceDetectParts': AIFluenceDetectParts}
NODE_DISPLAY_NAME_MAPPINGS = {'AIFluenceDetectParts': 'AI Fluence · Détecter visages, mains, pieds'}
