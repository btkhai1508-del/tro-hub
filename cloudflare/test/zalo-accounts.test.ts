import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/app.ts';
import { reserveResident } from '../src/central/directory.ts';
import { hashPassword } from '../src/password.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const SECRET = 'test-zalo-secret';
const json = (body: unknown, token?: string): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

const hmacHex = async (data: string, key: string) => {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)))].map((b) => b.toString(16).padStart(2, '0')).join('');
};

interface Seen { url: string; headers: Record<string, string> }
/** Pretends to be graph.zalo.me; every other fetch goes through. */
function mockZalo(opts: { number?: string; profileError?: boolean; phoneError?: boolean; network?: boolean } = {}): Seen[] {
  const seen: Seen[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith('https://graph.zalo.me/')) return real(input, init);
    if (opts.network) throw new TypeError('network down');
    seen.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    if (url.includes('/me/info')) {
      return opts.phoneError
        ? Response.json({ error: -124, message: 'Invalid phone token' })
        : Response.json({ error: 0, data: { number: opts.number ?? '84900000101' } });
    }
    return opts.profileError
      ? Response.json({ error: -216, message: 'Access token is invalid' })
      : Response.json({ error: 0, id: 'z-123', name: 'Zalo Name', picture: { data: { url: 'https://s.zalo/a.png' } } });
  });
  return seen;
}

const zaloLogin = (body: unknown = { accessToken: 'at-1', phoneToken: 'pt-1' }) => api('/api/auth/zalo', json(body));

