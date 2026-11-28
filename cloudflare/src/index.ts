import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireAuth, registerAuth } from './routes/auth.ts';
import { fail, type App, type Env } from './app.ts';
import { TenantLockedError } from './tenant/route.ts';
import { runCron } from './cron.ts';
import { registerNotifications } from './routes/notifications.ts';
import { registerAlerts } from './routes/alerts.ts';
import { registerHouses } from './routes/houses.ts';
import { registerPeople } from './routes/people.ts';
import { registerRent } from './routes/rent.ts';
import { registerIntegrations } from './routes/integrations.ts';
import { registerAdmin } from './routes/admin.ts';
import { registerBilling } from './routes/billing.ts';
import { registerSepay } from './routes/sepay.ts';
import { registerBankHub } from './routes/bankhub.ts';
import { registerStorage } from './routes/storage.ts';
import { registerTenantAccounts } from './routes/tenant.ts';
import { registerSource } from './routes/source.ts';
import { registerSession } from './routes/session.ts';
import { registerPublicInvoice } from './routes/publicInvoice.ts';

export { TenantStore } from './tenant/store.ts';

const app = new Hono<App>();

app.use('/api/*', (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  return cors({ origin: allowed, allowHeaders: ['Content-Type', 'Authorization'], maxAge: 86400 })(c, next); // maxAge: không gửi lại OPTIONS mỗi lần app hỏi trạng thái
});

registerAuth(app);

app.use('/api/houses', requireAuth);
app.use('/api/houses/*', requireAuth);

registerIntegrations(app);
registerHouses(app);
registerPeople(app);
registerRent(app);
registerPublicInvoice(app);
registerTenantAccounts(app); // before registerAdmin: /api/admin/accounts is handled here
registerAdmin(app);
registerBilling(app);
registerSepay(app);
registerBankHub(app);
registerStorage(app); // after registerHouses: /api/dev/* is Developer-only there
registerSource(app);
registerSession(app);
registerNotifications(app);
registerAlerts(app);

app.notFound((c) => fail(c, 404, 'NOT_FOUND', 'Không tìm thấy.'));

// A write while the landlord's data is being moved answers 503; anything else as Hono's default handler.
app.onError((err, c) => {
  if (err instanceof TenantLockedError) return fail(c, 503, 'TENANT_MIGRATING', err.message);
  if ('getResponse' in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text('Internal Server Error', 500);
});

export default {
  fetch: app.fetch,
  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCron(event.cron, env));
  },
} satisfies ExportedHandler<Env>;
