import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { money, useAdminHouses, workerCall } from './workerAdmin';

type Per = 'room' | 'person' | 'vehicle';
interface ServiceRow { key: string; id?: number; name: string; price: string; per: Per; maxQty: string; active: boolean }

const PER_LABEL: Record<Per, string> = { room: 'Mỗi phòng', person: 'Mỗi người', vehicle: 'Mỗi xe' };
const digits = (s: string) => s.replace(/\D/g, '');
const show = (s: string) => (s === '' ? '' : money(Number(s)));
const field = 'w-full bg-white dark:bg-neutral-900 px-3 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-bold text-sm text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-neutral-500';
let seq = 0;
const nextKey = () => `n${++seq}`;

/** Fee settings of one house, stored on the Worker. The actual (cost) electricity price is never shown or sent. */
export default function FeeSettings() {
  const { houses, houseId, setHouseId, error: houseError } = useAdminHouses();
  const [electric, setElectric] = useState('');
  const [water, setWater] = useState('');
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!houseId) return;
    let live = true;
    setLoaded(false);
    setMessage(null);
    workerCall(`/api/admin/config?houseId=${encodeURIComponent(houseId)}`).then((r) => {
      if (!live) return;
      if (!r.ok) return setMessage({ ok: false, text: r.error });
      const cfg = r.data.config;
      setElectric(String(cfg.electricPrice ?? 0));
      setWater(String(cfg.waterPrice ?? 0));
      setServices((cfg.services ?? []).map((s: any) => ({
        key: `s${s.id}`, id: s.id, name: s.name, price: String(s.price), per: s.per, maxQty: s.maxQty == null ? '' : String(s.maxQty), active: s.active,
      })));
      setLoaded(true);
    });
    return () => { live = false; };
  }, [houseId]);

  const patch = (key: string, change: Partial<ServiceRow>) => setServices((list) => list.map((s) => (s.key === key ? { ...s, ...change } : s)));

  const save = async () => {
    if (saving || !loaded) return;
    setSaving(true);
    setMessage(null);
    const body = {
      houseId,
      electricPrice: Number(electric || 0),
      waterPrice: Number(water || 0),
      services: services.map((s) => ({
        ...(s.id === undefined ? {} : { id: s.id }),
        name: s.name.trim(), price: Number(s.price || 0), per: s.per,
        maxQty: s.per === 'person' && s.maxQty !== '' ? Number(s.maxQty) : null, active: s.active,
      })),
    };
    const r = await workerCall('/api/admin/config', { method: 'PUT', body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) return setMessage({ ok: false, text: r.error });
    const cfg = r.data.config;
    if (cfg) {
      setElectric(String(cfg.electricPrice ?? 0));
      setWater(String(cfg.waterPrice ?? 0));
      setServices((cfg.services ?? []).map((s: any) => ({
        key: `s${s.id}`, id: s.id, name: s.name, price: String(s.price), per: s.per, maxQty: s.maxQty == null ? '' : String(s.maxQty), active: s.active,
      })));
    }
    const failed: string[] = r.data.recomputeFailed ?? [];
    setMessage({ ok: !failed.length, text: failed.length ? `Đã lưu, nhưng chưa tính lại được hoá đơn nháp phòng ${failed.join(', ')}.` : 'Đã lưu. Hoá đơn nháp đã được tính lại theo giá mới.' });
  };

  return (
    <div className="soft-card kit-form-surface p-4 sm:p-8 space-y-6">
      <div>
        <h3 className="type-h3 font-bold text-neutral-900 dark:text-white">Cài đặt phí</h3>
        <p className="text-xs text-neutral-700 dark:text-neutral-200 mt-1">Giá mới chỉ áp dụng cho hoá đơn nháp. Hoá đơn đã mở thu không bị tính lại.</p>
      </div>

      {houses.length > 1 && (
        <label className="block text-xs font-bold text-neutral-600 dark:text-neutral-300 uppercase">
          Nhà trọ
          <select aria-label="Chọn nhà trọ" value={houseId} onChange={(e) => setHouseId(e.target.value)} className={`${field} mt-2`}>
            {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </label>
      )}
      {houseError && <p role="alert" className="text-xs font-bold text-rose-600">{houseError}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { id: 'fee-electric', label: 'Điện (1 kW)', value: electric, set: setElectric },
          { id: 'fee-water', label: 'Nước (1 m³)', value: water, set: setWater },
        ].map((f) => (
          <div key={f.id} className="bg-neutral-50 dark:bg-neutral-800/60 p-4 rounded-2xl border border-neutral-100 dark:border-neutral-700/60 space-y-2">
            <label htmlFor={f.id} className="text-xs font-bold text-neutral-600 uppercase dark:text-neutral-300">{f.label}</label>
            <div className="relative">
              <input id={f.id} type="text" inputMode="numeric" value={show(f.value)} placeholder="0" disabled={!loaded}
                onChange={(e) => f.set(digits(e.target.value))} className={`${field} pr-8`} />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-bold text-sm text-neutral-900 dark:text-white">Dịch vụ</h4>
          <button type="button" disabled={!loaded}
            onClick={() => setServices((l) => [...l, { key: nextKey(), name: '', price: '', per: 'room', maxQty: '', active: true }])}
            className="soft-button min-h-11 px-4 text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50">
            <Plus size={16} /><span>Thêm dịch vụ</span>
          </button>
        </div>
        {loaded && services.length === 0 && <p className="text-xs text-neutral-600 dark:text-neutral-300">Chưa có dịch vụ nào.</p>}
        {services.map((s, i) => (
          <div key={s.key} data-testid="service-row" className={`rounded-2xl border border-neutral-100 dark:border-neutral-700/60 bg-neutral-50 dark:bg-neutral-800/60 p-4 space-y-3 ${s.active ? '' : 'opacity-70'}`}>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <label className="text-xs font-bold text-neutral-600 dark:text-neutral-300 sm:col-span-1">
                Tên
                <input type="text" value={s.name} maxLength={40} aria-label={`Tên dịch vụ ${i + 1}`} onChange={(e) => patch(s.key, { name: e.target.value })} className={`${field} mt-1`} />
              </label>
              <label className="text-xs font-bold text-neutral-600 dark:text-neutral-300">
                Giá (đ)
                <input type="text" inputMode="numeric" value={show(s.price)} aria-label={`Giá dịch vụ ${i + 1}`} placeholder="0" onChange={(e) => patch(s.key, { price: digits(e.target.value) })} className={`${field} mt-1`} />
              </label>
              <label className="text-xs font-bold text-neutral-600 dark:text-neutral-300">
                Tính theo
                <select value={s.per} aria-label={`Tính theo dịch vụ ${i + 1}`} onChange={(e) => patch(s.key, { per: e.target.value as Per, ...(e.target.value === 'person' ? {} : { maxQty: '' }) })} className={`${field} mt-1`}>
                  {(Object.keys(PER_LABEL) as Per[]).map((p) => <option key={p} value={p}>{PER_LABEL[p]}</option>)}
                </select>
              </label>
              {s.per === 'person' && (
                <label className="text-xs font-bold text-neutral-600 dark:text-neutral-300">
                  Tối đa (người)
                  <input type="text" inputMode="numeric" value={s.maxQty} aria-label={`Tối đa dịch vụ ${i + 1}`} placeholder="Không giới hạn" onChange={(e) => patch(s.key, { maxQty: digits(e.target.value) })} className={`${field} mt-1`} />
                </label>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs font-bold text-neutral-700 dark:text-neutral-200 min-h-11 cursor-pointer">
                <input type="checkbox" checked={s.active} onChange={(e) => patch(s.key, { active: e.target.checked })} className="w-5 h-5" />
                {s.active ? 'Đang tính' : 'Đã tắt'}
              </label>
              <button type="button" aria-label={`Xoá dịch vụ ${i + 1}`} onClick={() => setServices((l) => l.filter((x) => x.key !== s.key))}
                className="soft-button min-h-11 px-4 text-xs font-bold flex items-center gap-2 text-rose-600 cursor-pointer">
                <Trash2 size={16} /><span>Xoá</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-4 border-t border-neutral-100 dark:border-neutral-800">
        <button type="button" onClick={save} disabled={saving || !loaded} className="primary-button min-h-11 py-3 px-8 text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50">
          <Save size={16} /><span>{saving ? 'Đang lưu...' : 'Lưu cài đặt phí'}</span>
        </button>
        {message && <p role={message.ok ? 'status' : 'alert'} className={`text-xs font-bold ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</p>}
      </div>
    </div>
  );
}
