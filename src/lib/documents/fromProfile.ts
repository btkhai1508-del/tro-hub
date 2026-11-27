import type { Invoice, InvoiceDetailItem, UserProfile } from '../../context/AppContext';
import { houseFromRoom } from '../houses';
import { meterDetail } from '../meterDetail';
import type { Measurer } from './engine';
import { buildContract, buildCt01, Person } from './legalForms';
import { buildInvoiceNotice, buildPaymentHistory, type InvoicePayment } from './stateFormat';

const personFromProfile = (profile: UserProfile): Person => ({
  name: profile.name,
  dob: profile.dob,
  gender: profile.gender,
  cccd: profile.cccd,
  address: profile.address,
  phone: profile.phone,
  email: profile.email,
  relation: 'Người thuê trọ',
});

export const residentDocKey = (profile: UserProfile) =>
  [profile.name, profile.dob, profile.gender, profile.cccd, profile.address, profile.phone, profile.email, profile.room?.roomNumber].join('|');

/** Co-tenants are not exposed to a resident session, so only their own line is filled. */
export function residentContract(m: Measurer, profile: UserProfile) {
  const room = profile.room?.roomNumber;
  return buildContract(m, { house: houseFromRoom(room), room, tenants: [personFromProfile(profile)] });
}

export function residentCt01(m: Measurer, profile: UserProfile) {
  const room = profile.room?.roomNumber;
  return buildCt01(m, { house: houseFromRoom(room), room, declarant: personFromProfile(profile) });
}

const monthValue = (month: string) => {
  const [m, y] = month.split('/').map(Number);
  return (y || 0) * 12 + (m || 0);
};

export function residentInvoice(m: Measurer, profile: UserProfile, invoice: Invoice, invoices: Invoice[], payment?: InvoicePayment | null) {
  const room = profile.room?.roomNumber;
  const previousDebt = invoice.previousDebt ?? invoices
    .filter(item => item.status !== 'paid' && monthValue(item.month) < monthValue(invoice.month))
    .reduce((sum, item) => sum + (item.total || 0), 0);
  return buildInvoiceNotice(m, {
    invoice,
    house: houseFromRoom(room),
    room,
    tenantName: profile.name,
    tenantCccd: profile.cccd,
    previousDebt,
    payment: payment ?? undefined,
  });
}

const roomIsPaid = (status: string) => (status === 'paid' ? 'paid' : status === 'pending' ? 'pending' : 'unpaid');

/** The same notice a resident downloads, rebuilt from the admin's row for that room and month. */
const vnd = (n: number) => Math.round(Number(n) || 0).toLocaleString('vi-VN');

/** Worker rows carry the invoice's own lines: the same "Chi tiết" text the resident and the public page show. */
function detailsFromLines(room: any): InvoiceDetailItem[] {
  const meter = (newR: number, oldR: number, l: any) =>
    newR > 0 && newR - oldR === Number(l.qty) ? `(${vnd(newR)} − ${vnd(oldR)}) × ${vnd(l.unitPrice)}` : `${vnd(l.qty)} × ${vnd(l.unitPrice)}`;
  return (room.lines as any[])
    .filter((l) => Number(l.amount) !== 0 || ['room', 'electricity', 'water'].includes(l.kind))
    .map((l): InvoiceDetailItem => {
      const amount = Number(l.amount) || 0;
      if (l.kind === 'room') return { name: l.name, amount, type: 'room' };
      if (l.kind === 'electricity') return { name: l.name, amount, type: 'electricity', metric: meter(Number(room.dienMoi) || 0, Number(room.dienCu) || 0, l) };
      if (l.kind === 'water') return { name: l.name, amount, type: 'water', metric: meter(Number(room.nuocMoi) || 0, Number(room.nuocCu) || 0, l) };
      if (l.kind === 'service') return { name: l.name, amount, type: 'service', metric: `${vnd(l.qty)} × ${vnd(l.unitPrice)}` };
      return { name: l.name, amount, type: 'service', ...(Number(l.qty) > 1 ? { metric: `${vnd(l.qty)} × ${vnd(l.unitPrice)}` } : {}) };
    });
}

/** Worker list rows: the Worker's own fee lines with their "Chi tiết" text (old Sheet invoices included). */
function detailsFromFeeLines(lines: any[]): InvoiceDetailItem[] {
  const type = (kind: string): InvoiceDetailItem['type'] => (kind === 'room' || kind === 'electricity' || kind === 'water' ? kind : 'service');
  return lines.map((l) => ({ name: l.name, amount: Number(l.amount) || 0, type: type(l.kind), ...(l.formula ? { metric: l.formula } : {}) }));
}

export function roomInvoice(m: Measurer, room: any, month: string, payment?: InvoicePayment | null) {
  const fromFee = Array.isArray(room.feeLines) && room.feeLines.length > 0;
  const fromLines = fromFee || (Array.isArray(room.lines) && room.lines.length > 0);
  const details: InvoiceDetailItem[] = fromFee ? detailsFromFeeLines(room.feeLines) : fromLines ? detailsFromLines(room) : [
    { name: 'Tiền thuê phòng', amount: room.tienPhong || 0, type: 'room' },
    { name: 'Tiền điện', amount: room.tienDien || 0, type: 'electricity', metric: meterDetail(room.dienCu || 0, room.dienMoi || 0, room.dienUsed || 0, room.tienDien || 0) },
    { name: 'Tiền nước sinh hoạt', amount: room.tienNuoc || 0, type: 'water', metric: meterDetail(room.nuocCu || 0, room.nuocMoi || 0, room.nuocUsed || 0, room.tienNuoc || 0) },
    { name: 'Internet cáp quang', amount: room.tienNet || 0, type: 'internet' },
    { name: 'Tiền rác & dịch vụ', amount: room.tienRac || 0, type: 'service' },
    { name: 'Phí giữ phương tiện', amount: room.tienXe || 0, type: 'parking' },
  ];
  if (!fromLines && room.tienKhac) details.push({ name: 'Khoản khác / giảm trừ', amount: room.tienKhac, type: 'service' });
  const invoice: Invoice = {
    id: `SHEET-${String(room.room).replace(/[^\w]/g, '')}-${month.replace(/[^\w]/g, '')}`,
    month,
    issueDate: `01/${month}`,
    dueDate: `05/${month}`,
    total: room.tongTien || 0,
    status: roomIsPaid(room.paymentStatus || room.status),
    details,
  };
  return buildInvoiceNotice(m, {
    invoice,
    house: houseFromRoom(room.room),
    room: room.room,
    tenantName: room.nguoi1 || room.name,
    tenantCccd: room.cccd1,
    payment: payment ?? undefined,
  });
}

export function residentHistory(m: Measurer, profile: UserProfile, invoices: Invoice[]) {
  const room = profile.room?.roomNumber;
  return buildPaymentHistory(m, {
    invoices,
    house: houseFromRoom(room),
    room,
    tenantName: profile.name,
    tenantCccd: profile.cccd,
    exportedAt: new Date(),
  });
}
