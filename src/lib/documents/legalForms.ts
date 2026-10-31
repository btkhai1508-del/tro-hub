/**
 * The contract and form CT01, drawn at the coordinates of the supplied PDF templates.
 * Only blanks change: a known value replaces its blank in bold and an unknown one keeps the printed dots.
 */
import type { HouseInfo } from '../houses';
import { BuiltDocument, citizenId, f, Measurer, PageWriter, Run, sup, t } from './engine';

export interface Person {
  name?: string;
  dob?: string;
  gender?: string;
  cccd?: string;
  address?: string;
  phone?: string;
  email?: string;
  relation?: string;
}

export interface ContractData {
  house: HouseInfo;
  room?: string;
  date?: string;
  termMonths?: string;
  tenants: Person[];
}

const roomLabel = (room?: string) => (room || '').replace(/^P\.\s*/i, '').trim();
const birthYear = (dob?: string) => (dob || '').match(/\d{4}/)?.[0] || '';
const safeName = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');

const SIGNATURE_GAP = 72;

export function buildContract(m: Measurer, data: ContractData): BuiltDocument {
  const w = new PageWriter(m);
  const { house } = data;
  const S = 13.92;
  const L = 56.6;
  const R = 552.7;
  const LH = 16.08;

  w.span(169.1, 440.3, 26.2, 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', 12.96, 'bold');
  w.span(220.1, 389.4, 41, 'Độc Lập – Tự do – Hạnh Phúc', 12.96, 'bold');
  w.line(213.8, 45.4, 393.8, 45.4, 0.75);
  w.span(119.8, 489.6, 74.2, 'HỢP ĐỒNG THUÊ/MƯỢN/Ở NHỜ NHÀ, PHÒNG TRỌ', 15.12, 'bold');

  const [day, month, year] = (data.date || '').split('/');
  w.at(165.8, 106.6, [t('Hôm nay, ngày '), f(day, '......'), t(' tháng '), f(month, '........'), t(' năm 20'), f(year?.slice(-2), '......')], S);
  w.flow([t('Tại căn nhà số: '), f(house.houseNumber, '......................................'), t(' Đường '), f(house.street, '.........................'), t(', Khu phố '), f(house.quarter, '…....'), t(', ')], { x: L, right: R, y: 122.6, lineHeight: 0, size: S, align: 'center' });
  w.flow([t('phường '), f(house.ward, '….….……………'), t(', TP. Hồ Chí Minh')], { x: L, right: R, y: 138.7, lineHeight: 0, size: S, align: 'center' });

  let y = 170.9;
  w.span(L, 520, y, 'I/ BÊN CHO THUÊ/MƯỢN/Ở NHỜ NHÀ, PHÒNG TRỌ: (Gọi tắt là bên A):', S, 'bold');
  y += LH;

  const para = { x: L, right: R, lineHeight: LH, size: S, align: 'justify' as const };
  const landlords = [{ name: house.landlord, dob: house.landlordDob, cccd: house.landlordCccd }, {} as Person];
  landlords.forEach((person, index) => {
    y = w.flow([t(`${index + 1}. Ông/bà: `), f(person.name, '.......................................'), t(', Sinh năm: '), f(birthYear(person.dob), '.............'), t(', Số CCCD: '), f(person.cccd, '................................')], { ...para, y });
    y = w.flow([t('Nơi đăng ký thường trú: '), f(undefined, '......................'), t(' Đường '), f(undefined, '...................'), t(', Khu phố '), f(undefined, '.............'), t(', Phường '), f(undefined, '....................'), t(', Tỉnh (TP): '), f(undefined, '.........................................................................')], { ...para, y });
  });
  y = w.flow([t('Là chủ sở hữu căn nhà tại địa chỉ số: '), f(house.houseNumber, '............'), t(' Đường '), f(house.street, '...............'), t(', Khu phố '), f(house.quarter, '......'), t(', Phường '), f(house.ward, '….……………'), t(', TP. Hồ Chí Minh.')], { ...para, y });

  w.span(L, 489.3, y, 'II/ BÊN THUÊ/MƯỢN/Ở NHỜ NHÀ, PHÒNG TRỌ: (Gọi tắt là bên B):', S, 'bold');
  y += LH;
  for (let i = 0; i < 5; i += 1) {
    const person = data.tenants[i] || {};
    y = w.flow([t(`${i + 1}. Ông/bà:     `), f(person.name, '..............................'), t(' Sinh năm:  '), f(birthYear(person.dob), '........'), t('  Số CCCD/ĐDCN: '), f(citizenId(person.cccd), '.............................')], { ...para, y });
    y = w.flow([t('Nơi đăng ký thường trú: '), f(person.address, '.....................................................................................................')], { ...para, y });
  }

  w.span(160, 449.3, y, 'Sau khi thỏa thuận, hai bên thống nhất như sau:', S, 'bold');
  y += LH;
  const indent = { ...para, firstX: 84.6 };
  y = w.flow([t('Bên A đồng ý cho bên B được thuê/mượn/ở nhờ nhà, phòng trọ số '), f(roomLabel(data.room), '................'), t(' tại căn nhà số nhà '), f(house.houseNumber, '.............'), t(' Đường '), f(house.street, '..................'), t(', Khu phố '), f(house.quarter, '.........'), t(', Phường '), f(house.ward, '….……………'), t(', TP. Hồ Chí Minh')], { ...indent, y });
  y = w.flow([t('Thời hạn thuê (mượn, ở nhờ nhà): '), f(data.termMonths, '_ _'), t(' tháng kể từ ngày ký họp đồng')], { ...indent, y });
  y = w.flow([t('Bên B chỉ được quyền ở và đăng ký tạm trú vào địa chỉ nhà bên A, bên B không được tranh chấp nhà, yêu cầu gì về tài sản của bên A.')], { ...indent, y });
  y = w.flow([t('Hợp đồng này được lập thành 02 bản có giá trị như nhau mỗi bên giữ 01 bản./.')], { ...indent, y });

  y += LH;
  w.text(96.2, y, 'BÊN CHO/MƯỢN/Ở NHỜ', S, 'bold');
  w.text(345.7, y, 'BÊN THUÊ/MƯỢN/Ở NHỜ', S, 'bold');
  y += LH;
  w.text(117.9, y, 'NHÀ/PHÒNG TRỌ', S, 'bold');
  w.text(371.3, y, 'NHÀ/PHÒNG TRỌ', S, 'bold');
  y += LH;
  w.text(115.8, y, '(Ký tên, ghi rõ họ tên)', S, 'italic');
  w.text(369.2, y, '(Ký tên, ghi rõ họ tên)', S, 'italic');

  // The gap between the note and the name is where each side signs on the printed copy.
  y += SIGNATURE_GAP;
  const signerCx = (x: number) => x + m.width('(Ký tên, ghi rõ họ tên)', 'italic', S) / 2;
  if (house.landlord) w.center(signerCx(115.8), y, house.landlord, S, 'bold');
  if (data.tenants[0]?.name) w.center(signerCx(369.2), y, data.tenants[0].name, S, 'bold');

  return { title: 'Hợp đồng thuê phòng trọ', fileName: `Hop_dong_${safeName(roomLabel(data.room) || 'mau')}.pdf`, pages: w.pages };
}

export interface Ct01Data {
  house: HouseInfo;
  room?: string;
  declarant: Person;
  members?: Person[];
}

function digitBoxes(w: PageWriter, m: Measurer, left: number, step: number, top: number, bottom: number, value: string | undefined) {
  const digits = citizenId(value);
  for (let i = 0; i <= 12; i += 1) w.line(left + step * i, top, left + step * i, bottom, 0.48);
  w.line(left, top, left + step * 12, top, 0.48);
  w.line(left, bottom, left + step * 12, bottom, 0.48);
  digits.split('').forEach((digit, i) => {
    w.center(left + step * i + step / 2, (top + bottom) / 2 + 4.2, digit, 12, 'bold');
  });
  return m;
}

const PAIR_LINE = 19.5;

export function buildCt01(m: Measurer, data: Ct01Data): BuiltDocument {
  const w = new PageWriter(m);
  const { house, declarant } = data;
  const S = 12.96;

  w.span(155.2, 482.5, 68.6, 'Mẫu CT01 ban hành kèm theo Thông tư số 116/2026/TT-BCA', S);
  w.span(179.7, 458, 83.8, 'ngày 29 tháng 6 năm 2026 của Bộ trưởng Bộ Công an', S);
  w.span(178.8, 460.6, 113.3, 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', 13.92, 'bold');
  w.span(234.9, 402.8, 129.4, 'Độc lập – Tự do – Hạnh phúc', 13.92, 'bold');
  w.line(237.3, 135.3, 386.8, 135.3, 0.48);
  w.span(190.3, 447.4, 162.5, 'TỜ KHAI THAY ĐỔI THÔNG TIN CƯ TRÚ', S, 'bold');

  w.span(113.3, 156.5, 185.8, 'Kính gửi', S);
  w.at(156.5, 185.8, [sup('(1)', 8.4), t(': '), f(house.ward ? `Công an phường ${house.ward}, TP. Hồ Chí Minh` : '', '......................................................................................................', S)], S);
  w.span(85, 191.5, 208.8, '1. Họ, chữ đệm và tên', S);
  w.at(191.5, 208.8, [t(': ', 'normal', 12), f(declarant.name, '.........................................................................................................', S)], S);

  const [day, month, year] = (declarant.dob || '').split('/');
  w.span(85, 208.9, 229.7, '2. Ngày, tháng, năm sinh:', S);
  w.at(208.9, 229.7, [f(day, '.................', S, 12), t('/', 'normal', 12), f(month, '..................', S, 12), t(year ? '/' : '/ ', 'normal', 12), f(year, '.............................', S, 12)], S);
  w.span(428.4, 486.8, 229.7, '3. Giới tính:', S);
  w.at(486.8, 229.7, [t(' ', 'normal', 12), f(declarant.gender, '................', S, 12)], S);

  w.span(85, 206.9, 256.1, '4. Số định danh cá nhân:', S);
  digitBoxes(w, m, 253.45, 22.1, 238.55, 264, declarant.cccd);

  // Two items share a line while they fit; otherwise the second drops to its own line.
  const pair = (y: number, leftRuns: Run[], rightX: number, rightRuns: Run[]) => {
    const collide = 85 + w.measure(leftRuns, S) + 6 > rightX || rightX + w.measure(rightRuns, S) > 546.45;
    w.at(85, y, leftRuns, S);
    if (collide) {
      w.dy += PAIR_LINE;
      w.at(85, y, rightRuns, S);
    } else {
      w.at(rightX, y, rightRuns, S);
    }
  };
  pair(282.5,
    [t('5. Số điện thoại liên hệ'), t(': ', 'normal', 12), declarant.phone ? f(declarant.phone, '') : t('...................................................', 'normal', 12)],
    365, [t('6. Email'), t(': ', 'normal', 12), f(declarant.email, '...........................................', S, 12)]);
  // The person declaring registers as head of their own household in the rented room.
  pair(303.6,
    [t('7. Họ, chữ đệm và tên chủ hộ'), sup('(2)', 8.4), t(': ', 'normal', 12), f(declarant.name, '.................................', 12, 12)],
    352.2, [t('8. Mối quan hệ với chủ hộ: '), f(declarant.name ? 'Chủ hộ' : undefined, '..................', 12, 12)]);

  w.span(85, 263.3, 330, '9. Số định danh cá nhân của chủ hộ:', S);
  digitBoxes(w, m, 284.85, 20.6, 312.45, 338.85, declarant.cccd);

  const room = roomLabel(data.room);
  const request = room ? `Đăng ký tạm trú tại ${house.name}, ${house.address}.` : '';
  const dotsLine = '.'.repeat(145);
  const firstDots = '.'.repeat(126);
  if (request) {
    const end = w.flow([t('10. Nội dung đề nghị'), sup('(3)', 8.4), t(': ', 'normal', 12), t(request, 'bold')], { x: 85, right: 538, y: 354.2, lineHeight: 19.5, size: S });
    if (end <= 373.7) w.text(85, 373.7, dotsLine, 9.12);
  } else {
    w.at(85, 354.2, [t('10. Nội dung đề nghị'), sup('(3)', 8.4), t(':', 'normal', 12), t(' ', 'normal', 9.12), t(firstDots, 'normal', 9.12)], S);
    w.text(85, 373.7, dotsLine, 9.12);
  }

  w.text(85, 395.8, '11. Những thành viên trong hộ gia đình cùng thay đổi:', S);

  const cols = [91.45, 114, 246.95, 324.25, 361.95, 469.45, 546.45];
  const rows = [467.2, 487.4, 507.8, 528, 548.4, 568.5, 588.9, 609.3, 629.5];
  const top = 408.25;
  const head = 446.85;
  const bottom = rows[rows.length - 1];
  cols.forEach(x => w.line(x, top, x, bottom, 0.48));
  w.line(cols[0], top, cols[6], top, 0.48);
  w.line(cols[0], head, cols[6], head, 0.48);
  rows.forEach(y => w.line(cols[0], y, cols[6], y, 0.48, [0.5, 0.5]));

  const B = 11.04;
  w.text(96.8, 430.8, 'TT', 9.12, 'bold');
  w.text(151.6, 425, 'Họ, chữ đệm', B, 'bold');
  w.text(167, 437.8, 'và tên', B, 'bold');
  w.text(255.6, 425, 'Ngày, tháng,', B, 'bold');
  w.text(263.9, 437.8, 'năm sinh', B, 'bold');
  w.text(333, 425, 'Giới', B, 'bold');
  w.text(333.9, 437.8, 'tính', B, 'bold');
  w.text(385.6, 425, 'Số định danh', B, 'bold');
  w.text(397.8, 437.8, 'cá nhân', B, 'bold');
  w.text(479.3, 424.6, 'Mối quan hệ', B, 'bold');
  w.text(484.4, 437.3, 'với chủ hộ', B, 'bold');

  (data.members || []).slice(0, rows.length).forEach((person, i) => {
    const y = (i === 0 ? head : rows[i - 1]) + 14;
    w.center((cols[0] + cols[1]) / 2, y, String(i + 1), 11, 'bold');
    w.text(cols[1] + 3, y, person.name || '', 11, 'bold');
    w.center((cols[2] + cols[3]) / 2, y, person.dob || '', 11, 'bold');
    w.center((cols[3] + cols[4]) / 2, y, person.gender || '', 11, 'bold');
    w.center((cols[4] + cols[5]) / 2, y, citizenId(person.cccd), 11, 'bold');
    w.center((cols[5] + cols[6]) / 2, y, person.relation || '', 11, 'bold');
  });

  const dateLine = (x: number, a: string, tail: string, last: string, endX: number) => {
    w.text(x, 648, '...', 12);
    w.text(x + 9, 648, '..,ngày', B, 'italic');
    w.text(x + 38.7, 648, '...', 12);
    w.span(x + 47.7, endX, 648, a, B, 'italic');
    w.text(endX, 648, tail, 12);
    if (last) w.text(170.8, 648, last, B, 'italic');
  };
  dateLine(39.1, '....tháng....năm', '......', '.', 152.8);
  dateLine(189.1, '..tháng....năm', '...', '', 297.3);
  dateLine(329.8, '...tháng...năm', '...', '', 437.9);
  w.text(468, 648, '...', 12);
  w.span(477, 569.9, 648, '..,ngày....tháng...năm', B, 'italic');
  w.text(569.9, 648, '...', 12);

  const noteMark = (x: number, y: number, s: string) => w.text(x, y - 4.6, s, 6.96, 'bold');
  w.span(53.4, 157.4, 661, 'Ý KIẾN CỦA CHỦ HỘ', B, 'bold');
  noteMark(157.4, 661, '(4)');
  w.span(192.3, 315.6, 661, 'Ý KIẾN CỦA CHỦ SỞ HỮU', B, 'bold');
  w.span(208, 293.9, 673.7, 'CHỖ Ở HỢP PHÁP', B, 'bold');
  noteMark(293.9, 673.7, '(5)');
  w.span(336, 451, 661, 'Ý KIẾN CỦA CHA HOẶC', B, 'bold');
  w.span(334.7, 452.4, 673.7, 'MẸ  HOẶC NGƯỜI GIÁM', B, 'bold');
  w.span(382.6, 398.4, 686.4, 'HỘ', B, 'bold');
  noteMark(398.4, 686.4, '(6)');
  w.span(484.3, 564, 661, 'NGƯỜI KÊ KHAI', B, 'bold');
  noteMark(564, 661, '(7)');

  const signer = (x: number, name?: string, id?: string) => {
    w.span(x, x + 43, 758.9, '(8)  Họ và tên:', 7.92);
    w.at(x + 44.5, 758.9, [f(name, '……………………….…….', 7.92, 6.2)], 7.92);
    w.span(x, x + 15.8, 772.8, '(8) Số', 7.92);
    w.span(x + 16.9, x + 74, 772.3, 'định danh cá nhân:', 6.96);
    w.at(x + 75.5, 772.3, [f(id, '………………………', 7.92, 5.2)], 7.92);
  };
  signer(189.1, house.landlord, house.landlordCccd);
  signer(329.8);

  return { title: 'Tờ khai thay đổi thông tin cư trú (CT01)', fileName: `To_khai_CT01_${safeName(room || 'mau')}.pdf`, pages: w.pages };
}

