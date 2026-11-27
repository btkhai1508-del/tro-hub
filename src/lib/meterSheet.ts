/**
 * Pure helpers of the Điện nước screen (worker mode): which months may be picked, and the per-cell check.
 * Months are 'MM/YYYY' as the admin screen keeps them.
 */
import { getVnMonthStr } from './utils';

const key = (m: string) => m.slice(3, 7) + m.slice(0, 2);

/** 'MM/YYYY' of the month after `m`. */
export function nextMonthStr(m: string): string {
  const mm = Number(m.slice(0, 2));
  const yy = Number(m.slice(3, 7));
  return mm === 12 ? `01/${yy + 1}` : `${String(mm + 1).padStart(2, '0')}/${yy}`;
}

/** The next month while the Vietnam date is in the last 5 days of its month (as the Worker's prepMonth), else null. */
export function prepMonthStr(nowMs: number = Date.now()): string | null {
  const vn = new Date(nowMs + 7 * 3600_000);
  const days = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() + 1, 0)).getUTCDate();
  return vn.getUTCDate() >= days - 4 ? nextMonthStr(getVnMonthStr(nowMs)) : null;
}

/**
 * The months the meter screen offers, newest first: every listed month up to the current one (always included),
 * plus the next month in the last 5 days of the current one. Later months are left out.
 */
export function meterMonthChoices(months: string[], nowMs: number = Date.now()): string[] {
  const current = getVnMonthStr(nowMs);
  const prep = prepMonthStr(nowMs);
  const ok = new Set(months.filter((m) => /^\d{2}\/\d{4}$/.test(m) && key(m) <= key(current)));
  ok.add(current);
  if (prep) ok.add(prep);
  return [...ok].sort((a, b) => key(b).localeCompare(key(a)));
}

/** Usage from an old and a new reading; an empty or smaller new reading uses nothing yet. */
export function meterUsage(oldReading: number, newText: string | number | null | undefined): number {
  const n = Number(newText);
  if (newText === '' || newText === null || newText === undefined || !Number.isFinite(n) || n <= 0) return 0;
  return Math.max(n - oldReading, 0);
}

/** The error to show under a "mới" cell, or null when it can be saved (empty = not entered yet). */
export function meterCellError(oldReading: number, newText: string): string | null {
  if (newText === '') return null;
  const n = Number(newText);
  if (!Number.isInteger(n) || n < 0) return 'Chỉ nhập số nguyên.';
  if (n > 0 && n < oldReading) return `Nhỏ hơn số cũ (${oldReading}).`;
  return null;
}
