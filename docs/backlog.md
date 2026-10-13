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

- **Phrase d'un lieu** : les traits Lieu & décor sont listés dans l'ordre des catégories (« A wooden desk and a sunny kitchen »). Mieux : le type de pièce d'abord, le reste en « with … » (« A sunny kitchen with a wooden desk »). Piste : marquer la catégorie « type de lieu » dans la bibliothèque, ou une tournure `with {option}` sur les autres catégories.

- **« Smartphone photo » pris au pied de la lettre** : avec Z-Image, `amateur smartphone photo of…` fait apparaître un téléphone dans l'image (2 images sur 3 lors d'un test). Pour le bloc « Photo » des wildcards : décrire l'effet (`candid snapshot, slightly tilted framing, natural phone-camera look`) plutôt que l'appareil, et ajouter `smartphone, phone in frame, hands holding phone` au prompt négatif.

- **Termes mal compris par le modèle** : dans le pack de coiffures Civitai, « 360 waves » (vagues sur cheveux très courts) donne de longs cheveux ondulés, « bantu knots » une tresse en couronne. Les miniatures le rendent visible ; piste : corriger le fragment (plus descriptif) ou le faire réécrire par un modèle texte.

## Cohérence du personnage

- **Face model ReActor** : construire un modèle de visage à partir de plusieurs photos du persona (nœuds `ReActorBuildFaceModel` / `ReActorSaveFaceModel`), plus fiable qu'une seule image.
- **Brancher le persona** : visage de référence et description d'identité injectés automatiquement, sans pièce jointe manuelle (cf. spec wildcards § 10).
- **LoRA locales du persona** : associer une LoRA du dossier `models/loras` de ComfyUI à un persona (aujourd'hui, les LoRA du persona ne visent que les modèles SpicyAPI).
- **Retoucheur de visage haute résolution** (« FaceDetailer », pack Impact) : recadre le visage, le refait en grand avec Z-Image puis le recolle. Corrige le visage un peu flou de ReActor (échange en 128 × 128) et ajoute du détail de peau. Pack de nœuds à installer.
- **Workflow conseillé pour le réalisme** (à outiller un jour en un clic) : Qwen Edit avec la référence (scène + personnage) → Z-Image image → image à 0,2–0,3 avec la LoRA Realistic Snapshot (peau, lumière naturelle), ReActor en option si le visage a dérivé.
- **Dataset de LoRA** : exporter la planche de références d'un persona avec des légendes (JoyCaption est installé dans ComfyUI) pour entraîner une LoRA (ai-toolkit en local, fal…).
- **Plans larges** : `inswapper_128` est faible sur les petits visages ; tester un détail / upscale du visage avant le swap, ou un autre modèle de swap.

- **Angles d'un lieu** : l'image → image garde le cadrage de la référence ; même à 0,85, les « angles » changent peu (test : cuisine de Nadia). Pour de vrais changements d'angle : texte seul (fiche du lieu), ou un modèle d'édition à références (Qwen-Image-Edit, Flux Kontext en local ; Seedream, Nano Banana côté SpicyAPI).

## Local (ComfyUI)

- **Upscale local** (pour les images générées en local uniquement ; SpicyAPI garde son upscaler) : 4xUltrasharp et le upscaler Z-Image sont installés. Ces modèles font toujours ×4 : appliquer le modèle sur l'image **d'origine**, puis réduire le résultat à la taille visée (×2 max, ≈ 1728×3072), plutôt que réduire l'image avant (on ne perd pas de détail en entrée ; ComfyUI traite l'upscale par tuiles, la VRAM suit). Pas de 4K/8K en local.
- **Vidéo locale** : Wan 2.2 (5B ou GGUF) possible mais lent sur 12 Go ; à évaluer.
- **LTX-2.5** (sorti le 2026-08-11, 22B comme la 2.3 : pas plus lourd) : multi-plans dans une même génération (personnage, décor, lumière et son cohérents d'un plan à l'autre, intéressant pour les vidéos longues), durée déduite de l'action, 4K HDR (hors de portée en 12 Go). Demande un nouvel encodeur Gemma 4 12B et ses VAE (~20–25 Go en GGUF), et de revérifier notre chaîne (voix imposée, clips enchaînés, image de fin) avec les nœuds mis à jour. Attendre que les versions retravaillées (Civitai) et les GGUF mûrissent, puis comparer à la 2.3 sur la même image, le même prompt et le même « Texte dit ».
- **Commande `comfy` hors PATH** : le `.env` local préfixe la commande de démarrage ; ajouter `%APPDATA%\Python\Python314\Scripts` au PATH utilisateur simplifierait.

