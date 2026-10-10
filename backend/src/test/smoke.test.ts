import { describe, expect, it } from 'vitest';
import { call, signup } from './helpers.js';

describe('santé', () => {
  it('GET /health répond sans session', async () => {
    expect((await call('GET', '/health')).body).toEqual({ status: 'ok' });
  });

  it('une génération simulée réussit avec un fichier', async () => {
    const me = await signup();
    const { generation } = await me.generate();
    expect(generation.status).toBe('succeeded');
    expect(generation.outputs).toHaveLength(1);
  });
});
