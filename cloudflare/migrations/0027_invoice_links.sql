-- Public payment links: one random, unguessable token per invoice, opened without logging in.
-- The token only reads that one invoice (rooms, month, fees, total, bank account, pay code); it is never
-- a login and no other route accepts it. Rotating deletes the row and inserts a new token, so the old
-- link stops working at once. The page refuses drafts and hides the bank QR once the invoice is paid.
-- Wrong tokens are counted per IP in login_attempts (scope 'pay_miss').
CREATE TABLE invoice_links (
  token TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  house_id TEXT NOT NULL,
  invoice_id INTEGER NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (house_id, invoice_id)
);
