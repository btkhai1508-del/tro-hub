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

const ADMIN_UNIT = /^(phường|xã|thị trấn|quận|huyện|thị xã|thành phố|tỉnh|tp\.?|p\.|q\.|x\.|h\.|tx\.?)(\s|$)/i;
const PROVINCE_ALIASES: Record<string, string> = { hcm: 'hồ chí minh', 'tp.hcm': 'hồ chí minh', tphcm: 'hồ chí minh', 'tp hcm': 'hồ chí minh', hn: 'hà nội' };
const WARD_PREFIX: Record<string, string> = { P: 'Phường', X: 'Xã', D: 'Đặc khu' };

const legacyKey = (text: string) => {
  const key = text.normalize('NFC').toLowerCase().trim()
    .replace(/^(thành phố|tp\.?|tỉnh|quận|q\.|huyện|h\.|thị xã|tx\.?|phường|p\.|xã|x\.|thị trấn)\s*/, '')
    .trim();
  return PROVINCE_ALIASES[text.toLowerCase().trim()] || PROVINCE_ALIASES[key] || key;
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
  return joinAddress({ detail: rest.join(', '), ward, province: current.n });
}

/**
 * A saved address already on the current map stays as it is; an old one is converted like a CCCD scan.
 * It counts as current only when the ward is written out in full ("Phường Thủ Đức", not the old
 * "Thành phố Thủ Đức" district) and no old ward or district is left in the text before it.
 */
export async function toCurrentAddress(text: string): Promise<string> {
  const parts = splitAddress(text, await loadProvinces());
  const segments = String(text || '').split(',').map(part => part.trim()).filter(Boolean);
  const wardWritten = segments[segments.length - 2]?.normalize('NFC').toLowerCase() === parts.ward.toLowerCase();
  const oldUnitLeft = parts.detail.split(',').some(part => ADMIN_UNIT.test(part.trim()));
  return parts.province && parts.ward && wardWritten && !oldUnitLeft ? text : convertScannedAddress(text);
}
