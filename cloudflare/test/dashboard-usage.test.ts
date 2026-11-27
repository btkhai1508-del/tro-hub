import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;

for (const backend of BACKENDS) {
  describe(`dashboard: lượng điện nước theo tháng (${backend})`, () => {
    beforeEach(async () => {
      await seedWorld(backend);
      // Pretend the old Sheet was read a moment ago, so the dashboard does not sync over the test's readings.
      await e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('legacy_sync:2026-11', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
        .bind(new Date().toISOString()).run();
    });

    it('số cũ lưu 0 (lấy tháng trước) không làm lượng dùng thành cả chỉ số đồng hồ', async () => {
      const db = await tenantOfOwner(e, 1);
      const lvc = (await db.prepare(`SELECT id FROM invoices WHERE house_id = 'LVC' AND room_id = 3`).first<{ id: number }>())!.id;
      await db.batch([
        // LVC 101: stored old 0, the invoice billed 50 kWh / 3 m³.
        db.prepare(`INSERT INTO meter_readings (house_id, room_id, month, electric_old, electric_new, water_old, water_new) VALUES ('LVC', 3, '2026-11', 0, 7120, 0, 250)`),
        db.prepare(`INSERT INTO invoice_lines (invoice_id, kind, name, qty, unit_price, amount) VALUES (?, 'electricity', 'Tiền điện', 50, 3500, 175000), (?, 'water', 'Tiền nước', 3, 20000, 60000)`).bind(lvc, lvc),
        // TRUNG_KIM 101: an old Sheet invoice (no lines): real old readings count, an old reading of 0 does not.
        db.prepare(`INSERT INTO meter_readings (house_id, room_id, month, electric_old, electric_new, water_old, water_new) VALUES ('TRUNG_KIM', 1, '2026-11', 1000, 1040, 0, 999)`),
      ]);
      const res = await api('/api/admin/dashboard?month=11/2026', {}, await login(PHONES.owner));
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as any;
      expect(data.dien).toBe(90); // 50 + 40
      expect(data.nuoc).toBe(3); // 3 + 0 (old reading 0 is not a reading)
      expect(data.usageTrend.find((t: any) => t.month === '11/2026')).toMatchObject({ dien: 90, nuoc: 3 });
    });
  });
}
