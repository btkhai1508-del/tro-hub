/**
 * Invoices and statements in the administrative format of Nghị định 30/2020/NĐ-CP (Phụ lục I):
 * A4, margins top/bottom 20 mm, left 30 mm, right 15 mm, Times New Roman metrics, black.
 * Every page is portrait.
 */
import type { Invoice } from '../../context/AppContext';
import type { HouseInfo } from '../houses';
import { A4, BuiltDocument, citizenId, Measurer, PageWriter, t, f } from './engine';

const MM = 72 / 25.4;
const LEFT = 30 * MM;
const RIGHT = A4.width - 15 * MM;
const TOP = 20 * MM;
const BOTTOM = A4.height - 20 * MM;
const BODY = 14;
const LH = 16.5;
const PARA = 6;
const INDENT = 1.27 * 72 / 2.54;
const LEFT_COL_WIDTH = 60 * MM;
const fmt = (n: number) => Number(n || 0).toLocaleString('vi-VN');
const pad2 = (s: string | number) => String(s).padStart(2, '0');
const filled = (value: string | undefined, dots: string) => (value ? t(value) : f(undefined, dots));

function monthParts(month: string) {
  const [m = '', y = ''] = month.split('/');
  return { mm: pad2(m), yyyy: y };
}

/** Elements 1–4: issuing body with number on the left, national header with place and date on the right. */
function writeHeader(w: PageWriter, m: Measurer, house: HouseInfo, numberText: string, dateText: string, right = RIGHT) {
  const leftCx = LEFT + LEFT_COL_WIDTH / 2;
  const rightCx = (LEFT + LEFT_COL_WIDTH + right) / 2;
  let y = TOP + 12;

  w.center(rightCx, y, 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', 13, 'bold');
  w.center(leftCx, y, house.name, 13, 'bold');
  y += 16;

  const motto = 'Độc lập - Tự do - Hạnh phúc';
  w.center(rightCx, y, motto, 14, 'bold');
  const mottoWidth = m.width(motto, 'bold', 14);
  w.line(rightCx - mottoWidth / 2, y + 3, rightCx + mottoWidth / 2, y + 3, 0.5);

  const nameWidth = m.width(house.name, 'bold', 13);
  const rule = nameWidth * 0.45;
  w.line(leftCx - rule / 2, y - 10, leftCx + rule / 2, y - 10, 0.5);
  w.center(leftCx, y + 8, numberText, 13);

  y += 24;
  w.center(rightCx, y, dateText, 14, 'italic');
  return y + 30;
}

function writeTitle(w: PageWriter, m: Measurer, y: number, title: string, subtitle: string, right = RIGHT) {
  const cx = (LEFT + right) / 2;
  w.center(cx, y, title, 14, 'bold');
  y += LH;
  w.center(cx, y, subtitle, 14, 'bold');
  const rule = m.width(subtitle, 'bold', 14) * 0.45;
  w.line(cx - rule / 2, y + 5, cx + rule / 2, y + 5, 0.5);
  return y + LH + 12;
}

function writeSignatures(w: PageWriter, y: number, left: { title: string; note?: string; name?: string }, right: { title: string; note?: string; name?: string; signed?: boolean }, pageRight = RIGHT, gap = 64) {
  const leftCx = LEFT + (pageRight - LEFT) / 4;
  const rightCx = LEFT + ((pageRight - LEFT) * 3) / 4;
  w.center(leftCx, y, left.title, 14, 'bold');
  w.center(rightCx, y, right.title, 14, 'bold');
  y += LH;
  if (left.note) w.center(leftCx, y, left.note, 14, 'italic');
  if (right.note) w.center(rightCx, y, right.note, 14, 'italic');
  if (right.signed) w.center(rightCx, y + gap / 2, 'Đã ký', 14);
  y += gap;
  if (left.name) w.center(leftCx, y, left.name, 14, 'bold');
  if (right.name) w.center(rightCx, y, right.name, 14, 'bold');
}

export interface InvoiceDocData {
  invoice: Invoice;
  house: HouseInfo;
  room?: string;
  tenantName?: string;
  tenantCccd?: string;
  previousDebt?: number;
}

export const isDeposit = (item: { name: string }) => /đặt cọc/i.test(item.name);

export function buildInvoiceNotice(m: Measurer, data: InvoiceDocData): BuiltDocument {
  const w = new PageWriter(m);
  const { invoice, house } = data;
  const { mm, yyyy } = monthParts(invoice.month);
  const [d = '', mo = '', yr = ''] = (invoice.issueDate || '').split('/');
  const dateText = d && mo && yr
    ? `TP. Hồ Chí Minh, ngày ${pad2(d)} tháng ${pad2(mo)} năm ${yr}`
    : `TP. Hồ Chí Minh, ngày ..... tháng ${mm} năm ${yyyy}`;

  let y = writeHeader(w, m, house, `Số: ${mm}/TB-${house.abbreviation}`, dateText);
  y = writeTitle(w, m, y, 'THÔNG BÁO TIỀN PHÒNG TRỌ', `Tháng ${mm} năm ${yyyy}`);

  const room = (data.room || '').replace(/^P\.\s*/i, '');
  y = w.flow([t('Kính gửi: '), filled(data.tenantName, '...............................'), t('     CCCD số: '), filled(citizenId(data.tenantCccd), '.....................')], { x: LEFT, right: RIGHT, y, lineHeight: LH, size: BODY }) + PARA;
  y = w.flow([t('Ở phòng số: '), filled(room, '...............')], { x: LEFT, right: RIGHT, y, lineHeight: LH, size: BODY }) + PARA;
  y = w.flow([t(`Xin thông báo ông bà biết, tiền thuê phòng và các chi phí dịch vụ khác trong tháng ${mm} năm ${yyyy}. Cụ thể như sau:`)], { x: LEFT, firstX: LEFT + INDENT, right: RIGHT, y, lineHeight: LH, size: BODY, align: 'justify' }) + PARA;

  const cols = [LEFT, LEFT + 32, LEFT + 165, LEFT + 355, RIGHT];
  const T = 13;
  const rowH = 20;
  const deposit = invoice.details.find(isDeposit);
  // Column P of the sheet sums H:N, so reductions count and the deposit does not.
  const details = invoice.details.filter(item => !isDeposit(item) && (item.amount !== 0 || ['room', 'electricity', 'water'].includes(item.type)));
  const tableTop = y - 10;
  let rowTop = tableTop;
  const rowLine = (yy: number) => w.line(LEFT, yy, RIGHT, yy, 0.5);
  rowLine(rowTop);
  ['STT', 'Khoản', 'Chi tiết', 'Thành tiền'].forEach((label, i) => w.center((cols[i] + cols[i + 1]) / 2, rowTop + 14, label, T, 'bold'));
  rowTop += rowH;
  rowLine(rowTop);
  details.forEach((item, i) => {
    const base = rowTop + 14;
    w.center((cols[0] + cols[1]) / 2, base, String(i + 1), T);
    w.text(cols[1] + 4, base, item.name, T);
    if (item.metric) w.text(cols[2] + 4, base, item.metric, T);
    w.rightText(cols[4] - 4, base, fmt(item.amount), T);
    rowTop += rowH;
    rowLine(rowTop);
  });
  w.center((cols[2] + cols[3]) / 2, rowTop + 14, 'Tổng cộng:', T, 'bold');
  w.rightText(cols[4] - 4, rowTop + 14, fmt(invoice.total), T, 'bold');
  rowTop += rowH;
  rowLine(rowTop);
  cols.forEach(x => w.line(x, tableTop, x, rowTop, 0.5));

  y = rowTop + 20;
  const debt = data.previousDebt;
  const label = (text: string, value: string, bold = false) => {
    w.text(LEFT + (bold ? INDENT : 0), y, text, BODY, bold ? 'bold' : 'normal');
    w.rightText(LEFT + 330, y, value, BODY, bold ? 'bold' : 'normal');
    y += LH;
  };
  w.text(LEFT, y, 'Phần thanh toán:', BODY);
  w.line(LEFT, y + 2, LEFT + m.width('Phần thanh toán:', 'normal', BODY), y + 2, 0.5);
  y += LH;
  label('- Số tiền còn nợ tháng trước:', debt === undefined ? '..............' : fmt(debt));
  label('- Phải trả tháng này:', fmt(invoice.total));
  label('Tổng cộng:', debt === undefined ? '..............' : fmt(debt + invoice.total), true);
  w.text(LEFT, y, 'Chi tiết thanh toán:', BODY);
  y += LH;

  const lines: string[] = [];
  if (invoice.status === 'paid') {
    const via = invoice.paymentMethod === 'cash' ? 'tiền mặt' : 'chuyển khoản';
    lines.push(`Đã thanh toán${invoice.paidAt ? ` ngày ${invoice.paidAt}` : ''} bằng ${via}${invoice.transactionId ? `, mã giao dịch ${invoice.transactionId}` : ''}.`);
  } else if (invoice.status === 'pending') {
    lines.push('Đã ghi nhận giao dịch, đang chờ đối soát.');
  } else if (invoice.dueDate) {
    lines.push(`Hạn thanh toán: ${invoice.dueDate}.`);
  }
  if (deposit) lines.push(`Tiền đặt cọc đã giữ: ${fmt(deposit.amount)} đồng (không tính vào tổng).`);
  const dotted = Math.max(2, Math.min(3, Math.floor((BOTTOM - y - 118) / 17)));
  for (let i = 0; i < dotted; i += 1) {
    if (lines[i]) w.text(LEFT, y, lines[i], T);
    else w.line(LEFT, y, RIGHT, y, 0.5, [0.6, 1.6]);
    y += 17;
  }

  writeSignatures(w, y + 6,
    { title: 'NGƯỜI TRỌ', note: '(Ký, ghi rõ họ tên)', name: data.tenantName },
    { title: 'QUẢN LÝ NHÀ TRỌ', signed: true, name: house.landlord });

  return {
    title: `Thông báo tiền phòng trọ tháng ${mm}/${yyyy}`,
    fileName: `Thong_bao_tien_phong_${mm}_${yyyy}${room ? `_P${room.replace(/[^\p{L}\p{N}]+/gu, '')}` : ''}.pdf`,
    pages: w.pages,
  };
}

export interface HistoryDocData {
  invoices: Invoice[];
  house: HouseInfo;
  room?: string;
  tenantName?: string;
  tenantCccd?: string;
  exportedAt: Date;
}

const statusLabel = (status: string) => (status === 'paid' ? 'Đã nộp' : status === 'pending' ? 'Chờ duyệt' : 'Chưa nộp');

export function buildPaymentHistory(m: Measurer, data: HistoryDocData): BuiltDocument {
  const w = new PageWriter(m);
  const { exportedAt: now, house, invoices } = data;
  const dateText = `TP. Hồ Chí Minh, ngày ${pad2(now.getDate())} tháng ${pad2(now.getMonth() + 1)} năm ${now.getFullYear()}`;
  let y = writeHeader(w, m, house, `Số: ${pad2(now.getMonth() + 1)}/BK-${house.abbreviation}`, dateText);
  y = writeTitle(w, m, y, 'BẢNG KÊ', 'Lịch sử thanh toán tiền phòng trọ');

  const room = (data.room || '').replace(/^P\.\s*/i, '');
  y = w.flow([t('Người thuê: '), filled(data.tenantName, '...............................'), t('     Phòng: '), filled(room, '..........')], { x: LEFT, right: RIGHT, y, lineHeight: LH, size: BODY }) + PARA;

  const cols = [LEFT, LEFT + 34, LEFT + 120, LEFT + 270, LEFT + 370, RIGHT];
  const heads = ['STT', 'Kỳ', 'Tổng tiền', 'Trạng thái', 'Ngày nộp'];
  const T = 13;
  const rowH = 20;
  let top = y - 8;
  let sectionTop = top;

  const closeTable = () => cols.forEach(x => w.line(x, sectionTop, x, top, 0.5));
  const openTable = () => {
    w.line(LEFT, top, RIGHT, top, 0.5);
    heads.forEach((label, i) => w.center((cols[i] + cols[i + 1]) / 2, top + 14, label, T, 'bold'));
    top += rowH;
    w.line(LEFT, top, RIGHT, top, 0.5);
  };
  const newPage = () => {
    closeTable();
    w.addPage();
    w.center((LEFT + RIGHT) / 2, TOP, String(w.pages.length), 13);
    top = TOP + 16;
    sectionTop = top;
    openTable();
  };

  openTable();
  invoices.forEach((invoice, i) => {
    if (top + rowH > BOTTOM) newPage();
    const base = top + 14;
    w.center((cols[0] + cols[1]) / 2, base, String(i + 1), T);
    w.center((cols[1] + cols[2]) / 2, base, invoice.month, T);
    w.rightText(cols[3] - 4, base, fmt(invoice.total), T);
    w.center((cols[3] + cols[4]) / 2, base, statusLabel(invoice.status), T);
    w.center((cols[4] + cols[5]) / 2, base, invoice.status === 'paid' ? (invoice.paidAt || '').split(' ')[0] : '', T);
    top += rowH;
    w.line(LEFT, top, RIGHT, top, 0.5);
  });
  closeTable();

  const paid = invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + (i.total || 0), 0);
  const unpaid = invoices.filter(i => i.status !== 'paid').reduce((sum, i) => sum + (i.total || 0), 0);
  if (top + 150 > BOTTOM) {
    w.addPage();
    w.center((LEFT + RIGHT) / 2, TOP, String(w.pages.length), 13);
    top = TOP + 10;
  }
  y = top + 22;
  w.text(LEFT, y, `Đã thanh toán: ${fmt(paid)} đồng.`, BODY);
  y += LH;
  w.text(LEFT, y, `Còn phải thanh toán: ${fmt(unpaid)} đồng.`, BODY);
  writeSignatures(w, y + LH + 6,
    { title: 'NGƯỜI THUÊ', note: '(Ký, ghi rõ họ tên)', name: data.tenantName },
    { title: 'QUẢN LÝ NHÀ TRỌ', note: '(Ký, ghi rõ họ tên)', name: house.landlord });

  return { title: 'Bảng kê lịch sử thanh toán', fileName: `Bang_ke_thanh_toan_${now.getFullYear()}${pad2(now.getMonth() + 1)}.pdf`, pages: w.pages };
}

