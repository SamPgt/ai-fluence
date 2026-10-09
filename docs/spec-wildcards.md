# Spec fonctionnelle : wildcards, créateur de personnage, compositeur de scène

> Branche `feat/comfyui`. Vision produit de cette branche, indépendante de `main`.
> Statut : v1.2. Priorité au **choix visuel** (bibliothèque, miniatures, bulles), cf. § 2 et § 14.

## 1. Objectif

Créer un influenceur virtuel **en choisissant plutôt qu'en écrivant**. L'utilisateur assemble ses prompts à partir d'options lisibles (« Carré plongeant », « Golden hour », « Portrait pro »), et l'app écrit le prompt d'expert à sa place.

La même brique sert à deux usages :

1. **Créer un personnage** comme dans un jeu vidéo (Les Sims) : choisir ou tirer au hasard ses traits, générer des variantes, garder celle qui plaît.
2. **Composer une scène** pour un personnage existant : « faire ses courses » (tenue, pose, lieu, lumière, rendu photo), éventuellement avec une part d'aléatoire pour produire une série de posts variés.

## 2. Principes

- **Choisir visuellement.** On ne connaît pas par cœur le nom des coupes de cheveux : chaque option a une **miniature** qui la montre, et on choisit dans une grille d'images. C'est le cœur de l'outil ; la syntaxe des wildcards (`__…__`) n'est qu'un mécanisme sous le capot.
- **Un choix = une bulle.** L'option choisie apparaît comme une bulle au-dessus du champ de texte du composer (libellé français, fragment anglais au survol, clic pour changer).
- **Langage naturel.** Les fragments sont des groupes nominaux (`a short bowl cut`), assemblés en phrase par un gabarit accordé au genre du personnage (« a woman with a short bowl cut, light olive skin… »), pas en liste de mots-clés : c'est ce qu'attendent Flux, Z-Image, Qwen.
- **Choisir, pas écrire.** Le texte libre reste possible, mais n'est plus nécessaire.
- **Deux faces par option** : un libellé en français pour l'utilisateur, un fragment de prompt en anglais pour le modèle. Le jargon (objectifs, éclairages, termes techniques) est caché dans les fragments.
- **Aléatoire maîtrisé** : chaque emplacement peut être choisi, tiré au hasard (dans toute la liste ou une sélection) ou laissé vide. Un cadenas protège ce qui plaît.
- **Traçabilité** : chaque génération garde les tirages qui l'ont produite. On peut toujours savoir pourquoi une image ressemble à ça, et la reproduire.
- **Tous les modèles** : la résolution des wildcards se fait dans l'app, avant l'envoi. Elle fonctionne pour les modèles locaux (ComfyUI) comme pour SpicyAPI.
- **Local d'abord pour explorer** : générer des dizaines de variantes ne coûte rien en local. C'est l'usage naturel du créateur de personnage.

## 3. Vocabulaire

| Terme | Définition |
|---|---|
| **Option** | Un choix unitaire : libellé FR + fragment EN (ex. « Roux bouclé » → `curly copper-red hair`). |
| **Catégorie** (wildcard) | Une liste d'options du même type (ex. `cheveux_couleur`). Référencée dans un prompt par `__nom__`. |
| **Pack** | Un ensemble de catégories importé d'une source (ex. un pack Civitai) ou créé dans l'app. |
| **Bibliothèque** | Tous les packs disponibles pour un compte. |
| **Bloc** | Une partie du prompt : Identité, Tenue, Action, Décor, Photo. |
| **Emplacement** | Une case d'un bloc, alimentée par une ou plusieurs catégories (ex. bloc Identité → emplacement « Cheveux »). |
| **Gabarit** | L'ordre et la tournure dans lesquels les fragments sont assemblés en phrase. |
| **Tirage** | Le résultat de la résolution des emplacements et wildcards pour une génération donnée. |
| **Personnage** | Un persona dont l'identité est décrite par des emplacements figés (+ visage de référence, images master, LoRA). |
| **Lieu** | Un endroit récurrent et reconnaissable du personnage (sa chambre de gameuse, son salon…), décrit par une fiche et des images master. Un personnage peut en avoir plusieurs. |
| **Scène** | La combinaison pour un post : personnage + lieu + tenue + action + photo. Réutilisable (« Courses du samedi »). |
| **Lot** | N images générées d'un coup. En local, générées l'une après l'autre. |
| **Images master** | Les images validées d'un personnage ou d'un lieu : références pour la cohérence, puis jeu d'entraînement d'une LoRA. |

