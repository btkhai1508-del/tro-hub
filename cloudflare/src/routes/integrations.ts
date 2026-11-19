/** VietQR bank list and each Admin Tổng's Google account link. Central tables only; nothing here touches a landlord's store. */
import type { Hono } from 'hono';
import { actorOf, audit, fail, ownerOnly, type App } from '../app.ts';
import { checkState, connectUrl, finishConnect, googleKey, sheetsApi } from '../google.ts';
import { requireAuth } from './auth.ts';

interface Bank { bin: string; code: string; shortName: string; name: string; logo: string; transferSupported: number }
let bankCache: { banks: Bank[]; at: number } | null = null;

/** Banks that can receive VietQR transfers, from VietQR's public list, kept for a day. */
export async function vietQrBanks(): Promise<Bank[]> {
  if (bankCache && Date.now() - bankCache.at < 24 * 3600_000) return bankCache.banks;
  const res = await fetch('https://api.vietqr.io/v2/banks');
  const data = (await res.json().catch(() => null)) as { data?: Bank[] } | null;
  const banks = (data?.data ?? []).filter((b) => b.transferSupported);
  if (!banks.length) throw new Error('Không tải được danh sách ngân hàng VietQR.');
  bankCache = { banks, at: Date.now() };
  return banks;
}


export const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>
   <body style="font-family:system-ui;max-width:420px;margin:48px auto;padding:0 16px"><h2>${title}</h2><p>${text}</p></body>`;

export function registerIntegrations(app: Hono<App>): void {
  app.use('/api/banks', requireAuth);
  app.get('/api/banks', async (c) => {
    const banks = await vietQrBanks();
    return c.json({ success: true, banks: banks.map(({ bin, code, shortName, name, logo }) => ({ bin, code, shortName, name, logo })) });
  });

  /** Each Admin Tổng links their own Google account; their houses' Sheets live in their Drive. */
  app.use('/api/google/status', requireAuth, ownerOnly);
  app.get('/api/google/status', async (c) => {
    const row = await c.env.DB.prepare(`SELECT account, updated_at FROM integrations WHERE name = ?`)
      .bind(googleKey(actorOf(c.get('viewer'))))
      .first<{ account: string; updated_at: string }>();
    return c.json({ success: true, connected: Boolean(row), account: row?.account ?? null, since: row?.updated_at ?? null });
  });

  /** Admin Tổng opens this link in a browser and allows access with the Google account that should own the Sheets. */
  app.use('/api/google/connect-url', requireAuth, ownerOnly);
  app.post('/api/google/connect-url', async (c) => {
    const url = await connectUrl(c.env, new URL(c.req.url).origin, actorOf(c.get('viewer')));
    return c.json({ success: true, url });
  });

  app.get('/api/google/callback', async (c) => {
    const actor = await checkState(c.env, c.req.query('state') ?? '');
    const code = c.req.query('code');
    if (!actor || !code) return c.html(page('Không kết nối được', 'Link đã hết hạn hoặc bị huỷ. Vui lòng tạo link mới.'), 400);
    try {
      const email = await finishConnect(c.env, new URL(c.req.url).origin, code, actor);
      await audit(c, actor, 'google_connect', null, email);
      return c.html(page('Đã kết nối Google', `Trọ-Hub sẽ tạo và cập nhật Google Sheet trong Drive của <b>${email ?? 'tài khoản này'}</b>. Bạn có thể đóng trang này.`));
    } catch (e: any) {
      return c.html(page('Không kết nối được', String(e.message).replace(/</g, '&lt;')), 400);
    }
  });

  /** Proves the connection end to end: makes a small Sheet in the owner's Drive and returns its link. */
  app.use('/api/google/test-sheet', requireAuth, ownerOnly);
  app.post('/api/google/test-sheet', async (c) => {
    try {
      const actor = actorOf(c.get('viewer'));
      const sheet = await sheetsApi<{ spreadsheetId: string; spreadsheetUrl: string }>(c.env, actor, 'spreadsheets', {
        method: 'POST',
        body: { properties: { title: 'Trọ-Hub – kiểm tra kết nối' }, sheets: [{ properties: { title: 'Kiểm tra' } }] },
      });
      await sheetsApi(c.env, actor, `spreadsheets/${sheet.spreadsheetId}/values/Kiểm tra!A1:B1?valueInputOption=RAW`, {
        method: 'PUT',
        body: { values: [['Kết nối từ Cloudflare lúc', new Date().toISOString()]] },
      });
      return c.json({ success: true, url: sheet.spreadsheetUrl });
    } catch (e: any) {
      return fail(c, 400, 'GOOGLE_ERROR', e.message);
    }
  });

}
