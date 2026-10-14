---
name: write-commit
description: Écrit le message de commit des modifications en cours d'un dépôt Git (une ligne de titre puis des puces Conventional Commits), dans `<racine>/-commits/AAAA-MM-JJ.md`, prêt à copier-coller dans VS Code. À utiliser quand l'utilisateur demande « écris le commit », « prépare le commit », « résume les modifs pour le commit ». Ne commite jamais, ne modifie ni le code ni l'historique.
---

# Écrire le commit des modifications en cours

L'utilisateur commite lui-même. Ce skill prépare le texte du commit : il analyse les modifications, écrit un fichier Markdown dans `-commits/`, et l'utilisateur n'a plus qu'à copier-coller tout le fichier dans VS Code.

Ne jamais lancer `git commit`, `git add`, `git stash`, ni aucune commande qui modifie le dépôt ou son historique. Ne jamais modifier un fichier du projet (seul le fichier de `-commits/` est écrit).

## 1. Trouver le dépôt

1. Racine du dépôt : `git rev-parse --show-toplevel` depuis le dossier de travail.
2. Hors d'un dépôt : chercher le dépôt pertinent dans les dossiers de travail ; s'il y en a plusieurs, demander lequel.
3. Vérifier que `-commits/` est ignoré par Git (`git check-ignore -q -- -commits/x.md`). Sinon, le signaler à l'utilisateur et proposer d'ajouter `-commits` au `.gitignore`, sans le faire d'office.

## 2. Ce qu'il faut résumer

Par défaut : **les modifications en cours**, celles du prochain commit.

- `git status --short` : fichiers modifiés, ajoutés, supprimés, non suivis (`??`).
- `git diff HEAD --stat` puis `git diff HEAD -- <fichier>` sur les fichiers utiles ; lire les nouveaux fichiers non suivis qui comptent (routes, services, composants, migrations, tests).
- Une suppression déjà indexée (`D ` dans `git status`) fait partie du commit.

Si l'utilisateur donne autre chose (une plage de commits, une branche, une période), résumer cette sélection à la place, et l'indiquer en une ligne à la fin du fichier.

Règles d'analyse :

- Décrire ce que le code fait vraiment : lire le diff, ne pas deviner à partir d'un nom de fichier.
- Regrouper par fonctionnalité, pas par fichier ni par étape de travail. Une fonctionnalité construite en plusieurs fois (puis corrigée) donne une seule puce `feat`, pas une `feat` et trois `fix`.
- Un `fix` corrige un comportement qui existait déjà au dernier commit. Un réglage d'une nouveauté du même commit reste dans sa puce `feat`.
- Ignorer les fichiers générés et mécaniques sans intérêt pour le lecteur : `package-lock.json`, snapshots de migrations (`drizzle/meta/*`), `routeTree.gen.ts`, reformatage pur. Les mentionner seulement s'ils sont le sujet (par exemple « formatage Prettier de X » dans un `chore`).
- Ne jamais recopier une valeur de secret (clé API, mot de passe, jeton) vue dans un diff.
- Si rien de notable : écrire `Aucun changement pertinent à résumer.`

## 3. Format (à respecter exactement)

```
feat(scope): résumé de l'ensemble

- feat(scope) : changement principal
- feat : petites nouveautés regroupées, a, b, c
- fix(scope) : corrections regroupées, a, b
- refactor(scope) : restructuration
- test : ce qui change dans les tests
- chore : configuration, dépendances, fichiers ignorés
```

- **Titre** : la première ligne, sans préfixe (jamais « Titre : ») : le type Conventional Commits le plus représentatif, un scope, et un résumé de tout le commit (`feat(scope): résumé`). Une seule ligne, idéalement moins de 72 caractères. Le fichier se copie-colle tel quel : la première ligne devient le titre du commit.
- **Ligne vide** entre le titre et les puces.
- **10 lignes au maximum** pour tout le fichier, titre et ligne vide compris. Une ligne par puce, pas de sous-puces sauf rare exception. Regrouper les petites nouveautés dans une seule puce (`feat : a, b, c`) et les petites corrections aussi (`fix(ui) : a, b, c`). Si ça dépasse encore, garder l'essentiel et fusionner le reste.
- **Puces de premier niveau** : `- type(scope) : description`, avec une espace avant et après les deux-points. Types : `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `revert`. Ordre : `feat`, puis `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`.
- **Détails** : en principe aucun, la puce suffit. Exception rare (changement cassant, migration à appliquer) : une sous-puce indentée de deux espaces (`  - détail`), sans type.
- **Changement cassant** : `type(scope)! : …` et un détail `BREAKING CHANGE: …` qui explique l'impact.
- Pas de puce vide, pas de section vide, pas de préambule adressé à l'utilisateur, pas de bloc de code autour : le fichier contient seulement le texte du commit.

### Rédaction

- En français, sauf si le dépôt écrit ses commits dans une autre langue. Garder tels quels les noms techniques (fichiers, routes, composants, noms de modèles).
- Phrases courtes, structure simple (sujet, verbe, complément). Minuscule après les deux-points, pas de point final.
- Pas de tiret cadratin (`—`) : virgules, deux-points ou parenthèses à la place.
- Concret : « clic sur un persona : ouvre son fil le plus récent » plutôt que « amélioration de la navigation ».
- Scopes : réutiliser ceux de l'historique du dépôt (`git log --format=%s -50`) et les noms de l'app. Un scope par grande zone, pas un par dossier. Pas de type `rework` : utiliser `refactor`.

## 4. Écrire le fichier

- Chemin : `<racine>/-commits/AAAA-MM-JJ.md`, avec la date du jour (`date +%F`). Créer `-commits/` s'il n'existe pas.
- Fichier déjà présent pour ce jour : ne pas l'écraser, ajouter un suffixe (`AAAA-MM-JJ-2.md`, `-3`…).
- Relire le fichier écrit : la première ligne est le titre (sans « Titre : »), la deuxième est vide, les puces commencent par `- ` et suivent le format.

## 5. Réponse à l'utilisateur

Une ou deux phrases : le chemin du fichier (en lien cliquable) et le périmètre analysé (par exemple « les modifications en cours depuis le commit `0c2c591` »). Ne pas recopier le résumé, sauf si l'utilisateur le demande.
