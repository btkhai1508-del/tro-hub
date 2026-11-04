-- Kết nối với dịch vụ ngoài. 'google': refresh token của tài khoản Google đã cấp quyền,
-- mã hoá bằng CCCD_KEY; account là email để hiển thị.
CREATE TABLE integrations (
  name TEXT PRIMARY KEY,
  secret_enc TEXT NOT NULL,
  account TEXT,
  connected_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
