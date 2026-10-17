/**
 * Reformulation d'éléments de liste (faux SpicyAPI : le modèle de texte renvoie le texte
 * reçu, les lignes numérotées reviennent donc telles quelles).
 */
import { describe, expect, it } from 'vitest';
import { call, signup } from './helpers.js';

describe('POST /lists/rewrite', () => {
  it('exige une session', async () => {
    expect((await call('POST', '/lists/rewrite/quote', { items: ['a'] })).status).toBe(401);
  });

  it('devis puis reformulation, dans l’ordre, par paquets de 50 @smoke', async () => {
    const me = await signup();
    const items = Array.from({ length: 60 }, (_, i) => `tag ${i}, beach, sunset`);
    const quote = await me.post('/lists/rewrite/quote', { items });
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    // Deux paquets (50 + 10) : deux appels chiffrés.
    expect(quote.body).toEqual({ count: 60, estimatedCost: '0.002' });

    const res = await me.post('/lists/rewrite', { items });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual(items);
    expect(res.body.cost).toBe('0.002');
  });

  it('refus : liste vide, trop d’éléments, échec du modèle', async () => {
    const me = await signup();
    expect((await me.post('/lists/rewrite/quote', { items: [] })).status).toBe(400);
    expect((await me.post('/lists/rewrite/quote', { items: Array(201).fill('a') })).status).toBe(400);
    const failed = await me.post('/lists/rewrite', { items: ['raté FAIL_TEST'] });
    expect(failed.status).toBe(502);
  });
});
