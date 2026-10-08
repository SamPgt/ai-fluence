# Brief Claude Design : personnage, lieu, scène

> À coller dans Claude Design, avec une capture de l'app actuelle (écran d'accueil avec un fil ouvert et le composer).
> Référence fonctionnelle : `docs/spec-wildcards.md`.

---

Tu conçois de nouveaux écrans pour **AI Fluence**, une app web (locale) qui sert à créer des influenceurs virtuels en images et vidéos IA. Les écrans doivent **s'intégrer à l'app existante** : même mise en page, même charte, mêmes composants. Ne crée pas une nouvelle identité visuelle. Une capture de l'app actuelle est jointe : c'est la référence à respecter.

## 1. Charte de l'app (à respecter strictement)

**Thème sombre uniquement.** Pas de fond clair, pas de rouge comme couleur d'accent.

| Rôle | Valeur |
|---|---|
| Fond principal | `#0a0a0b` |
| Panneaux latéraux (liste des fils) | `#101012` |
| Barre de navigation tout à gauche | `#0c0c0d` |
| Cartes, popovers, fenêtres | `#141416` |
| Surfaces secondaires, survols, champs | gris très sombre `oklch(0.274 0.006 286)` (≈ `#27272a`) |
| Bordures | même gris, souvent à 40–60 % d'opacité |
| Texte principal | `#ededed` |
| Texte secondaire | `oklch(0.705 0.015 286)` (≈ `#a1a1aa`) |
| **Accent de marque** | **bleu ciel très clair `#a6efff`**, texte posé dessus `#0a0a0b` |
| Erreur | rouge sombre (fond `destructive/10`, bordure `destructive/40`) |

**Badges de modèles** (petites étiquettes, fond coloré à 15 %, texte clair, liseré à 30 %) : `LORA` violet, `REF` cyan, `PERF` ambre, `LOCAL` émeraude.

**Typographie** : Geist (repli Inter). Interface dense : textes de 11 à 13 px, titres de section 13–14 px semi-gras, titres de page 18–20 px.

**Formes** : rayon de base 10 px ; cartes et composer très arrondis (16 px) ; vignettes 12 px ; **boutons de la barre du composer en pilules** (hauteur 32 px, `rounded-full`, bordure fine, fond transparent sombre) ; bouton principal rond, plein, couleur de marque.

**Composants** : shadcn/ui (Radix) : Select, Popover, Dialog, Tabs, Switch, Tooltip, DropdownMenu. Icônes **Lucide** (trait fin). Pas d'ombres lourdes, peu de bordures épaisses ; les séparations se font par nuances de fond et bordures fines.

**Langue** : interface en français, tutoiement.

## 2. Mise en page existante (à conserver)

De gauche à droite :

1. **Barre des personas** (étroite, ~64 px) : logo, « Tous les fils », un avatar rond par persona, bouton « + » (créer), en bas : galerie et avatar du compte.
2. **Panneau des fils** (~288 px, fond `#101012`) : nom du persona, bouton « Nouveau fil » (contour couleur de marque), recherche ⌘K, liste des fils (épinglés, récents) ; en bas : statut « ComfyUI : Connecté » (pastille verte) et « Crédit : x $ ».
3. **Zone principale** : en-tête fin (bouton replier + titre du fil), le fil de générations au centre (demande de l'utilisateur à droite dans une bulle, résultats à gauche avec actions au survol), et le **composer en bas** : chips « Contexte » au-dessus, carte arrondie avec vignettes des pièces jointes, champ de texte, puis une rangée de pilules (joindre, Réf., modèle, paramètres rapides, ⚙️, Reformuler) et le bouton rond d'envoi.

Les nouveaux écrans s'ouvrent **dans la zone principale** (les deux barres de gauche restent visibles) ou en panneau à droite de la zone principale.

## 3. Concepts à représenter

- **Personnage** : une personne fictive, définie par une fiche d'identité (genre, âge, origine, morphologie, visage, yeux, cheveux coupe et couleur, peau, signes distinctifs) et par des **images master** (ses photos de référence validées).
- **Lieu** : un endroit **récurrent et reconnaissable** du personnage (sa chambre de gameuse, son salon, son café habituel). Il est défini par une fiche (type de pièce, style, éléments clés, couleurs, lumière) et ses propres images master. Un personnage peut avoir plusieurs lieux.
- **Scène** : la combinaison pour un post : **personnage + lieu + tenue + action + photo**.
- **Emplacement** : chaque ligne d'une fiche. Trois états : **Choisi** (une option), **Aléatoire** (tiré à chaque image, dans toute la liste ou une sélection : « 3 sur 48 »), **Vide**. Un **cadenas** protège un emplacement quand on relance tout.
- **Option** : un choix lisible en français (« Bouclé mi-long ») qui cache un fragment de prompt anglais (`shoulder-length curly hair`, affiché en petit, police mono). Les options importées non traduites portent un badge **EN**.
- **Lot** : un ensemble de N images générées d'un coup. En local, elles sont générées **l'une après l'autre** : elles apparaissent progressivement (vignette « en file », puis « en cours » avec chrono, puis l'image).

## 4. Écrans demandés

Pour chaque écran : une proposition principale, avec les états **vide**, **génération en cours** (lot qui se remplit image par image) et **résultats**.

