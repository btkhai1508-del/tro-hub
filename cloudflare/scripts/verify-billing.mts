/**
 * Read-only verification of stored invoices against the billing formula. No network, never writes.
 *
 *   node scripts/verify-billing.mts sql TRUNG_KIM LVC
 *       Prints the SELECT to run against production (D1 console / MCP) for those houses.
 *   node scripts/verify-billing.mts check rows.json --electric 2026-01=3300,2026-05=3500 --water 20000 --actual TRUNG_KIM=3300,LVC=3300
 *       Reads the JSON rows the SELECT returned (an array, or {results: [...]}, or the D1 console array of
 *       {results} objects) and prints the report. Exit code 1 when anything mismatches.
 *   Months missing from --electric fall back to --electric-default <price> when given.
 */
import { readFileSync } from 'node:fs';
import { compareRows, verifySelectSql, type VerifyRow } from '../src/billing/verify.ts';

function pairs(text: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (text ?? '').split(',').filter(Boolean)) {
    const [k, v] = part.split('=');
    const n = Number(v);
    if (!k || !Number.isFinite(n)) throw new Error(`Sai định dạng: ${part}`);
    out[k] = n;
  }
  return out;
}

function sqlFor(houses: string[]): string {
  if (houses.length === 0 || houses.some((h) => !/^[A-Za-z0-9_-]+$/.test(h))) throw new Error('Cần ít nhất một mã nhà (chữ, số, _ hoặc -)');
  return verifySelectSql(houses.length).replace(/\?/g, () => `'${houses.shift()}'`);
}

function rowsOf(json: any): VerifyRow[] {
  if (Array.isArray(json) && json.length > 0 && Array.isArray(json[0]?.results)) return json.flatMap((x) => x.results);
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.results)) return json.results;
  throw new Error('Không đọc được danh sách hàng từ file JSON');
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  if (cmd === 'sql') {
    console.log(sqlFor(rest));
    return 0;
  }
  if (cmd === 'check' && rest[0]) {
    const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
    const rows = rowsOf(JSON.parse(readFileSync(rest[0], 'utf8')));
    const electric = pairs(flag('--electric'));
    const fallback = flag('--electric-default');
    if (fallback !== undefined) for (const r of rows) electric[r.month] ??= Number(fallback);
    const actual: Record<string, number | null> = pairs(flag('--actual'));
    const res = compareRows(rows, { electricPriceByMonth: electric, waterPrice: Number(flag('--water') ?? 20000), actualElectricPriceByHouse: actual });
    console.log(`Đã kiểm: ${res.checked}, bỏ qua (không có số điện nước): ${res.skipped}, lệch: ${res.mismatches.length}`);
    for (const m of res.mismatches) console.log(`LỆCH ${m.houseId} ${m.room} ${m.month} ${m.field}: lưu ${m.stored}, tính ${m.computed}`);
    return res.mismatches.length === 0 ? 0 : 1;
  }
  console.error('Cách dùng: verify-billing.mts sql <HOUSE...> | check <rows.json> --electric M=giá,... [--electric-default giá] --water giá --actual HOUSE=giá,...');
  return 2;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 2;
}
