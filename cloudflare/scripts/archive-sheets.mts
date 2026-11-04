/**
 * Full backup of the Google Sheets into D1 before the app stops using them, printed as SQL.
 * Each file is kept twice: the whole .xlsx (colours and formatting, so it can be restored as it
 * was) and each tab's values as JSON. Everything is encrypted with CCCD_KEY: the sheets hold CCCD
 * numbers and old plain-text passwords. Run from the repo root:
 *   CCCD_KEY=... npx tsx cloudflare/scripts/archive-sheets.mts > cloudflare/.wrangler/archive.sql
 * Read it back with restore-archive.mts.
 */
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { parseSheetXmlRows, ADMIN_SPREADSHEET_ID, SHEET_TK_ID } from '../../src/server/adminService.ts';
import { encryptText } from '../src/cccd.ts';

const key = process.env.CCCD_KEY;
if (!key) throw new Error('Thiếu CCCD_KEY');

const FILES = [
  { id: ADMIN_SPREADSHEET_ID, name: 'Trọ-Hub (sheet chính)' },
  { id: SHEET_TK_ID, name: 'Sổ doanh thu Trung Kim' },
];
const CHUNK = 90_000; // D1 refuses SQL statements over 100 KB
const q = (v: string | number | null) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`);
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

const sql: string[] = [];
const report: Record<string, string> = {};

async function archive(spreadsheetId: string, name: string, kind: 'xlsx' | 'tab', tab: string | null, rows: number | null, plain: string, size: number, digest: string) {
  const enc = await encryptText(plain, key!);
  sql.push(`INSERT INTO sheet_archive (spreadsheet_id, spreadsheet_name, kind, tab, row_count, byte_size, sha256) VALUES (${q(spreadsheetId)}, ${q(name)}, ${q(kind)}, ${q(tab)}, ${q(rows)}, ${size}, ${q(digest)});`);
  for (let i = 0, seq = 0; i < enc.length; i += CHUNK, seq++) {
    sql.push(`INSERT INTO sheet_archive_chunks (archive_id, seq, data) VALUES ((SELECT MAX(id) FROM sheet_archive), ${seq}, ${q(enc.slice(i, i + CHUNK))});`);
  }
}

for (const file of FILES) {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${file.id}/export?format=xlsx`);
  if (!res.ok) throw new Error(`Không tải được ${file.name}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await archive(file.id, file.name, 'xlsx', null, null, bytes.toString('base64'), bytes.length, sha256(bytes));

  const zip = new AdmZip(bytes);
  const tabs = [...zip.readAsText('xl/workbook.xml').matchAll(/<sheet\s+[^>]*name="([^"]+)"/g)].map((m) => m[1]);
  let total = 0;
  for (const tab of tabs) {
    const { rows } = await parseSheetXmlRows(zip, tab);
    const values = rows.map((r: any) => ({
      row: r.rowNumber,
      cells: Object.fromEntries(Object.entries(r.cells).map(([col, c]: [string, any]) => [col, typeof c?.num === 'number' ? c.num : c?.value ?? ''])),
    }));
    const json = JSON.stringify(values);
    await archive(file.id, file.name, 'tab', tab, values.length, json, Buffer.byteLength(json), sha256(json));
    total += values.length;
  }
  report[file.name] = `${(bytes.length / 1024).toFixed(0)} KB xlsx, ${tabs.length} tab, ${total} dòng`;
}

console.log(sql.join('\n'));
console.error(JSON.stringify(report, null, 1));
