import { describe, expect, it } from 'vitest';
import { APP_DEFAULT_FAMILY, MODEL_FAMILIES, PROVIDERS, type CatalogFamily } from '@ai-fluence/shared';
import { SEEDANCE_MINI, SEEDREAM_FLASH, call, signup } from './helpers.js';

const TASKS = ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'reference-to-video', 'upscale'];

const byId = (families: CatalogFamily[], id: string) => families.find(f => f.id === id)!;

describe('GET /catalog', () => {
  it('liste toutes les familles de modèles, dans l’ordre de l’app', async () => {
    const me = await signup();
    const res = await me.get('/catalog');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['families', 'textModels']);
    expect(res.body.families.map((f: CatalogFamily) => f.id)).toEqual(MODEL_FAMILIES.map(f => f.id));
  });

  it('chaque famille a son fournisseur, ses drapeaux et ses tâches avec schéma', async () => {
    const me = await signup();
    const { families } = (await me.get('/catalog')).body as { families: CatalogFamily[] };
    const problems: string[] = [];
    for (const f of families) {
      if (!(f.provider in PROVIDERS)) problems.push(`${f.id} : fournisseur inconnu ${f.provider}`);
      if (typeof f.available !== 'boolean') problems.push(`${f.id} : available absent`);
      if (!['image', 'video'].includes(f.media)) problems.push(`${f.id} : média ${f.media}`);
      if (!f.label || typeof f.hint !== 'string') problems.push(`${f.id} : libellé ou indice absent`);
      if (!Array.isArray(f.badges)) problems.push(`${f.id} : badges absents`);
      if (f.typicalSeconds !== null) problems.push(`${f.id} : typicalSeconds sans génération`);
      if (f.available !== Object.keys(f.tasks).length > 0) problems.push(`${f.id} : available incohérent`);
      for (const [task, t] of Object.entries(f.tasks)) {
        if (!TASKS.includes(task)) problems.push(`${f.id} : tâche inconnue ${task}`);
        if (!t!.modelId.startsWith(`${f.id}/`)) problems.push(`${f.id} : modelId ${t!.modelId}`);
        if (!t!.schema || typeof t!.schema !== 'object') problems.push(`${f.id}/${task} : schéma absent`);
        if (!('startingPrice' in t!) || !('policyTier' in t!)) problems.push(`${f.id}/${task} : prix ou palier absent`);
      }
      // Le média de la famille correspond à ses tâches.
      const media = Object.keys(f.tasks).some(k => k.endsWith('-video')) ? 'video' : 'image';
      if (f.available && media !== f.media) problems.push(`${f.id} : tâches ${media} pour un modèle ${f.media}`);
    }
    expect(problems).toEqual([]);
  });

  it('les familles par défaut de l’app sont disponibles', async () => {
    const me = await signup();
    const { families } = (await me.get('/catalog')).body as { families: CatalogFamily[] };
    expect(APP_DEFAULT_FAMILY).toEqual({ image: SEEDREAM_FLASH, video: SEEDANCE_MINI });

    const image = byId(families, SEEDREAM_FLASH);
    expect(image).toMatchObject({ available: true, media: 'image', provider: 'bytedance' });
    expect(image.tasks['text-to-image']).toMatchObject({ modelId: `${SEEDREAM_FLASH}/text-to-image` });
    expect(image.tasks['image-to-image']).toMatchObject({ modelId: `${SEEDREAM_FLASH}/edit` });
    expect(image.tasks['text-to-image']!.schema.properties).toHaveProperty('prompt');

    const video = byId(families, SEEDANCE_MINI);
    expect(video).toMatchObject({ available: true, media: 'video', provider: 'bytedance' });
    expect(Object.keys(video.tasks).sort()).toEqual(['image-to-video', 'reference-to-video', 'text-to-video']);
  });

  it('toutes les familles de la capture du catalogue sont disponibles', async () => {
    const me = await signup();
    const { families } = (await me.get('/catalog')).body as { families: CatalogFamily[] };
    expect(families.filter(f => !f.available).map(f => f.id)).toEqual([]);
  });

  it('les outils (upscalers) ne sont pas dans les familles du menu', async () => {
    const me = await signup();
    const { families } = (await me.get('/catalog')).body as { families: CatalogFamily[] };
    expect(families.some(f => f.id.startsWith('spicyapi/'))).toBe(false);
  });

  it('liste les modèles texte activés', async () => {
    const me = await signup();
    const { textModels } = (await me.get('/catalog')).body;
    expect(textModels).toEqual(['deepseek/v4.1-flash/chat']);
  });

  it('ajoute une durée typique après une génération réussie', async () => {
    const me = await signup();
    await me.generate();
    const { families } = (await me.get('/catalog')).body as { families: CatalogFamily[] };
    const image = byId(families, SEEDREAM_FLASH);
    expect(typeof image.typicalSeconds).toBe('number');
    expect(image.typicalSeconds).toBeGreaterThanOrEqual(0);
    // Les autres familles restent sans durée.
    expect(families.filter(f => f.id !== SEEDREAM_FLASH).every(f => f.typicalSeconds === null)).toBe(true);
  });

  it("la durée typique ne dépend que de ses propres générations", async () => {
    const a = await signup();
    const b = await signup();
    await a.generate();
    const { families } = (await b.get('/catalog')).body as { families: CatalogFamily[] };
    expect(byId(families, SEEDREAM_FLASH).typicalSeconds).toBeNull();
  });

  it('accepte ?refresh=1 et renvoie le même catalogue', async () => {
    const me = await signup();
    const first = (await me.get('/catalog')).body;
    const res = await me.get('/catalog?refresh=1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(first);
  });

  it('répond 412 sans clé API', async () => {
    const me = await signup({ apiKey: false });
    const res = await me.get('/catalog');
    expect(res.status).toBe(412);
    expect(res.body.error).toMatch(/clé API/);
  });

  it("redevient disponible dès qu'une clé est ajoutée", async () => {
    const me = await signup({ apiKey: false });
    expect((await me.get('/catalog')).status).toBe(412);
    await me.put('/settings/api-key', { apiKey: 'sk-spicy-test-0000000000' });
    expect((await me.get('/catalog')).status).toBe(200);
  });

  it('répond 401 sans session', async () => {
    expect((await call('GET', '/catalog')).status).toBe(401);
  });
});