describe.each(BACKENDS)('đăng nhập Zalo, đăng ký, duyệt, hồ sơ (%s)', (backend) => {
  let owner: string;
  let manager: string;
  const setStatus = async (phone: string, status: string, extra = '') => {
    const store = await tenantOfOwner(e, 1);
    await store.prepare(`UPDATE residents SET status = ?${extra} WHERE phone = ?`).bind(status, phone).run();
  };
  /** A pending resident written the way registration writes it: index first, store second. */
  const seedPending = async (house: string, room: number | null, phone: string, name = 'Chờ Duyệt') => {
    const id = await reserveResident(e.DB, { phone, ownerId: 1, houseId: house });
    const store = await tenantOfOwner(e, 1);
    await store
      .prepare(`INSERT INTO residents (id, house_id, room_id, full_name, phone, password_hash, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`)
      .bind(id, house, room, name, phone, await hashPassword('secret1'))
      .run();
    return id;
  };
  const residentRow = async (phone: string) =>
    (await (await tenantOfOwner(e, 1)).prepare(`SELECT id, status, room_id, deleted_at, phone, full_name FROM residents WHERE phone = ? OR (phone IS NULL AND ? = '')`).bind(phone, phone).first<Record<string, any>>()) ?? null;

  beforeEach(async () => {
    await seedWorld(backend);
    (e as any).ZALO_APP_SECRET = SECRET;
    owner = await login(PHONES.owner);
    manager = await login(PHONES.manager);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    (e as any).ZALO_APP_SECRET = SECRET;
  });

  describe('POST /api/auth/zalo', () => {
    it.each(['+84900000101', '84900000101', '0900000101', '+84 900-000-101'])('số Zalo %s đăng nhập được cư dân và token dùng được', async (number) => {
      mockZalo({ number });
      const res = await zaloLogin();
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.viewer).toMatchObject({ kind: 'resident', phone: PHONES.residentTk, houseId: 'TRUNG_KIM' });
      expect(body.zalo).toEqual({ id: 'z-123', name: 'Zalo Name', avatar: 'https://s.zalo/a.png' });
      const me = (await (await api('/api/me', {}, body.token)).json()) as any;
      expect(me.viewer.phone).toBe(PHONES.residentTk);
    });

    it('số của staff cho token staff', async () => {
      mockZalo({ number: '+84902371800' });
      const body = (await (await zaloLogin()).json()) as any;
      expect(body.viewer).toMatchObject({ kind: 'staff', role: 'owner' });
      expect(((await (await api('/api/me', {}, body.token)).json()) as any).viewer.kind).toBe('staff');
    });

    it('ghi appsecret_proof, secret_key và code đúng', async () => {
      const seen = mockZalo();
      await zaloLogin({ accessToken: 'at-xyz', phoneToken: 'pt-xyz' });
      const profile = seen.find((s) => s.url.includes('/v2.0/me?'))!;
      const info = seen.find((s) => s.url.includes('/v2.0/me/info'))!;
      expect(profile.url).toBe('https://graph.zalo.me/v2.0/me?fields=id,name,picture');
      expect(profile.headers.access_token).toBe('at-xyz');
      expect(profile.headers.appsecret_proof).toBe(await hmacHex('at-xyz', SECRET));
      expect(info.headers).toMatchObject({ access_token: 'at-xyz', code: 'pt-xyz', secret_key: SECRET });
    });

    it('đang chờ duyệt: 403 AUTH_PENDING_APPROVAL', async () => {
      await setStatus(PHONES.residentTk, 'pending');
      mockZalo();
      const res = await zaloLogin();
      expect(res.status).toBe(403);
      expect(((await res.json()) as any).errorCode).toBe('AUTH_PENDING_APPROVAL');
    });

    it('bị từ chối: 403 AUTH_REJECTED', async () => {
      await setStatus(PHONES.residentTk, 'rejected');
      mockZalo();
      const res = await zaloLogin();
      expect(res.status).toBe(403);
      expect(((await res.json()) as any).errorCode).toBe('AUTH_REJECTED');
    });

    it('đã xoá thì không đăng nhập được', async () => {
      await setStatus(PHONES.residentTk, 'approved', `, deleted_at = datetime('now')`);
      mockZalo();
      expect((await zaloLogin()).status).toBe(404);
    });

    it('số chưa đăng ký: 404 đúng câu', async () => {
      mockZalo({ number: '84900000099' });
      const res = await zaloLogin();
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        success: false,
        errorCode: 'AUTH_TENANT_NOT_MAPPED',
        error: 'Số điện thoại Zalo 0900000099 chưa được đăng ký với phòng nào. Vui lòng liên hệ Chủ trọ để cập nhật SĐT.',
      });
    });

    it('thiếu secret: 503 ZALO_NOT_CONFIGURED', async () => {
      (e as any).ZALO_APP_SECRET = undefined;
      const seen = mockZalo();
      const res = await zaloLogin();
      expect(res.status).toBe(503);
      expect(((await res.json()) as any).errorCode).toBe('ZALO_NOT_CONFIGURED');
      expect(seen).toHaveLength(0);
    });

    it('Zalo từ chối token: 401 ZALO_REJECTED', async () => {
      mockZalo({ profileError: true });
      const res = await zaloLogin();
      expect(res.status).toBe(401);
      expect(((await res.json()) as any).errorCode).toBe('ZALO_REJECTED');
    });

    it('Zalo từ chối phoneToken: 401 ZALO_REJECTED', async () => {
      mockZalo({ phoneError: true });
      expect((await zaloLogin()).status).toBe(401);
    });

    it('không gọi được Zalo: 502 ZALO_UNAVAILABLE', async () => {
      mockZalo({ network: true });
      const res = await zaloLogin();
      expect(res.status).toBe(502);
      expect(((await res.json()) as any).errorCode).toBe('ZALO_UNAVAILABLE');
    });

    it('thiếu token: 400', async () => {
      mockZalo();
      expect((await zaloLogin({ accessToken: 'x' })).status).toBe(400);
    });

    it('ghi nhật ký đăng nhập', async () => {
      mockZalo();
      await zaloLogin();
      const row = await e.DB.prepare(`SELECT action FROM audit_log WHERE action = 'login' AND actor LIKE 'resident:%'`).first();
      expect(row).not.toBeNull();
    });
  });

  describe('POST /api/auth/register và duyệt', () => {
    const REG = { name: 'Người Mới', phone: '0900000777', password: 'secret1', roomNumber: '101', houseId: 'TRUNG_KIM', email: 'a@b.vn', gender: 'Nam' };

    it('đăng ký công khai → chờ duyệt → quản lý duyệt → đăng nhập mật khẩu', async () => {
      const res = await api('/api/auth/register', json(REG));
      expect(res.status).toBe(200);
      const reg = (await res.json()) as any;
      expect(reg).toMatchObject({ success: true, approved: false });
      expect(typeof reg.joinedAt).toBe('string');
      expect((await e.DB.prepare(`SELECT house_id FROM resident_index WHERE phone = ?`).bind(REG.phone).first<any>()).house_id).toBe('TRUNG_KIM');

      const pwLogin = () => api('/api/auth/login', json({ phone: REG.phone, password: 'secret1' }));
      const pending = await pwLogin();
      expect(pending.status).toBe(403);
      expect(((await pending.json()) as any).errorCode).toBe('AUTH_PENDING_APPROVAL');

      const list = (await (await api('/api/admin/accounts', {}, manager)).json()) as any;
      const acc = list.accounts.find((a: any) => a.phone === REG.phone);
      expect(acc).toMatchObject({ name: 'Người Mới', email: 'a@b.vn', gender: 'Nam', roomNumber: '101', status: 'pending', isAdmin: false });
      expect(acc.id).toMatch(/^sheet-\d+$/);
      expect(acc.createdAt).toBeTruthy();

      const ok = await api('/api/admin/accounts/status', json({ phone: REG.phone, name: REG.name, room: '101', status: 'approved' }, manager));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ success: true });
      expect((await pwLogin()).status).toBe(200);
      expect((await e.DB.prepare(`SELECT resident_count FROM house_directory WHERE house_id = 'TRUNG_KIM'`).first<any>()).resident_count).toBe(2);
      expect(await e.DB.prepare(`SELECT 1 FROM audit_log WHERE action = 'account_approved'`).first()).not.toBeNull();
    });

    it('từ chối rồi đăng nhập không được', async () => {
      await api('/api/auth/register', json(REG));
      const res = await api('/api/admin/accounts/status', json({ phone: REG.phone, status: 'rejected' }, owner));
      expect(res.status).toBe(200);
      const login = await api('/api/auth/login', json({ phone: REG.phone, password: 'secret1' }));
      expect(((await login.json()) as any).errorCode).toBe('AUTH_REJECTED');
      expect(await e.DB.prepare(`SELECT 1 FROM audit_log WHERE action = 'account_rejected'`).first()).not.toBeNull();
    });

    it('không có nhà mà hệ thống nhiều nhà: 400 HOUSE_REQUIRED, không để lại dòng index', async () => {
      const res = await api('/api/auth/register', json({ ...REG, houseId: undefined }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).errorCode).toBe('HOUSE_REQUIRED');
      expect(await e.DB.prepare(`SELECT 1 FROM resident_index WHERE phone = ?`).bind(REG.phone).first()).toBeNull();
    });

    it('một nhà duy nhất thì không cần houseId', async () => {
      await e.DB.prepare(`UPDATE house_directory SET status = 'inactive' WHERE house_id <> 'TRUNG_KIM'`).run();
      expect((await api('/api/auth/register', json({ ...REG, houseId: undefined }))).status).toBe(200);
    });

    it('số trùng (cư dân hoặc staff): 400 PHONE_TAKEN', async () => {
      for (const phone of [PHONES.residentTk, PHONES.manager]) {
        const res = await api('/api/auth/register', json({ ...REG, phone }));
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ errorCode: 'PHONE_TAKEN', error: 'Số điện thoại này đã có tài khoản.' });
      }
    });

    it.each([
      ['tên trống', { name: ' ' }],
      ['số không đủ 10', { phone: '09000' }],
      ['mật khẩu ngắn', { password: '12345' }],
      ['thiếu phòng', { roomNumber: '' }],
    ])('đầu vào sai (%s): 400', async (_n, patch) => {
      const res = await api('/api/auth/register', json({ ...REG, ...patch }));
      expect(res.status).toBe(400);
      expect(await e.DB.prepare(`SELECT 1 FROM resident_index WHERE phone = '0900000777'`).first()).toBeNull();
    });

    it('phòng không có: 400 ROOM_INVALID; phòng đủ người: 400 ROOM_FULL', async () => {
      expect(((await (await api('/api/auth/register', json({ ...REG, roomNumber: '999' }))).json()) as any).errorCode).toBe('ROOM_INVALID');
      await (await tenantOfOwner(e, 1)).prepare(`UPDATE rooms SET capacity = 1 WHERE id = 1`).run();
      const full = await api('/api/auth/register', json(REG));
      expect(full.status).toBe(400);
      expect(((await full.json()) as any).errorCode).toBe('ROOM_FULL');
      expect(await e.DB.prepare(`SELECT 1 FROM resident_index WHERE phone = ?`).bind(REG.phone).first()).toBeNull();
    });

    it('cư dân chờ duyệt không có phòng: duyệt cần phòng', async () => {
      await seedPending('TRUNG_KIM', null, '0900000888');
      const no = await api('/api/admin/accounts/status', json({ phone: '0900000888', status: 'approved' }, owner));
      expect(no.status).toBe(400);
      expect(((await no.json()) as any).errorCode).toBe('ROOM_REQUIRED');
      expect((await residentRow('0900000888'))!.status).toBe('pending');
      const yes = await api('/api/admin/accounts/status', json({ phone: '0900000888', status: 'approved', roomId: 1 }, owner));
      expect(yes.status).toBe(200);
      expect(await residentRow('0900000888')).toMatchObject({ status: 'approved', room_id: 1 });
    });

    it('duyệt vào phòng đã đủ người: 400 ROOM_FULL', async () => {
      await seedPending('TRUNG_KIM', null, '0900000888');
      await (await tenantOfOwner(e, 1)).prepare(`UPDATE rooms SET capacity = 1 WHERE id = 1`).run();
      const res = await api('/api/admin/accounts/status', json({ phone: '0900000888', status: 'approved', roomId: 1 }, owner));
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).errorCode).toBe('ROOM_FULL');
      expect((await residentRow('0900000888'))!.status).toBe('pending');
    });

    it('duyệt xong có hoá đơn nháp khi bật nguồn Worker', async () => {
      await e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('source_of_truth', 'worker') ON CONFLICT (key) DO UPDATE SET value = 'worker'`).run();
      await seedPending('LVC', 3, '0900000888');
      const month = (await (await tenantOfOwner(e, 1)).prepare(`SELECT strftime('%Y-%m', 'now', '+7 hours') AS m`).first<{ m: string }>())!.m;
      await (await tenantOfOwner(e, 1)).prepare(`DELETE FROM invoices WHERE room_id = 3`).run();
      expect((await api('/api/admin/accounts/status', json({ phone: '0900000888', status: 'approved' }, owner))).status).toBe(200);
      const draft = await (await tenantOfOwner(e, 1)).prepare(`SELECT issued_at FROM invoices WHERE room_id = 3 AND month = ?`).bind(month).first<any>();
      expect(draft).not.toBeNull();
      expect(draft.issued_at).toBeNull();
    });

    it('quản lý căn khác không thấy và không duyệt được', async () => {
      await seedPending('LVC', 3, '0900000888', 'Cư dân LVC chờ');
      const list = (await (await api('/api/admin/accounts', {}, manager)).json()) as any;
      expect(list.accounts.map((a: any) => a.phone)).toEqual([PHONES.residentTk]);
      const res = await api('/api/admin/accounts/status', json({ phone: '0900000888', status: 'approved' }, manager));
      expect(res.status).toBe(403);
      expect((await residentRow('0900000888'))!.status).toBe('pending');
      const del = await api('/api/admin/accounts/delete', json({ phone: '0900000888', mode: 'account' }, manager));
      expect(del.status).toBe(403);
      // The owner of both houses sees all three.
      const all = (await (await api('/api/admin/accounts', {}, owner)).json()) as any;
      expect(all.accounts.map((a: any) => a.phone).sort()).toEqual(['0900000201', '0900000888', PHONES.residentTk].sort());
    });

    it('cư dân không dùng được API duyệt', async () => {
      const resident = await login(PHONES.residentTk);
      expect((await api('/api/admin/accounts', {}, resident)).status).toBe(403);
      expect((await api('/api/admin/accounts/status', json({ phone: PHONES.residentLvc, status: 'rejected' }, resident))).status).toBe(403);
      expect((await api('/api/admin/accounts/delete', json({ phone: PHONES.residentLvc, mode: 'account' }, resident))).status).toBe(403);
      expect((await api('/api/admin/accounts')).status).toBe(401);
    });

    it('trạng thái sai: 400; tài khoản không có: 404', async () => {
      expect((await api('/api/admin/accounts/status', json({ phone: PHONES.residentTk, status: 'banana' }, owner))).status).toBe(400);
      expect((await api('/api/admin/accounts/status', json({ phone: '0900000555', status: 'approved' }, owner))).status).toBe(404);
    });
  });

  describe('POST /api/admin/accounts/delete', () => {
    it('xoá tài khoản: không đăng nhập được, số dùng lại được, bộ đếm giảm', async () => {
      const res = await api('/api/admin/accounts/delete', json({ phone: PHONES.residentTk, name: 'x', room: '101', mode: 'account' }, owner));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect((await api('/api/auth/login', json({ phone: PHONES.residentTk, password: '1' }))).status).toBe(401);
      expect(await e.DB.prepare(`SELECT 1 FROM resident_index WHERE phone = ?`).bind(PHONES.residentTk).first()).toBeNull();
      expect((await e.DB.prepare(`SELECT resident_count FROM house_directory WHERE house_id = 'TRUNG_KIM'`).first<any>()).resident_count).toBe(0);
      const list = (await (await api('/api/admin/accounts', {}, owner)).json()) as any;
      expect(list.accounts.map((a: any) => a.phone)).not.toContain(PHONES.residentTk);
      // The number can register again.
      const again = await api('/api/auth/register', json({ name: 'Lại', phone: PHONES.residentTk, password: 'secret1', roomNumber: '101', houseId: 'TRUNG_KIM' }));
      expect(again.status).toBe(200);
      expect(await e.DB.prepare(`SELECT 1 FROM audit_log WHERE action = 'account_delete'`).first()).not.toBeNull();
    });

    it('xoá khỏi phòng: không đăng nhập được nhưng giữ tài khoản', async () => {
      const res = await api('/api/admin/accounts/delete', json({ phone: PHONES.residentTk, mode: 'resident' }, owner));
      expect(res.status).toBe(200);
      expect((await api('/api/auth/login', json({ phone: PHONES.residentTk, password: '1' }))).status).toBe(403);
      expect(await residentRow(PHONES.residentTk)).toMatchObject({ status: 'moved_out', deleted_at: null });
    });

    it('mode sai: 400 với câu Express', async () => {
      const res = await api('/api/admin/accounts/delete', json({ phone: PHONES.residentTk, mode: 'x' }, owner));
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error).toBe('Thao tác xoá không hợp lệ.');
    });
  });

  describe('POST /api/profile/update', () => {
    const profile = { name: 'Tên Mới', email: 'moi@mail.vn', dob: '01/02/1999', gender: 'Nữ', address: '12 Đường A', plateNumber: '59A1-12345', vehicleType: 'Xe máy',
      emergencyName: 'Mẹ', emergencyPhone: '0911222333', emergencyRelation: 'Mẹ ruột' };

    it('sửa các trường của chính mình', async () => {
      const t = await login(PHONES.residentTk);
      const res = await api('/api/profile/update', json({ ...profile, phone: '0900 000 101', roomNumber: '999' }, t));
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(typeof body.message).toBe('string');
      const row = await (await tenantOfOwner(e, 1)).prepare(`SELECT * FROM residents WHERE phone = ?`).bind(PHONES.residentTk).first<any>();
      expect(row).toMatchObject({ full_name: 'Tên Mới', email: 'moi@mail.vn', dob: '01/02/1999', gender: 'Nữ', address_detail: '12 Đường A', plate_number: '59A1-12345',
        vehicle_type: 'Xe máy', emergency_name: 'Mẹ', emergency_phone: '0911222333', emergency_relation: 'Mẹ ruột', room_id: 1, status: 'approved' });
      expect(((await (await api('/api/me', {}, t)).json()) as any).viewer.name).toBe('Tên Mới');
    });

    it('nhận cả dạng lồng nhau của Express', async () => {
      const t = await login(PHONES.residentTk);
      await api('/api/profile/update', json({ name: 'N', vehicle: { type: 'Xe máy', plateNumber: '51B-999' }, emergencyContact: { name: 'Bố', phone: '0922', relationship: 'Cha' } }, t));
      const row = await (await tenantOfOwner(e, 1)).prepare(`SELECT plate_number, emergency_name, emergency_relation FROM residents WHERE phone = ?`).bind(PHONES.residentTk).first<any>();
      expect(row).toEqual({ plate_number: '51B-999', emergency_name: 'Bố', emergency_relation: 'Cha' });
    });

    it('CCCD được mã hoá', async () => {
      const t = await login(PHONES.residentTk);
      expect((await api('/api/profile/update', json({ name: 'N', cccd: '079123456789' }, t))).status).toBe(200);
      const row = await (await tenantOfOwner(e, 1)).prepare(`SELECT cccd_enc, cccd_last4, cccd_hash FROM residents WHERE phone = ?`).bind(PHONES.residentTk).first<any>();
      expect(row.cccd_last4).toBe('6789');
      expect(row.cccd_enc).not.toContain('079123456789');
      expect(row.cccd_hash).toBeTruthy();
      // The same number on another resident is refused.
      const other = await login(PHONES.residentLvc);
      expect((await api('/api/profile/update', json({ name: 'M', cccd: '079123456789' }, other))).status).toBe(400);
    });

    it('đổi số điện thoại: 400 PHONE_LOCKED, không đổi gì', async () => {
      const t = await login(PHONES.residentTk);
      const res = await api('/api/profile/update', json({ ...profile, phone: '0988888888' }, t));
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).errorCode).toBe('PHONE_LOCKED');
      expect((await residentRow(PHONES.residentTk))!.full_name).toBe('Cư dân Trung Kim');
    });

    it('không đổi được trạng thái, phòng, mật khẩu', async () => {
      const t = await login(PHONES.residentTk);
      await api('/api/profile/update', json({ name: 'Giữ', status: 'rejected', room_id: 3, roomId: 3, houseId: 'LVC', password: 'hack', password_hash: 'x' }, t));
      const row = await (await tenantOfOwner(e, 1)).prepare(`SELECT status, room_id, house_id FROM residents WHERE phone = ?`).bind(PHONES.residentTk).first<any>();
      expect(row).toEqual({ status: 'approved', room_id: 1, house_id: 'TRUNG_KIM' });
      expect((await api('/api/auth/login', json({ phone: PHONES.residentTk, password: '1' }))).status).toBe(200);
    });

    it('tên trống: 400; staff: 403; không token: 401', async () => {
      const t = await login(PHONES.residentTk);
      expect((await api('/api/profile/update', json({ name: ' ' }, t))).status).toBe(400);
      expect((await api('/api/profile/update', json({ name: 'x' }, owner))).status).toBe(403);
      expect((await api('/api/profile/update', json({ name: 'x' }))).status).toBe(401);
    });
  });
});

void SELF;
