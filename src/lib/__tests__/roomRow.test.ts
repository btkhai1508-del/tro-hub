import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRoomFilters, occupiedSlots, roomCapacity, sanitizeRoomRow } from '../roomRow';

const workerRow = (over: Record<string, any> = {}) => ({
  houseId: 'H1', roomId: 7, room: '302', capacity: 4, paymentStatus: 'unpaid',
  occupants: [{ residentId: 1, name: 'An', phone: '0912345678', plate: '1', vehicleType: '', cccdLast4: '' }],
  nguoi1: 'An', sdt1: '0912345678', xe1: '1', nguoi2: '', sdt2: '', xe2: '', nguoi3: '', sdt3: '', xe3: '',
  ...over,
});

test('worker rows are shown exactly as the Worker returned them', () => {
  const row = workerRow({ nguoi1: '2', xe1: '1', sdt1: '5' });
  const out = sanitizeRoomRow(row);
  assert.equal(out, row);
  assert.equal(out.xe1, '1');
  assert.equal(out.nguoi1, '2');
});

test('sheet rows still hide junk cells', () => {
  const out: any = sanitizeRoomRow({ room: '101', nguoi1: '1', xe1: '1', sdt1: '0', cccd1: '0', nguoi2: 'Họ và tên', xe2: '59-X1 888.88' });
  assert.equal(out.nguoi1, '');
  assert.equal(out.xe1, '');
  assert.equal(out.sdt1, '');
  assert.equal(out.cccd1, '');
  assert.equal(out.nguoi2, '');
  assert.equal(out.xe2, '59-X1 888.88');
});

test('baseline and form cleaned the same way compare equal after a save', () => {
  const saved = workerRow({ xe1: '1' });
  assert.equal(sanitizeRoomRow(saved).xe1, sanitizeRoomRow({ ...saved }).xe1);
});

test('occupied slots and capacity', () => {
  assert.deepEqual(occupiedSlots(workerRow({ nguoi1: '3' })), [1]);
  assert.equal(roomCapacity(workerRow()), 4);
  assert.equal(roomCapacity({ nguoi1: 'An' }), 3);
  assert.equal(roomCapacity(workerRow({ capacity: 0 })), 3);
});

test('house and status filters', () => {
  const full = workerRow();
  const empty = workerRow({ houseId: 'H2', occupants: [], nguoi1: '', paymentStatus: 'paid' });
  assert.equal(matchesRoomFilters(full, 'all', 'all'), true);
  assert.equal(matchesRoomFilters(full, 'H2', 'all'), false);
  assert.equal(matchesRoomFilters(empty, 'H2', 'vacant'), true);
  assert.equal(matchesRoomFilters(full, '', 'vacant'), false);
  assert.equal(matchesRoomFilters(full, '', 'occupied'), true);
  assert.equal(matchesRoomFilters(full, '', 'unpaid'), true);
  assert.equal(matchesRoomFilters(empty, '', 'paid'), true);
});