### Écran 1 : Créer un personnage

Ouvert par le « + » de la barre des personas.

- **À gauche, la fiche d'identité** : une ligne par emplacement (libellé, valeur choisie avec son fragment anglais en petit, ou « Aléatoire · 3 sur 48 »), avec les icônes 🎲 (tirer) et 🔒 (verrouiller). En haut : « Tout relancer », compteur « 3 aléatoires · 3 verrouillés ». En bas : l'aperçu neutre utilisé pour juger le personnage (« Portrait buste · fond uni · lumière douce », modifiable).
- **En haut** : point de départ (Vierge / Aléatoire complet / Dupliquer), sélecteur de modèle (avec badge LOCAL), nombre d'images (4 / 8 / 12), bouton « Générer 8 variantes » (couleur de marque).
- **À droite, les variantes**, avec une bascule **Grille / Comparer** :
  - *Grille* : les images ; au survol ou à la sélection, les traits tirés pour cette image, et deux actions : « Reprendre ces traits » (copie le tirage dans la fiche) et « Choisir comme image de référence ».
  - *Comparer* : un tableau, une colonne par image et une ligne par trait ; les traits qui varient d'une image à l'autre sont mis en évidence (couleur de marque), les traits fixes sont en texte secondaire.
- **Historique des lots** (Lot 1, Lot 2…) : les images non choisies restent disponibles, rien n'est supprimé.

### Écran 2 : Images master (personnage et lieu)

Suite logique de l'écran 1, même structure, une fois l'image de référence choisie.

- L'**image de référence** est affichée en grand, à gauche ou en tête.
- « **Générer des variations proches** » : N images qui gardent le même visage (ou le même lieu) en variant angle, expression, cadrage, lumière et tenue. Des préréglages rapides : « Face / profil / 3/4 », « Expressions », « Plans larges », « Tenues ».
- Dans chaque lot, l'utilisateur **marque ses images master** (une étoile ou une case). Les masters sont rassemblées dans une bande ou une grille « Images master » avec un compteur et un indicateur de progression vers un jeu d'entraînement de LoRA (ex. « 12 / 20 recommandées », avec la diversité : angles, expressions, lumières).
- Actions sur l'ensemble : « Garder ce personnage » (crée le persona avec sa fiche et ses masters) et, plus tard, « Préparer l'entraînement d'une LoRA ».

### Écran 3 : Créer un lieu

Même logique que l'écran 1, appliquée à un lieu : fiche (type de pièce, style déco, éléments clés comme « setup gaming double écran », « néons RGB », palette, fenêtre et lumière, moment de la journée), variantes, choix d'une image de référence, puis images master du lieu (écran 2). Le lieu est rattaché à un ou plusieurs personnages. Montre où l'on retrouve les lieux d'un personnage (par exemple un onglet dans la page du persona).

### Écran 4 : Composer une scène (dans un fil)

Le fil actuel reste au centre ; un **panneau « Scène » s'ouvre à droite** :

- **Personnage** : résumé verrouillé en une ligne (« Léa : 24 ans, rousse bouclée, taches de rousseur »), avec sa vignette.
- **Lieu** : sélecteur parmi les lieux du personnage (vignette + nom), ou « Aucun lieu ».
- **Tenue, Action, Photo** : sections repliables, une ligne par emplacement avec 🎲 / 🔒 et la valeur (ou « Aléatoire · Favoris · 4 »).
- **Aperçu du prompt** en bas du panneau : le texte final, où les parties tirées au hasard sont surlignées (couleur de marque) et le texte libre souligné, avec l'identifiant du tirage.
- Actions du panneau : « Charger une scène… », « Enregistrer la scène ».

Dans le **composer** : une pilule « Scène : Courses du samedi · 2 aléatoires », une pilule « Lieu : Chambre gaming », une pilule « Visage : Léa », et un sélecteur **×1 / ×4 / ×8** (nombre d'images) à côté du bouton d'envoi. Dans le fil, une série apparaît comme un groupe d'images avec, sous chacune, les valeurs tirées (« Accoudée à l'étal · rire léger »).

### Écran 5 : Choisir une option (fenêtre)

Réutilisée partout (fiche personnage, fiche lieu, panneau scène) :

- titre de l'emplacement et catégories sources (« cheveux_coupe (Influenceur base) + hairstyles_v3 (Civitai) ») ;
- recherche, filtres par tag (femme, mi-long, long, court, attaché…), onglets « Tous 48 / Favoris 6 / Sélection 3 » ;
- grille de vignettes : libellé français, fragment anglais en petit, badge EN si non traduit, **case à cocher** (ajoute à la sélection de tirage) et **étoile** (favori) ;
- pied de fenêtre : « 3 dans la sélection de tirage · Vider », « 🎲 Tirer dans la sélection », bouton principal « Choisir "Bouclé mi-long" ».

## 5. Ce qu'on attend

- Des écrans **cohérents avec la capture jointe** : thème sombre, accent bleu ciel `#a6efff`, pilules, densité de l'app actuelle.
- Les images de personnes peuvent rester des emplacements vides (icône image), comme dans les maquettes précédentes.
- Une seule proposition par écran, sauf pour l'écran 1 où tu peux montrer la bascule Grille / Comparer dans ses deux états.
