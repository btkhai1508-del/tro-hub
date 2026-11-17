-- Mọi giao dịch SePay gửi tới webhook chung /api/sepay/webhook, để không xử lý một giao dịch hai lần
-- và biết mỗi giao dịch là gì:
--   service: khớp mã hoá đơn phí dịch vụ (TH…), đã ghi ở service_payments
--   rent:    có mã tiền trọ của app (<phòng>-T<tháng>-<năm>); lưu căn/phòng/tháng nhận ra được.
--            Chưa tự đánh dấu "đã trả": việc đó bật khi tiền trọ chuyển sang D1.
--   laundry: có mã máy giặt (MG01, MS02…)
--   none:    không khớp gì
CREATE TABLE sepay_events (
  sepay_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('service', 'rent', 'laundry', 'none')),
  amount INTEGER NOT NULL DEFAULT 0,
  content TEXT,
  account_no TEXT,
  house_id TEXT,
  room TEXT,
  month TEXT,                          -- 'YYYY-MM'
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sepay_events_created ON sepay_events(created_at);
