-- Kết nối SePay không cần OAuth: chủ trọ tự tạo webhook trên my.sepay.vn của họ, dán URL và API key
-- Trọ Hub cấp. Mỗi chủ trọ một key; chỉ lưu SHA-256, bản gốc chỉ hiện một lần lúc tạo.
CREATE TABLE sepay_manual_webhooks (
  owner_id INTEGER PRIMARY KEY REFERENCES staff(id),
  key_sha256 TEXT NOT NULL UNIQUE,
  key_hint TEXT NOT NULL,                -- 4 ký tự cuối, để nhận ra key nào đang dùng
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_event_at TEXT                     -- lần gần nhất SePay gửi giao dịch bằng key này
);
