# Backlog : idées et points à voir plus tard

Notes de la branche `feat/comfyui`. Une ligne par idée, avec le contexte utile pour la reprendre.

## Modèle texte (bouton « Reformuler », Ollama local)

- **Polir le prompt assemblé** par les wildcards : transformer l'assemblage de fragments en une phrase fluide et cohérente, sans changer les choix de l'utilisateur.
- **Convertir un pack « tags » en langage naturel** (`1girl, long_hair` → `a woman with long hair`) pour l'utiliser avec Z-Image, Qwen, Flux.
- **Générer de nouvelles catégories** sur demande (« 30 tenues streetwear d'été »).
- **Traduire les libellés** des packs importés en français.
- **Exécution locale** : Ollama est installé sur le poste ; brancher un modèle texte local en plus de ceux de SpicyAPI, pour que tout le parcours puisse rester local.

## Bibliothèque

- **Sous-catégories « alternatives »** : aujourd'hui une sous-catégorie est un trait à part (Hauts + Bas). Découper « Coiffures » en « Courtes » / « Longues » donne deux traits de coiffure, et deux emplacements dans le créateur de personnage. Si ce besoin revient, un réglage de la catégorie parente « une seule option parmi ses sous-catégories » ; sinon, préférer favoris et masquage (lot 1c) pour réduire une liste.

## Prompts

- **« Smartphone photo » pris au pied de la lettre** : avec Z-Image, `amateur smartphone photo of…` fait apparaître un téléphone dans l'image (2 images sur 3 lors d'un test). Pour le bloc « Photo » des wildcards : décrire l'effet (`candid snapshot, slightly tilted framing, natural phone-camera look`) plutôt que l'appareil, et ajouter `smartphone, phone in frame, hands holding phone` au prompt négatif.

- **Termes mal compris par le modèle** : dans le pack de coiffures Civitai, « 360 waves » (vagues sur cheveux très courts) donne de longs cheveux ondulés, « bantu knots » une tresse en couronne. Les miniatures le rendent visible ; piste : corriger le fragment (plus descriptif) ou le faire réécrire par un modèle texte.

## Cohérence du personnage

- **Face model ReActor** : construire un modèle de visage à partir de plusieurs photos du persona (nœuds `ReActorBuildFaceModel` / `ReActorSaveFaceModel`), plus fiable qu'une seule image.
- **Brancher le persona** : visage de référence et description d'identité injectés automatiquement, sans pièce jointe manuelle (cf. spec wildcards § 10).
- **LoRA locales du persona** : associer une LoRA du dossier `models/loras` de ComfyUI à un persona (aujourd'hui, les LoRA du persona ne visent que les modèles SpicyAPI).
- **Dataset de LoRA** : exporter la planche de références d'un persona avec des légendes (JoyCaption est installé dans ComfyUI) pour entraîner une LoRA (ai-toolkit en local, fal…).
- **Plans larges** : `inswapper_128` est faible sur les petits visages ; tester un détail / upscale du visage avant le swap, ou un autre modèle de swap.

## Local (ComfyUI)

- **Upscale local** (pour les images générées en local uniquement ; SpicyAPI garde son upscaler) : 4xUltrasharp et le upscaler Z-Image sont installés. Ces modèles font toujours ×4 : appliquer le modèle sur l'image **d'origine**, puis réduire le résultat à la taille visée (×2 max, ≈ 1728×3072), plutôt que réduire l'image avant (on ne perd pas de détail en entrée ; ComfyUI traite l'upscale par tuiles, la VRAM suit). Pas de 4K/8K en local.
- **Vidéo locale** : Wan 2.2 (5B ou GGUF) possible mais lent sur 12 Go ; à évaluer.
- **Commande `comfy` hors PATH** : le `.env` local préfixe la commande de démarrage ; ajouter `%APPDATA%\Python\Python314\Scripts` au PATH utilisateur simplifierait.

## Windows

- **« Ouvrir le dossier des médias »** (`settings.route.ts`, `execFile('open', …)`) ne fonctionne que sur macOS ; utiliser `explorer` sous Windows, `xdg-open` sous Linux.
- **npm 8 → 11** sur le poste Windows : évite le bruit `"peer": true` dans `package-lock.json`.

## Ménage

- **Compte de test** `claude-test@local.test` (créé pour tester l'interface) : à supprimer, avec ses générations.
- **PR** : ouvrir la PR de `feat/comfyui` quand la branche est prête à être montrée (dépend de la PR Windows `SamPgt/ai-fluence#1`).