## 4. Structure du prompt

### 4.1 Blocs et emplacements par défaut

| Bloc | Emplacements | Porté par |
|---|---|---|
| **Identité** | genre, âge, origine, morphologie, forme du visage, yeux, cheveux (coupe), cheveux (couleur), peau, signes distinctifs | le **personnage** (figé une fois choisi) |
| **Tenue** | style, haut, bas, chaussures, accessoires | la scène (ou le personnage : « tenue signature ») |
| **Action** | pose, expression, activité, interaction (objet, autre personne) | la scène |
| **Décor** | lieu, moment de la journée, météo, saison | un **lieu** enregistré (cf. § 9.5), ou la scène pour un décor ponctuel |
| **Photo** | cadrage, angle, rendu (smartphone, reflex, argentique, studio), objectif, éclairage | la scène, ou un « look » réutilisable |

Les emplacements sont configurables : on peut en ajouter, en masquer, ou changer la catégorie qui les alimente.

### 4.2 Gabarit d'assemblage

Les modèles récents (Z-Image, Qwen, Flux, modèles SpicyAPI) comprennent mieux une phrase qu'une liste de mots-clés. Le gabarit par défaut :

```
{photo.rendu} {photo.cadrage} of {identité}, wearing {tenue}, {action.pose}, {action.expression},
{action.activité}, in {décor.lieu}, {décor.moment}, {décor.météo}. {photo.objectif}, {photo.éclairage}.
```

Règles :
- un emplacement vide disparaît avec sa ponctuation (pas de « wearing , ») ;
- le texte libre de l'utilisateur est ajouté à la fin (ou à l'endroit de `{libre}` si le gabarit le place) ;
- les contextes et le suffixe du persona existants continuent de s'appliquer après le gabarit ;
- le prompt final réellement envoyé reste enregistré (`finalPrompt`, déjà en place).

Un gabarit **« tags »** (fragments séparés par des virgules) est proposé pour les modèles qui préfèrent ce style (SDXL, Pony). Le gabarit est un réglage par modèle.

## 5. Bibliothèque et modèle de données

### 5.1 Entités

**Pack**
- nom, source (`civitai`, `import manuel`, `app`), URL d'origine, licence, version importée
- style détecté : `langage naturel` ou `tags` (cf. § 6.3)
- contenu mature : oui / non (filtre global)
- actif / inactif

**Catégorie**
- nom technique (`cheveux_couleur`, unique dans le pack, utilisé dans `__…__`)
- libellé FR, description
- emplacement suggéré (bloc + emplacement), modifiable
- options

**Option**
- fragment EN (obligatoire) : le texte envoyé au modèle
- libellé FR (facultatif ; à défaut, le fragment est affiché)
- poids (probabilité relative au tirage, 1 par défaut)
- tags libres (ex. `femme`, `streetwear`, `été`) pour filtrer
- vignette (facultative, cf. § 9)
- favori (par utilisateur)

**Tirage** (enregistré avec chaque génération)
- pour chaque emplacement : mode (choisi / aléatoire / vide), option retenue, catégorie
- pour chaque wildcard du texte libre : valeur retenue
- graine du tirage (permet de rejouer exactement le même tirage)

### 5.2 Rattachement aux emplacements

Un emplacement peut piocher dans **plusieurs catégories** (ex. « Lieu » = `lieux_urbains` + `lieux_nature`). L'utilisateur peut restreindre le tirage à **une sélection** d'options (« blond ou roux, pas brun »), enregistrée avec l'emplacement.

## 6. Import de packs (Civitai et autres)

### 6.1 Formats acceptés

| Format | Contenu | Correspondance |
|---|---|---|
| `.txt` | une option par ligne | 1 fichier = 1 catégorie, nommée d'après le fichier |
| `.yaml` / `.yml` | catégories imbriquées (format Dynamic Prompts / Impact Pack) | chaque liste feuille = 1 catégorie, nom = chemin (`vetements/hauts`) |
| `.zip` | dossiers de `.txt` / `.yaml` | 1 dossier = 1 groupe, nom = chemin (`__vetements/hauts__`) |

Le téléchargement depuis Civitai est fait par l'utilisateur (fichier glissé dans l'app) ; l'app ne télécharge rien d'elle-même. L'URL de la page Civitai peut être renseignée pour garder la source et la licence.

### 6.2 Étapes d'import

