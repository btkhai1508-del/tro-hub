/** The 34 provinces and their wards since the July 2025 merger. Districts no longer exist. */
export interface VnProvince {
  n: string;
  w: string[];
}

export interface AddressParts {
  province: string;
  ward: string;
  detail: string;
}

export const loadProvinces = async (): Promise<VnProvince[]> => (await import('./vnAddresses.json')).default;

const normalize = (text: string) => text
  .normalize('NFC')
  .toLowerCase()
  .replace(/^(thành phố|tỉnh|tp\.?|phường|xã|đặc khu|p\.|x\.)\s*/, '')
  .trim();

/** Column G holds one text cell, so the parts are joined back into it. */
export const joinAddress = ({ province, ward, detail }: AddressParts) =>
  [detail.trim(), ward, province].filter(Boolean).join(', ');

/** Anything that does not match the current list, like an old district or merged province, stays in the free text. */
export function splitAddress(text: string, provinces: VnProvince[]): AddressParts {
  const segments = String(text || '').split(',').map(part => part.trim()).filter(Boolean);
  const province = provinces.find(item => normalize(item.n) === normalize(segments[segments.length - 1] || ''));
  if (!province) return { province: '', ward: '', detail: segments.join(', ') };
  const rest = segments.slice(0, -1);
  const ward = province.w.find(item => normalize(item) === normalize(rest[rest.length - 1] || ''));
  return { province: province.n, ward: ward || '', detail: (ward ? rest.slice(0, -1) : rest).join(', ') };
}

// Full names need a space after them; short forms may be written with or without one ("P.Linh Trung", "TP. Thủ Đức", "Q1").
const ADMIN_UNIT = /^(?:(?:phường|xã|thị trấn|quận|huyện|thị xã|thành phố|tỉnh|đặc khu)(?:\s+|$)|(?:tp|tx|tt|p|q|x|h)\.\s*|(?:tp|tx|tt)\s+|[pq](?=\d+$))/i;
// Units above a ward that no longer exist; any of them left in the text marks the address as pre-merger.
const DISTRICT_UNIT = /^(?:(?:quận|huyện|thị xã|thành phố)\s+|(?:q|h|tx|tp)\.\s*|(?:tx|tp)\s+|q(?=\d+$))/i;
const WARD_UNIT = /^(?:phường|xã|đặc khu|p\.|x\.)/i;
const PROVINCE_ALIASES: Record<string, string> = { hcm: 'hồ chí minh', 'tp.hcm': 'hồ chí minh', tphcm: 'hồ chí minh', 'tp hcm': 'hồ chí minh', hn: 'hà nội' };
const WARD_PREFIX: Record<string, string> = { P: 'Phường', X: 'Xã', D: 'Đặc khu' };

/** New-style CCCDs, printed from the merger on, already show the new ward and province. */
const MERGER_DATE = '2025-07-01';

const legacyKey = (text: string) => {
  const key = text.normalize('NFC').toLowerCase().trim().replace(ADMIN_UNIT, '').trim();
  return PROVINCE_ALIASES[text.toLowerCase().trim()] || PROVINCE_ALIASES[key] || key;
};

/** The house, street and neighbourhood only: wards and districts have their own fields or are gone. */
const dropUnits = (parts: string[]) => parts.map(part => part.trim()).filter(part => part && !ADMIN_UNIT.test(part));

/** "ddmmyyyy" from the CCCD QR or "dd/mm/yyyy" as "yyyy-mm-dd", so dates compare as text. */
const isoDate = (value: string) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(4)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}` : '';
};

type LegacyProvinces = Record<string, { p: string; d: Record<string, Record<string, string>> }>;

/**
 * Turns a CCCD address, written with districts and the old provinces, into "detail, ward, province"
 * on the current map. The text keeps only the house, street and neighbourhood; the ward has its own
 * field. An old ward that was split between new wards, or is missing from the list, gives no ward,
 * because the address alone cannot tell which one it became, so the resident picks it.
 */
export async function convertScannedAddress(text: string): Promise<string> {
  const segments = String(text || '').split(',').map(part => part.trim()).filter(Boolean);
  if (!segments.length) return '';
  const [provinces, legacy] = await Promise.all([
    loadProvinces(),
    import('./vnLegacyAddresses.json').then(module => module.default as LegacyProvinces),
  ]);
  const last = segments[segments.length - 1];
  const oldProvince = legacy[legacyKey(last)];
  const current = provinces.find(item => normalize(item.n) === normalize(last)) || provinces.find(item => item.n === oldProvince?.p);
  if (!current) return segments.join(', ');

  const rest = segments.slice(0, -1);
  const units: string[] = [];
  while (rest.length && ADMIN_UNIT.test(rest[rest.length - 1])) units.unshift(rest.pop()!);
  // Written without any "Phường"/"Quận": take the last two parts only if they are a real old ward and district.
  if (!units.length && rest.length >= 2 && oldProvince?.d[legacyKey(rest[rest.length - 1])]?.[legacyKey(rest[rest.length - 2])] !== undefined) {
    units.push(...rest.splice(-2));
  }

  const wardText = units[0] || '';
  const districtKey = units.length > 1 ? legacyKey(units[units.length - 1]) : '';
  const wardKey = legacyKey(wardText);
  const district = oldProvince?.d[districtKey];
  let code = district?.[wardKey];
  if (code === undefined && !district && oldProvince) {
    // No usable district: trust the old ward only if its name is unique in the province.
    const matches = Object.values(oldProvince.d).map(wards => wards[wardKey]).filter(value => value !== undefined);
    if (matches.length === 1) code = matches[0];
  }
  const mapped = code ? `${WARD_PREFIX[code[0]]} ${code.slice(2)}` : '';
  const sameName = code === undefined ? current.w.find(item => normalize(item) === normalize(wardText)) : '';
  const ward = current.w.includes(mapped) ? mapped : sameName || '';
  return joinAddress({ detail: dropUnits(rest).join(', '), ward, province: current.n });
}

/**
 * Puts an address on the current map, from a CCCD scan (with its issue date) or a saved profile.
 * A card issued before the merger always has the old address, so it is converted; one issued since
 * already has the new address and is kept as written. Without a date the address is old when a
 * district (Quận, Huyện, TP. Thủ Đức...) is still in it or the new ward cannot be read from it.
 * Either way a stray "P. ..." is dropped from the house and street text.
 */
export async function toCurrentAddress(text: string, issuedOn = ''): Promise<string> {
  const parts = splitAddress(text, await loadProvinces());
  const segments = String(text || '').split(',').map(part => part.trim()).filter(Boolean);
  const issued = isoDate(issuedOn);
  const wardSegment = segments[segments.length - 2] || '';
  const wardWritten = WARD_UNIT.test(wardSegment) && normalize(wardSegment) === normalize(parts.ward);
  const districtLeft = segments.slice(0, -1).some(part => DISTRICT_UNIT.test(part));
  const isNew = issued ? issued >= MERGER_DATE : Boolean(parts.province && parts.ward && wardWritten && !districtLeft);
  // A province written short ("TP.HCM") is read through the old-name list, which also finds new wards by name.
  if (!isNew || !parts.province) return convertScannedAddress(text);
  return joinAddress({ ...parts, detail: dropUnits(parts.detail.split(',')).join(', ') });
}