## Windows

- **« Ouvrir le dossier des médias »** (`settings.route.ts`, `execFile('open', …)`) ne fonctionne que sur macOS ; utiliser `explorer` sous Windows, `xdg-open` sous Linux.
- **npm 8 → 11** sur le poste Windows : évite le bruit `"peer": true` dans `package-lock.json`.

## Ménage

- **Compte de test** `claude-test@local.test` (créé pour tester l'interface) : à supprimer, avec ses générations.
- **PR** : ouvrir la PR de `feat/comfyui` quand la branche est prête à être montrée (dépend de la PR Windows `SamPgt/ai-fluence#1`).

## Garde-fous (à définir par Kevin)

- **Filtre NSFW de ReActor désactivé** (2026-10-11) : il noircissait des tenues sexy mais habillées (score 0,99 sur résille / body en mesh). Interrupteur `REACTOR_NSFW_FILTER=0` dans `COMFYUI_LAUNCH` (patch local de `comfyui-reactor/scripts/reactor_sfw.py`, original en `.orig`, à refaire après une mise à jour du nœud). Garde-fous à poser dans l'app plutôt que dans l'outil : échange de visage réservé aux visages des personnages (pas de photo d'une personne réelle sans son accord), âge minimal des personnages, règles de contenu selon la plateforme de publication.
- **Prompt négatif sans effet** sur les modèles locaux (CFG 1 : Z-Image Turbo, klein, Qwen Lightning, Wan lightx2v, LTX distillé). Piste : le nœud natif `NAGuidance` (Normalized Attention Guidance), qui rend le négatif actif à CFG 1, à tester modèle par modèle ; sinon retirer le champ « Prompt négatif » de Z-Image.

## Licences des modèles (si le projet devient commercial)

Tant que le projet reste pour le plaisir (pas de revenus), tous les modèles installés sont utilisables. Le jour où l'influenceuse rapporte de l'argent (partenariats, monétisation, contenus payants, service payant) :

- **Libres, usage commercial autorisé** : Z-Image Turbo, Qwen Edit 2511, FLUX.2 klein **4B**, Wan 2.2 (Apache 2.0) ; LoRA Realistic Snapshot (usage commercial autorisé sur sa page Civitai). Le workflow réalisme conseillé (Qwen Edit → Z-Image + Realistic Snapshot) est entièrement dans ce groupe.
- **Non commercial (probable)** : FLUX.2 klein **9B**. Page verrouillée chez Black Forest Labs : lire le texte en acceptant la licence sur Hugging Face. Les licences FLUX « dev » laissent utiliser les images produites, mais réservent le modèle à un usage non commercial (zone grise pour un compte rémunéré). Sinon : licence commerciale à acheter chez Black Forest Labs.
- **Sous conditions** : Krea 2 (licence communautaire, gratuite sous un seuil de chiffre d'affaires) ; LTX-2.3 (licence communautaire de Lightricks, à vérifier de la même façon).
- **Outils** : Chatterbox (MIT), JoyCaption (licence Llama 3.1 de Meta, à vérifier), LatentSync (Apache 2.0, n'est plus utilisé dans l'app).
- À faire le moment venu : relire chaque licence, retirer ou remplacer les modèles non conformes, ou acheter les licences nécessaires.

