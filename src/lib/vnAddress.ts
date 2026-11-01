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
