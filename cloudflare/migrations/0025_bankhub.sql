-- SePay Bank Hub (sandbox trial). All central and additive: nothing here is read by existing routes.
--   bankhub_companies   the Bank Hub "company" made for a landlord (xid comes from POST /v1/company/create)
--   bankhub_accounts    bank accounts linked through Hosted Link (fields from the BANK_ACCOUNT_LINKED event and GET /v1/bank-account)
--                       status: 'active' | 'inactive' | 'unlinked'. The owner is never reassigned once set.
--   bankhub_link_tokens which landlord a link token was made for: the link events carry only link_token_xid,
--                       so this is how an event is tied to a landlord (an unknown token is ignored, never guessed).
-- Balance-change IPNs reuse sepay_events with the id namespace 'bh-<transaction_id>'.
CREATE TABLE bankhub_companies (
  owner_id INTEGER PRIMARY KEY,
  company_xid TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE bankhub_accounts (
  bank_account_xid TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  company_xid TEXT,
  bank TEXT,
  account_number TEXT,
  account_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX bankhub_accounts_owner ON bankhub_accounts(owner_id);

CREATE TABLE bankhub_link_tokens (
  link_token_xid TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  company_xid TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
