/**
 * What the resident app shows after login, built from the Worker's own data: the profile, the issued
 * invoices of the resident's room (newest first, last 12 months) and the same data in the shape the
 * Express `tenant-data` route answers with. Drafts (issued_at NULL) never appear here.
 */
import type { Context } from 'hono';
import { bankReceived, effectiveStatus, type InvoiceStatus } from '../central/deferred.ts';
import { paymentStatusOut, statusView, vnDate } from '../routes/rent.ts';
import { toSheetMonth } from '../sheetSync.ts';
import { tenantFor } from '../tenant/route.ts';
import type { App, Viewer } from '../app.ts';

type Resident = Extract<Viewer, { kind: 'resident' }>;

export interface InvoiceDetailOut { name: string; amount: number; type: 'room' | 'electricity' | 'water' | 'internet' | 'service' | 'parking'; metric?: string }
export interface InvoiceOut {
  id: string; month: string; issueDate: string; dueDate: string; total: number; status: 'unpaid' | 'paid' | 'pending';
  paidAt?: string; paymentMethod?: 'qr' | 'cash'; details: InvoiceDetailOut[];
}

interface LineRow { invoice_id: number; kind: string; name: string; qty: number; amount: number; sheet_col: string | null }

function detailOf(l: LineRow): InvoiceDetailOut {
  const base = { name: l.name, amount: l.amount };
  if (l.kind === 'room') return { ...base, type: 'room' };
  if (l.kind === 'electricity') return { ...base, type: 'electricity', metric: `${l.qty} số` };
  if (l.kind === 'water') return { ...base, type: 'water', metric: `${l.qty} khối` };
  if (l.kind === 'service') return { ...base, type: l.sheet_col === 'L' ? 'internet' : l.sheet_col === 'M' ? 'parking' : 'service' };
  return { ...base, type: 'service' };
}

const dmy = (iso: string) => iso.split('-').reverse().join('/');

/** Issued invoices of one room as the app's Invoice shape; the status goes through the same overlay as the payment-status API. */
export async function residentInvoices(c: Context<App>, viewer: Resident): Promise<InvoiceOut[]> {
  if (!viewer.roomId || !viewer.roomName) return [];
  const db = await tenantFor(c, viewer.houseId);
  const { results: rows } = await db
    .prepare(`SELECT id, house_id, month, total, status, paid_at, issued_at FROM invoices WHERE room_id = ? AND issued_at IS NOT NULL ORDER BY month DESC LIMIT 12`)
    .bind(viewer.roomId)
    .all<{ id: number; house_id: string; month: string; total: number; status: InvoiceStatus; paid_at: string | null; issued_at: string }>();
  if (!rows.length) return [];
  const { results: lines } = await db
    .prepare(
      `SELECT l.invoice_id, l.kind, l.name, l.qty, l.amount, s.sheet_col
         FROM invoice_lines l LEFT JOIN house_services s ON s.id = l.service_id
        WHERE l.invoice_id IN (${rows.map(() => '?').join(',')}) ORDER BY l.id`
    )
    .bind(...rows.map((r) => r.id))
    .all<LineRow>();

  const views = new Map<string, Awaited<ReturnType<typeof statusView>>>();
  const out: InvoiceOut[] = [];
  for (const r of rows) {
    if (!views.has(r.month)) views.set(r.month, await statusView(c.env.DB, db, [viewer.houseId], r.month));
    const status = await views.get(r.month)!({ id: r.id, house_id: r.house_id, room: viewer.roomName, total: r.total, status: r.status, issued_at: r.issued_at });
    const shown = paymentStatusOut(status, r.paid_at);
    const [year, month] = r.month.split('-');
    out.push({
      id: `INV-${r.id}`,
      month: toSheetMonth(r.month),
      issueDate: vnDate(r.issued_at),
      dueDate: `05/${month}/${year}`,
      total: r.total,
      status: shown.paymentStatus as InvoiceOut['status'],
      ...(shown.paymentMethod ? { paidAt: shown.label, paymentMethod: shown.paymentMethod as 'qr' | 'cash' } : {}),
      details: lines.filter((l) => l.invoice_id === r.id).map(detailOf),
    });
  }
  return out;
}

