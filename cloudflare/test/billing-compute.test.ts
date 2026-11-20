import { describe, expect, it } from 'vitest';
import { computeInvoice, type BillingInput, type ServiceFee } from '../src/billing/compute.ts';

const TK_SERVICES: ServiceFee[] = [
  { id: 1, name: 'Rác', price: 30_000, per: 'room', maxQty: null, sheetCol: 'K' },
  { id: 2, name: 'Internet', price: 40_000, per: 'person', maxQty: 2, sheetCol: 'L' },
  { id: 3, name: 'Xe máy', price: 50_000, per: 'vehicle', maxQty: null, sheetCol: 'M' },
];

function input(over: Partial<BillingInput> = {}): BillingInput {
  return {
    rent: 2_300_000, electricOld: 1000, electricNew: 1065, waterOld: 100, waterNew: 104,
    electricPrice: 3500, waterPrice: 20000, actualElectricPrice: 3300,
    services: TK_SERVICES, people: 2, vehicles: 2, ...over,
  };
}
const line = (r: ReturnType<typeof computeInvoice>, name: string) => r.lines.find((l) => l.name === name)!;

describe('computeInvoice', () => {
  it('matches the real October sheet total', () => {
    const r = computeInvoice(input());
    expect(r.total).toBe(2_300_000 + 227_500 + 80_000 + 30_000 + 80_000 + 100_000 - 13_000);
    expect(r.electricUsage).toBe(65);
    expect(r.waterUsage).toBe(4);
    expect(r.lines.map((l) => l.kind)).toEqual(['room', 'electricity', 'water', 'service', 'service', 'service', 'other']);
    expect(r.lines.find((l) => l.kind === 'electricity')!.amount).toBe(227_500);
    expect(r.lines.find((l) => l.kind === 'other')!.amount).toBe(-13_000);
    expect(r.total).toBe(r.lines.reduce((s, l) => s + l.amount, 0));
  });
  it('internet caps at 2 people', () => {
    const l = line(computeInvoice(input({ people: 3 })), 'Internet');
    expect(l.qty).toBe(2);
    expect(l.amount).toBe(80_000);
  });
  it('vehicles are counted per vehicle', () => {
    const l = line(computeInvoice(input({ vehicles: 1 })), 'Xe máy');
    expect(l.amount).toBe(50_000);
  });
  it('room service is qty 1', () => {
    expect(line(computeInvoice(input()), 'Rác').amount).toBe(30_000);
  });
  it('new reading below old gives 0', () => {
    const r = computeInvoice(input({ electricNew: 900, waterNew: 50 }));
    expect(r.electricUsage).toBe(0);
    expect(r.waterUsage).toBe(0);
    expect(r.lines.find((l) => l.kind === 'other')!.amount).toBe(0);
  });
  it('null readings give usage 0', () => {
    const r = computeInvoice(input({ electricOld: null, waterNew: null }));
    expect(r.electricUsage).toBe(0);
    expect(r.waterUsage).toBe(0);
  });
  it('no actualElectricPrice means no other line', () => {
    const r = computeInvoice(input({ actualElectricPrice: null }));
    expect(r.lines.some((l) => l.kind === 'other')).toBe(false);
  });
  it('actual equals price gives an other line of 0', () => {
    const r = computeInvoice(input({ electricPrice: 3300, actualElectricPrice: 3300 }));
    const o = r.lines.find((l) => l.kind === 'other')!;
    expect(o.amount).toBe(0);
    expect(r.lines.find((l) => l.kind === 'electricity')!.amount).toBe(65 * 3300);
  });
  it('services with qty 0 still have a line, in given order', () => {
    const r = computeInvoice(input({ people: 0, vehicles: 0 }));
    const svc = r.lines.filter((l) => l.kind === 'service');
    expect(svc.map((l) => l.serviceId)).toEqual([1, 2, 3]);
    expect(svc.map((l) => l.amount)).toEqual([30_000, 0, 0]);
  });
  it('clamps negative and truncates fractional counts, never NaN', () => {
    const r = computeInvoice(input({ people: -3, vehicles: 1.9 }));
    expect(line(r, 'Internet').qty).toBe(0);
    expect(line(r, 'Xe máy').qty).toBe(1);
    expect(Number.isNaN(r.total)).toBe(false);
  });
  it('all amounts are integers for integer inputs', () => {
    for (const [ep, ap] of [[3500, 3300], [3333, 3217], [4001, 3999]]) {
      const r = computeInvoice(input({ electricPrice: ep, actualElectricPrice: ap, electricNew: 1077 }));
      for (const l of r.lines) expect(Number.isInteger(l.amount)).toBe(true);
      expect(Number.isInteger(r.total)).toBe(true);
    }
  });
});
