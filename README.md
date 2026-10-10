# AI Fluence

AI Fluence est un studio local pour créer du contenu d'**influenceurs IA** et de **pages art** (images et vidéos), dans une interface de type chat.

Chaque personnage ou page art est un **persona** : une bulle dans la barre de gauche, avec sa LoRA, ses images de référence, sa personnalité et ses prompts automatiques. Tu écris une idée, tu ajoutes des références si besoin, tu choisis un modèle, et le résultat arrive dans le fil, avec son coût.

Toutes les générations passent par [SpicyAPI](https://spicyapi.ai), qui donne accès à une centaine de modèles photo et vidéo avec une seule clé.

> ⚠️ **Une clé API SpicyAPI est obligatoire pour générer.** Sans clé, l'app s'ouvre mais aucun modèle n'est disponible. Voir [Clé API SpicyAPI](#clé-api-spicyapi).

## Fonctionnalités

- **Fil de génération** : chaque demande (prompt, références, modèle, paramètres) et son résultat restent dans un fil, renommable et épinglable, avec une recherche (⌘K).
- **Séries ×1 / ×4 / ×8** : la même demande générée N fois, chaque image avec sa propre graine, affichées en grille dans le fil. En local, les images sont générées l'une après l'autre (file ComfyUI), avec progression, temps restant estimé et « Annuler le reste ».
- **16 modèles choisis** pour l'usage, classés par badge :
  - `LORA` : accepte une LoRA de personnage (Qwen Image 2512, Z-Image Turbo, FLUX.1 Dev, MiniMax H3, Wan 2.2, LTX 2.3) ;
  - `REF` : garde la cohérence grâce à des images de référence (Seedream 5.0 Pro, Seedance 2.5, Wan 3.0, HappyHorse…) ;
  - `PERF` : qualité de rendu, pour l'art et le fun (Seedream, Qwen Image 3.0 Pro, GPT Image 2.5, Kling 3.0…).
- **Tâche choisie automatiquement** selon les pièces jointes : texte → image, image → image, image → vidéo, références → vidéo.
- **Paramètres générés depuis le schéma live** de chaque modèle (format, résolution, durée, seed…).
- **Prix affiché avant de générer** (devis exact et gratuit), puis coût réel, total par fil et crédit restant.
- **Personas** : LoRA avec mot déclencheur, suffixe de prompt, bibliothèque de références, personnalité utilisée par le bouton « Améliorer » (réécriture du prompt par un modèle texte), modèles par défaut.
- **Actions sur un résultat** : Varier, Éditer, Animer, Ajouter aux références, Relancer avec un autre modèle, Télécharger.
- **Galerie** de tous les résultats, filtrable par persona et par type.
- **Plusieurs comptes** en local (mot de passe hashé en bcrypt), chacun avec sa propre clé API.
- **Fichiers en local** : chaque image et vidéo est téléchargée sur ton disque, rangée par persona puis par jour.

## Stack technique

| Partie | Technos |
| --- | --- |
| Front (`frontend/`) | TanStack Start, TanStack Router, TanStack Query, React 19, shadcn/ui (Radix), Tailwind CSS 4, Vite 8 |
| Back (`backend/`) | Hono sur Node.js, Drizzle ORM, PostgreSQL, SDK officiel `@spicyapi/sdk`, bcrypt |
| Partagé (`shared/`) | Registre des modèles, choix de la tâche, construction de la requête SpicyAPI, types d'API |

Monorepo npm workspaces. Le front est un fork de [rs-4/tanstack-ai-demo](https://github.com/rs-4/tanstack-ai-demo) (licence MIT). Le code du fork qui n'est pas utilisé est gardé dans `archives/` comme référence.

## Prérequis

- **Node.js 22.13 ou plus récent**
- **PostgreSQL** en local, avec une base vide nommée `ai-fluence`
- **Un compte SpicyAPI** avec une clé API et un peu de crédit

## Installation

```bash
npm install
cp backend/.env.example backend/.env
```

Puis remplir `backend/.env` :

| Variable | Rôle |
| --- | --- |
| `DATABASE_URL` | Connexion Postgres, par exemple `postgresql://<user>@localhost:5432/ai-fluence` |
| `APP_SECRET` | 64 caractères hex, pour chiffrer les clés API en base (`openssl rand -hex 32`) |
| `API_PORT` | Port de l'API Hono (3470 par défaut) |
| `CLIENT_URL` | URL du front (http://localhost:3070 par défaut) |
| `DATA_DIR` | Dossier des fichiers générés (`~/Documents/ai-influence-app` par défaut) |
| `spicyApiKey` | Facultatif, utilisé seulement par le serveur MCP SpicyAPI de `.mcp.json` |

## Lancer l'app

```bash
npm run dev
```

Une seule commande. Elle applique les migrations, lance l'API Hono (port 3470), attend qu'elle réponde, puis lance le front (port 3070).

Ouvre ensuite http://localhost:3070, crée un compte, puis ajoute ta clé API.

## Clé API SpicyAPI

L'app ne génère rien sans clé. Pour l'obtenir :

1. Crée un compte sur [spicyapi.ai](https://spicyapi.ai/register) et vérifie ton adresse e-mail (sans vérification, SpicyAPI refuse les générations).
2. Crée une clé sur la [page des clés](https://spicyapi.ai/console/keys). Elle commence par `sk-spicy-` et n'est affichée qu'une fois.
3. Ajoute du crédit dans [Billing](https://spicyapi.ai/console/billing). Une image coûte entre 0,002 $ et 0,10 $ environ, une vidéo de 5 s entre 0,10 $ et 1 $ selon le modèle.
4. Dans l'app : avatar en bas à gauche → **Paramétrage** → onglet **Clé API**, colle la clé et enregistre.

La clé est vérifiée auprès de SpicyAPI, puis stockée **chiffrée** en base (AES-256-GCM). Elle n'est jamais renvoyée au navigateur, seuls ses 4 derniers caractères sont affichés.

## ComfyUI local (optionnel)

L'app peut se connecter à un ComfyUI qui tourne sur la même machine. Sans `COMFYUI_URL`, rien ne s'affiche et l'app fonctionne comme avant.

| Variable | Rôle |
| --- | --- |
| `COMFYUI_URL` | Adresse de ComfyUI, par exemple `http://127.0.0.1:8188`. Affiche son statut en bas de la barre latérale |
| `COMFYUI_LAUNCH` | Commande de démarrage, par exemple `python -m comfy_cli launch --background` |
| `COMFYUI_STOP` | Commande d'arrêt, par exemple `python -m comfy_cli stop --port 8188` |
| `COMFYUI_DIR` | Dossier de ComfyUI (ex. `A:\ComfyUI`). L'app y supprime sa copie de chaque image (`output/ai-fluence/`) une fois rapatriée dans ses médias. Vide : rien n'est supprimé |

Avec `COMFYUI_LAUNCH` et `COMFYUI_STOP`, un bouton permet de démarrer et d'arrêter ComfyUI depuis l'app. La commande de démarrage doit rendre la main (`--background`) : ComfyUI tourne ainsi dans son propre processus et survit aux redémarrages du backend.

### Modèles locaux

Quand ComfyUI tourne, les modèles locaux (badge `LOCAL`) apparaissent dans le sélecteur de modèles, même sans clé SpicyAPI. Une génération locale suit le même chemin qu'une génération SpicyAPI (fil, galerie, dossier des médias), sans coût.

| Modèle | Tâches | Fichiers attendus dans ComfyUI |
| --- | --- | --- |
| Z-Image (local) | texte → image, image → image, + visage (si ReActor est installé) | un ou plusieurs modèles Z-Image dans `diffusion_models` (ex. `zImageTurbo_turbo.safetensors`), `qwen_3_4b_fp8_mixed.safetensors` (text_encoders), `flux1AE_v10.safetensors` (vae) |
| FLUX.2 klein (local) | texte → image, ou 1 à 3 images de **référence** (cohérence d'un personnage, d'un lieu) | `flux-2-klein-4b-fp8.safetensors` (diffusion_models), `flux2-vae.safetensors` (vae), l'encodeur Qwen3-4B de Z-Image |
| Qwen Edit 2511 (local) | retouche à partir de 1 à 3 images (« la femme de l'image 1 dans la cuisine de l'image 2, en t-shirt gris ») | `qwen-image-edit-2511-Q3_K_M.gguf` (diffusion_models), `qwen_2.5_vl_7b_fp8_scaled.safetensors` (text_encoders), `qwen_image_vae.safetensors` (vae), `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` (loras), nœud [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) |
| Wan 2.2 (local, vidéo) | image → vidéo, 3 ou 5 s, 480p ou 720p | `Wan2.2-I2V-A14B-HighNoise-Q3_K_M.gguf` et `…LowNoise…` (diffusion_models), `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise` / `low_noise` (loras), `umt5_xxl_fp8_e4m3fn_scaled` (text_encoders), `wan_2.1_vae` (vae), nœud ComfyUI-GGUF |

Un modèle dont un fichier manque reste grisé, avec la liste des fichiers manquants.

Mesures sur RTX 3060 12 Go (ComfyUI lancé avec `--reserve-vram 1.5`) : klein ~8 s en texte seul, 15 à 25 s avec 1 ou 2 références, sans déborder de la VRAM ; Qwen Edit ~1 à 2 min (il déborde de 1 à 1,7 Go en RAM, proprement) mais suit mieux une consigne de retouche (changer la tenue, le décor) ; Wan ~4 min pour 3 s en 480p.

**Windows et VRAM** : quand la VRAM est pleine, le pilote NVIDIA déborde **en silence** sur la RAM et tout devient 10 fois plus lent (une image passée de 14 s à 3 min). Lancer ComfyUI avec `-- --reserve-vram 1.5` (dans `COMFYUI_LAUNCH`) et régler le pilote : Panneau NVIDIA → Gérer les paramètres 3D → « CUDA – Sysmem Fallback Policy » → **Prefer No Sysmem Fallback**.

Les fichiers installés dans ComfyUI sont lus en direct :
- **Modèle** : tous les fichiers de `diffusion_models` dont le nom contient « Z-Image » (Turbo, finetunes comme CyberRealistic…) ;
- **LoRA** : tous les fichiers de `models/loras`, avec leur force. Le paramètre n'apparaît que s'il y a au moins une LoRA.

**Visage (ReActor)** : avec un modèle local, chaque image jointe porte une pastille **Départ** ou **Visage** (clic pour changer). L'image « Départ » est retravaillée (image → image) ; l'image « Visage » donne son visage au résultat, via [ReActor](https://github.com/Gourieff/ComfyUI-ReActor) ajouté en fin de workflow. Par défaut, la 1re image est l'image de départ et la 2e le visage ; un visage seul donne texte → image + visage. Seul le visage est remplacé : cheveux, silhouette et tenue viennent du prompt. Le paramètre « Restauration du visage » (CodeFormer, GFPGAN…) affine le résultat. Sans ReActor dans ComfyUI, les pastilles n'apparaissent pas. Avec un modèle SpicyAPI, toutes les images restent des références, comme avant.

**Précision** (paramètres ⚙️) : **fp8 par défaut**, pleine précision au choix. Sur une RTX 3060 12 Go, à graine identique, les images sont identiques à l'œil et la vitesse est la même, mais le pic de VRAM passe de 11,8 Go à 7,5–9,2 Go : assez de marge pour que ComfyUI ne sature pas quand d'autres applications utilisent la carte. Sans effet sur un modèle déjà enregistré en fp8.

Un fichier ajouté dans ComfyUI apparaît dans l'app au rafraîchissement du catalogue. Le temps de calcul de chaque génération locale est affiché sous le résultat.

Ajouter un workflow :
1. Dans ComfyUI, exporte-le au format API (menu Workflow → Export (API)) dans `backend/comfy-workflows/<modèle>/<tâche>.json`.
2. Déclare-le dans `backend/src/services/comfy-workflows.ts` : ses paramètres (même format que les schémas SpicyAPI, le formulaire se construit tout seul) et les nœuds où écrire le prompt, le seed, l'image…
3. Ajoute la famille dans `LOCAL_FAMILIES` (`shared/src/models.ts`).

> Windows : `comfy launch --background` relance la commande `comfy`, qui doit être dans le PATH. Si `comfy` n'est pas reconnu dans un terminal, ajoute le dossier `Scripts` de Python au PATH, ou préfixe la commande : `set "PATH=%APPDATA%\Python\Python314\Scripts;%PATH%" && python -m comfy_cli launch --background`.

## Bibliothèque (wildcards)

Icône « Bibliothèque » dans la barre de gauche. Des **catégories** (coupe de cheveux, pièces, lumières…) regroupent des **options** : un fragment de prompt en anglais pour le modèle (`a short bowl cut`) et un libellé en français pour toi (« Coupe au bol », badge **EN** tant qu'il manque).

Les catégories sont rangées par **zone**, la partie du prompt qu'elles alimentent :

| Zone | Exemples | Genre des options |
| --- | --- | --- |
| Personnage | coiffures, couleurs de cheveux, yeux, peau | demandé à l'import (femme / homme / les deux) |
| Tenue | hauts, robes, chaussures, accessoires | demandé à l'import |
| Pose & action | poses, expressions, activités | pas demandé ; possible pour quelques exceptions |
| Lieu & décor | pièces, mobilier, objets, moments de la journée | jamais |
| Photo & ambiance | cadrages, lumières, rendus | jamais |

- **Importer un fichier wildcard** dans une zone (`.txt`, une option par ligne ; lignes vides et commentaires `#` / `//` ignorés, doublons écartés) : il devient une catégorie de cette zone. On peut aussi importer dans une catégorie existante.
- Une option réservée à un genre (**F** / **H**) n'aura que sa miniature, et ne sera proposée qu'aux personnages du même genre (réglé dans les paramètres du persona).
- Ajouter, modifier ou supprimer une option à la main ; déplacer une catégorie vers une autre zone.
- **Découper une grosse catégorie** : coche des cartes (Maj+clic pour une plage, ou « Sélectionner les N résultats » après une recherche comme `dress`), puis **Déplacer vers…** une catégorie existante ou une **nouvelle sous-catégorie** (« Vêtements › Robes »). Les miniatures suivent. **Supprimer** en masse ce qui ne sert pas.
- **Proposer un découpage** (zone Tenue, catégorie d'au moins 10 options) : range les options en sous-catégories (Robes, Hauts, Bas, Lingerie & nuit, Maillots de bain, Vestes & manteaux, Ensembles, Chaussures, Accessoires) d'après leurs mots-clés anglais, en suivant le nom principal (« sweater dress » → Robes, « dress shirt » → Hauts). On renomme ou décoche un groupe avant de valider ; un groupe du même nom qu'une sous-catégorie existante y est fusionné ; les options non reconnues restent en place.
- **Trier sans supprimer** : ⭐ **favori** (sur la carte ou sur une sélection) et **masquer** (hors du sélecteur, des tirages et des miniatures à générer, récupérable dans la vue « Masquées »). Le sélecteur de traits montre les favoris en premier, avec un filtre ★.
- **Sous-catégories** : deux niveaux au plus. Une sous-catégorie suit la zone de sa catégorie et hérite de son genre, de sa tournure et de son gabarit de miniatures. Chaque sous-catégorie est un trait à part (une bulle « Hauts » et une bulle « Bas » peuvent coexister) : découpe plutôt en pièces complémentaires. Supprimer une catégorie fait remonter ses sous-catégories au premier niveau.
- Chaque catégorie a un nom technique (`__coupe_de_cheveux__`) pour la syntaxe des wildcards.

**Miniatures** : chaque option a une image type, générée en local par ComfyUI (512×640, ~11 s par miniature sur une RTX 3060), pour choisir visuellement sans connaître le nom des coiffures ou des tenues.

- « Générer les miniatures manquantes » sur une catégorie : mises dans la file de ComfyUI, générées l'une après l'autre, avec la progression, le temps restant et « Annuler ». Elles n'apparaissent ni dans les fils ni dans la galerie.
- Le **gabarit** (bouton « Gabarit ») est le prompt neutre de la catégorie. Chaque zone a un gabarit par défaut (portrait sur fond uni, plein pied pour les tenues, pièce vide pour les lieux…). Mots-clés :
  - `{option}` : le fragment de l'option, avec la **tournure** de la catégorie si elle en a une (tournure `{option} skin` : « black » → « black skin ») ;
  - `{subject}` : une personne tirée au hasard (origine, âge, version femme / homme selon la miniature) ;
  - `{person}` : une femme ou un homme **sans origine**, pour les catégories où l'origine contredirait l'option (couleur de peau, des yeux…) ;
  - `{femme: … | homme: …}` : un passage différent selon la version de la miniature, ex. `{femme: wearing a fitted crop top | homme: shirtless}` pour voir une morphologie « muscular ».
- **Modèle des miniatures** : choisi par catégorie dans la barre « Miniatures » (Z-Image en local par défaut). Un modèle **API** (SpicyAPI) marche sans ComfyUI : le coût total s'affiche avant de lancer. Pour juger un résultat décevant avec un autre modèle : change le modèle de la catégorie, puis « Régénérer » sur la carte.
- Une miniature ratée se régénère au survol de sa carte ; l'ancienne reste affichée jusque-là. « Tout régénérer » relance toute la catégorie (après un changement de gabarit, par exemple).
- Dans une catégorie genrée, « Femme / Homme » choisit la version affichée des options valables pour les deux.

**Traits dans le composer** : le bouton **« Trait »** ouvre la bibliothèque (zones et catégories à gauche, miniatures à droite). Un clic sur une miniature ajoute une **bulle** au-dessus du champ de texte : une par catégorie (choisir une autre coiffure remplace la précédente), clic sur la bulle pour changer, croix pour retirer. Les bulles restent après l'envoi, comme les contextes.

- Seules les options et miniatures du genre du persona actif sont proposées (sans genre : choix Femme / Homme dans la fenêtre).
- Les traits sont assemblés en une phrase en anglais, zone par zone, puis prolongés par le texte libre : « A woman with beach waves hairstyle and light freckles, wearing a red summer dress, a soft smile, a cozy bedroom, golden hour light, reading a book ». Le texte libre devient facultatif.
- La **tournure** d'une catégorie (bibliothèque → « Gabarit ») règle l'insertion de ses options : `{option} hairstyle` transforme « bob » en « bob hairstyle ».
- Le prompt réellement envoyé s'affiche sous le composer (« Prompt envoyé : … »). Les traits restent visibles dans la demande, et « Modifier la demande » les remet dans le composer.

## Composer une scène

Dans le composer, autour des bulles de traits :

- **🎲 Au hasard** (bouton dans la fenêtre « Trait ») : la catégorie est tirée au hasard pour **chaque image** ; en série ×4 / ×8, chaque image a son propre tirage, affiché sous l'image (🎲 …). Un clic sur la bulle 🎲 choisit parmi quoi tirer : toute la liste, les favoris, ou une sélection.
- **Lieu** : un lieu récurrent (ceux du personnage en premier). Sa fiche entre dans le prompt ; un clic sur sa bulle propose ses images master comme **image de départ** (image → image) pour un lieu plus fidèle.
- **Visage de …** (modèles locaux avec ReActor) : joint l'avatar du personnage en rôle Visage, en un clic.
- **Scènes** : enregistre la combinaison actuelle (bulles hors personnage, 🎲, lieu, texte) sous un nom (« Courses du samedi ») et la recharge pour n'importe quel personnage ; l'identité du persona actif est gardée.
- **Texte libre** : `__clé__` tire une option de la catégorie (clé affichée sous son nom dans la Bibliothèque, avec sa tournure), `{café|parc|plage}` une variante, `{2::café|parc}` une variante pondérée. Une catégorie inconnue est signalée et laissée telle quelle.
- Avec des tirages, la ligne sous le composer montre **un exemple** de prompt : chaque image fait son propre tirage.

## Créer un personnage

Le **+** de la barre de gauche ouvre le créateur (la création rapide d'un persona reste accessible en haut à droite).

- **Fiche d'identité** : une ligne par catégorie de la zone *Personnage* de la bibliothèque. Pour chaque trait : choisir dans la grille de miniatures, 🎲 aléatoire (tiré pour chaque variante ; un clic sur la ligne choisit parmi quoi tirer : toute la liste, mes favoris, ou ma sélection « 3 sur 48 »), vider (le modèle décide), 🔒 verrouiller. « Tout aléatoire » passe en aléatoire tous les traits non verrouillés.
- **Départ** : « Vierge » ou « Aléatoire complet » démarrent une nouvelle création ; la création en cours est reprise à chaque ouverture.
- **Genre** (Femme / Homme), **modèle** et **taille du lot** (4, 8, 12), puis « Générer N variantes ». Chaque variante fait son propre tirage ; en local, elles arrivent une par une, avec la progression et « Annuler le lot ».
- **Variantes** : historique des lots (rien n'est supprimé), vue **Grille** (traits tirés sous chaque image) ou **Comparer** (une colonne par image, une ligne par trait, en couleur ce qui varie ; clic sur une case pour reprendre ce trait seul).
- Sur une variante : **Reprendre ces traits** (recopiés dans la fiche, sauf les verrouillés) ou **Garder ce personnage** : le persona est créé avec son genre, l'image comme avatar, première référence et première image master, et ses traits comme fiche d'identité. Quand on le sélectionne, le composer ajoute ces traits en bulles. On arrive ensuite sur ses images master.
- L'**aperçu neutre** (cadrage, fond, lumière) prolonge la phrase des traits ; modifiable. Les variantes restent hors de la liste des fils et de la galerie.

## Images master

Page d'un personnage → **Images master** (ou directement après « Garder ce personnage »).

- Avec un modèle à **références** (FLUX.2 klein, Qwen Edit), **Partir de la référence (image 1)** donne l'image de référence au modèle : la cohérence vient du modèle lui-même, sans ReActor.
- Choisir un **axe** : Angles, Expressions, Lumières, Tenues, Cadrages, ou **Mélange** (une variante tirée dans tous les axes pour chaque image). Chaque image du lot prend une variante différente de l'axe.
- Le prompt = la fiche d'identité du personnage + la variante (« head and shoulders portrait in side profile view… »). **Visage de la référence** (local, ReActor) applique le visage de l'avatar à chaque image.
- ⭐ sur une variation : elle devient **image master** et rejoint les références du personnage. Clic sur l'image : plein écran.
- Le panneau de gauche compte les masters (repère : 20 pour entraîner une LoRA) et la **diversité par axe** (4 par axe) pour voir ce qui manque.
- Les variations restent hors de la liste des fils et de la galerie ; retirer une image des références la retire aussi des masters.

## Lieux

Icône « Lieux » dans la barre de gauche : les lieux récurrents (la chambre de Léa, son café…), pour retrouver le même décor d'une scène à l'autre.

- **Créer un lieu** : même créateur que pour un personnage, avec une fiche tirée de la zone *Lieu & décor* de la bibliothèque (type de pièce, style déco, mobilier…), des lots de variantes en paysage (aperçu : plan large, sans personne), puis **Garder ce lieu** (l'image devient sa référence et sa première master).
- **Images master du lieu** : axes **Angles** (depuis l'entrée, coin opposé, plongée…), **Moments** (matin, heure dorée, nuit…), **Détails**, **Avec quelqu'un** (une silhouette pour l'échelle), ou **Mélange**. **Partir de la référence** fait chaque variation en image → image depuis la référence (force réglable : plus elle est haute, plus l'image s'en éloigne), pour garder la même pièce. Repère : 12 masters, 3 par axe.
- **Rattacher** un lieu à un ou plusieurs personnages depuis sa carte ; la page du personnage liste ses lieux. Le moment de la journée n'appartient pas au lieu : il viendra de la scène (lot 6).

## Où sont les fichiers

```
~/Documents/ai-influence-app/media/<compte>/
├── <persona>/<jour>/        résultats générés
├── sans-persona/<jour>/
├── miniatures/<catégorie>/   miniatures de la bibliothèque
└── references/<persona>/    images importées (références, avatars)
```

Le dossier se change dans Paramétrage → Stockage. Supprimer un fil, une demande, un résultat ou un persona les retire de l’app mais **ne supprime jamais les fichiers**.

## LoRA

- SpicyAPI n'entraîne pas de LoRA, il les utilise. Entraîne ta LoRA ailleurs (fal, Muapi, ai-toolkit en local), puis colle son lien dans le persona.
- Le lien doit être **public** et **direct** vers le fichier `.safetensors` (Hugging Face, Civitai). SpicyAPI le vérifie dès le devis.
- Une LoRA ne fonctionne que sur le modèle pour lequel elle a été entraînée : indique ce modèle dans le persona.

## Ajouter un modèle

Ajoute une ligne dans `shared/src/models.ts` avec l'identifiant de la famille SpicyAPI (par exemple `bytedance/seedream-5.0-pro`) et ses badges. Le formulaire de paramètres se construit tout seul à partir du schéma live du modèle.

## Base de données

```bash
npm run db:generate   # après une modification de backend/src/db/schema.ts
npm run db:migrate    # aussi lancé automatiquement par npm run dev
npm run typecheck     # shared + backend + frontend
```

## Structure

```
ai-fluence/
├── frontend/   TanStack Start (routes, composer, fil, paramétrage, personas, galerie)
├── backend/    Hono (auth, SpicyAPI, suivi des tâches, médias, personas, fils)
├── shared/     modèles, logique d'input, types d'API
└── archives/   code du fork non utilisé, gardé comme référence
```

## Déploiement

Pour l'instant, c'est un outil local. Si l'app passe un jour en web : front sur Vercel, back sur Railway, pas de Docker. Il faudra alors remettre nitro pour le build du front (retiré à cause d'un conflit de version avec Vite 8) et remplacer le stockage disque par un stockage objet (S3 ou R2). Tout le stockage passe par `backend/src/services/storage.service.ts`, c'est le seul fichier à adapter.