interface ProfileRow {
  full_name: string; phone: string | null; email: string | null; dob: string | null; gender: string | null; address_detail: string | null;
  plate_number: string | null; vehicle_type: string | null; emergency_name: string | null; emergency_relation: string | null;
  emergency_phone: string | null; move_in_date: string | null;
  room_name: string | null; room_price: number | null; room_deposit: number | null; floor: number | null; house_name: string;
}

/** The resident's profile in the shape of `AuthenticatedTenantUser` (plus gender and the legacy keys the Sheet profile had). */
export async function residentProfile(c: Context<App>, viewer: Resident, invoices: InvoiceOut[]) {
  const db = await tenantFor(c, viewer.houseId);
  const r = await db
    .prepare(
      `SELECT r.full_name, r.phone, r.email, r.dob, r.gender, r.address_detail, r.plate_number, r.vehicle_type, r.emergency_name, r.emergency_relation,
              r.emergency_phone, r.move_in_date, rm.name AS room_name, rm.price AS room_price, rm.deposit AS room_deposit, rm.floor, h.name AS house_name
         FROM residents r JOIN houses h ON h.id = r.house_id LEFT JOIN rooms rm ON rm.id = r.room_id
        WHERE r.id = ? AND r.deleted_at IS NULL`
    )
    .bind(viewer.id)
    .first<ProfileRow>();
  return {
    name: r?.full_name ?? viewer.name,
    phone: r?.phone ?? viewer.phone ?? '',
    cccd: '',
    email: r?.email ?? '',
    dob: r?.dob ?? '',
    gender: r?.gender ?? '',
    address: r?.address_detail ?? '',
    vehicleType: r?.vehicle_type || 'Xe máy',
    plateNumber: r?.plate_number ?? '',
    roomNumber: r?.room_name ?? '',
    building: r?.house_name ?? '',
    floor: r?.floor == null ? '' : String(r.floor),
    startDate: r?.move_in_date ?? '',
    personType: 'tenant' as const,
    emergencyName: r?.emergency_name ?? '',
    emergencyRelation: r?.emergency_relation ?? '',
    emergencyPhone: r?.emergency_phone ?? '',
    contractUrl: '',
    rentPrice: r?.room_price ?? 0,
    depositAmount: r?.room_deposit ?? 0,
    totalMonthlyAmount: invoices[0]?.total ?? 0,
  };
}

/** Staff have no room: the app only needs a name, the phone and the admin flag. */
export function staffProfile(viewer: Extract<Viewer, { kind: 'staff' }>) {
  return {
    name: viewer.name, phone: viewer.phone, cccd: '', email: '', dob: '', address: '', plateNumber: '', vehicleType: '',
    roomNumber: 'admin', personType: 'person1' as const, emergencyName: '', emergencyRelation: '', emergencyPhone: '',
    rentPrice: 0, depositAmount: 0, totalMonthlyAmount: 0, isAdmin: true,
  };
}

/** Same answer as Express /api/auth/worker-session minus the Express token. */
export async function tenantSession(c: Context<App>) {
  const viewer = c.get('viewer');
  if (viewer.kind === 'staff')
    return { success: true, user: staffProfile(viewer), invoices: [] as InvoiceOut[], isAdmin: true, house: { role: viewer.role, houseIds: viewer.houseIds } };
  const invoices = await residentInvoices(c, viewer);
  return { success: true, user: await residentProfile(c, viewer, invoices), invoices, isAdmin: false, house: { role: 'resident' as const, houseIds: [viewer.houseId] } };
}

/** Same answer as Express /api/sheets/tenant-data: profile and invoices of the caller. */
export async function tenantData(c: Context<App>) {
  const viewer = c.get('viewer');
  const session = await tenantSession(c);
  const count = viewer.kind === 'resident'
    ? ((await (await tenantFor(c, viewer.houseId)).prepare(`SELECT COUNT(*) AS n FROM residents WHERE house_id = ? AND status = 'approved' AND deleted_at IS NULL`).bind(viewer.houseId).first<{ n: number }>())?.n ?? 0)
    : 0;
  return { success: true, timestamp: new Date().toISOString(), profile: session.user, invoices: session.invoices, allResidentsCount: count, logsTransactionFound: false };
}
