/**
 * Pure parts of migrate-tenant.mts (argument parsing, which pages to snapshot, how to diff snapshots,
 * how to print a report), kept apart so they can be tested without a network. No dependencies.
 */

export type Command = 'dry-run' | 'migrate' | 'rollback';

export interface Options {
  command: Command;
  ownerId: number;
  base: string;
}

export class UsageError extends Error {}

export const USAGE = `Cách dùng: TROHUB_DEV_TOKEN=<token Developer> node scripts/migrate-tenant.mts <dry-run|migrate|rollback> <ownerId> --base <url>

  dry-run   chép sang kho thử, đối chiếu, không đổi gì
  migrate   chuyển chủ trọ sang kho riêng (chụp các API đọc trước và sau rồi so)
  rollback  quay lại D1 (cũng chụp trước và sau)

Token Developer chỉ đọc từ biến môi trường TROHUB_DEV_TOKEN, không nhận qua dòng lệnh.`;

export function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  let base: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') base = argv[++i];
    else if (a.startsWith('--base=')) base = a.slice('--base='.length);
    else if (a === '--token' || a.startsWith('--token=')) throw new UsageError('Không đưa token vào dòng lệnh: dùng biến môi trường TROHUB_DEV_TOKEN.');
    else if (a.startsWith('--')) throw new UsageError(`Không hiểu tuỳ chọn ${a}.`);
    else positional.push(a);
  }
  const [command, owner, ...extra] = positional;
  if (command !== 'dry-run' && command !== 'migrate' && command !== 'rollback') throw new UsageError('Lệnh phải là dry-run, migrate hoặc rollback.');
  if (!owner || !/^[1-9]\d*$/.test(owner)) throw new UsageError('Thiếu ownerId (số nguyên dương).');
  if (extra.length) throw new UsageError(`Thừa tham số: ${extra.join(' ')}`);
  if (!base) throw new UsageError('Thiếu --base <url>.');
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new UsageError('--base không phải địa chỉ hợp lệ.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new UsageError('--base phải là https (http chỉ cho localhost).');
  if (url.username || url.password) throw new UsageError('--base không được chứa tên đăng nhập hay mật khẩu.');
  return { command, ownerId: Number(owner), base: url.origin };
}

/** "YYYY-MM" of now in Vietnam time (the months the Worker uses). */
export function currentMonth(now: Date = new Date()): string {
  const vn = new Date(now.getTime() + 7 * 3600_000);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The read APIs whose JSON must not change across a move, for every house of the landlord. */
export function snapshotPaths(houseIds: string[], month: string): string[] {
  const paths = ['/api/houses'];
  for (const id of houseIds) {
    const h = encodeURIComponent(id);
    paths.push(`/api/houses/${h}/rooms`, `/api/houses/${h}/invoices?month=${month}`, `/api/admin/payment-gate?houseId=${h}`);
  }
  return paths;
}

export type Snapshot = Record<string, { status: number; body: unknown }>;

/** `/api/houses` lists every house for the Developer; keep only the landlord's, so other landlords' changes are not noise. */
export function onlyHouses(path: string, body: unknown, houseIds: string[]): unknown {
  if (path !== '/api/houses' || !body || typeof body !== 'object' || !Array.isArray((body as { houses?: unknown }).houses)) return body;
  const b = body as { houses: { id?: string }[] };
  return { ...b, houses: b.houses.filter((h) => h.id !== undefined && houseIds.includes(h.id)) };
}

function firstDifference(a: unknown, b: unknown, at = ''): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${at || '/'}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${at || '/'}: kiểu khác nhau`;
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return `${at || '/'}: ${a.length} phần tử → ${b.length} phần tử`;
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const k of [...keys].sort()) {
    const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}/${k}`);
    if (d) return d;
  }
  return null;
}

/** One line per API whose status or JSON differs (the first differing place), empty when the snapshots are the same. */
export function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  const out: string[] = [];
  for (const path of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const a = before[path];
    const b = after[path];
    if (!a || !b) out.push(`${path}: chỉ có ở lần chụp ${a ? 'trước' : 'sau'}`);
    else if (a.status !== b.status) out.push(`${path}: mã ${a.status} → ${b.status}`);
    else {
      const d = firstDifference(a.body, b.body);
      if (d) out.push(`${path}: ${d}`);
    }
  }
  return out;
}

interface TableRow { table: string; d1Count: number; doCount: number; d1Sha: string; doSha: string; ok: boolean }
interface MonthRow { month: string; d1Total: number; doTotal: number; d1Paid: number; doPaid: number; ok: boolean }
export interface ReportLike {
  ownerId: number;
  mode: string;
  ok: boolean;
  tables?: TableRow[];
  months?: MonthRow[];
  deferredReplayed?: number;
  lockedMs?: number;
  error?: string;
  errorCode?: string;
  unmatchedPayments?: number;
  warnings?: string[];
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);

export function formatReport(r: ReportLike): string {
  const lines = [`${r.mode} chủ trọ #${r.ownerId}: ${r.ok ? 'KHỚP' : 'KHÔNG THÀNH CÔNG'}`];
  if (r.tables?.length) {
    lines.push('', `${pad('bảng', 16)}${pad('D1', 7)}${pad('kho', 7)}${pad('sha D1', 14)}${pad('sha kho', 14)}kết quả`);
    for (const t of r.tables) lines.push(`${pad(t.table, 16)}${pad(t.d1Count, 7)}${pad(t.doCount, 7)}${pad(t.d1Sha.slice(0, 12), 14)}${pad(t.doSha.slice(0, 12), 14)}${t.ok ? 'OK' : 'LỆCH'}`);
  }
  if (r.months?.length) {
    lines.push('', `${pad('tháng', 10)}${pad('tổng D1', 14)}${pad('tổng kho', 14)}${pad('đã đóng D1', 12)}${pad('đã đóng kho', 12)}kết quả`);
    for (const m of r.months) lines.push(`${pad(m.month, 10)}${pad(m.d1Total, 14)}${pad(m.doTotal, 14)}${pad(m.d1Paid, 12)}${pad(m.doPaid, 12)}${m.ok ? 'OK' : 'LỆCH'}`);
  }
  lines.push('');
  if (r.deferredReplayed !== undefined) lines.push(`Tiền về bị hoãn đã ghi: ${r.deferredReplayed}`);
  if (r.lockedMs) lines.push(`Thời gian khoá ghi: ${r.lockedMs} ms`);
  if (r.unmatchedPayments) lines.push(`Khoản chưa gắn căn và không khớp tài khoản của chủ trọ nào (ở lại D1): ${r.unmatchedPayments}`);
  for (const w of r.warnings ?? []) lines.push(`Lưu ý: ${w}`);
  if (r.error) lines.push(`Lỗi${r.errorCode ? ` (${r.errorCode})` : ''}: ${r.error}`);
  return lines.join('\n');
}

export function rollbackHint(o: Options): string {
  return `node scripts/migrate-tenant.mts rollback ${o.ownerId} --base ${o.base}`;
}
