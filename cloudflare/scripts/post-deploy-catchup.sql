-- Post-deploy catch-up for the per-landlord-storage release. Safe to run more than once.
--
-- Why: between "apply migrations" and "the new Worker is live" the OLD Worker still serves traffic. It never
-- writes house_directory or resident_index, so a house or a resident created in that window exists only in
-- houses / residents. Migration 0019's backfill ran once, so this file repeats it for the missing rows only.
-- The column derivations are copied from migrations/0019_central_directory.sql (backfill block).
--
-- Run right after the deploy (document only; this file is never run by the tests against production):
--   npx wrangler d1 execute <DATABASE_NAME> --remote --file scripts/post-deploy-catchup.sql
-- The last two statements are the verification: both must return 0.

INSERT OR IGNORE INTO house_directory (house_id, owner_id, name, status, delete_after, pay_no, modules, room_count, resident_count)
  SELECT h.id, h.owner_id, h.name, h.status, h.delete_after, h.pay_no, h.modules,
         (SELECT COUNT(*) FROM rooms r WHERE r.house_id = h.id AND r.deleted_at IS NULL),
         (SELECT COUNT(*) FROM residents x WHERE x.house_id = h.id AND x.status = 'approved' AND x.deleted_at IS NULL)
  FROM houses h WHERE h.owner_id IS NOT NULL AND h.id NOT IN (SELECT house_id FROM house_directory);

INSERT OR IGNORE INTO resident_index (resident_id, phone, owner_id, house_id)
  SELECT x.id, x.phone, h.owner_id, x.house_id
  FROM residents x JOIN houses h ON h.id = x.house_id
  WHERE h.owner_id IS NOT NULL AND x.id NOT IN (SELECT resident_id FROM resident_index);

INSERT INTO settings (key, value)
  SELECT 'house_pay_seq', CAST(MAX(pay_no) AS TEXT) FROM houses WHERE pay_no IS NOT NULL HAVING COUNT(*) > 0
  ON CONFLICT (key) DO UPDATE SET value = CAST(MAX(CAST(settings.value AS INTEGER), CAST(excluded.value AS INTEGER)) AS TEXT), updated_at = datetime('now');

-- Verification 1: houses with an owner that are not in the directory (must be 0).
SELECT COUNT(*) AS houses_missing_from_directory FROM houses WHERE owner_id IS NOT NULL AND id NOT IN (SELECT house_id FROM house_directory);

-- Verification 2: residents of such houses that are not in the resident index (must be 0).
SELECT COUNT(*) AS residents_missing_from_index FROM residents x JOIN houses h ON h.id = x.house_id
  WHERE h.owner_id IS NOT NULL AND x.id NOT IN (SELECT resident_id FROM resident_index);
