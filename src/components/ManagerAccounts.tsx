import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Lock, Unlock, UserPlus } from 'lucide-react';
import { workerFetch } from '../lib/api';
import { cn } from '../lib/utils';

interface House { id: string; name: string }
interface Staff { id: number; full_name: string; phone: string; role: 'owner' | 'manager'; status: 'active' | 'locked'; house_ids: string[] }

const fieldClass =
  'w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl px-3 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-neutral-500 placeholder:text-neutral-400 dark:placeholder:text-neutral-500';
const labelClass = 'text-[11px] font-bold text-neutral-600 uppercase block mb-1.5 dark:text-neutral-300';

/**
 * Admin Tổng creates an Admin căn for one or more of their own houses, and can lock or unlock it.
 * The Worker checks every rule; this screen only offers the houses the Admin Tổng owns.
 */
export function ManagerAccounts() {
  const [houses, setHouses] = useState<House[]>([]);
  const [managers, setManagers] = useState<Staff[]>([]);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [houseIds, setHouseIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [h, s] = await Promise.all([
      workerFetch('/api/houses').then((r) => r.json()).catch(() => null),
      workerFetch('/api/staff').then((r) => r.json()).catch(() => null),
    ]);
    const list: House[] = h?.houses ?? [];
    setHouses(list);
    setHouseIds((current) => (current.length ? current : list.length === 1 ? [list[0].id] : []));
    setManagers((s?.staff ?? []).filter((x: Staff) => x.role === 'manager'));
    if (!s?.success) setMessage({ ok: false, text: s?.error || 'Chưa tải được danh sách Admin căn.' });
  }, []);

  useEffect(() => { load(); }, [load]);

  const houseName = (id: string) => houses.find((h) => h.id === id)?.name ?? id;
  const toggleHouse = (id: string) => setHouseIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await workerFetch('/api/staff', {
        method: 'POST',
        body: JSON.stringify({ fullName, phone, password, role: 'manager', houseIds }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.success) throw new Error(data?.error || 'Chưa tạo được tài khoản.');
      setMessage({ ok: true, text: `Đã tạo Admin căn ${fullName.trim()}. Người này đăng nhập bằng số ${phone.trim()} và mật khẩu vừa đặt.` });
      setFullName('');
      setPhone('');
      setPassword('');
      await load();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (m: Staff, status: Staff['status']) => {
    setMessage(null);
    const res = await workerFetch(`/api/staff/${m.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!data?.success) return setMessage({ ok: false, text: data?.error || 'Chưa cập nhật được tài khoản.' });
    setMessage({ ok: true, text: status === 'locked' ? `Đã khoá ${m.full_name}. Người này bị đăng xuất ngay.` : `Đã mở khoá ${m.full_name}.` });
    await load();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <form onSubmit={create} className="space-y-4">
        <h3 className="type-h3 font-bold text-neutral-900 dark:text-white flex items-center gap-2">
          <UserPlus size={18} />
          <span>Tạo Admin căn</span>
        </h3>
        <p className="text-xs text-neutral-600 dark:text-neutral-300">
          Admin căn quản lý nhà được giao: điện nước, thu tiền, cư dân. Không đổi được ngân hàng nhận tiền và không tạo được tài khoản quản lý khác.
        </p>
        <div>
          <label htmlFor="mgr-name" className={labelClass}>Họ tên</label>
          <input id="mgr-name" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className={fieldClass} placeholder="Nguyễn Văn A" required />
        </div>
        <div>
          <label htmlFor="mgr-phone" className={labelClass}>Số điện thoại đăng nhập</label>
          <input id="mgr-phone" type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} className={cn(fieldClass, 'font-num')} placeholder="09xxxxxxxx" required />
        </div>
        <div>
          <label htmlFor="mgr-pass" className={labelClass}>Mật khẩu</label>
          <input id="mgr-pass" type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass} placeholder="Ít nhất 6 ký tự" minLength={6} required />
        </div>
        <fieldset>
          <legend className={labelClass}>Nhà được giao</legend>
          <div className="flex flex-wrap gap-2">
            {houses.map((h) => (
              <label key={h.id} className={cn('soft-button min-h-11 px-3 inline-flex items-center gap-2 text-sm cursor-pointer', houseIds.includes(h.id) && 'kit-segment-active')}>
                <input type="checkbox" className="accent-neutral-900" checked={houseIds.includes(h.id)} onChange={() => toggleHouse(h.id)} />
                <span>{h.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" disabled={busy || !houseIds.length} className="primary-button min-h-11 w-full px-4 apple-control flex items-center justify-center gap-2 disabled:opacity-50">
          <CheckCircle2 size={16} />
          <span>{busy ? 'Đang tạo...' : 'Tạo Admin căn'}</span>
        </button>
        {message && (
          <p role={message.ok ? 'status' : 'alert'} className={cn('text-xs font-semibold', message.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600')}>
            {message.text}
          </p>
        )}
      </form>

      <div className="space-y-3 lg:border-l border-neutral-200 dark:border-neutral-800 lg:pl-8">
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
