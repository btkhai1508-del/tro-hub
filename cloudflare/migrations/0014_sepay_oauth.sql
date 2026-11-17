-- Mỗi chủ trọ kết nối tài khoản SePay của chính họ với Trọ Hub qua OAuth2 (họ tự đăng nhập SePay và bấm đồng ý).
-- Trọ Hub giữ token (mã hoá bằng CCCD_KEY) để đọc tài khoản ngân hàng và tạo một webhook trên tài khoản SePay
-- của họ, gửi tiền về /api/sepay/webhook. Tiền trọ vẫn vào thẳng tài khoản của chủ trọ, Trọ Hub chỉ nhận thông báo.
CREATE TABLE sepay_connections (
  owner_id INTEGER PRIMARY KEY REFERENCES staff(id),
  access_enc TEXT NOT NULL,
  refresh_enc TEXT NOT NULL,
  expires_at INTEGER NOT NULL,           -- giây (epoch) access token hết hạn
  scope TEXT,
  company TEXT,                          -- tên công ty / người dùng trên SePay
  bank_accounts TEXT,                    -- JSON [{id, bank, last4, holder}] lúc đồng bộ gần nhất
  webhook_id TEXT,                       -- webhook Trọ Hub tạo trên tài khoản SePay của chủ trọ
  webhook_key_sha256 TEXT,               -- SHA-256 API key của webhook đó, không lưu bản gốc
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sepay_connections_key ON sepay_connections(webhook_key_sha256);

-- Giao dịch đến từ webhook của chủ trọ nào (NULL: webhook của Developer).
ALTER TABLE sepay_events ADD COLUMN owner_id INTEGER;
