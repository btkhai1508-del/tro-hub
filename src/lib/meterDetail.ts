/** Meter cells read "3.787" in the sheet: the dot groups thousands, it is not a decimal. An empty cell means 0. */
export function meterReading(value: unknown): number {
  const digits = String(value ?? '').trim().replace(/[.,]0+$/, '').replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

/** "(mới - cũ) x đơn giá". The price comes from the sheet's own amount, nothing is recalculated. */
export function meterDetail(oldReading: number, newReading: number, usage: number, amount: number): string {
  const fmt = (n: number) => n.toLocaleString('vi-VN');
  const base = `(${fmt(newReading)} - ${fmt(oldReading)})`;
  return usage > 0 && amount > 0 ? `${base} x ${fmt(Math.round(amount / usage))}` : base;
}
