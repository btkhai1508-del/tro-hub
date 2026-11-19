import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { BACKENDS, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const count = async (db: { prepare(s: string): { first<T>(): Promise<T | null> } }, table: string) =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe.each(BACKENDS)('seedWorld(%s)', (backend) => {
  it('puts the business rows on the chosen backend only', async () => {
    await seedWorld(backend);
    await seedWorld(backend); // idempotent: callable in beforeEach
    const mine = await tenantOfOwner(e, 1);
    const other = await tenantOfOwner(e, 4);
    const names = async (db: typeof mine) => (await db.prepare(`SELECT id FROM houses ORDER BY id`).all<{ id: string }>()).results.map((r) => r.id);
    expect(await names(mine)).toEqual(backend === 'd1' ? ['LVC', 'NTTD', 'TRUNG_KIM'] : ['LVC', 'TRUNG_KIM']);
    expect(await names(other)).toEqual(backend === 'd1' ? ['LVC', 'NTTD', 'TRUNG_KIM'] : ['NTTD']);
    expect(await count(other, 'rooms')).toBe(backend === 'd1' ? 4 : 2);
    expect(await count(mine, 'invoices')).toBe(2);
    // D1 holds the business rows only on d1; on do its houses table is empty
    expect(await count(e.DB, 'houses')).toBe(backend === 'd1' ? 3 : 0);
    expect(await count(e.DB, 'rooms')).toBe(backend === 'd1' ? 4 : 0);
    expect(await count(e.DB, 'residents')).toBe(backend === 'd1' ? 2 : 0);
    expect(await count(e.DB, 'invoices')).toBe(backend === 'd1' ? 2 : 0);
    // central rows are always in D1
    expect(await count(e.DB, 'house_directory')).toBe(3);
    expect(await count(e.DB, 'resident_index')).toBe(2);
    expect(await count(e.DB, 'staff')).toBe(4);
  });
});