export interface DeclarationRow { date?: string; person?: string; amount?: number }

export interface DeclarationDocData {
  house: HouseInfo;
  month: string;
  rows: DeclarationRow[];
  sigDate?: string;
}

/** Sổ doanh thu mẫu S1a-HKD: columns A (ngày tháng), B (diễn giải) and 1 (số tiền). */
export function buildDeclaration(m: Measurer, data: DeclarationDocData): BuiltDocument {
  const w = new PageWriter(m);
  const { house, month } = data;
  const { mm, yyyy } = monthParts(month);
  const T = 13;
  const split = LEFT + (RIGHT - LEFT) * 0.58;
  const rightCx = (split + 8 + RIGHT) / 2;

  let y = TOP + 12;
  y = w.flow([t('HỘ, CÁ NHÂN KINH DOANH: ', 'bold'), t(house.name, 'bold')], { x: LEFT, right: split, y, lineHeight: 15, size: T });
  y = w.flow([t(`Địa chỉ: ${house.address}`)], { x: LEFT, right: split, y, lineHeight: 15, size: T });
  y = w.flow([t(`Mã số thuế: ${house.landlordCccd}`)], { x: LEFT, right: split, y, lineHeight: 15, size: T });
  let ry = TOP + 12;
  w.center(rightCx, ry, 'Mẫu số S1a-HKD', T, 'bold');
  ry += 15;
  ry = w.flow([t('(Kèm theo Thông tư số 152/2025/TT-BTC ngày 31 tháng 12 năm 2025 của Bộ trưởng Bộ Tài chính)', 'italic')], { x: split + 8, right: RIGHT, y: ry, lineHeight: 14, size: 12, align: 'center' });

  const cx = (LEFT + RIGHT) / 2;
  y = Math.max(y, ry) + 16;
  w.center(cx, y, 'SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ', BODY, 'bold');
  y += LH;
  y = w.flow([t(`Địa điểm kinh doanh: ${house.address}`)], { x: LEFT, right: RIGHT, y, lineHeight: LH, size: T, align: 'center' });
  w.center(cx, y, `Kỳ kê khai: Tháng ${mm} năm ${yyyy}`, T, 'bold');
  y += 12;

  const cols = [LEFT, LEFT + 88, RIGHT - 110, RIGHT];
  const rowH = 20;
  const rows = data.rows.filter(row => row.date || row.person || row.amount);
  const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const lastBottom = BOTTOM - 112;
  let top = y;
  let sectionTop = top;
  const closeTable = () => cols.forEach(x => w.line(x, sectionTop, x, top, 0.5));
  const openTable = () => {
    w.line(LEFT, top, RIGHT, top, 0.5);
    ['Ngày tháng', 'Diễn giải', 'Số tiền (VNĐ)'].forEach((label, i) => w.center((cols[i] + cols[i + 1]) / 2, top + 14, label, T, 'bold'));
    top += rowH;
    w.line(LEFT, top, RIGHT, top, 0.5);
    ['A', 'B', '1'].forEach((label, i) => w.center((cols[i] + cols[i + 1]) / 2, top + 14, label, T));
    top += rowH;
    w.line(LEFT, top, RIGHT, top, 0.5);
  };
  const newPage = () => {
    closeTable();
    w.addPage();
    w.center(cx, TOP, String(w.pages.length), T);
    top = TOP + 16;
    sectionTop = top;
    openTable();
  };
  openTable();
  const blanks = Math.max(0, 8 - rows.length);
  [...rows, ...Array.from({ length: blanks }, () => ({} as DeclarationRow))].forEach(row => {
    if (top + rowH > BOTTOM) newPage();
    if (row.date) w.center((cols[0] + cols[1]) / 2, top + 14, row.date, T);
    if (row.person) w.text(cols[1] + 4, top + 14, row.person, T);
    if (row.amount) w.rightText(cols[3] - 4, top + 14, fmt(Number(row.amount)), T);
    top += rowH;
    w.line(LEFT, top, RIGHT, top, 0.5);
  });
  if (top + rowH > lastBottom) newPage();
  w.center((cols[0] + cols[2]) / 2, top + 14, 'Tổng cộng', T, 'bold');
  w.rightText(cols[3] - 4, top + 14, fmt(total), T, 'bold');
  top += rowH;
  w.line(LEFT, top, RIGHT, top, 0.5);
  closeTable();

  const sigCx = LEFT + ((RIGHT - LEFT) * 3) / 4 - 20;
  y = top + 24;
  w.center(sigCx, y, data.sigDate || `Ngày ..... tháng ${mm} năm ${yyyy}`, BODY, 'italic');
  y += LH;
  w.center(sigCx, y, 'NGƯỜI ĐẠI DIỆN HỘ KINH DOANH/', T, 'bold');
  y += 15;
  w.center(sigCx, y, 'CÁ NHÂN KINH DOANH', T, 'bold');
  y += 15;
  w.center(sigCx, y, '(Ký, họ tên, đóng dấu)', T, 'italic');
  y += 56;
  w.center(sigCx, y, house.landlord, BODY, 'bold');

  return { title: `Sổ doanh thu S1a-HKD tháng ${mm}/${yyyy}`, fileName: `So_doanh_thu_S1a-HKD_${house.abbreviation}_${mm}_${yyyy}.pdf`, pages: w.pages };
}
