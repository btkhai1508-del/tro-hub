import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { LaundryService, startLaundryWorker } from '../../server/laundryService';

// Worker mode: the laundry ticker must not read the Google Sheet (Machines sync, Logs scan).
test('laundry worker reads no Google Sheet while the Worker owns the data', async (t) => {
  t.mock.method(fs, 'writeFileSync', () => {}); // the ticker must not touch laundryStore.json
  const sync = t.mock.method(LaundryService, 'syncFromGoogleSheet', async () => ({ success: true }) as any);
  const scan = t.mock.method(LaundryService, 'scanGoogleSheetPaymentLogs', async () => ({ processed: 0, newPayments: [] }));
  const timer = startLaundryWorker(async () => true);
  await new Promise((r) => setTimeout(r, 4500));
  clearInterval(timer);
  assert.equal(sync.mock.callCount(), 0);
  assert.equal(scan.mock.callCount(), 0);
});

test('Sheet mode keeps reading it as before', async (t) => {
  t.mock.method(fs, 'writeFileSync', () => {}); // the ticker must not touch laundryStore.json
  const sync = t.mock.method(LaundryService, 'syncFromGoogleSheet', async () => ({ success: true }) as any);
  const scan = t.mock.method(LaundryService, 'scanGoogleSheetPaymentLogs', async () => ({ processed: 0, newPayments: [] }));
  const timer = startLaundryWorker(async () => false);
  await new Promise((r) => setTimeout(r, 50));
  clearInterval(timer);
  assert.equal(sync.mock.callCount(), 1);
  assert.ok(scan.mock.callCount() >= 1);
});
