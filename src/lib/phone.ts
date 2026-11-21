/**
 * Vietnamese phone numbers, same rule as `cloudflare/src/password.ts normalizePhone`:
 * digits only, `84` + 9 digits becomes `0` + 9 digits, exactly 9 digits gets a leading 0.
 */
export function normalizeVnPhone(input: string): string {
  let digits = String(input || '').replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length === 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 9) digits = `0${digits}`;
  return digits;
}

export const PHONE_PROBLEM_MESSAGE = 'Số điện thoại phải có 10 chữ số, bắt đầu bằng 0.';

/** `null` when the number that would be stored is valid, otherwise the message to show. */
export function phoneProblem(input: string): string | null {
  return /^0\d{9}$/.test(normalizeVnPhone(input)) ? null : PHONE_PROBLEM_MESSAGE;
}
