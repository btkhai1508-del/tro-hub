/**
 * Bridge while the app moves to Cloudflare: login happens on the Worker, which knows each
 * person's house, room and lock status. The app then trades the Worker token here for the
 * usual session, so every Express route keeps working on the Google Sheet data until it
 * moves to the Worker too. The Worker is asked on every exchange, so no secret is shared.
 */
import type { Express, NextFunction, Request, Response } from 'express';
import { authenticateUser, normalizePhone } from './googleSheetsBackendService.js';
import { signTenantToken } from './authToken.js';
import { createModuleGate } from './moduleGate.js';
import { createSourceReader } from './workerSource.js';

export const WORKER_API_URL = (process.env.WORKER_API_URL || 'https://tro-hub-api.trohub.workers.dev').replace(/\/+$/, '');

const readSource = createSourceReader(WORKER_API_URL);

/** Tiện ích gate for Express routes: re-reads the Worker's list (60 s cache) with the Worker bearer carried in the session. */
export const moduleGate = createModuleGate(WORKER_API_URL);

/**
 * Express routes that write to the Google Sheet (Apps Script) must not run once the Worker owns the data:
 * the Worker no longer reads the Sheet, so the write would be silently lost. A stale tab or an old Mini App
 * build gets 409 SOURCE_CHANGED instead. Fails open to the Sheet only when the source was never known.
 */
export async function sourceChangedGuard(_req: Request, res: Response, next: NextFunction) {
  if ((await readSource().catch(() => 'sheet')) !== 'worker') return next();
  const message = 'Hệ thống đã chuyển nguồn dữ liệu, hãy tải lại trang';
  res.status(409).json({ success: false, code: 'SOURCE_CHANGED', message, error: message });
}

interface WorkerViewer {
  kind: 'resident' | 'staff';
  id: number;
  name: string;
  phone: string | null;
  role?: 'developer' | 'owner' | 'manager';
  houseId?: string;
  houseIds?: string[];
  roomName?: string | null;
}

function staffOnlyProfile(viewer: WorkerViewer): Awaited<ReturnType<typeof authenticateUser>> {
  return {
    success: true,
    isAdmin: true,
    invoices: [],
    user: {
      name: viewer.name,
      phone: viewer.phone ?? '',
      cccd: '',
      email: '',
      dob: '',
      address: '',
      plateNumber: '',
      vehicleType: '',
      roomNumber: 'admin',
      personType: 'person1',
      emergencyName: '',
      emergencyRelation: '',
      emergencyPhone: '',
      rentPrice: 0,
      depositAmount: 0,
      totalMonthlyAmount: 0,
      isAdmin: true,
    },
  } as Awaited<ReturnType<typeof authenticateUser>>;
}

export function registerWorkerSession(app: Express) {
  app.post('/api/auth/worker-session', async (req, res) => {
    const bearer = String(req.headers.authorization || '');
    const me = await fetch(`${WORKER_API_URL}/api/me`, { headers: { Authorization: bearer } }).catch(() => null);
    const body = me?.ok ? await me.json().catch(() => null) : null;
    const viewer: WorkerViewer | undefined = body?.viewer;
    if (!viewer) {
      return res.status(401).json({ success: false, errorCode: 'AUTH_SESSION_EXPIRED', error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
    }
    if (!viewer.phone) {
      return res.status(403).json({ success: false, errorCode: 'AUTH_REJECTED', error: 'Tài khoản chưa có số điện thoại. Vui lòng liên hệ quản lý.' });
    }

    try {
      // The Worker already checked the password, so the sheet row is found by phone alone.
      // Staff created on the Worker (Admin Tổng, Admin căn) have no sheet row: their profile comes from the Worker.
      // With source 'worker' the Worker answers for everyone (residents and staff) and the Sheet is not read.
      let result: Awaited<ReturnType<typeof authenticateUser>>;
      if ((await readSource()) === 'worker') {
        // The Worker owns profiles and invoices: take them from it (same Bearer) instead of the Sheet.
        const session = await fetch(`${WORKER_API_URL}/api/tenant/session`, { headers: { Authorization: bearer } }).catch(() => null);
        const data = session?.ok ? await session.json().catch(() => null) : null;
        if (!data?.success || !data.user) {
          return res.status(502).json({ success: false, error: 'Không lấy được dữ liệu từ máy chủ. Vui lòng thử lại.' });
        }
        result = { success: true, user: data.user, invoices: data.invoices ?? [] } as typeof result;
      } else {
        result = await authenticateUser(viewer.phone, '', undefined, { verifiedPhone: true });
        if ((!result.success || !result.user) && viewer.kind === 'staff') result = staffOnlyProfile(viewer);
      }
      if (!result.success || !result.user) return res.status(401).json(result);

      const isAdmin = viewer.kind === 'staff';
      // Tiện ích the person's houses use (staff: union of their houses; resident: their house; Developer: all).
      // Without the list the token carries no claim and the modules stay open (see tokenAllowsModule).
      const modulesRes = await fetch(`${WORKER_API_URL}/api/modules`, { headers: { Authorization: bearer } }).catch(() => null);
      const modulesBody = modulesRes?.ok ? await modulesRes.json().catch(() => null) : null;
      const modules: string[] | undefined = Array.isArray(modulesBody?.modules) ? modulesBody.modules.map(String) : undefined;
      if (!modules) console.warn('[worker-session] modules list unavailable, token issued without a modules claim');
      const token = signTenantToken({
        phone: normalizePhone(result.user.phone) || viewer.phone,
        room: result.user.roomNumber,
        personType: result.user.personType,
        isAdmin,
        ...(modules ? { modules } : {}),
        wt: bearer.replace(/^Bearer\s+/i, '').trim() || undefined,
      });
      res.json({
        ...result,
        isAdmin,
        token,
        modules,
        house: viewer.kind === 'staff'
          ? { role: viewer.role, houseIds: viewer.houseIds ?? [] }
          : { role: 'resident', houseIds: viewer.houseId ? [viewer.houseId] : [] },
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Lỗi xử lý đăng nhập' });
    }
  });
}
