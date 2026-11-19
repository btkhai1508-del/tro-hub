-- staff_houses now points at the central house directory instead of D1's houses table, so a house
-- whose data lives in a landlord's own store can still be assigned to a manager.
PRAGMA defer_foreign_keys = true;

CREATE TABLE staff_houses_new (
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  house_id TEXT NOT NULL REFERENCES house_directory(house_id),
  PRIMARY KEY (staff_id, house_id)
);
INSERT INTO staff_houses_new (staff_id, house_id) SELECT staff_id, house_id FROM staff_houses;
DROP TABLE staff_houses;
ALTER TABLE staff_houses_new RENAME TO staff_houses;
