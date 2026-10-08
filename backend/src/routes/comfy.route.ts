import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ComfyStatus } from '@ai-fluence/shared';
import { env } from '../env.js';
import { auth } from '../middleware/auth.js';
import { getComfyStatus, startComfy, stopComfy } from '../services/comfy.service.js';
import type { AppEnv } from '../types.js';

function requireControl() {
  if (!env.COMFYUI_URL || !env.COMFYUI_LAUNCH || !env.COMFYUI_STOP) {
    throw new HTTPException(404, { message: 'Pilotage de ComfyUI non configuré.' });
  }
}

const comfyRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/status', async c => c.json({ status: await getComfyStatus() satisfies ComfyStatus }))
  .post('/start', async c => {
    requireControl();
    return c.json({ status: await startComfy() });
  })
  .post('/stop', async c => {
    requireControl();
    return c.json({ status: await stopComfy() });
  });

export default comfyRoutes;
