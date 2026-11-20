// Pure invoice calculation (no DB, no I/O). Mirrors the Sheet formulas.
export type Per = 'room' | 'person' | 'vehicle';
export interface ServiceFee { id: number; name: string; price: number; per: Per; maxQty: number | null; sheetCol: 'K' | 'L' | 'M' | null }
export interface BillingInput {
  rent: number; electricOld: number | null; electricNew: number | null; waterOld: number | null; waterNew: number | null;
  electricPrice: number; waterPrice: number; actualElectricPrice: number | null;
  services: ServiceFee[]; people: number; vehicles: number;
}
export interface InvoiceLine { kind: 'room' | 'electricity' | 'water' | 'service' | 'other'; serviceId: number | null; name: string; qty: number; unitPrice: number; amount: number }

const count = (n: number): number => (Number.isFinite(n) ? Math.max(Math.trunc(n), 0) : 0);

function usage(oldR: number | null, newR: number | null): number {
  if (oldR === null || newR === null) return 0;
  return Math.max(Math.trunc(newR) - Math.trunc(oldR), 0);
}

function serviceQty(s: ServiceFee, people: number, vehicles: number): number {
  if (s.per === 'room') return 1;
  if (s.per === 'vehicle') return count(vehicles);
  const p = count(people);
  return s.maxQty === null ? p : Math.min(p, count(s.maxQty));
}

export function computeInvoice(input: BillingInput): { lines: InvoiceLine[]; total: number; electricUsage: number; waterUsage: number } {
  const electricUsage = usage(input.electricOld, input.electricNew);
  const waterUsage = usage(input.waterOld, input.waterNew);
  const lines: InvoiceLine[] = [
    { kind: 'room', serviceId: null, name: 'Tiền phòng', qty: 1, unitPrice: input.rent, amount: input.rent },
    { kind: 'electricity', serviceId: null, name: 'Tiền điện', qty: electricUsage, unitPrice: input.electricPrice, amount: electricUsage * input.electricPrice },
    { kind: 'water', serviceId: null, name: 'Tiền nước', qty: waterUsage, unitPrice: input.waterPrice, amount: waterUsage * input.waterPrice },
  ];
  for (const s of input.services) {
    const qty = serviceQty(s, input.people, input.vehicles);
    lines.push({ kind: 'service', serviceId: s.id, name: s.name, qty, unitPrice: s.price, amount: qty * s.price });
  }
  if (input.actualElectricPrice !== null) {
    const diff = input.actualElectricPrice - input.electricPrice;
    lines.push({ kind: 'other', serviceId: null, name: 'Khác', qty: electricUsage, unitPrice: diff, amount: electricUsage * diff + 0 }); // + 0 normalises -0
  }
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0), electricUsage, waterUsage };
}
