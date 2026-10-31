import type { Invoice, InvoiceDetailItem, UserProfile } from '../../context/AppContext';
import { houseFromRoom } from '../houses';
import type { Measurer } from './engine';
import { buildContract, buildCt01, Person } from './legalForms';
import { buildInvoiceNotice, buildPaymentHistory } from './stateFormat';

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

export function residentInvoice(m: Measurer, profile: UserProfile, invoice: Invoice, invoices: Invoice[]) {
  const room = profile.room?.roomNumber;
  const previousDebt = invoices
    .filter(item => item.status !== 'paid' && monthValue(item.month) < monthValue(invoice.month))
    .reduce((sum, item) => sum + (item.total || 0), 0);
  return buildInvoiceNotice(m, {
    invoice,
    house: houseFromRoom(room),
    room,
    tenantName: profile.name,
    tenantCccd: profile.cccd,
    previousDebt,
  });
}

const roomIsPaid = (status: string) => (status === 'paid' ? 'paid' : status === 'pending' ? 'pending' : 'unpaid');

/** The same notice a resident downloads, rebuilt from the admin's row for that room and month. */
export function roomInvoice(m: Measurer, room: any, month: string) {
  const details: InvoiceDetailItem[] = [
    { name: 'Tiền thuê phòng', amount: room.tienPhong || 0, type: 'room' },
    { name: 'Tiền điện', amount: room.tienDien || 0, type: 'electricity', metric: `${room.dienUsed || 0} kWh (${room.dienCu || 0} - ${room.dienMoi || 0})` },
    { name: 'Tiền nước sinh hoạt', amount: room.tienNuoc || 0, type: 'water', metric: `${room.nuocUsed || 0} m³ (${room.nuocCu || 0} - ${room.nuocMoi || 0})` },
    { name: 'Internet cáp quang', amount: room.tienNet || 0, type: 'internet' },
    { name: 'Tiền rác & dịch vụ', amount: room.tienRac || 0, type: 'service' },
    { name: 'Phí giữ phương tiện', amount: room.tienXe || 0, type: 'parking' },
  ];
  if (room.tienKhac) details.push({ name: 'Khoản khác / giảm trừ', amount: room.tienKhac, type: 'service' });
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
