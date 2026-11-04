/**
 * Reads the Google Sheet backup back out of D1 and checks it against its SHA-256.
 *   CCCD_KEY=... npx tsx cloudflare/scripts/restore-archive.mts [--remote] [--out folder]
 * With --out, each backed-up .xlsx is written to that folder so it can be opened or re-uploaded.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptText } from '../src/cccd.ts';

const key = process.env.CCCD_KEY;
if (!key) throw new Error('Thiếu CCCD_KEY');
const remote = process.argv.includes('--remote');
const outIndex = process.argv.indexOf('--out');
const out = outIndex > 0 ? process.argv[outIndex + 1] : null;

const d1 = (sql: string) =>
  JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'tro-hub', remote ? '--remote' : '--local', '--json', '--command', sql], { cwd: fileURLToPath(new URL('..', import.meta.url).href), maxBuffer: 256 * 1024 * 1024 }).toString())[0].results;

const items = d1('SELECT id, spreadsheet_name, kind, tab, row_count, byte_size, sha256 FROM sheet_archive ORDER BY id');
let ok = 0;
for (const item of items) {
  const chunks = d1(`SELECT data FROM sheet_archive_chunks WHERE archive_id = ${Number(item.id)} ORDER BY seq`);
  const plain = await decryptText(chunks.map((c: any) => c.data).join(''), key);
  const data = item.kind === 'xlsx' ? Buffer.from(plain, 'base64') : Buffer.from(plain);
  const match = createHash('sha256').update(data).digest('hex') === item.sha256;
  if (match) ok++;
  console.log(`${match ? '✅' : '❌'} ${item.spreadsheet_name} · ${item.kind === 'xlsx' ? 'file .xlsx' : `tab ${item.tab} (${item.row_count} dòng)`}`);
  if (out && item.kind === 'xlsx') {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `${item.spreadsheet_name}.xlsx`), data);
  }
}
console.log(`${ok}/${items.length} mục khớp SHA-256`);
