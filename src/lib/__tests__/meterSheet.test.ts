import test from 'node:test';
import assert from 'node:assert/strict';
import { meterCellError, meterMonthChoices, meterUsage, nextMonthStr, prepMonthStr } from '../meterSheet';

// Vietnam is UTC+7: hh:mm there = hh-7:mm UTC.
const vn = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h - 7);

test('nextMonthStr: qua năm', () => {
  assert.equal(nextMonthStr('11/2026'), '12/2026');
  assert.equal(nextMonthStr('12/2026'), '01/2027');
});

test('prepMonthStr: chỉ 5 ngày cuối tháng (giờ Việt Nam)', () => {
  assert.equal(prepMonthStr(vn(2026, 11, 25, 23)), null);
  assert.equal(prepMonthStr(vn(2026, 11, 26, 0)), '12/2026');
  assert.equal(prepMonthStr(vn(2026, 12, 27)), '01/2027');
  assert.equal(prepMonthStr(vn(2027, 2, 24)), '03/2027'); // 28 days: from the 24th
  assert.equal(prepMonthStr(vn(2027, 2, 23)), null);
});

test('meterMonthChoices: tới tháng hiện tại, thêm tháng sau khi ở 5 ngày cuối, mới nhất trước', () => {
  const list = ['09/2026', '10/2026', '12/2026', '01/2027', 'xx'];
  assert.deepEqual(meterMonthChoices(list, vn(2026, 11, 10)), ['11/2026', '10/2026', '09/2026']);
  assert.deepEqual(meterMonthChoices(list, vn(2026, 11, 27)), ['12/2026', '11/2026', '10/2026', '09/2026']);
});

test('meterUsage: số mới trống hoặc nhỏ hơn thì 0', () => {
  assert.equal(meterUsage(100, '150'), 50);
  assert.equal(meterUsage(100, ''), 0);
  assert.equal(meterUsage(100, '90'), 0);
  assert.equal(meterUsage(0, 12), 12);
});

test('meterCellError: nhỏ hơn số cũ thì báo lỗi, trống thì không', () => {
  assert.equal(meterCellError(100, ''), null);
  assert.equal(meterCellError(100, '100'), null);
  assert.equal(meterCellError(100, '150'), null);
  assert.equal(meterCellError(100, '90'), 'Nhỏ hơn số cũ (100).');
  assert.equal(meterCellError(100, '0'), null);
});
