import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoiceNotice, paidDay, paidMoment } from '../documents/stateFormat';
import type { Measurer } from '../documents/engine';

const m: Measurer = { width: (s: string, _style, size: number) => s.length * size * 0.5 };
const house = { name: 'NHÀ TRỌ 109/6', abbreviation: 'NT1096', address: '109/6 Lê Văn Chí, Phường Linh Xuân, TP. Hồ Chí Minh', landlord: 'Chủ trọ' } as any;
const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'INV-7', month: '11/2026', issueDate: '01/11/2026', dueDate: '08/11/2026', total: 3_620_000, status: 'unpaid',
  details: [
    { name: 'Tiền phòng', amount: 3_500_000, type: 'room', metric: '1 tháng' },
    { name: 'Tiền điện', amount: 120_000, type: 'electricity', metric: '1.250 − 1.210 = 40 số × 3.000' },
  ],
  ...over,
}) as any;
const payment = { qrPng: 'data:image/png;base64,AAAA', accountNo: '0123456789', bankName: 'MB BANK', accountName: 'Chủ trọ', payCode: '002101112026' };
const texts = (doc: ReturnType<typeof buildInvoiceNotice>) => doc.pages.flat().filter((op: any) => op.t === 'text').map((op: any) => op.s).join('\n');
const images = (doc: ReturnType<typeof buildInvoiceNotice>) => doc.pages.flat().filter((op: any) => op.t === 'image');

test('paid label helpers keep only the day (or day and time)', () => {
  assert.equal(paidDay('Đã thanh toán ngày 03/10/2026'), '03/10/2026');
  assert.equal(paidDay('03/10/2026 12:00'), '03/10/2026');
  assert.equal(paidMoment('03/10/2026 12:00'), '03/10/2026 12:00');
  assert.equal(paidDay(undefined), '');
});

test('unpaid invoice with a payment page: QR link, account and pay code next to the total', () => {
  const doc = buildInvoiceNotice(m, { invoice: invoice(), house, room: '101', payment });
  assert.equal(images(doc).length, 1);
  const all = texts(doc);
  const flat = all.replace(/\n/g, ' ');
  assert.match(flat, /Tên ngân hàng: MB BANK/);
  assert.match(flat, /Tên chủ tài khoản: Chủ trọ/);
  assert.match(flat, /Số tài khoản: 0123456789/);
  assert.match(flat, /Nội dung chuyển khoản: 002101112026/);
  assert.match(flat, /Hạn thanh toán: 08\/11\/2026/);
  assert.match(all.replace(/\n/g, ' '), /109\/6 Lê Văn Chí/); // address under the house name (one op per word)
  assert.ok(doc.pages.flat().some((op: any) => op.t === 'rect' && op.fill !== undefined), 'gray total row');
});

test('paid invoice: no QR, "Đã thanh toán ngày" written once', () => {
  const doc = buildInvoiceNotice(m, { invoice: invoice({ status: 'paid', paidAt: 'Đã thanh toán ngày 20/11/2026', paymentMethod: 'qr' }), house, room: '101', payment });
  assert.equal(images(doc).length, 0);
  const all = texts(doc);
  assert.equal(all.match(/Đã thanh toán/g)?.length, 1);
  assert.match(all, /Đã thanh toán ngày 20\/11\/2026\./);
  assert.doesNotMatch(all, /bằng chuyển khoản|bằng tiền mặt/);
  assert.doesNotMatch(all, /0123456789/);
});

test('no previous debt: 0 and the total are written, never dots', () => {
  const all = texts(buildInvoiceNotice(m, { invoice: invoice(), house, room: '101' }));
  assert.match(all, /- Số tiền còn nợ tháng trước:\n0 ₫\n/);
  assert.match(all, /Tổng cộng:\n3\.620\.000 ₫/);
});

test('without a payment page (Google Sheet mode) the notice has no QR', () => {
  assert.equal(images(buildInvoiceNotice(m, { invoice: invoice(), house, room: '101' })).length, 0);
});
