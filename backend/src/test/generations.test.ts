/**
 * Générations : devis, création, prompt final, séries, suivi des tâches,
 * lecture et upscale. SpicyAPI est le faux client (SPICY_FAKE) ; on espionne
 * ses méthodes pour vérifier l'input exact envoyé.
 */
import { existsSync } from 'node:fs';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFamily } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, generations } from '../db/schema.js';
import { fakeSpicyClient } from '../services/spicy.fake.js';
import { EDIT_INSTRUCTION } from '../services/prompt.js';
import { type Agent, GPT, SEEDANCE_MINI, SEEDREAM_FLASH, call, signup } from './helpers.js';

const QWEN_PRO = 'alibaba/qwen-image-3.0-pro';
const Z_IMAGE_LORA = 'alibaba/z-image-turbo-lora';
const WAN_22_LORA = 'alibaba/wan-2.2-lora';
const LTX = 'lightricks/ltx-2.3-spicy-lora';
const WAN_30 = 'alibaba/wan-3.0';
const FAKE_UUID = '00000000-0000-4000-8000-000000000000';
const LORA_URL = 'https://huggingface.co/test/lora/resolve/main/lora.safetensors';

const client = fakeSpicyClient as unknown as Record<string, (...args: any[]) => Promise<any>>;
const originalListModels = client.listModels;

afterEach(() => {
  vi.restoreAllMocks();
});

/** Corps minimal d'une demande de génération. */
function body(extra: Record<string, unknown> = {}) {
  return { family: SEEDREAM_FLASH, prompt: 'une pomme rouge', params: {}, referenceAssetIds: [], ...extra };
}

/** Espionne createTask et renvoie la liste des inputs reçus. */
function spyCreateTask() {
  return vi.spyOn(client, 'createTask');
}

function sentInputs(spy: ReturnType<typeof spyCreateTask>) {
  return spy.mock.calls.map(c => (c[0] as { input: Record<string, unknown> }).input);
}

/** Catalogue sans certains modèles (pour simuler une clé qui n'y a pas accès). */
function hideModels(predicate: (model: string) => boolean) {
  vi.spyOn(client, 'listModels').mockImplementation(async (...args: unknown[]) => {
    const res = await originalListModels(...args);
    return { items: res.items.filter((m: { model: string }) => !predicate(m.model)) };
  });
}

async function uploadMany(me: Agent, n: number, mime = 'image/png') {
  const out: { id: string; url: string }[] = [];
  for (let i = 0; i < n; i++) out.push(await me.uploadAsset({ mime, bytes: mime.startsWith('video/') ? new Uint8Array([0, 0, 0, 1]) : undefined }));
  return out;
}

async function uploadVideo(me: Agent) {
  return me.uploadAsset({ mime: 'video/mp4', bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]) });
}

async function createPreset(me: Agent, label: string, text: string) {
  const res = await me.post('/presets', { label, text });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.preset as { id: string };
}

/** Persona avec une LoRA Z-Image (mots déclencheurs sks, rousse) et un contexte. */
async function loraPersona(me: Agent, extra: Record<string, unknown> = {}) {
  return me.createPersona({
    name: 'Léa',
    loras: [
      {
        label: 'Léa visage',
        path: LORA_URL,
        scale: 0.8,
        family: Z_IMAGE_LORA,
        triggerWords: ['sks woman', 'rousse', 'cachée'],
        hiddenWords: ['cachée'],
      },
    ] as any,
    ...extra,
  });
}

// ── Devis ─────────────────────────────────────────────────────

