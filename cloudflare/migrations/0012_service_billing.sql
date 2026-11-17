-- Thu phí dịch vụ Trọ Hub: Developer xuất hoá đơn phí hằng tháng cho mỗi chủ trọ, chủ trọ chuyển khoản
-- vào tài khoản SePay của Developer, webhook SePay đối chiếu mã hoá đơn trong nội dung chuyển khoản.
-- Tiền trọ của cư dân KHÔNG đi qua đây: nó vào thẳng tài khoản của chủ trọ.

-- Cài đặt chung dạng key/value. API key SePay chỉ lưu SHA-256, không lưu bản gốc.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE service_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES staff(id),
  month TEXT NOT NULL,                 -- 'YYYY-MM'
  amount INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,           -- ghi trong nội dung chuyển khoản, ví dụ 'TH7K2M9Q'
  detail TEXT,                         -- JSON: từng căn, số phòng, phí
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_id, month)
);

-- Mọi giao dịch SePay báo về tài khoản Developer. invoice_id trống: chưa khớp hoá đơn nào.
CREATE TABLE service_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sepay_id TEXT UNIQUE,                -- id giao dịch của SePay, chặn ghi trùng khi webhook gửi lại
  invoice_id INTEGER REFERENCES service_invoices(id),
  amount INTEGER NOT NULL,
  content TEXT,
  account_no TEXT,
  gateway TEXT,
  reference TEXT,
  paid_at TEXT,
  simulated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX service_payments_invoice ON service_payments(invoice_id);
