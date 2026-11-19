/**
 * Dry run, move or roll back one landlord's data between the shared D1 and their own store, through the
 * Developer-only API (see src/migrate/tenant.ts), and print the comparison. Run from the cloudflare folder:
 *
 *   TROHUB_DEV_TOKEN=<token> node scripts/migrate-tenant.mts dry-run  1 --base https://<worker>
 *   TROHUB_DEV_TOKEN=<token> node scripts/migrate-tenant.mts migrate  1 --base https://<worker>
 *   TROHUB_DEV_TOKEN=<token> node scripts/migrate-tenant.mts rollback 1 --base https://<worker>
 *
 * The Developer token is read from the environment only (never from the command line, never printed).
 * For migrate and rollback the landlord's read APIs (houses, rooms, this month's invoices, payment gate of
 * every house) are saved as JSON before and after and compared. Exit code 1 when the report says not ok or
 * the JSON differs, with the command that rolls back.
 */
import { currentMonth, diffSnapshots, formatReport, onlyHouses, parseArgs, rollbackHint, snapshotPaths, snapshotStatusError, UsageError, USAGE, type Snapshot } from './migrate-tenant-lib.mts';

const token = process.env.TROHUB_DEV_TOKEN;

async function call(base: string, method: 'GET' | 'POST', path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}

async function snapshot(base: string, ownerId: number): Promise<Snapshot> {
  const landlords = await call(base, 'GET', '/api/dev/landlords');
  if (landlords.status !== 200) throw new Error(`GET /api/dev/landlords trả ${landlords.status}: kiểm tra TROHUB_DEV_TOKEN và --base.`);
  const owner = (landlords.body.landlords ?? []).find((l: { id: number }) => l.id === ownerId);
  if (!owner) throw new Error(`Không thấy chủ trọ #${ownerId}.`);
  const houseIds: string[] = owner.houses.map((h: { id: string }) => h.id);
  const out: Snapshot = {};
  for (const path of snapshotPaths(houseIds, currentMonth())) {
    const r = await call(base, 'GET', path);
    // Two identical 401/403/500 answers must never read as "the same": every snapshot page has to be a 200.
    const bad = snapshotStatusError(path, r.status);
    if (bad) throw new Error(bad);
    out[path] = { status: r.status, body: onlyHouses(path, r.body, houseIds) };
  }
  return out;
}

async function main(): Promise<number> {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (!token) {
    console.error(`Thiếu biến môi trường TROHUB_DEV_TOKEN.\n\n${USAGE}`);
    return 2;
  }
  const compare = opts.command !== 'dry-run';
  const hint = () => {
    if (opts.command === 'migrate') console.error(`\nCó vấn đề. Nếu công tắc đã sang kho riêng, quay lại bằng:\n  ${rollbackHint(opts)}`);
    else if (opts.command === 'rollback') console.error('\nCó vấn đề. Xem GET /api/dev/storage: nếu công tắc vẫn ở kho riêng thì dữ liệu thật còn nguyên ở đó; chạy lại rollback sau khi sửa nguyên nhân.');
  };
  const before = compare ? await snapshot(opts.base, opts.ownerId) : null; // nothing was changed yet: a failure here just stops

  let res: { status: number; body: any };
  try {
    res = await call(opts.base, 'POST', `/api/dev/storage/${opts.ownerId}/${opts.command}`);
  } catch (e) {
    // The request may have been carried out even though no answer came back.
    console.error(`Không nhận được trả lời (${e instanceof Error ? e.message : String(e)}); lệnh có thể đã chạy xong. Xem GET /api/dev/storage.`);
    hint();
    return 1;
  }
  const report = res.body?.report ?? { ownerId: opts.ownerId, mode: opts.command, ok: false, error: res.body?.error ?? `Máy chủ trả ${res.status}`, errorCode: res.body?.errorCode };
  console.log(formatReport(report));

  let differences: string[] = [];
  if (before) {
    try {
      differences = diffSnapshots(before, await snapshot(opts.base, opts.ownerId));
    } catch (e) {
      differences = [`không chụp được sau khi chạy: ${e instanceof Error ? e.message : String(e)}`];
    }
    console.log(differences.length ? `\nCác API đọc KHÁC nhau trước và sau (${differences.length}):\n${differences.map((d) => `  - ${d}`).join('\n')}` : '\nCác API đọc giống hệt nhau trước và sau.');
  }
  if (report.ok && !differences.length) return 0;
  hint();
  return 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`Lỗi: ${e instanceof Error ? e.message : String(e)}`); // never the token: it is only ever in a request header
    process.exit(1);
  },
);
