/**
 * CCCD numbers, and other secrets kept in D1 such as the Google refresh token, are stored
 * encrypted (AES-256-GCM) with CCCD_KEY, a base64 32-byte secret.
 * cccd_hash is an HMAC of the number under the same key, so duplicates can be found
 * without decrypting. Losing CCCD_KEY means losing every stored CCCD: keep a copy offline.
 */
const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const aesKey = (keyB64: string) => crypto.subtle.importKey('raw', fromB64(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
const hmacKey = (keyB64: string) =>
  crypto.subtle.importKey('raw', fromB64(keyB64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

/** Returns "<iv>.<ciphertext>" in base64. */
export async function encryptText(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), new TextEncoder().encode(plain));
  return `${toB64(iv)}.${toB64(new Uint8Array(data))}`;
}

export async function decryptText(stored: string, keyB64: string): Promise<string> {
  const [iv, data] = stored.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await aesKey(keyB64), fromB64(data));
  return new TextDecoder().decode(plain);
}

export async function hashCccd(cccd: string, keyB64: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(keyB64), new TextEncoder().encode(`cccd:${cccd}`));
  return toB64(new Uint8Array(sig));
}
