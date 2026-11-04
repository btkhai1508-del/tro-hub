import React, { useCallback, useEffect, useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { workerFetch } from '../lib/api';
import { cn } from '../lib/utils';

interface House { id: string; name: string }
interface Staff { id: number; full_name: string; phone: string; role: 'owner' | 'manager'; status: 'active' | 'locked'; house_ids: string[] }

/**
 * Admin Tổng's list of Admin căn, with lock and unlock. New ones are made in "Tạo tài khoản mới"
 * by picking the "Admin" room. The Worker checks every rule.
 */
export function ManagerAccounts() {
  const [houses, setHouses] = useState<House[]>([]);
  const [managers, setManagers] = useState<Staff[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [h, s] = await Promise.all([
      workerFetch('/api/houses').then((r) => r.json()).catch(() => null),
      workerFetch('/api/staff').then((r) => r.json()).catch(() => null),
    ]);
    setHouses(h?.houses ?? []);
    setManagers((s?.staff ?? []).filter((x: Staff) => x.role === 'manager'));
    if (!s?.success) setMessage({ ok: false, text: s?.error || 'Chưa tải được danh sách Admin căn.' });
  }, []);

  useEffect(() => { load(); }, [load]);

  const houseName = (id: string) => houses.find((h) => h.id === id)?.name ?? id;
  const setStatus = async (m: Staff, status: Staff['status']) => {
    setMessage(null);
    const res = await workerFetch(`/api/staff/${m.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!data?.success) return setMessage({ ok: false, text: data?.error || 'Chưa cập nhật được tài khoản.' });
    setMessage({ ok: true, text: status === 'locked' ? `Đã khoá ${m.full_name}. Người này bị đăng xuất ngay.` : `Đã mở khoá ${m.full_name}.` });
    await load();
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-600 dark:text-neutral-300">
        Tạo Admin căn ở mục <b>Tạo tài khoản mới</b>: chọn nhà, rồi chọn phòng <b>Admin (Admin căn trọ)</b>. Admin căn quản lý nhà được giao, không đổi được ngân hàng nhận tiền và không tạo được tài khoản quản lý khác.
      </p>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={cn('text-xs font-semibold', message.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600')}>
          {message.text}
        </p>
      )}
      <div className="space-y-3">
        <h3 className="type-h3 font-bold text-neutral-900 dark:text-white">Admin căn hiện có</h3>
        {managers.length === 0 && <p className="text-sm text-neutral-600 dark:text-neutral-300">Chưa có Admin căn nào.</p>}
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {managers.map((m) => (
            <li key={m.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-neutral-900 dark:text-white truncate">
                  {m.full_name}
                  {m.status === 'locked' && <span className="ml-2 text-[11px] font-bold text-rose-600">Đã khoá</span>}
                </p>
                <p className="text-xs text-neutral-600 dark:text-neutral-300">
                  <span className="font-num">{m.phone}</span> · {m.house_ids.map(houseName).join(', ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStatus(m, m.status === 'locked' ? 'active' : 'locked')}
                className="soft-button min-h-11 px-3 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
              >
                {m.status === 'locked' ? <Unlock size={14} /> : <Lock size={14} />}
                <span>{m.status === 'locked' ? 'Mở khoá' : 'Khoá'}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
