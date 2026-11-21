-- Room rent and deposit: a house can have a common rent and deposit; a room either follows them (custom = 0)
-- or keeps its own price (custom = 1). Rooms that exist today keep the price they have (custom = 1).
-- Additive only: nothing existing is changed or dropped.

ALTER TABLE houses ADD COLUMN default_room_price INTEGER;   -- NULL = no common rent set
ALTER TABLE houses ADD COLUMN default_deposit INTEGER;      -- NULL = no common deposit set

ALTER TABLE rooms ADD COLUMN price_custom INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rooms ADD COLUMN deposit_custom INTEGER NOT NULL DEFAULT 1;
