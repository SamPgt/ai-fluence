/**
 * Appels de l'API par `app.fetch` (sans serveur), avec la session d'un
 * utilisateur de test. SpicyAPI est simulé (SPICY_FAKE).
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import type { Generation, Persona, Thread, User } from '@ai-fluence/shared';
import app from '../app.js';
import { db } from '../db/index.js';
import { SESSION_COOKIE } from '../lib/session.js';

const BASE = 'http://api.test';
export const PASSWORD = 'mot-de-passe-test';
export const FIXTURE_PNG = readFileSync(new URL('./fixtures/output.png', import.meta.url));
export const SEEDREAM_FLASH = 'bytedance/seedream-5.0-flash';
export const GPT = 'openai/gpt-image-2.5-sunburst';
export const SEEDANCE_MINI = 'bytedance/seedance-2.0-mini';

export async function resetDb() {
  await db.execute(
    sql.raw(
      'TRUNCATE users, sessions, user_settings, personas, threads, generations, assets, prompt_presets RESTART IDENTITY CASCADE',
    ),
  );
}

/** Laisse finir les suivis de génération lancés en arrière-plan. */
export async function settle() {
  for (let i = 0; i < 50; i++) {
    const [row] = (await db.execute(
      sql.raw("select count(*)::int as n from generations where status in ('queued', 'running')"),
    )) as unknown as { n: number }[];
    if (!row?.n) return;
    await new Promise(r => setTimeout(r, 100));
  }
}

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/** Requête brute (sans session si `cookie` est absent). */
export async function call<T = any>(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await app.fetch(new Request(`${BASE}${path}`, { method, headers, body: payload }));
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Réponse non JSON (fichier média…).
  }
  return { status: res.status, body: parsed as T, headers: res.headers };
}

export function sessionCookie(res: Res): string {
  const set = res.headers.getSetCookie().find(c => c.startsWith(`${SESSION_COOKIE}=`));
  expect(set, 'cookie de session').toBeTruthy();
  return set!.split(';')[0];
}

/** Utilisateur connecté : `req` envoie sa session. */
export class Agent {
  constructor(
    readonly cookie: string,
    readonly user: User,
    readonly email: string,
  ) {}

  req<T = any>(method: string, path: string, body?: unknown) {
    return call<T>(method, path, body, this.cookie);
  }
  get<T = any>(path: string) {
    return this.req<T>('GET', path);
  }
  post<T = any>(path: string, body?: unknown) {
    return this.req<T>('POST', path, body ?? {});
  }
  patch<T = any>(path: string, body: unknown) {
    return this.req<T>('PATCH', path, body);
  }
  put<T = any>(path: string, body: unknown) {
    return this.req<T>('PUT', path, body);
  }
  del<T = any>(path: string) {
    return this.req<T>('DELETE', path);
  }

  async createPersona(data: Partial<Persona> & { name: string }): Promise<Persona> {
    const res = await this.post('/personas', data);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.persona;
  }

  async upload(opts: { personaId?: string; isReference?: boolean; mime?: string; bytes?: Uint8Array } = {}) {
    const form = new FormData();
    const mime = opts.mime ?? 'image/png';
    form.set('file', new File([(opts.bytes ?? FIXTURE_PNG) as BlobPart], `test.${mime.split('/')[1]}`, { type: mime }));
    if (opts.personaId) form.set('personaId', opts.personaId);
    if (opts.isReference) form.set('isReference', 'true');
    return this.req('POST', '/assets', form);
  }

  async uploadAsset(opts: Parameters<Agent['upload']>[0] = {}) {
    const res = await this.upload(opts);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.asset as { id: string; url: string };
  }

  /** Génération simulée, attendue jusqu'à son résultat. */
  async generate(body: Record<string, unknown> = {}): Promise<{ generation: Generation; thread: Thread }> {
    const res = await this.post('/generations', {
      family: SEEDREAM_FLASH,
      prompt: 'une pomme rouge',
      params: {},
      referenceAssetIds: [],
      ...body,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const generation = await this.waitGeneration(res.body.generation.id);
    return { generation, thread: res.body.thread };
  }

  async waitGeneration(id: string): Promise<Generation> {
    for (let i = 0; i < 100; i++) {
      const g = (await this.get(`/generations/${id}`)).body.generation as Generation;
      if (g.status === 'succeeded' || g.status === 'failed') return g;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Génération ${id} toujours en cours`);
  }
}

/** Inscrit un utilisateur (avec une fausse clé SpicyAPI par défaut). */
export async function signup(opts: { email?: string; name?: string; apiKey?: boolean } = {}): Promise<Agent> {
  const email = opts.email ?? `u-${randomUUID().slice(0, 8)}@test.local`;
  const res = await call('POST', '/auth/signup', { email, name: opts.name ?? 'Test', password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const agent = new Agent(sessionCookie(res), res.body.user, email);
  if (opts.apiKey !== false) {
    const key = await agent.put('/settings/api-key', { apiKey: 'sk-spicy-test-0000000000' });
    expect(key.status, JSON.stringify(key.body)).toBe(200);
  }
  return agent;
}
