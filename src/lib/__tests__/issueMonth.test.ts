import test from 'node:test';
import assert from 'node:assert/strict';
import { houseResultText, issueScope, missingMeterRooms, monthLabel } from '../issueMonth';

const rows = [
  { houseId: 'A', roomName: '101', invoiceId: 1, draft: true, missingMeters: true },
  { houseId: 'A', roomName: '102', invoiceId: 2, draft: false },
  { houseId: 'A', roomName: '103', invoiceId: null, draft: false },
  { houseId: 'B', roomName: '101', invoiceId: 3, draft: true, missingMeters: false },
  { houseId: 'B', roomName: '201', invoiceId: 4, draft: false },
];

test('all houses: drafts grouped by house, issued ones not counted', () => {
  const s = issueScope(rows, 'all');
  assert.equal(s.invoices, 4);
  assert.equal(s.drafts, 2);
  assert.deepEqual([...s.draftsByHouse.keys()], ['A', 'B']);
  assert.equal(s.allIssued, false);
});

test('one house scope ignores the other house (same room name in both)', () => {
  const s = issueScope(rows, 'B');
  assert.equal(s.invoices, 2);
  assert.equal(s.drafts, 1);
  assert.equal(s.draftsByHouse.get('B')?.[0].roomName, '101');
  assert.equal(s.draftsByHouse.has('A'), false);
});

test('every invoice issued -> allIssued; a later draft re-enables it', () => {
  const issued = rows.map((r) => ({ ...r, draft: false }));
  assert.equal(issueScope(issued, 'all').allIssued, true);
  const later = [...issued, { houseId: 'A', roomName: '104', invoiceId: 9, draft: true }];
  const s = issueScope(later, 'all');
  assert.equal(s.allIssued, false);
  assert.equal(s.drafts, 1);
});

test('no invoice at all is not "all issued"', () => {
  const s = issueScope([{ houseId: 'A', roomName: '101', invoiceId: null }], 'all');
  assert.equal(s.allIssued, false);
  assert.equal(s.drafts, 0);
});

test('missing meters list names the house only when several are involved', () => {
  const names = (id: string) => (id === 'A' ? 'Căn A' : 'Căn B');
  const withMissingB = rows.map((r) => (r.houseId === 'B' && r.draft ? { ...r, missingMeters: true } : r));
  assert.deepEqual(missingMeterRooms(issueScope(withMissingB, 'all'), names), ['101 (Căn A)', '101 (Căn B)']);
  assert.deepEqual(missingMeterRooms(issueScope(rows, 'A'), names), ['101']);
  assert.deepEqual(missingMeterRooms(issueScope(rows, 'B'), names), []);
  // "Tất cả căn" with drafts left in one house only still names it (the other house may have a 101 too).
  assert.deepEqual(missingMeterRooms(issueScope(rows.filter((r) => r.houseId === 'A'), 'all'), names, true), ['101 (Căn A)']);
});

test('labels', () => {
  assert.equal(monthLabel('2026-11'), '11/2026');
  assert.equal(monthLabel('11/2026'), '11/2026');
  assert.equal(houseResultText('Căn A', { ok: true, issued: 3 }, true), 'Căn A: đã tạo 3 hoá đơn');
  assert.equal(houseResultText('Căn A', { ok: false, error: 'Lỗi' }, false), 'Lỗi');
});
