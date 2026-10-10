# AI Fluence

## Stockage : seules les images sont sur le disque

- L'app sera déployée sur le web. Tout ce qui est sauvegardé doit donc l'être d'une façon qui fonctionne aussi en ligne : en base (Postgres) ou dans le navigateur (cookies, localStorage).
- Seuls les médias (images, vidéos) sont aujourd'hui enregistrés sur le disque local, pour éviter pour l'instant un CDN et son coût. Au passage sur le web, seul ce stockage changera (bascule vers un CDN).
- Ne jamais ajouter d'autre donnée enregistrée en fichiers locaux côté serveur (brouillons, réglages, préférences…).

## Générations de test (payantes)

- Une génération SpicyAPI coûte de l'argent : n'en lancer que pour répondre à une question dont la réponse vient de l'expérience (comportement réel d'un modèle) et ne se trouve pas dans la documentation.
- Toujours demander l'accord dans le chat avant chaque lancement, avec le modèle, les réglages et le prix. Jamais rien d'automatisé, de récurrent ou de fréquent.
- Choisir le moins cher : modèle low cost, résolution la plus basse, une seule image.
- Une fois le test fini, mettre les fils de test à la corbeille.

## Tests

- `npm run test` (racine, mode rapide, ~3 min) : `test:db` (crée et migre la base `ai-fluence-test`), puis `test:unit` (tous les tests unitaires et API), puis `test:e2e` (seulement les tests E2E marqués `@core` : un par page et par comportement principal).
- `npm run test:full` : la même chose avec tous les tests E2E (`test:e2e:full`), cas particuliers compris.
- Un nouveau test E2E essentiel (nouvelle page, nouveau parcours principal) prend ` @core` à la fin de son titre ; les cas particuliers n'en prennent pas.
- `npm run test:unit` (Vitest, `vitest.config.mts`) :
  - projet `unit` : logique pure (`shared`, `frontend/src/lib`, `backend/src/services`), sans base ni serveur ;
  - projet `api` : chaque endpoint Hono appelé par `app.fetch` (sans serveur), sur `ai-fluence-test`, avec un faux SpicyAPI (`SPICY_FAKE`, cf. `backend/src/services/spicy.fake.ts` ; un prompt contenant `FAIL_TEST` simule un échec). Fichiers dans `backend/src/test/`.
- Playwright lance `npm run dev:test` (back avec `cross-env` en `NODE_ENV=test` sur `ai-fluence-test`, port 3471 ; front sur le port 3071 après `wait-on` de l'API), puis les specs `e2e/*.spec.ts`. Chrome installé sur la machine est utilisé.
- En mode test, rien ne sort de la machine : pas de SpicyAPI ni de Civitai réels, pas d'ouverture du Finder, les fichiers purgés sont supprimés directement (pas de corbeille macOS).
- Toute évolution doit garder ces tests verts et en ajouter pour les nouveaux cas.
