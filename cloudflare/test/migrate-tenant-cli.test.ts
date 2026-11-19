import { describe, expect, it } from 'vitest';
import { currentMonth, diffSnapshots, formatReport, onlyHouses, parseArgs, snapshotPaths, UsageError } from '../scripts/migrate-tenant-lib.mts';

describe('migrate-tenant: dòng lệnh', () => {
  it('đọc lệnh, ownerId và --base (cả hai dạng)', () => {
    expect(parseArgs(['migrate', '1', '--base', 'https://tro-hub.example.workers.dev/'])).toEqual({ command: 'migrate', ownerId: 1, base: 'https://tro-hub.example.workers.dev' });
    expect(parseArgs(['--base=http://localhost:8787', 'dry-run', '4'])).toEqual({ command: 'dry-run', ownerId: 4, base: 'http://localhost:8787' });
    expect(parseArgs(['rollback', '12', '--base', 'http://127.0.0.1:8787/api'])).toMatchObject({ base: 'http://127.0.0.1:8787' });
  });

  it('từ chối: lệnh lạ, ownerId xấu, thiếu --base, thừa tham số, http ngoài localhost, base có mật khẩu', () => {
    const bad = (argv: string[]) => expect(() => parseArgs(argv)).toThrow(UsageError);
    bad([]);
    bad(['nuke', '1', '--base', 'https://x.dev']);
    bad(['migrate', 'abc', '--base', 'https://x.dev']);
    bad(['migrate', '0', '--base', 'https://x.dev']);
    bad(['migrate', '-1', '--base', 'https://x.dev']);
    bad(['migrate', '1']);
    bad(['migrate', '1', '--base']);
    bad(['migrate', '1', '2', '--base', 'https://x.dev']);
    bad(['migrate', '1', '--base', 'http://tro-hub.example.com']);
    bad(['migrate', '1', '--base', 'not a url']);
    bad(['migrate', '1', '--base', 'https://user:pw@x.dev']);
    bad(['migrate', '1', '--base', 'https://x.dev', '--force']);
  });

  it('không nhận token qua dòng lệnh, và thông báo lỗi không lặp lại giá trị', () => {
    for (const argv of [['migrate', '1', '--base', 'https://x.dev', '--token', 'SECRET-123'], ['migrate', '1', '--base', 'https://x.dev', '--token=SECRET-123']]) {
      let message = '';
      try {
        parseArgs(argv);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/TROHUB_DEV_TOKEN/);
      expect(message).not.toContain('SECRET-123');
    }
  });
});

describe('migrate-tenant: chụp và so', () => {
  it('tháng hiện tại theo giờ Việt Nam', () => {
    expect(currentMonth(new Date('2026-11-19T10:00:00Z'))).toBe('2026-11');
    expect(currentMonth(new Date('2026-11-30T17:30:00Z'))).toBe('2026-12'); // already 1/12 in Vietnam
    expect(currentMonth(new Date('2026-12-31T16:59:59Z'))).toBe('2026-12');
    expect(currentMonth(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01');
  });

  it('các đường dẫn chụp cho mọi căn', () => {
    expect(snapshotPaths(['A', 'B C'], '2026-11')).toEqual([
      '/api/houses',
      '/api/houses/A/rooms', '/api/houses/A/invoices?month=2026-11', '/api/admin/payment-gate?houseId=A',
      '/api/houses/B%20C/rooms', '/api/houses/B%20C/invoices?month=2026-11', '/api/admin/payment-gate?houseId=B%20C',
    ]);
  });

  it('chỉ giữ các căn của chủ trọ trong /api/houses', () => {
    const body = { success: true, houses: [{ id: 'A' }, { id: 'Z' }], canSeeSummary: false };
    expect(onlyHouses('/api/houses', body, ['A'])).toEqual({ success: true, houses: [{ id: 'A' }], canSeeSummary: false });
    expect(onlyHouses('/api/houses/A/rooms', body, ['A'])).toBe(body);
    expect(onlyHouses('/api/houses', null, ['A'])).toBeNull();
  });

  it('giống nhau thì không có khác biệt; khác thì chỉ ra API và chỗ khác đầu tiên', () => {
    const a = { '/x': { status: 200, body: { rooms: [{ id: 1, price: 5 }, { id: 2, price: 6 }] } }, '/y': { status: 200, body: { v: 'STOP' } } };
    expect(diffSnapshots(a, structuredClone(a))).toEqual([]);
    const b = structuredClone(a);
    b['/x'].body.rooms[1].price = 7;
    expect(diffSnapshots(a, b)).toEqual(['/x: /rooms/1/price: 6 → 7']);
    const c = structuredClone(a);
    c['/x'].body.rooms.pop();
    c['/y'].status = 503;
    expect(diffSnapshots(a, c)).toEqual(['/x: /rooms: 2 phần tử → 1 phần tử', '/y: mã 200 → 503']);
    expect(diffSnapshots(a, { '/x': a['/x'] })).toEqual(['/y: chỉ có ở lần chụp trước']);
    // Key order does not matter, value types do.
    expect(diffSnapshots({ '/x': { status: 200, body: { a: 1, b: 2 } } }, { '/x': { status: 200, body: { b: 2, a: 1 } } })).toEqual([]);
    expect(diffSnapshots({ '/x': { status: 200, body: { a: 1 } } }, { '/x': { status: 200, body: { a: '1' } } })).toHaveLength(1);
    expect(diffSnapshots({ '/x': { status: 200, body: { a: null } } }, { '/x': { status: 200, body: { a: 0 } } })).toHaveLength(1);
  });

  it('in bảng báo cáo, đánh dấu dòng lệch và in lỗi', () => {
    const text = formatReport({
      ownerId: 1, mode: 'migrate', ok: false, errorCode: 'VERIFY_FAILED', error: 'Đối chiếu không khớp: rooms.', lockedMs: 1200, deferredReplayed: 0, unmatchedPayments: 2,
      tables: [
        { table: 'houses', d1Count: 2, doCount: 2, d1Sha: 'a'.repeat(64), doSha: 'a'.repeat(64), ok: true },
        { table: 'rooms', d1Count: 2, doCount: 3, d1Sha: 'b'.repeat(64), doSha: 'c'.repeat(64), ok: false },
      ],
      months: [{ month: '2026-11', d1Total: 6500000, doTotal: 6500000, d1Paid: 1, doPaid: 1, ok: true }],
    });
    expect(text).toContain('migrate chủ trọ #1: KHÔNG THÀNH CÔNG');
    expect(text).toMatch(/houses\s+2\s+2\s+aaaaaaaaaaaa\s+aaaaaaaaaaaa\s+OK/);
    expect(text).toMatch(/rooms\s+2\s+3\s+bbbbbbbbbbbb\s+cccccccccccc\s+LỆCH/);
    expect(text).toMatch(/2026-11\s+6500000\s+6500000/);
    expect(text).toContain('Lỗi (VERIFY_FAILED): Đối chiếu không khớp: rooms.');
    expect(text).toContain('Khoản chưa gắn căn');
    expect(formatReport({ ownerId: 4, mode: 'dry-run', ok: true })).toContain('KHỚP');
  });
});
