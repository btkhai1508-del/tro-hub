import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVnPhone, phoneProblem } from '../phone';

const MSG = 'Số điện thoại phải có 10 chữ số, bắt đầu bằng 0.';

test('normalizeVnPhone follows the Worker rule', () => {
  assert.equal(normalizeVnPhone('912345678'), '0912345678');
  assert.equal(normalizeVnPhone('+84 912 345 678'), '0912345678');
  assert.equal(normalizeVnPhone('84912345678'), '0912345678');
  assert.equal(normalizeVnPhone('0912345678'), '0912345678');
});

test('phoneProblem', () => {
  assert.equal(phoneProblem('12345'), MSG);
  assert.equal(phoneProblem('091234567890'), MSG);
  assert.equal(phoneProblem('1912345678'), MSG);
  assert.equal(phoneProblem('0912 345 678'), null);
});
