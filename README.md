# AI Fluence

Studio local de génération photo et vidéo pour du contenu d'influenceurs IA et de pages art, branché sur [SpicyAPI](https://spicyapi.ai).

## Démarrer

```bash
npm install
npm run dev
```

Une seule commande : elle applique les migrations, lance l'API Hono (port 3470), attend qu'elle réponde, puis lance le front (port 3070). Ouvrir http://localhost:3070.

Prérequis : Node 22.13+, un Postgres local avec une base `ai-fluence`, et `backend/.env` rempli (voir `backend/.env.example`).

## Stack

- `frontend/` : TanStack Start + Router, TanStack Query, shadcn/ui, Tailwind 4. Base forkée de [rs-4/tanstack-ai-demo](https://github.com/rs-4/tanstack-ai-demo), le code non utilisé est rangé dans `archives/`.
- `backend/` : Hono sur Node, Drizzle + Postgres, SDK officiel `@spicyapi/sdk`.
- `shared/` : registre des modèles, logique de choix de tâche et de construction de l'`input`, types d'API.

## Comment ça marche

1. Le composer envoie prompt, modèle, paramètres et références au backend.
2. Le backend choisit la tâche selon les pièces jointes (texte → image, image → image, image → vidéo, références → vidéo), ajoute la LoRA, le mot déclencheur et le suffixe du persona, uploade les références chez SpicyAPI, puis demande un devis gratuit (affiché avant le clic).
3. Au clic, la tâche est créée avec ce devis. Le backend la suit jusqu'au bout, télécharge le résultat dans le dossier local et enregistre le coût réel.

Les fichiers sont rangés dans `~/Documents/ai-influence-app/media/<utilisateur>/<persona>/<jour>/` (modifiable dans Paramétrage → Stockage). Supprimer un fil ne supprime jamais les fichiers.

## Ajouter un modèle

Ajouter une ligne dans `shared/src/models.ts` (l'id est le préfixe des model IDs SpicyAPI, par exemple `bytedance/seedream-5.0-pro`) avec ses badges `LORA`, `REF` ou `PERF`. Les champs du formulaire viennent du schéma live du modèle, il n'y a rien d'autre à coder.

## Base de données

```bash
npm run db:generate   # après une modification de backend/src/db/schema.ts
npm run db:migrate    # aussi lancé automatiquement par npm run dev
```

## Notes

- La clé API SpicyAPI se saisit par compte dans Paramétrage → Clé API. Elle est vérifiée, puis chiffrée en base (AES-256-GCM, clé `APP_SECRET`).
- Les LoRA doivent être un lien `https` public et direct vers le `.safetensors`. SpicyAPI le vérifie dès le devis.
- Pas de build de production pour l'instant (nitro retiré, conflit de peer avec vite 8). À remettre le jour d'un déploiement.
- Déploiement futur : front sur Vercel, back sur Railway, pas de Docker.
