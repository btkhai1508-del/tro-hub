/**
 * Central directory in the shared D1: which landlord owns which house and resident, where each
 * landlord's data lives (tenant_storage), and the counters the dashboards read without opening
 * a landlord's own store.
 */

export type Backend = 'd1' | 'migrating' | 'do';

export interface HouseDir {
  house_id: string;
  owner_id: number;
  name: string;
  status: string;
  delete_after: string | null;
  pay_no: number | null;
  modules: string | null;
  room_count: number;
  resident_count: number;
}

export class PhoneTakenError extends Error {
  constructor(message = 'Số điện thoại đã được dùng.') {
    super(message);
    this.name = 'PhoneTakenError';
  }
}

const HOUSE_COLS = `house_id, owner_id, name, status, delete_after, pay_no, modules, room_count, resident_count`;

export async function houseOwner(db: D1Database, houseId: string): Promise<number | null> {
  const row = await db.prepare(`SELECT owner_id FROM house_directory WHERE house_id = ?`).bind(houseId).first<{ owner_id: number }>();
  return row?.owner_id ?? null;
}

export async function ownerHouses(db: D1Database, ownerId: number): Promise<HouseDir[]> {
  const { results } = await db.prepare(`SELECT ${HOUSE_COLS} FROM house_directory WHERE owner_id = ? ORDER BY house_id`).bind(ownerId).all<HouseDir>();
  return results;
}

export async function allHouses(db: D1Database): Promise<HouseDir[]> {
  const { results } = await db.prepare(`SELECT ${HOUSE_COLS} FROM house_directory ORDER BY house_id`).all<HouseDir>();
  return results;
}

/** Insert or update a house; the counters are left alone on update (see setHouseCounts). */
export async function upsertHouseDir(db: D1Database, row: Omit<HouseDir, 'room_count' | 'resident_count'>): Promise<void> {
  await db
    .prepare(
      `INSERT INTO house_directory (house_id, owner_id, name, status, delete_after, pay_no, modules)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (house_id) DO UPDATE SET owner_id = excluded.owner_id, name = excluded.name, status = excluded.status,
         delete_after = excluded.delete_after, pay_no = excluded.pay_no, modules = excluded.modules`
    )
    .bind(row.house_id, row.owner_id, row.name, row.status, row.delete_after, row.pay_no, row.modules)
    .run();
}

export async function removeHouseDir(db: D1Database, houseId: string): Promise<void> {
  await db.prepare(`DELETE FROM house_directory WHERE house_id = ?`).bind(houseId).run();
}

/** Next house payment number. One statement; never goes back, even after a directory row is removed. */
export async function allocateHousePayNo(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO settings (key, value)
       VALUES ('house_pay_seq', CAST(MAX(COALESCE((SELECT MAX(pay_no) FROM house_directory), 0), COALESCE((SELECT MAX(pay_no) FROM houses), 0)) + 1 AS TEXT))
       ON CONFLICT (key) DO UPDATE SET
         value = CAST(MAX(CAST(settings.value AS INTEGER), COALESCE((SELECT MAX(pay_no) FROM house_directory), 0), COALESCE((SELECT MAX(pay_no) FROM houses), 0)) + 1 AS TEXT),
         updated_at = datetime('now')
       RETURNING value`
    )
    .first<{ value: string }>();
  return Number(row!.value);
}

export async function setHouseCounts(db: D1Database, houseId: string, counts: { rooms: number; residents: number }): Promise<void> {
  await db
    .prepare(`UPDATE house_directory SET room_count = ?, resident_count = ? WHERE house_id = ?`)
    .bind(counts.rooms, counts.residents, houseId)
    .run();
}

/** True when a staff account or an indexed resident already uses this phone (optionally ignoring one of them). */
export async function phoneTaken(
  db: D1Database,
  phone: string,
  except: { staffId?: number; residentId?: number } = {}
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM staff WHERE phone = ?1 AND (?2 IS NULL OR id <> ?2))
         OR EXISTS (SELECT 1 FROM resident_index WHERE phone = ?1 AND (?3 IS NULL OR resident_id <> ?3)) AS taken`
    )
    .bind(phone, except.staffId ?? null, except.residentId ?? null)
    .first<{ taken: number }>();
  return !!row?.taken;
}

function isUnique(e: unknown): boolean {
  return /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e));
}

