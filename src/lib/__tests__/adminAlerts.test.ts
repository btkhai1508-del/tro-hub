import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertPlace, alertSource, alertTitle, badgeText, formatVnd, monthText, vnTime, type AdminAlert } from '../adminAlerts.ts';

const base: AdminAlert = {
  id: 'LVC:1', kind: 'invoice_paid', houseId: 'LVC', houseName: 'NHÀ TRỌ 109/6', room: '101', month: '2026-11',
  amount: 3_500_000, receivedAt: '2026-11-17T13:10:00Z', read: false, source: 'sepay',
};

test('chuông: tiêu đề, nơi, thời gian theo giờ Việt Nam, số tiền', () => {
  assert.equal(alertTitle(base), 'Hoá đơn đã được thanh toán');
  assert.equal(alertTitle({ ...base, kind: 'overpaid' }), 'Tiền vào hoá đơn đã thanh toán');
  assert.equal(alertTitle({ ...base, kind: 'password_reset' }), 'Thông báo');
  assert.equal(alertPlace(base), 'NHÀ TRỌ 109/6 · Phòng 101 · Tháng 11/2026');
  assert.equal(vnTime(base.receivedAt), '20:10 17/11/2026');
  assert.equal(vnTime('x'), '');
  assert.equal(monthText('2026-01'), '01/2026');
  assert.match(formatVnd(3_500_000), /^3[.,]500[.,]000 đ$/);
  assert.equal(alertSource(base), 'Ngân hàng (SePay)');
  assert.equal(alertSource({ ...base, source: 'staff:2' }), 'Đánh dấu thủ công');
});

test('chuông: badge', () => {
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(3), '3');
  assert.equal(badgeText(120), '99+');
});
