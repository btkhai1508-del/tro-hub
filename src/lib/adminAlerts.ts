/**
 * Text of the admin bell (worker mode). The Worker answers GET /api/admin/alerts with the alerts of the houses the
 * caller manages; this file only turns one alert into the lines the bell shows. `kind` is open: a kind this file
 * does not know yet still shows (its own words come later, e.g. password reset requests).
 */
export interface AdminAlert {
  id: string;
  kind: string;
  houseId: string;
  houseName: string;
  room: string | null;
  month: string | null; // 'YYYY-MM'
  amount: number | null;
  receivedAt: string; // ISO UTC
  read: boolean;
  source?: string | null;
}

export const formatVnd = (n: number | null | undefined) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')} đ`;

/** 'YYYY-MM' → 'MM/YYYY'. */
export const monthText = (month: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month ?? ''));
  return m ? `${m[2]}/${m[1]}` : '';
};

/** Vietnam wall time of an ISO instant: 'HH:MM dd/mm/yyyy'. */
export function vnTime(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const d = new Date(at + 7 * 3600_000).toISOString();
  return `${d.slice(11, 16)} ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

export function alertTitle(a: AdminAlert): string {
  if (a.kind === 'invoice_paid') return 'Hoá đơn đã được thanh toán';
  if (a.kind === 'overpaid') return 'Tiền vào hoá đơn đã thanh toán';
  return 'Thông báo';
}

/** "Căn · Phòng 101 · Tháng 11/2026" */
export function alertPlace(a: AdminAlert): string {
  return [a.houseName, a.room ? `Phòng ${a.room}` : '', a.month ? `Tháng ${monthText(a.month)}` : ''].filter(Boolean).join(' · ');
}

/** Who/what reported the money: SePay (bank) or a person marking it. */
export function alertSource(a: AdminAlert): string {
  if (a.source === 'sepay') return 'Ngân hàng (SePay)';
  if (a.source && a.source.startsWith('staff:')) return 'Đánh dấu thủ công';
  return '';
}

/** The badge text: nothing at 0, '99+' above 99. */
export const badgeText = (unread: number) => (unread <= 0 ? '' : unread > 99 ? '99+' : String(unread));
