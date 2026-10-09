import { Hono } from 'hono';
import { auth } from '../middleware/auth.js';
import { listTrash, purge, restorePersona, restoreThread } from '../services/trash.service.js';
import type { AppEnv } from '../types.js';

const trashRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/', async c => c.json(await listTrash(c.get('user').id)))
  .post('/personas/:id/restore', async c => {
    if (!(await restorePersona(c.get('user').id, c.req.param('id')))) return c.json({ error: 'Introuvable dans la corbeille.' }, 404);
    return c.json({ ok: true });
  })
  .post('/threads/:id/restore', async c => {
    if (!(await restoreThread(c.get('user').id, c.req.param('id')))) return c.json({ error: 'Introuvable dans la corbeille.' }, 404);
    return c.json({ ok: true });
  })
  /** Suppression définitive d'un élément (fichiers vers la Corbeille du système). */
  .delete('/personas/:id', async c => c.json(await purge({ userId: c.get('user').id, personaIds: [c.req.param('id')] })))
  .delete('/threads/:id', async c => c.json(await purge({ userId: c.get('user').id, threadIds: [c.req.param('id')] })))
  /** Vider la corbeille. */
  .delete('/', async c => {
    const { personas, threads } = await listTrash(c.get('user').id);
    return c.json(
      await purge({ userId: c.get('user').id, personaIds: personas.map(p => p.id), threadIds: threads.map(t => t.id) }),
    );
  });

export default trashRoutes;
