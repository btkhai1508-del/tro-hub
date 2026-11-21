/**
 * Input rules for a resident's phone and CCCD, shared by every route that writes them (staff create, staff edit,
 * the resident's own profile) so they cannot drift apart. Pure functions; the database checks (duplicates) stay in the routes.
 */
import { encryptText, hashCccd } from './cccd.ts';
import { normalizePhone } from './password.ts';

/** A Vietnamese mobile number as stored: 10 digits starting with 0. */
export const isLocalPhone = (phone: string): boolean => /^0\d{9}$/.test(phone);

/** The phone as it will be stored (`normalizePhone`), or null when that is not a valid 10-digit number. */
export function storablePhone(input: unknown): string | null {
  const phone = normalizePhone(String(input ?? ''));
  return isLocalPhone(phone) ? phone : null;
}

export const PHONE_INVALID_MESSAGE = 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng 0.';
export const CCCD_INVALID_MESSAGE = 'Số CCCD phải gồm 9 đến 12 chữ số.';
export const CCCD_TAKEN_MESSAGE = 'Số CCCD này đã được dùng cho một tài khoản khác.';

/** The CCCD as typed, without spaces; '' = not given ("not filled in", never "erase"). */
export const cleanCccd = (input: unknown): string => String(input ?? '').replace(/\s/g, '');

export const isCccd = (cccd: string): boolean => /^\d{9,12}$/.test(cccd);

/** The columns that hold a CCCD: encrypted, last 4 digits for display, and the hash used to find duplicates. */
export async function cccdColumns(cccd: string, key: string): Promise<{ cccd_enc: string; cccd_last4: string; cccd_hash: string }> {
  return { cccd_enc: await encryptText(cccd, key), cccd_last4: cccd.slice(-4), cccd_hash: await hashCccd(cccd, key) };
}
