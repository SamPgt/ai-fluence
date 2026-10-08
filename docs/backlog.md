# Backlog : idées et points à voir plus tard

Notes de la branche `feat/comfyui`. Une ligne par idée, avec le contexte utile pour la reprendre.

## Modèle texte (bouton « Reformuler », Ollama local)

- **Polir le prompt assemblé** par les wildcards : transformer l'assemblage de fragments en une phrase fluide et cohérente, sans changer les choix de l'utilisateur.
- **Convertir un pack « tags » en langage naturel** (`1girl, long_hair` → `a woman with long hair`) pour l'utiliser avec Z-Image, Qwen, Flux.
- **Générer de nouvelles catégories** sur demande (« 30 tenues streetwear d'été »).
- **Traduire les libellés** des packs importés en français.
- **Exécution locale** : Ollama est installé sur le poste ; brancher un modèle texte local en plus de ceux de SpicyAPI, pour que tout le parcours puisse rester local.

## Cohérence du personnage

- **Face model ReActor** : construire un modèle de visage à partir de plusieurs photos du persona (nœuds `ReActorBuildFaceModel` / `ReActorSaveFaceModel`), plus fiable qu'une seule image.
- **Brancher le persona** : visage de référence et description d'identité injectés automatiquement, sans pièce jointe manuelle (cf. spec wildcards § 10).
- **LoRA locales du persona** : associer une LoRA du dossier `models/loras` de ComfyUI à un persona (aujourd'hui, les LoRA du persona ne visent que les modèles SpicyAPI).
- **Dataset de LoRA** : exporter la planche de références d'un persona avec des légendes (JoyCaption est installé dans ComfyUI) pour entraîner une LoRA (ai-toolkit en local, fal…).
- **Plans larges** : `inswapper_128` est faible sur les petits visages ; tester un détail / upscale du visage avant le swap, ou un autre modèle de swap.

## Local (ComfyUI)

- **Upscale local** (pour les images générées en local uniquement ; SpicyAPI garde son upscaler) : 4xUltrasharp et le upscaler Z-Image sont installés. Ces modèles font toujours ×4 : appliquer le modèle sur l'image **d'origine**, puis réduire le résultat à la taille visée (×2 max, ≈ 1728×3072), plutôt que réduire l'image avant (on ne perd pas de détail en entrée ; ComfyUI traite l'upscale par tuiles, la VRAM suit). Pas de 4K/8K en local.
- **Vitesse** : le modèle Z-Image en pleine précision (11,7 Go) remplit la VRAM de la RTX 3060 (~3,9 s/étape). Tester `weight_dtype: fp8_e4m3fn` sur le chargeur.
- **Vidéo locale** : Wan 2.2 (5B ou GGUF) possible mais lent sur 12 Go ; à évaluer.
- **Commande `comfy` hors PATH** : le `.env` local préfixe la commande de démarrage ; ajouter `%APPDATA%\Python\Python314\Scripts` au PATH utilisateur simplifierait.

## Windows

- **« Ouvrir le dossier des médias »** (`settings.route.ts`, `execFile('open', …)`) ne fonctionne que sur macOS ; utiliser `explorer` sous Windows, `xdg-open` sous Linux.
- **npm 8 → 11** sur le poste Windows : évite le bruit `"peer": true` dans `package-lock.json`.

## Ménage

- **Compte de test** `claude-test@local.test` (créé pour tester l'interface) : à supprimer, avec ses générations.
- **PR** : ouvrir la PR de `feat/comfyui` quand la branche est prête à être montrée (dépend de la PR Windows `SamPgt/ai-fluence#1`).
