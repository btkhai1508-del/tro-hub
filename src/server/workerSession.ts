/**
 * Bridge while the app moves to Cloudflare: login happens on the Worker, which knows each
 * person's house, room and lock status. The app then trades the Worker token here for the
 * usual session, so every Express route keeps working on the Google Sheet data until it
 * moves to the Worker too. The Worker is asked on every exchange, so no secret is shared.
 */
import type { Express } from 'express';
import { authenticateUser, normalizePhone } from './googleSheetsBackendService.js';
import { signTenantToken } from './authToken.js';

export const WORKER_API_URL = (process.env.WORKER_API_URL || 'https://tro-hub-api.trohub.workers.dev').replace(/\/+$/, '');

interface WorkerViewer {
  kind: 'resident' | 'staff';
  id: number;
  name: string;
  phone: string | null;
  role?: 'owner' | 'manager';
  houseId?: string;
  houseIds?: string[];
  roomName?: string | null;
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
      const result = await authenticateUser(viewer.phone, '', undefined, { verifiedPhone: true });
      if (!result.success || !result.user) return res.status(401).json(result);

      const isAdmin = viewer.kind === 'staff';
      const token = signTenantToken({
        phone: normalizePhone(result.user.phone) || viewer.phone,
        room: result.user.roomNumber,
        personType: result.user.personType,
        isAdmin,
      });
      res.json({
        ...result,
        isAdmin,
        token,
        house: viewer.kind === 'staff'
          ? { role: viewer.role, houseIds: viewer.houseIds ?? [] }
          : { role: 'resident', houseIds: viewer.houseId ? [viewer.houseId] : [] },
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Lỗi xử lý đăng nhập' });
    }
  });
}
