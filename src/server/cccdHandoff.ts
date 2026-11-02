/**
 * Scan a CCCD with a phone and fill the form on a computer, whose webcam cannot read the dense code.
 * The computer opens a session and shows its link as a QR; the phone opens the link, scans the card
 * and posts what it read; the computer polls and takes it once. Sessions live only in memory, last
 * five minutes, and are deleted as soon as the computer has the result, so no CCCD data is stored.
 */
import crypto from 'crypto';
import type { Express } from 'express';
import { requireAuth, type AuthedRequest } from './authToken.js';

interface Handoff {
  owner: string;
  expires: number;
  data?: Record<string, string>;
}

const TTL_MS = 5 * 60 * 1000;
const FIELDS = ['cccd', 'name', 'dob', 'gender', 'address', 'issueDate'];
const EXPIRED = 'Mã đã hết hạn hoặc đã dùng. Hãy tạo mã mới trên máy tính.';
const handoffs = new Map<string, Handoff>();

function sweep() {
  const now = Date.now();
  for (const [id, handoff] of handoffs) if (handoff.expires < now) handoffs.delete(id);
}

export function registerCccdHandoff(app: Express) {
  // The computer opens a session; one open session per account.
  app.post('/api/cccd-handoff', requireAuth, (req: AuthedRequest, res) => {
    sweep();
    const owner = req.tenant!.phone;
    for (const [id, handoff] of handoffs) if (handoff.owner === owner) handoffs.delete(id);
    const id = crypto.randomBytes(18).toString('base64url');
    handoffs.set(id, { owner, expires: Date.now() + TTL_MS });
    res.json({ success: true, id, expiresIn: TTL_MS / 1000 });
  });

  // The computer polls; the result is handed over once and then forgotten.
  app.get('/api/cccd-handoff/:id', requireAuth, (req: AuthedRequest, res) => {
    const handoff = handoffs.get(req.params.id);
    if (!handoff || handoff.expires < Date.now() || handoff.owner !== req.tenant!.phone) {
      return res.status(404).json({ success: false, error: EXPIRED });
    }
    if (!handoff.data) return res.json({ success: true, status: 'waiting' });
    handoffs.delete(req.params.id);
    res.json({ success: true, status: 'done', data: handoff.data });
  });

  // The phone is not logged in: the unguessable session id in the link is what lets it post.
  app.post('/api/cccd-handoff/:id', (req, res) => {
    const handoff = handoffs.get(req.params.id);
    if (!handoff || handoff.expires < Date.now() || handoff.data) {
      return res.status(404).json({ success: false, error: EXPIRED });
    }
    const body = req.body || {};
    const data: Record<string, string> = {};
    for (const field of FIELDS) data[field] = String(body[field] ?? '').trim().slice(0, 300);
    if (!/^\d{12}$/.test(data.cccd) || !data.name) {
      return res.status(400).json({ success: false, error: 'Đây không phải thông tin từ QR trên CCCD.' });
    }
    handoff.data = data;
    res.json({ success: true });
  });
}