describe('POST /generations/quote', () => {
  it('refuse sans session (401)', async () => {
    expect((await call('POST', '/generations/quote', body())).status).toBe(401);
  });

  it('texte vers image sans référence', async () => {
    const me = await signup();
    const res = await me.post('/generations/quote', body());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.quote).toMatchObject({
      count: 1,
      task: 'text-to-image',
      modelId: `${SEEDREAM_FLASH}/text-to-image`,
      estimatedCost: '0.01',
      maxCharge: '0.01',
      quantity: '1',
      unit: 'per_image',
      dropped: 0,
      lorasApplied: 0,
    });
    expect(typeof res.body.quote.expiresAt).toBe('string');
  });

  it('image vers image avec des références', async () => {
    const me = await signup();
    const refs = await uploadMany(me, 2);
    const res = await me.post('/generations/quote', body({ referenceAssetIds: refs.map(r => r.id) }));
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({ task: 'image-to-image', modelId: `${SEEDREAM_FLASH}/edit`, dropped: 0 });
  });

  it('texte vers vidéo sans référence', async () => {
    const me = await signup();
    const res = await me.post('/generations/quote', body({ family: SEEDANCE_MINI }));
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({ task: 'text-to-video', modelId: `${SEEDANCE_MINI}/text-to-video` });
  });

  it('image vers vidéo : une image sert d’image de départ', async () => {
    const me = await signup();
    const [ref] = await uploadMany(me, 1);
    const res = await me.post('/generations/quote', body({ family: SEEDANCE_MINI, referenceAssetIds: [ref.id] }));
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({ task: 'image-to-video', modelId: `${SEEDANCE_MINI}/image-to-video`, dropped: 0 });
  });

  it('image vers vidéo : deux images (début et fin) passent, la troisième est ignorée', async () => {
    const me = await signup();
    const refs = await uploadMany(me, 3);
    const res = await me.post('/generations/quote', body({ family: SEEDANCE_MINI, referenceAssetIds: refs.map(r => r.id) }));
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({ task: 'image-to-video', dropped: 1 });
  });

  it('mode référence : les images partent en références vidéo', async () => {
    const me = await signup();
    const refs = await uploadMany(me, 2);
    const res = await me.post(
      '/generations/quote',
      body({ family: SEEDANCE_MINI, refMode: 'reference', referenceAssetIds: refs.map(r => r.id) }),
    );
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({ task: 'reference-to-video', modelId: `${SEEDANCE_MINI}/reference-to-video` });
  });

  it('une vidéo jointe passe en référence même sans le mode référence', async () => {
    const me = await signup();
    const video = await uploadVideo(me);
    const res = await me.post('/generations/quote', body({ family: SEEDANCE_MINI, referenceAssetIds: [video.id] }));
    expect(res.status).toBe(200);
    expect(res.body.quote.task).toBe('reference-to-video');
  });

  it('le nombre d’images multiplie le coût', async () => {
    const me = await signup();
    const res = await me.post('/generations/quote', body({ count: 4 }));
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({ count: 4, estimatedCost: '0.04', maxCharge: '0.04' });
  });

  it('signale les références en trop (dropped)', async () => {
    const me = await signup();
    // Qwen Image 3.0 Pro accepte 3 images au maximum.
    const refs = await uploadMany(me, 5);
    const res = await me.post('/generations/quote', body({ family: QWEN_PRO, referenceAssetIds: refs.map(r => r.id) }));
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({ task: 'image-to-image', dropped: 2 });
  });

  it('compte les LoRA du persona appliquées (cochées et entraînées pour ce modèle)', async () => {
    const me = await signup();
    const persona = await loraPersona(me);
    const loraId = persona.loras[0].id;
    const res = await me.post(
      '/generations/quote',
      body({ family: Z_IMAGE_LORA, personaId: persona.id, loraIds: [loraId] }),
    );
    expect(res.status).toBe(200);
    expect(res.body.quote.lorasApplied).toBe(1);
  });

  it('aucune LoRA appliquée si elle n’est pas cochée', async () => {
    const me = await signup();
    const persona = await loraPersona(me);
    const res = await me.post('/generations/quote', body({ family: Z_IMAGE_LORA, personaId: persona.id }));
    expect(res.status).toBe(200);
    expect(res.body.quote.lorasApplied).toBe(0);
  });

  it('aucune LoRA appliquée sur un autre modèle que le sien', async () => {
    const me = await signup();
    const persona = await loraPersona(me);
    const res = await me.post(
      '/generations/quote',
      body({ family: SEEDREAM_FLASH, personaId: persona.id, loraIds: [persona.loras[0].id] }),
    );
    expect(res.status).toBe(200);
    expect(res.body.quote.lorasApplied).toBe(0);
  });

  it('Wan 2.2 : les LoRA HIGH et LOW sont rangées dans leur passe', async () => {
    const me = await signup();
    const persona = await me.createPersona({
      name: 'Wan',
      loras: [
        { label: 'H', path: LORA_URL, family: WAN_22_LORA, noise: 'high', triggerWords: [] },
        { label: 'L', path: `${LORA_URL}?low`, family: WAN_22_LORA, noise: 'low', triggerWords: [] },
      ] as any,
    });
    const quote = vi.spyOn(client, 'quoteTask');
    const res = await me.post(
      '/generations/quote',
      body({ family: WAN_22_LORA, personaId: persona.id, loraIds: persona.loras.map(l => l.id) }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.quote.lorasApplied).toBe(2);
    const input = (quote.mock.calls[0][0] as { input: Record<string, unknown> }).input;
    expect(input.high_noise_loras).toEqual([{ path: LORA_URL, scale: 1 }]);
    expect(input.low_noise_loras).toEqual([{ path: `${LORA_URL}?low`, scale: 1 }]);
    expect(input.loras).toBeUndefined();
  });

  it('400 pour un modèle inconnu', async () => {
    const me = await signup();
    const res = await me.post('/generations/quote', body({ family: 'acme/inconnu' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Modèle inconnu.');
  });

  it('400 pour un modèle absent du catalogue de la clé', async () => {
    hideModels(m => m.startsWith(`${SEEDREAM_FLASH}/`));
    const me = await signup();
    const res = await me.post('/generations/quote', body());
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("n'est pas disponible avec cette clé");
  });

  it('400 quand une vidéo est envoyée à un modèle photo', async () => {
    const me = await signup();
    const video = await uploadVideo(me);
    const res = await me.post('/generations/quote', body({ referenceAssetIds: [video.id] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Un modèle photo ne prend pas de vidéo en entrée.');
  });

  it('400 quand un modèle vidéo sans texte vers vidéo n’a pas d’image de départ', async () => {
    const me = await signup();
    const res = await me.post('/generations/quote', body({ family: LTX }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Ce modèle a besoin d’une image de départ.');
  });

  it('400 quand une vidéo est envoyée à un modèle qui n’accepte pas de vidéo en référence', async () => {
    const me = await signup();
    const video = await uploadVideo(me);
    const res = await me.post('/generations/quote', body({ family: LTX, referenceAssetIds: [video.id] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Ce modèle n'accepte pas de vidéo en référence.");
  });

  it('400 « besoin d’un prompt » quand le modèle l’exige', async () => {
    const me = await signup();
    const res = await me.post('/generations/quote', body({ prompt: '   ' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Ce modèle a besoin d’un prompt.');
  });

  it('accepte un prompt vide quand le modèle ne l’exige pas', async () => {
    const me = await signup();
    const [ref] = await uploadMany(me, 1);
    const res = await me.post('/generations/quote', body({ family: WAN_30, prompt: '', referenceAssetIds: [ref.id] }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.quote.task).toBe('image-to-video');
  });

  it.each([
    ['prompt trop long', { prompt: 'a'.repeat(5001) }],
    ['plus de 30 références', { referenceAssetIds: Array.from({ length: 31 }, () => FAKE_UUID) }],
    ['plus de 12 images', { count: 13 }],
    ['nombre d’images nul', { count: 0 }],
    ['nombre d’images non entier', { count: 1.5 }],
    ['référence qui n’est pas un uuid', { referenceAssetIds: ['abc'] }],
    ['fil qui n’est pas un uuid', { threadId: 'abc' }],
    ['persona qui n’est pas un uuid', { personaId: 'abc' }],
    ['image à éditer qui n’est pas un uuid', { editAssetId: 'abc' }],
    ['mode de référence inconnu', { refMode: 'magie' }],
    ['famille trop courte', { family: 'ab' }],
    ['famille absente', { family: undefined }],
    ['plus de 20 contextes', { contextIds: Array.from({ length: 21 }, () => FAKE_UUID) }],
    ['plus de 12 LoRA', { loraIds: Array.from({ length: 13 }, (_, i) => `l${i}`) }],
    ['coût attendu mal formé', { expectedCost: '1,5' }],
    ['paramètres qui ne sont pas un objet', { params: 'x' }],
  ])('400 de validation : %s', async (_label, extra) => {
    const me = await signup();
    const res = await me.post('/generations/quote', body(extra));
    expect(res.status).toBe(400);
  });

  it('erreur 412 sans clé API SpicyAPI', async () => {
    const me = await signup({ apiKey: false });
    const res = await me.post('/generations/quote', body());
    expect(res.status).toBe(412);
    expect(res.body.error).toContain('Aucune clé API SpicyAPI');
  });

  it('404 pour le persona d’un autre utilisateur', async () => {
    const other = await signup();
    const persona = await other.createPersona({ name: 'Autre' });
    const me = await signup();
    const res = await me.post('/generations/quote', body({ personaId: persona.id }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Persona introuvable.');
  });

  it('ignore les références d’un autre utilisateur', async () => {
    const other = await signup();
    const foreign = await other.uploadAsset();
    const me = await signup();
    const res = await me.post('/generations/quote', body({ referenceAssetIds: [foreign.id] }));
    expect(res.status).toBe(200);
    expect(res.body.quote.task).toBe('text-to-image');
  });
});

// ── Création ──────────────────────────────────────────────────

describe('POST /generations', () => {
  it('refuse sans session (401)', async () => {
    expect((await call('POST', '/generations', body())).status).toBe(401);
  });

  it('crée un fil titré par le prompt quand il n’y en a pas', async () => {
    const me = await signup();
    const res = await me.post('/generations', body({ prompt: '  Une pomme rouge sur une table en bois  ' }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.thread.title).toBe('Une pomme rouge sur une table en bois');
    expect(res.body.generation.threadId).toBe(res.body.thread.id);
    // Le prompt est enregistré sans espaces aux extrémités.
    expect(res.body.generation.prompt).toBe('Une pomme rouge sur une table en bois');
    const threads = await me.get('/threads');
    expect(threads.status).toBe(200);
    expect(JSON.stringify(threads.body)).toContain(res.body.thread.id);
  });

  it('coupe le titre du fil à 60 caractères', async () => {
    const me = await signup();
    const prompt = 'x'.repeat(100);
    const res = await me.post('/generations', body({ prompt }));
    expect(res.status).toBe(201);
    expect(res.body.thread.title).toBe('x'.repeat(60));
  });

  it('titre le fil avec le nom du modèle quand le prompt est vide', async () => {
    const me = await signup();
    const [ref] = await uploadMany(me, 1);
    const res = await me.post('/generations', body({ family: WAN_30, prompt: '', referenceAssetIds: [ref.id] }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.thread.title).toBe(getFamily(WAN_30)!.label);
  });

  it('reprend un fil existant', async () => {
    const me = await signup();
    const { thread } = await me.generate();
    const res = await me.post('/generations', body({ threadId: thread.id, prompt: 'une poire' }));
    expect(res.status).toBe(201);
    expect(res.body.thread.id).toBe(thread.id);
    expect(res.body.generation.threadId).toBe(thread.id);
    const list = await me.get(`/threads/${thread.id}`);
    expect(list.status).toBe(200);
  });

  it('404 pour le fil d’un autre utilisateur, sans rien créer', async () => {
    const other = await signup();
    const { thread } = await other.generate();
    const me = await signup();
    const create = spyCreateTask();
    const res = await me.post('/generations', body({ threadId: thread.id }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Fil introuvable.');
    expect(create).not.toHaveBeenCalled();
    const rows = await db.select().from(generations).where(eq(generations.userId, me.user.id));
    expect(rows).toHaveLength(0);
  });

  it('404 pour un fil inconnu', async () => {
    const me = await signup();
    const res = await me.post('/generations', body({ threadId: FAKE_UUID }));
    expect(res.status).toBe(404);
  });

  it('rattache la génération et le nouveau fil au persona', async () => {
    const me = await signup();
    const persona = await me.createPersona({ name: 'Léa' });
    const res = await me.post('/generations', body({ personaId: persona.id }));
    expect(res.status).toBe(201);
    expect(res.body.generation.personaId).toBe(persona.id);
    expect(res.body.thread.personaId).toBe(persona.id);
  });

  it('404 pour un persona supprimé', async () => {
    const me = await signup();
    const persona = await me.createPersona({ name: 'Léa' });
    expect((await me.del(`/personas/${persona.id}`)).status).toBeLessThan(300);
    const res = await me.post('/generations', body({ personaId: persona.id }));
    expect(res.status).toBe(404);
  });

  it('prompt seul : finalPrompt identique, sans titres', async () => {
    const me = await signup();
    const res = await me.post('/generations', body({ prompt: 'une pomme rouge' }));
    expect(res.body.generation.finalPrompt).toBe('une pomme rouge');
  });

  it('prompt conservé tel quel, finalPrompt avec LoRA en tête, détails puis contexte général', async () => {
    const me = await signup();
    const persona = await loraPersona(me, {
      contextBlocks: [
        { title: 'Visage', text: 'yeux   verts,\ntaches de rousseur' },
        { title: '', text: 'toujours souriante' },
        { title: 'Vide', text: '   ' },
      ],
    });
    const lumiere = await createPreset(me, 'Lumière', 'golden   hour');
    const cadrage = await createPreset(me, 'Cadrage', 'plan serré');
    const loraId = persona.loras[0].id;
    const create = spyCreateTask();
    const res = await me.post(
      '/generations',
      body({
        family: Z_IMAGE_LORA,
        personaId: persona.id,
        prompt: 'Léa boit un café',
        loraIds: [loraId],
        // « cachée » est masqué, « inconnu » n'est pas un mot de la LoRA : aucun des deux n'est ajouté.
        loraWords: { [loraId]: ['sks woman', 'rousse', 'cachée', 'inconnu'] },
        // Ordre de la demande conservé.
        contextIds: [cadrage.id, lumiere.id],
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const g = res.body.generation;
    expect(g.prompt).toBe('Léa boit un café');
    expect(g.finalPrompt).toBe(
      [
        '# Lora\nsks woman, rousse',
        '# Prompt (important)\nLéa boit un café',
        '# Détails\nCadrage : plan serré\nLumière : golden hour',
        '# Contexte général\n- Visage : yeux verts, taches de rousseur\n- toujours souriante',
      ].join('\n\n'),
    );
    expect(g.contexts.map((c: { id: string }) => c.id)).toEqual([cadrage.id, lumiere.id]);
    expect(g.loras).toEqual([{ id: loraId, label: 'Léa visage', triggerWords: ['sks woman', 'rousse'] }]);
    expect(g.lorasApplied).toBe(1);
    const input = sentInputs(create)[0];
    expect(input.prompt).toBe(g.finalPrompt);
    expect(input.loras).toEqual([{ path: LORA_URL, scale: 0.8 }]);
  });

  it('n’ajoute pas un mot déclencheur déjà écrit dans le prompt', async () => {
    const me = await signup();
    const persona = await loraPersona(me);
    const loraId = persona.loras[0].id;
    const res = await me.post(
      '/generations',
      body({
        family: Z_IMAGE_LORA,
        personaId: persona.id,
        prompt: 'Portrait de SKS Woman au soleil',
        loraIds: [loraId],
        loraWords: { [loraId]: ['sks woman', 'rousse'] },
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.generation.finalPrompt).toBe('# Lora\nrousse\n\n# Prompt (important)\nPortrait de SKS Woman au soleil');
  });

  it('ignore les raccourcis d’un autre utilisateur', async () => {
    const other = await signup();
    const foreign = await createPreset(other, 'Secret', 'texte secret');
    const me = await signup();
    const res = await me.post('/generations', body({ contextIds: [foreign.id] }));
    expect(res.status).toBe(201);
    expect(res.body.generation.finalPrompt).toBe('une pomme rouge');
    expect(res.body.generation.contexts).toEqual([]);
  });

  it('éditer la première image : la consigne d’édition apparaît une seule fois', async () => {
    const me = await signup();
    const [a, b] = await uploadMany(me, 2);
    const res = await me.post('/generations', body({ referenceAssetIds: [a.id, b.id], editAssetId: a.id }));
    expect(res.status).toBe(201);
    const fp: string = res.body.generation.finalPrompt;
    expect(fp.split(EDIT_INSTRUCTION)).toHaveLength(2);
    expect(fp).toBe(`# Prompt (important)\nune pomme rouge\n\n# Images\n${EDIT_INSTRUCTION}`);
    // Le prompt affiché dans la bulle ne contient jamais la consigne.
    expect(res.body.generation.prompt).toBe('une pomme rouge');
  });

  it('pas de consigne d’édition quand l’image à éditer n’est pas la première', async () => {
    const me = await signup();
    const [a, b] = await uploadMany(me, 2);
    const res = await me.post('/generations', body({ referenceAssetIds: [a.id, b.id], editAssetId: b.id }));
    expect(res.status).toBe(201);
    expect(res.body.generation.finalPrompt).not.toContain(EDIT_INSTRUCTION);
  });

  it('pas de consigne d’édition sans image à éditer', async () => {
    const me = await signup();
    const [a, b] = await uploadMany(me, 2);
    const res = await me.post('/generations', body({ referenceAssetIds: [a.id, b.id] }));
    expect(res.status).toBe(201);
    expect(res.body.generation.finalPrompt).not.toContain(EDIT_INSTRUCTION);
  });

  it('garde les références dans l’ordre de la demande', async () => {
    const me = await signup();
    const refs = await uploadMany(me, 3);
    const order = [refs[2].id, refs[0].id, refs[1].id];
    const create = spyCreateTask();
    const res = await me.post('/generations', body({ referenceAssetIds: order }));
    expect(res.status).toBe(201);
    expect(res.body.generation.references.map((r: { id: string }) => r.id)).toEqual(order);
    const rows = await db.select({ id: assets.id, uri: assets.spicyUri }).from(assets).where(inArray(assets.id, order));
    const uriOf = new Map(rows.map(r => [r.id, r.uri]));
    expect(sentInputs(create)[0].image_urls).toEqual(order.map(id => uriOf.get(id)));
  });

  it('image vers vidéo : image de départ puis image de fin', async () => {
    const me = await signup();
    const [start, end] = await uploadMany(me, 2);
    const create = spyCreateTask();
    const res = await me.post('/generations', body({ family: SEEDANCE_MINI, referenceAssetIds: [start.id, end.id] }));
    expect(res.status).toBe(201);
    expect(res.body.generation.task).toBe('image-to-video');
    const rows = await db.select({ id: assets.id, uri: assets.spicyUri }).from(assets).where(inArray(assets.id, [start.id, end.id]));
    const uriOf = new Map(rows.map(r => [r.id, r.uri]));
    const input = sentInputs(create)[0];
    expect(input.image_url).toBe(uriOf.get(start.id));
    expect(input.last_image_url).toBe(uriOf.get(end.id));
  });

  it('série de 4 : 4 générations sœurs avec le même batchId', async () => {
    const me = await signup();
    const create = spyCreateTask();
    const res = await me.post('/generations', body({ count: 4 }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(create).toHaveBeenCalledTimes(4);
    const rows = await db.select().from(generations).where(eq(generations.userId, me.user.id));
    expect(rows).toHaveLength(4);
    const batchId = res.body.generation.batchId;
    expect(batchId).toBeTruthy();
    expect(rows.every(r => r.batchId === batchId && r.threadId === res.body.thread.id)).toBe(true);
    expect(rows.map(r => r.batchIndex).sort()).toEqual([0, 1, 2, 3]);
    expect(res.body.generation.batchIndex).toBe(0);
    for (const r of rows) {
      const g = await me.waitGeneration(r.id);
      expect(g.status).toBe('succeeded');
    }
  });

  it('une génération seule n’a pas de batchId', async () => {
    const me = await signup();
    const res = await me.post('/generations', body());
    expect(res.body.generation.batchId).toBeNull();
    expect(res.body.generation.batchIndex).toBe(0);
  });

  it('série avec graine fixée : la graine est décalée d’une image à l’autre', async () => {
    const me = await signup();
    const create = spyCreateTask();
    const res = await me.post('/generations', body({ family: QWEN_PRO, count: 3, params: { seed: 10 } }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(sentInputs(create).map(i => i.seed)).toEqual([10, 11, 12]);
    const rows = await db.select().from(generations).where(eq(generations.userId, me.user.id));
    expect(rows.sort((a, b) => a.batchIndex - b.batchIndex).map(r => r.params.seed)).toEqual([10, 11, 12]);
  });

  it('409 « price_changed » avec le nouveau devis quand le prix a augmenté', async () => {
    const me = await signup();
    const create = spyCreateTask();
    const res = await me.post('/generations', body({ expectedCost: '0.005' }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('price_changed');
    expect(res.body.quote).toMatchObject({ estimatedCost: '0.01', count: 1, task: 'text-to-image' });
    expect(create).not.toHaveBeenCalled();
  });

  it('409 pour une série dont le total dépasse le prix attendu', async () => {
    const me = await signup();
    const res = await me.post('/generations', body({ count: 4, expectedCost: '0.03' }));
    expect(res.status).toBe(409);
    expect(res.body.quote).toMatchObject({ count: 4, estimatedCost: '0.04' });
  });

  it('accepte un prix attendu égal ou supérieur', async () => {
    const me = await signup();
    expect((await me.post('/generations', body({ count: 4, expectedCost: '0.04' }))).status).toBe(201);
    expect((await me.post('/generations', body({ expectedCost: '1' }))).status).toBe(201);
  });

  it('la génération réussit avec un fichier de sortie lisible sur /media/:id', async () => {
    const me = await signup();
    const { generation } = await me.generate();
    expect(generation.status).toBe('succeeded');
    expect(generation.cost).toBe('0.01');
    expect(generation.settled).toBe(true);
    expect(generation.completedAt).toBeTruthy();
    expect(generation.spicyTaskId).toBeTruthy();
    expect(generation.outputs).toHaveLength(1);
    const out = generation.outputs[0];
    expect(out).toMatchObject({ kind: 'output', mediaType: 'image', mime: 'image/png', generationId: generation.id });
    expect(out.url).toBe(`/api/media/${out.id}`);
    const media = await me.get(`/media/${out.id}`);
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toBe('image/png');
    const [row] = await db.select().from(assets).where(eq(assets.id, out.id));
    expect(existsSync(row.filePath)).toBe(true);
  });

  it('paramètres nettoyés : clés inconnues retirées, PNG imposé, relance officielle, une image par tâche', async () => {
    const me = await signup();
    const create = spyCreateTask();
    const params = { quality: 'low', foo: 'bar', num_outputs: 4, output_format: 'jpeg', resolution: '9k', prompt: 'pirate' };
    const res = await me.post('/generations', body({ family: GPT, params }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [call0] = create.mock.calls;
    const sent = call0[0] as { model: string; input: Record<string, unknown>; quoteId: string; expectedCost: string };
    expect(sent.model).toBe(`${GPT}/text-to-image`);
    expect(sent.quoteId).toBeTruthy();
    expect(sent.expectedCost).toBe('0.01');
    expect(sent.input).toEqual({
      prompt: 'une pomme rouge',
      quality: 'low',
      num_outputs: 1,
      output_format: 'png',
      official_fallback: true,
    });
    expect((call0[1] as { idempotencyKey: string }).idempotencyKey).toBeTruthy();
    // Les paramètres saisis sont gardés tels quels dans l'historique ; l'input envoyé est enregistré à part.
    expect(res.body.generation.params).toEqual(params);
    const [row] = await db.select().from(generations).where(eq(generations.id, res.body.generation.id));
    expect(row.input).toEqual(sent.input);
  });

  it('applique la qualité « high » par défaut quand le modèle la propose', async () => {
    const me = await signup();
    const create = spyCreateTask();
    // Le schéma GPT a déjà « high » par défaut : rien n'est ajouté.
    await me.post('/generations', body({ family: GPT }));
    expect(sentInputs(create)[0].quality).toBeUndefined();
  });

  it('convertit les nombres saisis sous forme de texte et ignore les valeurs vides', async () => {
    const me = await signup();
    const create = spyCreateTask();
    await me.post('/generations', body({ family: QWEN_PRO, params: { seed: '42.4', resolution: '' } }));
    const input = sentInputs(create)[0];
    expect(input.seed).toBe(42);
    expect(input.resolution).toBeUndefined();
  });

  it('une tâche échouée termine en échec avec le code et le message', async () => {
    vi.spyOn(client, 'getTask').mockImplementation(async (taskId: string) => ({
      taskId,
      state: 'failed',
      errorCode: 'content_policy',
      errorMessage: 'Contenu refusé par le modèle.',
      cost: '0',
      settled: true,
    }));
    const me = await signup();
    const res = await me.post('/generations', body());
    expect(res.status).toBe(201);
    const g = await me.waitGeneration(res.body.generation.id);
    expect(g).toMatchObject({
      status: 'failed',
      errorCode: 'content_policy',
      errorMessage: 'Contenu refusé par le modèle.',
      cost: '0',
      outputs: [],
    });
    expect(g.completedAt).toBeTruthy();
  });

  it('une tâche expirée sans message prend un message par défaut', async () => {
    vi.spyOn(client, 'getTask').mockImplementation(async (taskId: string) => ({
      taskId,
      state: 'expired',
      cost: '0',
      settled: true,
    }));
    const me = await signup();
    const res = await me.post('/generations', body());
    const g = await me.waitGeneration(res.body.generation.id);
    expect(g).toMatchObject({ status: 'failed', errorCode: 'expired', errorMessage: 'La tâche a expiré.' });
  });

  it('une tâche refusée à la création est enregistrée en échec (201 quand même)', async () => {
    vi.spyOn(client, 'createTask').mockRejectedValue(new Error('Refus SpicyAPI'));
    const me = await signup();
    const res = await me.post('/generations', body());
    expect(res.status).toBe(201);
    expect(res.body.generation).toMatchObject({ status: 'failed', errorCode: 'create_failed', errorMessage: 'Refus SpicyAPI' });
  });

  it('une tâche réussie sans fichier termine en échec', async () => {
    vi.spyOn(client, 'getTask').mockImplementation(async (taskId: string) => ({
      taskId,
      state: 'succeeded',
      cost: '0.01',
      settled: true,
      output: { assets: [] },
    }));
    const me = await signup();
    const res = await me.post('/generations', body());
    const g = await me.waitGeneration(res.body.generation.id);
    expect(g.status).toBe('failed');
    expect(g.errorCode).toBe('watch_failed');
  });

  it('erreur 412 sans clé API SpicyAPI', async () => {
    const me = await signup({ apiKey: false });
    const res = await me.post('/generations', body());
    expect(res.status).toBe(412);
  });

  it('400 de validation sur le corps', async () => {
    const me = await signup();
    expect((await me.post('/generations', body({ prompt: 'a'.repeat(5001) }))).status).toBe(400);
    expect((await me.post('/generations', body({ count: 13 }))).status).toBe(400);
    expect((await me.post('/generations', body({ referenceAssetIds: ['pas-un-uuid'] }))).status).toBe(400);
  });

  it('400 pour un modèle inconnu', async () => {
    const me = await signup();
    const res = await me.post('/generations', body({ family: 'acme/inconnu' }));
    expect(res.status).toBe(400);
  });
});

// ── Lecture ───────────────────────────────────────────────────

describe('GET /generations/:id', () => {
  it('refuse sans session (401)', async () => {
    expect((await call('GET', `/generations/${FAKE_UUID}`)).status).toBe(401);
  });

  it('renvoie sa propre génération', async () => {
    const me = await signup();
    const { generation } = await me.generate();
    const res = await me.get(`/generations/${generation.id}`);
    expect(res.status).toBe(200);
    expect(res.body.generation.id).toBe(generation.id);
    expect(res.body.generation.family).toBe(SEEDREAM_FLASH);
  });

  it('404 pour la génération d’un autre utilisateur', async () => {
    const other = await signup();
    const { generation } = await other.generate();
    const me = await signup();
    const res = await me.get(`/generations/${generation.id}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Génération introuvable.');
  });

  it('404 pour un id inconnu ou mal formé', async () => {
    const me = await signup();
    expect((await me.get(`/generations/${FAKE_UUID}`)).status).toBe(404);
    expect((await me.get('/generations/pas-un-uuid')).status).toBe(404);
  });
});

// ── Upscale ───────────────────────────────────────────────────

describe('upscale', () => {
  async function output(me: Agent) {
    const { generation, thread } = await me.generate();
    return { asset: generation.outputs[0], thread, generation };
  }

  it('refuse sans session (401)', async () => {
    expect((await call('POST', '/generations/upscale/quote', { assetId: FAKE_UUID })).status).toBe(401);
    expect((await call('POST', '/generations/upscale', { assetId: FAKE_UUID })).status).toBe(401);
  });

  it('devis d’upscale d’une image générée', async () => {
    const me = await signup();
    const { asset } = await output(me);
    const res = await me.post('/generations/upscale/quote', { assetId: asset.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.quote).toMatchObject({
      count: 1,
      task: 'upscale',
      modelId: 'spicyapi/image-upscaler-v1/upscale',
      estimatedCost: '0.01',
      dropped: 0,
      lorasApplied: 0,
    });
  });

  it('crée l’upscale dans le même fil que l’original, au palier demandé', async () => {
    const me = await signup();
    const { asset, thread } = await output(me);
    const create = spyCreateTask();
    const res = await me.post('/generations/upscale', { assetId: asset.id, resolution: '8k' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.thread.id).toBe(thread.id);
    expect(res.body.generation).toMatchObject({
      threadId: thread.id,
      task: 'upscale',
      family: 'spicyapi/image-upscaler-v1',
      modelId: 'spicyapi/image-upscaler-v1/upscale',
      prompt: '',
      finalPrompt: '',
      params: { resolution: '8k' },
    });
    expect(res.body.generation.references.map((r: { id: string }) => r.id)).toEqual([asset.id]);
    const [row] = await db.select({ uri: assets.spicyUri }).from(assets).where(eq(assets.id, asset.id));
    expect(sentInputs(create)[0]).toEqual({ image_url: row.uri, resolution: '8k' });
    const g = await me.waitGeneration(res.body.generation.id);
    expect(g.status).toBe('succeeded');
    expect(g.outputs).toHaveLength(1);
  });

  it('palier inconnu : le palier par défaut (4k) est utilisé', async () => {
    const me = await signup();
    const { asset } = await output(me);
    const create = spyCreateTask();
    const res = await me.post('/generations/upscale', { assetId: asset.id, resolution: '16k' });
    expect(res.status).toBe(201);
    expect(res.body.generation.params).toEqual({ resolution: '4k' });
    expect(sentInputs(create)[0].resolution).toBe('4k');
  });

  it('upscale d’une vidéo générée : video_url et palier 1080p par défaut', async () => {
    vi.spyOn(client, 'getTask').mockImplementation(async (taskId: string) => ({
      taskId,
      state: 'succeeded',
      cost: '0.01',
      settled: true,
      output: { assets: [{ url: 'data:video/mp4;base64,AAAAGGZ0eXA=', mime: 'video/mp4' }] },
    }));
    const me = await signup();
    const { generation } = await me.generate({ family: SEEDANCE_MINI });
    expect(generation.status).toBe('succeeded');
    const video = generation.outputs[0];
    expect(video.mediaType).toBe('video');
    const create = spyCreateTask();
    const quote = await me.post('/generations/upscale/quote', { assetId: video.id });
    expect(quote.body.quote.modelId).toBe('spicyapi/video-upscaler-v1/upscale');
    const res = await me.post('/generations/upscale', { assetId: video.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const input = sentInputs(create)[0];
    expect(input.video_url).toMatch(/^spicy:\/\//);
    expect(input.resolution).toBe('1080p');
    expect(input.image_url).toBeUndefined();
  });

  it('409 « price_changed » quand le prix attendu est dépassé', async () => {
    const me = await signup();
    const { asset } = await output(me);
    const res = await me.post('/generations/upscale', { assetId: asset.id, expectedCost: '0.001' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'price_changed', quote: { task: 'upscale', estimatedCost: '0.01' } });
  });

  it('400 pour un média importé (pas un résultat généré)', async () => {
    const me = await signup();
    const upload = await me.uploadAsset();
    for (const path of ['/generations/upscale/quote', '/generations/upscale']) {
      const res = await me.post(path, { assetId: upload.id });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Seuls les résultats générés peuvent être upscalés.');
    }
  });

  it('404 pour un média inconnu ou d’un autre utilisateur', async () => {
    const other = await signup();
    const { asset } = await output(other);
    const me = await signup();
    for (const path of ['/generations/upscale/quote', '/generations/upscale']) {
      expect((await me.post(path, { assetId: FAKE_UUID })).status).toBe(404);
      const res = await me.post(path, { assetId: asset.id });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Média introuvable.');
    }
  });

  it('400 quand l’upscaler n’est pas disponible avec la clé', async () => {
    hideModels(m => m.startsWith('spicyapi/image-upscaler-v1/'));
    const me = await signup();
    const { asset } = await output(me);
    const res = await me.post('/generations/upscale/quote', { assetId: asset.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("n'est pas disponible avec cette clé");
  });

  it.each([
    ['assetId absent', {}],
    ['assetId mal formé', { assetId: 'abc' }],
    ['palier trop long', { assetId: FAKE_UUID, resolution: '12345678901' }],
    ['coût attendu mal formé', { assetId: FAKE_UUID, expectedCost: 'cher' }],
  ])('400 de validation : %s', async (_label, payload) => {
    const me = await signup();
    expect((await me.post('/generations/upscale/quote', payload)).status).toBe(400);
    expect((await me.post('/generations/upscale', payload)).status).toBe(400);
  });

  it('erreur 412 sans clé API SpicyAPI', async () => {
    const me = await signup();
    const { asset } = await output(me);
    expect((await me.del('/settings/api-key')).status).toBeLessThan(300);
    const res = await me.post('/generations/upscale/quote', { assetId: asset.id });
    expect(res.status).toBe(412);
  });
});
