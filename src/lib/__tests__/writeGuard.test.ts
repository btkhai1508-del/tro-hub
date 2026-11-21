import test from 'node:test';
import assert from 'node:assert/strict';
import { createWriteGuard } from '../writeGuard';

test('read overlapping a write is rejected', () => {
  const g = createWriteGuard();
  const a = g.beginRead();
  g.beginWrite();
  assert.equal(g.acceptRead(a), false);
  g.endWrite();
  const b = g.beginRead();
  assert.equal(g.acceptRead(b), true);
});

test('read started during a write is rejected once the write ends', () => {
  const g = createWriteGuard();
  g.beginWrite();
  const a = g.beginRead();
  g.endWrite();
  assert.equal(g.acceptRead(a), false);
});

test('newest accepted read wins over an older one', () => {
  const g = createWriteGuard();
  const a = g.beginRead();
  const b = g.beginRead();
  assert.equal(g.acceptRead(b), true);
  assert.equal(g.acceptRead(a), false);
});

test('older read accepted when it arrives first', () => {
  const g = createWriteGuard();
  const a = g.beginRead();
  g.beginRead();
  assert.equal(g.acceptRead(a), true);
});
