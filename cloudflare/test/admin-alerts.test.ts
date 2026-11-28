import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const MONTH = '2026-11';
const DEV_KEY = 'developer-key-alerts';
const LVC_CODE = '002101112026'; // house 002 (LVC), room 101, 11/2026

const sha = async (t: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');

const webhook = async (id: number, amount: number) => {
  const res = await api('/api/sepay/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Apikey ${DEV_KEY}` },
    body: JSON.stringify({ id, gateway: 'MBBank', transferType: 'in', accountNumber: '0123456789', referenceCode: `FT${id}`,
      transactionDate: '2026-11-17 20:10:00', transferAmount: amount, content: `CHUYEN TIEN ${LVC_CODE}` }),
  });
  expect(res.status).toBe(200);
};
const alerts = async (token: string) => {
  const res = await api('/api/admin/alerts', {}, token);
  expect(res.status).toBe(200);
  return (await res.json()) as { success: boolean; unread: number; alerts: any[] };
};
const markRead = (token: string, body: unknown) =>
  api('/api/admin/alerts/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, token);

describe.each(BACKENDS)('chuông thông báo thanh toán (%s)', (backend) => {
  let owner: string;
  let manager: string;
  beforeEach(async () => {
    await e.DB.batch([
      e.DB.prepare(`DELETE FROM sepay_events`), e.DB.prepare(`DELETE FROM unassigned_payments`),
      e.DB.prepare(`DELETE FROM sepay_manual_webhooks`), e.DB.prepare(`DELETE FROM sepay_connections`),
      e.DB.prepare(`DELETE FROM service_payments`), e.DB.prepare(`DELETE FROM service_invoices`),
    ]);
    await seedWorld(backend);
    await e.DB.batch([
      e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('sepay_key_sha256', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(await sha(DEV_KEY)),
      e.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(`legacy_sync:${MONTH}`, new Date().toISOString()),
    ]);
    const db = await tenantOfOwner(e, 1);
    await db.prepare(`UPDATE rooms SET pay_no = CAST(name AS INTEGER)`).run();
    [owner, manager] = await Promise.all([login(PHONES.owner), login(PHONES.manager)]);
  });

  it('SePay báo tiền về: một thông báo đã thanh toán; webhook gửi lại không tạo thêm; tiền vào hoá đơn đã trả là tiền thừa', async () => {
    await webhook(7001, 3_500_000);
    await webhook(7001, 3_500_000); // SePay sends the same transaction again
    let list = await alerts(owner);
    expect(list.unread).toBe(1);
    expect(list.alerts).toEqual([expect.objectContaining({
      kind: 'invoice_paid', houseId: 'LVC', houseName: 'NHÀ TRỌ 109/6', room: '101', month: MONTH, amount: 3_500_000,
      receivedAt: '2026-11-17T13:10:00Z', read: false, source: 'sepay',
    })]);
    await webhook(7002, 200_000);
    await webhook(7002, 200_000);
    list = await alerts(owner);
    expect(list.alerts.map((a) => [a.kind, a.amount])).toEqual(expect.arrayContaining([['invoice_paid', 3_500_000], ['overpaid', 200_000]]));
    expect(list.alerts).toHaveLength(2);
    // The manager of TRUNG_KIM sees nothing of LVC.
    expect(await alerts(manager)).toMatchObject({ unread: 0, alerts: [] });
  });

  it('chủ trọ thấy mọi căn; quản lý chỉ thấy căn được giao; đã đọc tính riêng từng người', async () => {
    await webhook(7003, 3_500_000); // LVC paid by SePay
    const mark = await api('/api/admin/payment-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ houseId: 'TRUNG_KIM', roomNumber: '101', status: 'paid', month: MONTH }),
    }, manager);
    expect(mark.status).toBe(200);
    const mine = await alerts(owner);
    expect(mine.alerts.map((a) => a.houseId).sort()).toEqual(['LVC', 'TRUNG_KIM']);
    expect(mine.unread).toBe(2);
    const theirs = await alerts(manager);
    expect(theirs.alerts.map((a) => a.houseId)).toEqual(['TRUNG_KIM']);
    expect(theirs.alerts[0]).toMatchObject({ kind: 'invoice_paid', room: '101', amount: 3_000_000, source: 'staff:2' });

    // A manager cannot read (or mark) an alert of another house.
    const lvc = mine.alerts.find((a) => a.houseId === 'LVC')!;
    expect((await markRead(manager, { ids: [lvc.id] })).status).toBe(403);
    // The same number under the manager's own house marks nothing of LVC.
    await markRead(manager, { ids: [`TRUNG_KIM:${lvc.id.split(':')[1]}`] });

    const read = (await (await markRead(owner, { ids: [lvc.id] })).json()) as any;
    expect(read.unread).toBe(1);
    expect(read.alerts.find((a: any) => a.id === lvc.id).read).toBe(true);
    expect((await (await markRead(owner, { all: true })).json() as any).unread).toBe(0);
    // Reading is per person: the owner read everything, the manager's TRUNG_KIM alert is still unread for them.
    const tk = theirs.alerts[0];
    expect(tk.id).not.toBe(`TRUNG_KIM:${lvc.id.split(':')[1]}`);
    expect(await alerts(manager)).toMatchObject({ unread: 1, alerts: [expect.objectContaining({ id: tk.id, read: false })] });

    // Taking the payment back removes its alert; paying again alerts again.
    await api('/api/admin/payment-status', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ houseId: 'TRUNG_KIM', roomNumber: '101', status: 'unpaid', month: MONTH }) }, manager);
    expect((await alerts(manager)).alerts).toEqual([]);
  });

  it('chủ trọ khác không thấy gì; cư dân bị chặn', async () => {
    await webhook(7004, 3_500_000);
    expect(await alerts(await login(PHONES.otherOwner))).toMatchObject({ unread: 0, alerts: [] });
    const res = await api('/api/admin/alerts', {}, await login(PHONES.residentLvc));
    expect(res.status).toBe(403);
  });
});
