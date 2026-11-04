/**
 * HS256 JWT on Web Crypto. The token only says who the caller is; what they may see
 * (house, room, lock status) is read from D1 on every request, so changes apply at once.
 */
export interface TokenPayload {
  sub: number;
  kind: 'resident' | 'staff';
  iat: number;
  exp: number;
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const utf8 = (text: string) => new TextEncoder().encode(text);

function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signToken(sub: number, kind: TokenPayload['kind'], secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(utf8(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(utf8(JSON.stringify({ sub, kind, iat: now, exp: now + TOKEN_TTL_SECONDS })));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8(`${header}.${body}`));
  return `${header}.${body}.${b64url(new Uint8Array(signature))}`;
}

export async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  try {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return null;
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(signature), utf8(`${header}.${body}`));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as TokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
