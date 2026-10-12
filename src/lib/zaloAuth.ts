/**
 * Zalo Mini App login (frontend side).
 * Flow:
 *  1. authorize()        -> ask the user for userInfo + phone number permissions
 *  2. getAccessToken()   -> Zalo user access token
 *  3. getPhoneNumber()   -> one-time token that the server exchanges for the real phone number
 *  4. POST /api/auth/zalo -> server verifies with Zalo Open API, maps phone -> tenant, returns our JWT
 */
import { authorize, getAccessToken, getPhoneNumber, getSetting } from 'zmp-sdk/apis';
import { apiFetch } from './api';

export interface ZaloLoginTokens {
  accessToken: string;
  phoneToken: string;
}

async function ensurePermissions(): Promise<void> {
  let granted: Record<string, boolean> = {};
  try {
    const setting: any = await getSetting({});
    granted = setting?.authSetting || {};
  } catch {
    // getSetting not available on old Zalo versions -> just call authorize
  }

  const needed = ['scope.userInfo', 'scope.userPhonenumber'].filter(scope => !granted[scope]);
  if (needed.length === 0) return;

  const result: any = await authorize({ scopes: needed as any });
  if (result && result['scope.userPhonenumber'] === false) {
    throw new Error('Bạn cần cho phép EcoStay truy cập số điện thoại Zalo để xác định phòng của bạn.');
  }
}

export async function getZaloLoginTokens(): Promise<ZaloLoginTokens> {
  await ensurePermissions();

  const accessToken = await getAccessToken({});
  if (!accessToken) {
    throw new Error('Không lấy được access token từ Zalo.');
  }

  const phone: any = await getPhoneNumber({});
  const phoneToken = phone?.token;
  if (!phoneToken) {
    throw new Error('Không lấy được số điện thoại Zalo. Vui lòng cấp quyền và thử lại.');
  }

  return { accessToken, phoneToken };
}

/** Calls the backend with Zalo tokens. Returns the raw JSON from /api/auth/zalo. */
export async function requestZaloLogin(sheetId?: string): Promise<any> {
  const tokens = await getZaloLoginTokens();
  const res = await apiFetch('/api/auth/zalo', {
    method: 'POST',
    body: JSON.stringify({ ...tokens, sheetId })
  });
  return res.json().catch(() => ({ success: false, error: `Lỗi máy chủ (${res.status})` }));
}