1. **Lecture** : catégories détectées, nombre d'options, aperçu de 5 options par catégorie.
2. **Analyse** : style (tags / langage naturel), présence de contenu mature, références à des wildcards absentes (`__xyz__` non résolu), doublons avec la bibliothèque.
3. **Rattachement** : l'app propose un emplacement pour chaque catégorie d'après son nom (`hair*` → Identité / Cheveux, `pose*` → Action / Pose…) ; l'utilisateur valide ou corrige.
4. **Validation** : le pack est ajouté, actif par défaut.

Lignes ignorées : vides, commentaires (`#`). Les options en double dans une catégorie sont fusionnées.

### 6.3 Style des packs

Les fichiers ne sont pas liés techniquement à un modèle : n'importe quel pack fonctionne avec n'importe quel modèle. Mais un pack écrit en tags (`1girl, long_hair`) rend moins bien sur un modèle « phrases » (Z-Image, Qwen), et inversement.

- Le style est **détecté à l'import** (proportion d'options courtes séparées par des virgules, présence d'underscores, de `1girl`…) et affiché sur le pack.
- Un pack « tags » utilisé avec un modèle « phrases » affiche un avertissement discret.
- Évolution prévue : conversion d'un pack tags → langage naturel par un modèle texte (cf. `backlog.md`).

## 7. Syntaxe de résolution

Valable dans le texte libre, dans les options (imbrication) et dans le gabarit.

| Syntaxe | Effet |
|---|---|
| `__cheveux_couleur__` | une option tirée de la catégorie |
| `__vetements/hauts__` | idem, catégorie d'un pack en dossiers |
| `{café\|parc\|plage}` | une des variantes, au hasard |
| `{2::café\|parc}` | variantes pondérées (café 2× plus probable) |
| `{2$$rouge\|bleu\|vert}` | 2 variantes distinctes, jointes par « , » |
| `{1-2$$…}` | entre 1 et 2 variantes |

Règles :
- **imbrication** autorisée (une option peut contenir `__autre__`), profondeur maximale 5 ; au-delà, ou en cas de boucle, la résolution s'arrête et un avertissement est affiché ;
- wildcard inconnue : laissée telle quelle dans le prompt, signalée dans le composer avant l'envoi ;
- **graine du tirage** : distincte de la graine d'image. « Relancer » retire les wildcards ; « Relancer à l'identique » rejoue le même tirage ;
- résolution côté backend, au moment de préparer la génération (même endroit que les contextes et le suffixe du persona) ; le composer peut afficher un **aperçu** du prompt résolu.

## 8. Parcours A : créer un personnage

### 8.1 Écran « Créer un personnage »

1. **Point de départ** : vierge, aléatoire complet, ou à partir d'un personnage existant (dupliquer).
2. **Bloc Identité** affiché en fiche : chaque emplacement montre sa valeur, avec trois contrôles :
   - choisir une option (liste avec recherche, vignettes, favoris) ;
   - 🎲 tirer au hasard (dans toute la catégorie ou dans une sélection) ;
   - 🔒 verrouiller.
3. **🎲 global** : relance tous les emplacements non verrouillés.
4. **Tenue / Décor / Photo de prévisualisation** : un réglage neutre par défaut (portrait, fond simple, lumière douce) pour juger le personnage, pas la scène. Modifiable.
5. **Générer N variantes** (4, 8, 12…) avec un modèle au choix (local par défaut). Chaque variante fait son propre tirage pour les emplacements en mode aléatoire.

### 8.2 Comparer et garder

- Les variantes s'affichent en grille. Au survol : les traits tirés pour cette image.
- **« Reprendre ces traits »** : copie le tirage de l'image dans la fiche (pour continuer à affiner autour).
- **« Garder ce personnage »** : crée ou met à jour le persona avec :
  - les traits d'identité figés (emplacements en mode « choisi ») ;
  - l'image comme **visage de référence** (utilisé par ReActor) et première image de sa bibliothèque de références ;
  - le modèle et la graine utilisés (pour reproduire).

### 8.3 Images master

Une fois l'image de référence choisie (« Choisir comme image de référence » sur une variante) :

1. **Variations proches** : générer un lot qui garde le même visage (rôle Visage / ReActor, puis LoRA quand elle existe) en variant angle, expression, cadrage, lumière et tenue. Préréglages : « Face / profil / 3/4 », « Expressions », « Plans larges », « Tenues ».
2. **Sélection des masters** : l'utilisateur marque les images qui « matchent ». Les autres restent dans l'historique des lots ; rien n'est supprimé.
3. **Progression** : compteur vers un jeu d'entraînement de LoRA (repère : 15 à 30 images variées en angles, expressions et lumières).
4. Les masters alimentent la bibliothèque de références du persona et, plus tard, l'export d'un dataset de LoRA (légendes générées, cf. backlog).

