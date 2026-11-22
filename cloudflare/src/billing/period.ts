/**
 * Month preparation window (Vietnam time, UTC+7): during the LAST 5 DAYS of a month the landlord already works on
 * the next month (drafts, meter readings, fees); residents see nothing of it until the month starts and it is issued.
 */
const VN_OFFSET_MS = 7 * 3600_000;

/** 'YYYY-MM' of the Vietnam wall clock at `nowMs`. */
export const vnMonthAt = (nowMs: number): string => new Date(nowMs + VN_OFFSET_MS).toISOString().slice(0, 7);

/** The month after `month` ('YYYY-MM'). */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Next month ('YYYY-MM') while the Vietnam date is in the last 5 days of its month (day >= days-in-month - 4), else null. */
export function prepMonth(nowMs: number): string | null {
  const vn = new Date(nowMs + VN_OFFSET_MS);
  const days = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() + 1, 0)).getUTCDate();
  return vn.getUTCDate() >= days - 4 ? nextMonth(vnMonthAt(nowMs)) : null;
}

/** The month the admin screen opens on: the one being prepared, else the current one. */
export const adminDefaultMonth = (nowMs: number): string => prepMonth(nowMs) ?? vnMonthAt(nowMs);
