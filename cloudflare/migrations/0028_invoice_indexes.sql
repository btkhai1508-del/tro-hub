-- Lookups by invoice: the fee lines of an invoice and the money booked on it. Without these, every
-- "lines of invoice X" / "money of invoice X" scanned the whole table (once per invoice on the dashboard),
-- which burned the daily rows-read allowance. Indexes only: no data changes.
CREATE INDEX IF NOT EXISTS invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS payments_invoice ON payments(invoice_id);
