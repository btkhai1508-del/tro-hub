import { useEffect, useState } from 'react';
import { workerFetch } from '../../lib/api';

export interface AdminHouse { id: string; name: string }

/** Result of a Worker call: `error` is already a readable Vietnamese sentence. */
export interface WorkerResult<T = any> { ok: boolean; status: number; data: T | null; error: string }

const NETWORK_ERROR = 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.';

const HINTS: Record<string, string> = {
  INVOICE_LOCKED: 'Phòng này đã đóng tiền nên không sửa được. Hãy bỏ "đã đóng" ở tab Thu tiền trước.',
  INVOICE_FROZEN: 'Hoá đơn tháng cũ đã chốt, không sửa được.',
  METER_INVALID: 'Chỉ số mới không được nhỏ hơn chỉ số cũ.',
  HOUSE_REQUIRED: 'Hãy chọn nhà trọ.',
};

/** Calls a Worker admin route and turns any failure into a message the admin can read. */
export async function workerCall<T = any>(path: string, init: RequestInit = {}): Promise<WorkerResult<T>> {
  try {
    const res = await workerFetch(path, init);
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.success !== false) return { ok: true, status: res.status, data, error: '' };
    const code = String(data?.errorCode || '');
    const text = typeof data?.error === 'string' && data.error ? data.error : '';
    const fallback = res.status === 409 ? 'Dữ liệu đang bị khoá, chưa lưu được.' : 'Chưa lưu được. Vui lòng thử lại.';
    return { ok: false, status: res.status, data, error: text || HINTS[code] || fallback };
  } catch {
    return { ok: false, status: 0, data: null, error: NETWORK_ERROR };
  }
}

/** The houses the signed-in staff may manage, and the one currently chosen (the first by default). */
export function useAdminHouses() {
  const [houses, setHouses] = useState<AdminHouse[]>([]);
  const [houseId, setHouseId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    workerCall<{ houses: AdminHouse[] }>('/api/houses').then((r) => {
      if (!live) return;
      if (!r.ok) return setError(r.error);
      const list = (r.data?.houses ?? []).filter((h) => h && h.id);
      setHouses(list);
      setHouseId((cur) => cur || list[0]?.id || '');
    });
    return () => { live = false; };
  }, []);
  return { houses, houseId, setHouseId, error };
}

export const money = (n: number | null | undefined) => Number(n || 0).toLocaleString('vi-VN');