#### Mise en œuvre (lot 4b)

- **Base** : `assets.is_master` (marquer une master la met aussi dans les références du persona ; retirée des références, elle n'est plus master), `generations.variation` (`{axis, variantId, label}`), `personas.master_thread_id` (fil masqué des variations).
- **Axes** (`shared/src/masters.ts`) : Angles, Expressions, Lumières, Tenues (formulations neutres en genre), Cadrages ; 6 à 8 variantes chacun (libellé FR, fragment EN). Un lot parcourt l'axe dans un ordre mélangé, sans répétition tant que possible ; « Mélange » pioche dans tous les axes.
- **Prompt** : phrase de la fiche d'identité du persona + fragment de la variante ; sans fiche, « a woman / a man ». Le suffixe du persona s'applique comme ailleurs.
- **Visage** : l'avatar du persona en rôle Visage (ReActor), activé par défaut si le modèle local le permet.
- **API** : `GET /personas/:id/masters`, `PATCH /personas/:id/masters/:assetId`, `POST /personas/:id/variations {axis, count, family, face, params}`.
- **Écran** : `/personnages/:id/masters` ; panneau des masters (total / 20, barre par axe / 4), lots de variations avec ⭐. L'image de référence du créateur est la première master.
- **Pas encore fait** : choisir une autre image que l'avatar comme visage, export du dataset de LoRA (images + légendes).

### 8.4 Historique et comparaison

- Chaque génération de variantes forme un **lot** (Lot 1, Lot 2…), conservé avec son tirage.
- La zone des variantes bascule entre **Grille** (images, traits tirés sous chaque vignette, panneau de l'image sélectionnée) et **Comparer** (tableau : une colonne par image, une ligne par trait, les traits qui varient en couleur de marque, les traits fixes en gris).
- En mode Comparer, **un clic sur une case reprend ce trait seul** dans la fiche.
- Pendant la génération d'un lot : vignettes « En file · n », image en cours avec chrono, barre de progression, temps restant estimé à partir des durées réelles des images déjà terminées, et « Annuler le lot ».

### 8.5 Diversité des images master

- L'image de référence compte comme **première master**.
- Chaque préréglage de variations correspond à un **axe** : Angles, Expressions, Lumières, Tenues (personnage) ; Angles de la pièce, Moments de la journée, Détails, Avec / sans personnage (lieu).
- Le panneau « Images master » affiche le total (« 12 / 20 recommandées ») et une **barre par axe**, pour voir ce qui manque au jeu d'entraînement.

## 9. Parcours B : composer une scène

### 9.1 Panneau « Scène » dans le composer

- Le persona actif apporte son **identité** (lecture seule, rappelée en une ligne : « Léa : 24 ans, rousse bouclée, taches de rousseur »).
- Les blocs **Tenue, Action, Décor, Photo** sont proposés en sections repliables, avec les mêmes contrôles qu'au § 8 (choisir, 🎲, 🔒, vide).
- Le texte libre du composer reste disponible pour préciser (« elle tient un café à emporter »).
- **Aperçu** du prompt final (repliable), avant envoi.
- Les pièces jointes (Départ / Visage) et les réglages du modèle restent ceux du composer actuel.

### 9.2 Séries

- **Générer N posts** : chaque image tire ses propres valeurs pour les emplacements aléatoires.
- Usage type : « même tenue, même lieu, pose et expression au hasard parmi mes favorites » → 8 images prêtes à trier.

### 9.3 Scènes et looks enregistrés

- **Enregistrer comme scène** : la combinaison d'emplacements (avec leurs modes) devient réutilisable pour n'importe quel personnage.
- **Look photo** : un sous-ensemble du bloc Photo (« Smartphone casual », « Shooting 85 mm ») réutilisable seul.

### 9.4 Séries d'images (×N)

Valable partout dans l'app, pas seulement avec les wildcards : le composer propose **×1 / ×4 / ×8**.

- Chaque image est une génération à part, avec **sa propre graine** d'image et **son propre tirage** de wildcards.
- **Local** : les N prompts sont mis dans la file de ComfyUI, qui les exécute **l'un après l'autre** (jamais en parallèle sur le GPU). Les images apparaissent au fur et à mesure.
- **SpicyAPI** : N tâches, exécutées en parallèle par le cloud. Le devis affiché est le total (×N).

### 9.5 Lieux récurrents

Un lieu se crée comme un personnage (§ 8) : fiche, variantes (aperçu neutre : plan large, sans personnage), image de référence, images master. Il est rattaché à un ou plusieurs personnages (un même lieu peut servir à Léa et à Victoria) et se choisit dans le panneau Scène.

**Emplacements de la fiche d'un lieu** : type de pièce, style déco, éléments clés (ex. setup gaming double écran), mobilier, palette, fenêtre et lumière naturelle, désordre.

**Le moment de la journée n'appartient pas au lieu** : la chambre de Léa doit pouvoir apparaître de jour comme de nuit. Le moment et l'éclairage relèvent de la scène (bloc Décor du panneau Scène). Les images master d'un lieu, elles, couvrent plusieurs moments (préréglage « Moments de la journée »).

**Cohérence d'un lieu** : c'est plus difficile que pour un visage (pas d'équivalent de ReActor pour une pièce). Leviers :
- la fiche du lieu injectée à l'identique dans chaque prompt (base) ;
- **image → image** depuis une image master du lieu, à force modérée (local) ;
- modèles **à références multiples** (SpicyAPI : Seedream, Nano Banana, Qwen Edit, Kling O3…) qui combinent personnage + lieu ;
- en local, des modèles d'édition par référence (Qwen-Image-Edit, Flux Kontext) sont possibles mais lourds pour 12 Go de VRAM : à évaluer.

### 9.6 Miniatures des options

Choisir visuellement est plus rapide que lire : chaque option a une miniature.

- **Gabarit de miniature par catégorie** : un prompt neutre où l'option est insérée, avec un cadrage constant (ex. coiffures : portrait tête et épaules, fond gris uni, lumière douce ; couleur de peau : gros plan du visage). Modifiable.
- **Modèles variés** : la personne de la miniature change d'une option à l'autre (âge, origine tirés au hasard) pour montrer l'option, pas une personne.
- **Par genre** : une catégorie peut être « genrée » (coiffures, tenues…). Chaque option y est réservée aux femmes, aux hommes, ou aux deux (choisi à l'import du fichier, modifiable par option). Une option « les deux » a une miniature femme et une homme ; une option réservée n'a que la sienne. Le sélecteur ne montre que les options et miniatures du genre du personnage. Les catégories sans genre (lieux, objets, ambiances) n'ont qu'une miniature par option.
- **Génération depuis la bibliothèque** : « Générer les miniatures manquantes » sur une catégorie, en local, en basse résolution (rapide), avec la progression à l'écran (pas en tâche de fond cachée). « Régénérer » sur une miniature ratée.

### 9.7 Page du personnage

Le persona devient une page à onglets : **Fiche** (identité), **Images master**, **Lieux** (cartes avec nombre de masters, personnages rattachés, « Utiliser dans une scène » ; « Créer un lieu », « Rattacher un lieu existant »), **Scènes** enregistrées, **LoRA**. Action « Nouveau fil avec … » en en-tête.

### 9.8 Séries dans le fil

- Une série (×N) s'affiche comme **un seul bloc** dans le fil : la demande, puis la grille des N images, chacune avec ses valeurs tirées en légende.
- Le composer affiche les pilules **Scène**, **Lieu** et **Visage**, et un sélecteur **×1 / ×4 / ×8** à côté du bouton d'envoi.

## 10. Intégration avec l'existant

| Élément | Intégration |
|---|---|
| **Persona** | Gagne une fiche d'identité (emplacements figés), un visage de référence, une tenue signature facultative. La description libre et le suffixe actuels restent utilisables. |
| **Contextes** (chips « Lumière dorée », « Ciné 35mm »…) | Ce sont des fragments fixes ajoutés au prompt : ils deviennent des options d'une catégorie « Ambiance » ou des looks photo. Migration automatique des contextes existants. ⚠️ Divergence avec `main` : sur `main`, les contextes restent des fragments indépendants. |
| **Visage (ReActor)** | Le visage de référence du persona est joint automatiquement en rôle « Visage » pour les modèles locaux. |
| **LoRA** | Si le persona a une LoRA pour le modèle choisi, elle est appliquée (déjà en place côté SpicyAPI, à étendre aux LoRA locales). |
| **Génération** | Le tirage est enregistré dans la génération ; affiché dans le fil (« traits tirés »), réutilisable par « Relancer » et « Modifier la demande ». |
| **Fournisseurs** | Aucune différence : le prompt résolu est envoyé à ComfyUI ou à SpicyAPI. |

## 11. Cas limites

- **Options incompatibles** (ex. « crâne rasé » + « tresses ») : pas de gestion de règles en v1 ; l'utilisateur verrouille ou restreint la sélection. Les tags d'option permettent de filtrer (§ 5.1).
- **Genre et identité** : les catégories peuvent être filtrées par tag (`femme`, `homme`, `neutre`) selon le personnage, pour ne pas tirer d'options incohérentes.
- **Contenu mature** : les packs marqués matures sont masqués par défaut ; un réglage les active.
- **Pack supprimé** alors que des personnages ou scènes l'utilisent : les valeurs déjà choisies sont conservées (copiées dans le tirage), les emplacements concernés passent en « vide » pour les prochains tirages, avec un avertissement.
- **Prompt trop long** : avertissement au-delà de la limite du modèle, si elle est connue.

## 12. Hors périmètre v1

Voir `backlog.md` : polissage du prompt assemblé par un modèle texte, conversion tags → phrases, génération de nouvelles catégories par un modèle texte, traduction automatique des libellés, règles d'incompatibilité entre options, partage de packs entre comptes.

## 13. Décisions et questions ouvertes

Décidé :
- **Pas de pack de démarrage** : la bibliothèque est alimentée par l'import de wildcards (Civitai ou autre). Le format exact sera calé sur un premier fichier réel.
- **Bulles au-dessus du champ de texte**, pas mélangées au texte.
- **Miniatures par genre** : seule la version du genre du personnage est montrée.
- **Genre du personnage** : nouveau paramètre du persona (femme / homme). ⚠️ Divergence avec `main`, où le persona n'a pas de genre.
- **Zones de la bibliothèque** : chaque catégorie appartient à une zone (Personnage, Tenue, Pose & action, Lieu & décor, Photo & ambiance), qui correspond aux blocs du § 4.1. L'import se fait dans une zone. Le genre est demandé à l'import pour Personnage et Tenue, facultatif pour Pose & action (quelques exceptions), absent pour Lieu & décor et Photo & ambiance.

Ouvert :
1. **Libellés FR des options importées** : saisie à la main, ou traduction automatique (cf. backlog) ; en attendant, le fragment anglais est affiché avec un badge EN.
2. **Emplacements par défaut** : la liste du § 4.1 convient-elle, ou faut-il l'adapter au type de contenu visé (lifestyle, mode, fitness…) ?
3. **Créer un personnage** : page dédiée (recommandé) ou extension de l'écran persona actuel ?

## 14. Découpage proposé

| Lot | Contenu | Statut |
|---|---|---|
| **0. Séries ×N** | Générer N images avec la même demande (file ComfyUI séquentielle en local, N tâches SpicyAPI), en un bloc dans le fil, progression et annulation | ✅ fait |
| **1. Bibliothèque** | Catégories et options en base (FR / EN, catégorie genrée ou non), import d'un fichier wildcard dans une catégorie, ajout et édition à la main, page « Bibliothèque ». Genre du persona. | ✅ fait (import `.txt` ; `.yaml` / `.zip` à caler sur un fichier réel) |
| **2. Miniatures** | Gabarit de miniature par catégorie, génération locale des miniatures manquantes (basse résolution, progression), régénération, versions femme / homme | ✅ fait |
| **3. Sélecteur visuel et bulles** | Composer : « + Trait » → catégorie → grille de miniatures → bulle ; assemblage en langage naturel accordé au genre ; aperçu du prompt | ✅ fait |
| **4a. Créateur de personnage** | Fiche d'identité avec le même sélecteur, 🎲 / 🔒, lots de variantes, Grille / Comparer, « Garder ce personnage » (avatar, référence, fiche d'identité en bulles) | ✅ fait (sélection de tirage « 3 sur 48 » à venir) |
| **4b. Images master** | Variations proches de l'image de référence, étoiles, diversité par axe, préparation d'un dataset de LoRA | ✅ fait (export du dataset à venir) |
| **5. Lieux** | Fiche du lieu, variantes, images master, rattachement au personnage | à faire |
| **6. Compositeur de scène** | Panneau Scène (personnage + lieu + tenue + action + photo), scènes et looks enregistrés, aléatoire et syntaxe `__…__` / `{…}` | à faire |