/** Reserve a resident id (and phone) in the index before the landlord's store gets the row. */
export async function reserveResident(
  db: D1Database,
  input: { phone: string | null; ownerId: number; houseId: string }
): Promise<number> {
  if (input.phone && (await phoneTaken(db, input.phone))) throw new PhoneTakenError();
  try {
    const row = await db
      .prepare(`INSERT INTO resident_index (phone, owner_id, house_id) VALUES (?, ?, ?) RETURNING resident_id`)
      .bind(input.phone, input.ownerId, input.houseId)
      .first<{ resident_id: number }>();
    return row!.resident_id;
  } catch (e) {
    if (isUnique(e)) throw new PhoneTakenError();
    throw e;
  }
}

export async function releaseResident(db: D1Database, residentId: number): Promise<void> {
  await db.prepare(`DELETE FROM resident_index WHERE resident_id = ?`).bind(residentId).run();
}

export async function residentRoute(
  db: D1Database,
  by: { id: number } | { phone: string }
): Promise<{ resident_id: number; owner_id: number; house_id: string } | null> {
  const stmt =
    'id' in by
      ? db.prepare(`SELECT resident_id, owner_id, house_id FROM resident_index WHERE resident_id = ?`).bind(by.id)
      : db.prepare(`SELECT resident_id, owner_id, house_id FROM resident_index WHERE phone = ?`).bind(by.phone);
  return (await stmt.first<{ resident_id: number; owner_id: number; house_id: string }>()) ?? null;
}

export async function updateResidentIndex(
  db: D1Database,
  residentId: number,
  patch: { phone?: string | null; houseId?: string }
): Promise<void> {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (patch.phone !== undefined) {
    sets.push('phone = ?');
    args.push(patch.phone);
  }
  if (patch.houseId !== undefined) {
    sets.push('house_id = ?');
    args.push(patch.houseId);
  }
  if (!sets.length) return;
  try {
    await db.prepare(`UPDATE resident_index SET ${sets.join(', ')} WHERE resident_id = ?`).bind(...args, residentId).run();
  } catch (e) {
    if (isUnique(e)) throw new PhoneTakenError();
    throw e;
  }
}

export async function getStorage(
  db: D1Database,
  ownerId: number,
  now: number = Date.now()
): Promise<{ backend: Backend; lockExpiresAt: number | null; migratedAt: string | null }> {
  // Compare-and-set: an expired lock flips back to d1 in a single statement.
  await db
    .prepare(
      `UPDATE tenant_storage SET backend = 'd1', lock_expires_at = NULL, changed_at = datetime('now')
       WHERE owner_id = ? AND backend = 'migrating' AND lock_expires_at < ?`
    )
    .bind(ownerId, now)
    .run();
  const row = await db
    .prepare(`SELECT backend, lock_expires_at, migrated_at FROM tenant_storage WHERE owner_id = ?`)
    .bind(ownerId)
    .first<{ backend: Backend; lock_expires_at: number | null; migrated_at: string | null }>();
  if (!row) return { backend: 'd1', lockExpiresAt: null, migratedAt: null };
  return { backend: row.backend, lockExpiresAt: row.lock_expires_at, migratedAt: row.migrated_at };
}

export async function newOwnerBackend(db: D1Database): Promise<'d1' | 'do'> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'new_owner_backend'`).first<{ value: string }>();
  return row?.value === 'do' ? 'do' : 'd1';
}

/** Switch a landlord's backend. With `expect`, only changes when the current value matches (returns false otherwise). */
export async function setStorage(
  db: D1Database,
  ownerId: number,
  backend: Backend,
  opts: { expect?: Backend; lockMinutes?: number; note?: string } = {}
): Promise<boolean> {
  const lock = backend === 'migrating' && opts.lockMinutes != null ? Date.now() + opts.lockMinutes * 60_000 : null;
  const migratedAt = backend === 'do' ? new Date().toISOString() : null;
  const note = opts.note ?? null;
  // A landlord without a row is on d1: materialise it so the guarded update below has something to match.
  if (!opts.expect || opts.expect === 'd1') {
    await db
      .prepare(`INSERT INTO tenant_storage (owner_id, backend, changed_at) VALUES (?, 'd1', datetime('now')) ON CONFLICT (owner_id) DO NOTHING`)
      .bind(ownerId)
      .run();
  }
  const res = await db
    .prepare(
      `UPDATE tenant_storage SET backend = ?2, lock_expires_at = ?3, changed_at = datetime('now'),
         migrated_at = COALESCE(?4, migrated_at), note = COALESCE(?5, note)
       WHERE owner_id = ?1 AND (?6 IS NULL OR backend = ?6)`
    )
    .bind(ownerId, backend, lock, migratedAt, note, opts.expect ?? null)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
