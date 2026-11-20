/** What the resident app reads about the signed-in person once the Worker owns the data. */
import type { Hono } from 'hono';
import type { App } from '../app.ts';
import { tenantData, tenantSession } from '../billing/tenantView.ts';
import { requireAuth } from './auth.ts';

export function registerSession(app: Hono<App>): void {
  app.use('/api/tenant/session', requireAuth);
  app.get('/api/tenant/session', async (c) => c.json(await tenantSession(c)));

  app.use('/api/sheets/tenant-data', requireAuth);
  app.get('/api/sheets/tenant-data', async (c) => c.json(await tenantData(c)));
}
