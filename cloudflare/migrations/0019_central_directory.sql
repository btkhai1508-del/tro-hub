-- Central routing tables for per-landlord storage. The shared D1 keeps only the directory of who owns
-- what; each landlord's business tables can live in their own Durable Object (tenant_storage.backend).

CREATE TABLE house_directory (
  house_id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  delete_after TEXT,
  pay_no INTEGER UNIQUE,
  modules TEXT,
  room_count INTEGER NOT NULL DEFAULT 0,
  resident_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX house_directory_owner ON house_directory(owner_id);

CREATE TABLE resident_index (
  resident_id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE,
  owner_id INTEGER NOT NULL,
  house_id TEXT NOT NULL
);
CREATE INDEX resident_index_house ON resident_index(house_id);

CREATE TABLE tenant_storage (
  owner_id INTEGER PRIMARY KEY,
  backend TEXT NOT NULL CHECK (backend IN ('d1', 'migrating', 'do')),
  lock_expires_at INTEGER,             -- epoch ms; an expired 'migrating' lock reads as 'd1'
  changed_at TEXT,
  migrated_at TEXT,
  note TEXT
);

-- Payments that arrived for a house whose landlord could not be resolved.
CREATE TABLE unassigned_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sepay_id TEXT UNIQUE,
  amount INTEGER NOT NULL,
  content TEXT,
  account_no TEXT,
  bank_name TEXT,
  reference TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE sepay_events ADD COLUMN status TEXT NOT NULL DEFAULT 'done';
-- The payment-status API asks for deferred events on every call; this index keeps that almost free.
CREATE INDEX sepay_events_deferred ON sepay_events(house_id, month) WHERE status = 'deferred';

ALTER TABLE audit_log ADD COLUMN owner_id INTEGER;

-- backfill:start
INSERT INTO house_directory (house_id, owner_id, name, status, delete_after, pay_no, modules, room_count, resident_count)
  SELECT h.id, h.owner_id, h.name, h.status, h.delete_after, h.pay_no, h.modules,
         (SELECT COUNT(*) FROM rooms r WHERE r.house_id = h.id AND r.deleted_at IS NULL),
         (SELECT COUNT(*) FROM residents x WHERE x.house_id = h.id AND x.status = 'approved' AND x.deleted_at IS NULL)
  FROM houses h WHERE h.owner_id IS NOT NULL;
INSERT INTO resident_index (resident_id, phone, owner_id, house_id)
  SELECT x.id, x.phone, h.owner_id, x.house_id
  FROM residents x JOIN houses h ON h.id = x.house_id WHERE h.owner_id IS NOT NULL;
INSERT INTO tenant_storage (owner_id, backend, changed_at)
  SELECT id, 'd1', datetime('now') FROM staff WHERE role = 'owner';
INSERT INTO settings (key, value)
  SELECT 'house_pay_seq', CAST(MAX(pay_no) AS TEXT) FROM houses WHERE pay_no IS NOT NULL HAVING COUNT(*) > 0
  ON CONFLICT (key) DO UPDATE SET value = CAST(MAX(CAST(settings.value AS INTEGER), CAST(excluded.value AS INTEGER)) AS TEXT), updated_at = datetime('now');
-- backfill:end
