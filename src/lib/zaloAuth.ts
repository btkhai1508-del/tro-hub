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
import { isZaloMiniApp } from './platform';

export interface ZaloLoginTokens {
  accessToken: string;
  phoneToken: string;
}

async function ensurePermissions(): Promise<void> {
  if (!isZaloMiniApp) {
    throw new Error('Tính năng đăng nhập Zalo 1-chạm chỉ hỗ trợ khi mở trong ứng dụng Zalo trên điện thoại.');
  }

  let granted: Record<string, boolean> = {};
  try {
    const setting: any = await getSetting({});
    granted = setting?.authSetting || {};
  } catch (err: any) {
    console.warn('[ZaloAuth] getSetting check warning:', err);
    if (err?.code === -2000) {
      throw new Error('Không thể kết nối Zalo runtime. Vui lòng mở ứng dụng trong Zalo.');
    }
  }

  const needed = ['scope.userInfo', 'scope.userPhonenumber'].filter(scope => !granted[scope]);
  if (needed.length === 0) return;

  try {
    const result: any = await authorize({ scopes: needed as any });
    if (result && result['scope.userPhonenumber'] === false) {
      throw new Error('Bạn cần cho phép Nhà Trọ Phong Lan truy cập số điện thoại Zalo để xác định phòng của bạn.');
    }
  } catch (err: any) {
    if (err?.code === -2000) {
      throw new Error('Tính năng đăng nhập Zalo chỉ hoạt động trên ứng dụng Zalo.');
    }
    throw err;
  }
}

export async function getZaloLoginTokens(): Promise<ZaloLoginTokens> {
  if (!isZaloMiniApp) {
    throw new Error('Đăng nhập Zalo chỉ hoạt động trên ứng dụng Zalo. Vui lòng sử dụng số điện thoại & mật khẩu.');
  }

  await ensurePermissions();

  let accessToken = '';
  try {
    accessToken = await getAccessToken({});
  } catch (err: any) {
    if (err?.code === -2000) {
      throw new Error('Không lấy được token Zalo từ trình duyệt ngoài.');
    }
    throw err;
  }

  if (!accessToken) {
    throw new Error('Không lấy được access token từ Zalo.');
  }

  let phoneToken = '';
  try {
    const phone: any = await getPhoneNumber({});
    phoneToken = phone?.token;
  } catch (err: any) {
    if (err?.code === -2000) {
      throw new Error('Không thể đọc số điện thoại Zalo trên trình duyệt.');
    }
    throw err;
  }

  if (!phoneToken) {
    throw new Error('Không lấy được số điện thoại Zalo. Vui lòng cấp quyền và thử lại.');
  }

  return { accessToken, phoneToken };
}

/** Calls the backend with Zalo tokens. Returns the raw JSON from /api/auth/zalo. */
export async function requestZaloLogin(sheetId?: string): Promise<any> {
  if (!isZaloMiniApp) {
    return {
      success: false,
      errorCode: 'AUTH_INVALID_CREDENTIALS',
      error: 'Tính năng đăng nhập Zalo 1-chạm chỉ khả dụng khi mở trong ứng dụng Zalo. Vui lòng đăng nhập bằng Số điện thoại bên dưới.'
    };
  }

  try {
    const tokens = await getZaloLoginTokens();
    const res = await apiFetch('/api/auth/zalo', {
      method: 'POST',
      body: JSON.stringify({ ...tokens, sheetId })
    });
    return await res.json().catch(() => ({ success: false, error: `Lỗi máy chủ (${res.status})` }));
  } catch (err: any) {
    return {
      success: false,
      errorCode: 'AUTH_INVALID_CREDENTIALS',
      error: err?.message || 'Lỗi xác thực Zalo'
    };
  }
}
