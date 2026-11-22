import { useEffect, useRef, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { money, useAdminHouses, workerCall } from './workerAdmin';
import { refreshBilling, refreshDashboard, refreshGate, refreshRooms } from '../../lib/adminRefresh';

type Per = 'room' | 'person' | 'vehicle';
interface ServiceRow { key: string; id?: number; name: string; price: string; per: Per; maxQty: string; active: boolean }

const PER_LABEL: Record<Per, string> = { room: 'Mỗi phòng', person: 'Mỗi người', vehicle: 'Mỗi xe' };
const digits = (s: string) => s.replace(/\D/g, '');
const show = (s: string) => (s === '' ? '' : money(Number(s)));
const field = 'w-full bg-white dark:bg-neutral-900 px-3 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-bold text-sm text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-neutral-500';
const vnMonth = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7); // current month, Vietnam time, YYYY-MM
const nextMonth = () => { const [y, m] = vnMonth().split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }; // latest month the server accepts
const monthLabel = (m: string) => `Tháng ${m.slice(5, 7)}/${m.slice(0, 4)}`;
/** "2026-11" -> "11/2026", the month format the admin screen keeps. */
const screenMonth = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const num = (v: unknown): number | null => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const servicesSig = (list: ServiceRow[]) => JSON.stringify(list.map((s) => [s.id ?? null, s.name.trim(), num(s.price) ?? 0, s.per, s.per === 'person' ? num(s.maxQty) : null, !!s.active]));
interface Snapshot { electric: number; water: number; services: string; rent: number | null; deposit: number | null }
let seq = 0;
const nextKey = () => `n${++seq}`;

/** Fee settings of one house, stored on the Worker. The actual (cost) electricity price is never shown or sent. */
export default function FeeSettings({ initialMonth }: { initialMonth?: string } = {}) {
  const { houses, houseId, setHouseId, error: houseError } = useAdminHouses();
  const [electric, setElectric] = useState('');
  const [water, setWater] = useState('');
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [rent, setRent] = useState('');
  const [deposit, setDeposit] = useState('');
  const [applyAll, setApplyAll] = useState(false);
  const [orig, setOrig] = useState<Snapshot | null>(null); // the values last loaded or saved, to tell what changed
  const [loaded, setLoaded] = useState(false);
  const [month, setMonth] = useState(() => { const m = initialMonth && /^\d{2}\/\d{4}$/.test(initialMonth) ? `${initialMonth.slice(3)}-${initialMonth.slice(0, 2)}` : vnMonth(); return m > nextMonth() ? vnMonth() : m; }); // fees are per month; a past month is read-only
  const [editable, setEditable] = useState(true);
  const [known, setKnown] = useState(true); // false: the month predates stored fees, the numbers shown are today's
  const view = useRef({ houseId: '', month: '' }); // what the screen shows now, to drop a slow answer for an old choice
  view.current = { houseId, month };
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const applyLoaded = (data: any) => {
    const cfg = data.config;
    const list: ServiceRow[] = (cfg.services ?? []).map((s: any) => ({
      key: `s${s.id}`, id: s.id, name: s.name, price: String(s.price), per: s.per, maxQty: s.maxQty == null ? '' : String(s.maxQty), active: s.active,
    }));
    const rentNow = num(data.defaultRoomPrice ?? cfg.defaultRoomPrice);
    const depositNow = num(data.defaultDeposit ?? cfg.defaultDeposit);
    setElectric(String(cfg.electricPrice ?? 0));
    setWater(String(cfg.waterPrice ?? 0));
    setServices(list);
    setRent(rentNow === null ? '' : String(rentNow));
    setDeposit(depositNow === null ? '' : String(depositNow));
    setApplyAll(false);
    setOrig({ electric: num(cfg.electricPrice) ?? 0, water: num(cfg.waterPrice) ?? 0, services: servicesSig(list), rent: rentNow, deposit: depositNow });
  };

  useEffect(() => {
    if (!houseId) return;
    let live = true;
    setLoaded(false);
    setMessage(null);
    workerCall(`/api/admin/config?houseId=${encodeURIComponent(houseId)}&month=${month}`).then((r) => {
      if (!live) return;
      if (!r.ok) return setMessage({ ok: false, text: r.error });
      setEditable(r.data.editable !== false);
      setKnown(r.data.known !== false);
      const cfg = r.data.config;
      setElectric(String(cfg.electricPrice ?? 0));
      setWater(String(cfg.waterPrice ?? 0));
      applyLoaded(r.data);
      setLoaded(true);
    });
    return () => { live = false; };
  }, [houseId, month]);

  const patch = (key: string, change: Partial<ServiceRow>) => setServices((list) => list.map((s) => (s.key === key ? { ...s, ...change } : s)));

  const feeDirty = !!orig && (( num(electric) ?? 0) !== orig.electric || (num(water) ?? 0) !== orig.water || servicesSig(services) !== orig.services);
  const houseDirty = !!orig && (num(rent) !== orig.rent || num(deposit) !== orig.deposit || applyAll);
  const dirty = (editable && feeDirty) || houseDirty;
  const reason = saving ? 'Đang lưu...' : !loaded ? 'Đang tải...' : !dirty ? 'Chưa có thay đổi nào để lưu.' : '';

  const save = async () => {
    if (saving || !loaded || !dirty || !orig) return;
    setSaving(true);
    setMessage(null);
    const body: Record<string, unknown> = { houseId };
    if (editable) {
      body.month = month;
      body.electricPrice = Number(electric || 0);
      body.waterPrice = Number(water || 0);
      body.services = services.map((s) => ({
        ...(s.id === undefined ? {} : { id: s.id }),
        name: s.name.trim(), price: Number(s.price || 0), per: s.per,
        maxQty: s.per === 'person' && s.maxQty !== '' ? Number(s.maxQty) : null, active: s.active,
      }));
    }
    // House-level rent and deposit: sent when changed, or when "apply to all" is on (then the shown values are the ones applied).
    if (num(rent) !== orig.rent || (applyAll && num(rent) !== null)) body.defaultRoomPrice = num(rent);
    if (num(deposit) !== orig.deposit || (applyAll && num(deposit) !== null)) body.defaultDeposit = num(deposit);
    if (applyAll) body.applyToAllRooms = true;
    const r = await workerCall('/api/admin/config', { method: 'PUT', body: JSON.stringify(body) });
    setSaving(false);
    if (view.current.houseId !== houseId || view.current.month !== month) return; // the admin moved on: do not paint this answer over the other month
    if (!r.ok) return setMessage({ ok: false, text: r.error });
    if (r.data.config) applyLoaded(r.data);
    const failed: string[] = r.data.recomputeFailed ?? [];
    const locked: string[] = r.data.lockedRooms ?? [];
    const repriced = Number(r.data.roomsRepriced ?? 0);
    const parts: string[] = [];
    if (failed.length) parts.push(`Đã lưu, nhưng chưa tính lại được hoá đơn nháp phòng ${failed.join(', ')}.`);
    else parts.push(editable && feeDirty ? 'Đã lưu. Hoá đơn nháp đã được tính lại theo giá mới.' : 'Đã lưu.');
    if (body.defaultRoomPrice !== undefined || body.defaultDeposit !== undefined) {
      if (repriced > 0) parts.push(`Đã đổi giá cho ${repriced} phòng.`);
      else if (body.applyToAllRooms) parts.push('Không có phòng nào cần đổi giá.');
    }
    if (locked.length) parts.push(`Phòng ${locked.join(', ')} đã đóng nên áp dụng từ tháng sau.`);
    setMessage({ ok: !failed.length, text: parts.join(' ') });
    const m = screenMonth(month);
    refreshRooms(m); refreshBilling(m); refreshDashboard(m); refreshGate(m);
  };

  return (
    <div className="soft-card kit-form-surface p-4 sm:p-8 space-y-6">
      <div>
        <h3 className="type-h3 font-bold text-neutral-900 dark:text-white">Cài đặt phí</h3>
        <p className="text-xs text-neutral-700 dark:text-neutral-200 mt-1">Phí được lưu riêng cho từng tháng; sang tháng mới sẽ lấy theo tháng trước. Giá mới chỉ áp dụng cho hoá đơn nháp của tháng đang chọn.</p>
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

      <div className="flex flex-wrap items-end gap-4">
        <label className="block text-xs font-bold text-neutral-600 dark:text-neutral-300 uppercase">
          Tháng
          <input type="month" aria-label="Chọn tháng" value={month} max={nextMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${field} mt-2`} />
        </label>
        <p className="text-sm font-bold text-neutral-900 dark:text-white pb-3">{monthLabel(month)}</p>
      </div>
      {loaded && !known && <p role="status" className="text-xs font-bold text-amber-700 dark:text-amber-400">Chưa lưu phí của {monthLabel(month)}: đang hiện phí hiện tại để tham khảo.</p>}
      {loaded && month > vnMonth() && <p role="status" data-testid="fee-prep-note" className="text-xs font-bold text-amber-700 dark:text-amber-400">Phí tháng này được sao chép từ tháng trước lúc bắt đầu chuẩn bị; nếu bạn vừa đổi phí tháng trước, hãy kiểm tra lại ở đây.</p>}
      {loaded && !editable && <p role="status" className="text-xs font-bold text-amber-700 dark:text-amber-400">{monthLabel(month)} đã qua nên chỉ xem, không sửa được.</p>}

      <div className="space-y-3 rounded-2xl border border-neutral-100 dark:border-neutral-700/60 p-4">
        <div>
          <h4 className="font-bold text-sm text-neutral-900 dark:text-white">Giá phòng chung (áp dụng cho cả nhà, không theo tháng)</h4>
          <p className="text-xs text-neutral-700 dark:text-neutral-200 mt-1">Phòng nào chưa có giá riêng sẽ lấy theo giá này. Hoá đơn đã đóng không bị đổi, giá mới áp dụng từ hoá đơn kế tiếp.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { id: 'fee-rent', label: 'Tiền phòng chung', value: rent, set: setRent },
            { id: 'fee-deposit', label: 'Tiền cọc chung', value: deposit, set: setDeposit },
          ].map((f) => (
            <div key={f.id} className="space-y-2">
              <label htmlFor={f.id} className="text-xs font-bold text-neutral-600 uppercase dark:text-neutral-300">{f.label}</label>
              <div className="relative">
                <input id={f.id} type="text" inputMode="numeric" value={show(f.value)} placeholder="Chưa đặt" disabled={!loaded}
                  onChange={(e) => f.set(digits(e.target.value))} className={`${field} pr-8`} />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
              </div>
            </div>
          ))}
        </div>
        <label className="flex items-start gap-2 text-xs font-bold text-neutral-700 dark:text-neutral-200 min-h-11 cursor-pointer">
          <input type="checkbox" checked={applyAll} disabled={!loaded} onChange={(e) => setApplyAll(e.target.checked)} className="w-5 h-5 shrink-0" />
          <span>Áp dụng cho tất cả phòng (kể cả phòng đang có giá riêng)</span>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { id: 'fee-electric', label: 'Điện (1 kW)', value: electric, set: setElectric },
          { id: 'fee-water', label: 'Nước (1 m³)', value: water, set: setWater },
        ].map((f) => (
          <div key={f.id} className="bg-neutral-50 dark:bg-neutral-800/60 p-4 rounded-2xl border border-neutral-100 dark:border-neutral-700/60 space-y-2">
            <label htmlFor={f.id} className="text-xs font-bold text-neutral-600 uppercase dark:text-neutral-300">{f.label}</label>
            <div className="relative">
              <input id={f.id} type="text" inputMode="numeric" value={show(f.value)} placeholder="0" disabled={!loaded || !editable}
                onChange={(e) => f.set(digits(e.target.value))} className={`${field} pr-8`} />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-bold text-sm text-neutral-900 dark:text-white">Dịch vụ</h4>
          <button type="button" disabled={!loaded || !editable}
            onClick={() => setServices((l) => [...l, { key: nextKey(), name: '', price: '', per: 'room', maxQty: '', active: true }])}
            className="soft-button min-h-11 px-4 text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50">
            <Plus size={16} /><span>Thêm dịch vụ</span>
          </button>
        </div>
        {loaded && services.length === 0 && <p className="text-xs text-neutral-600 dark:text-neutral-300">Chưa có dịch vụ nào.</p>}
        <fieldset disabled={!editable} className="space-y-3 border-0 p-0 m-0 min-w-0">
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
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-4 border-t border-neutral-100 dark:border-neutral-800">
        <button type="button" onClick={save} disabled={!!reason} title={reason || undefined} className="primary-button min-h-11 py-3 px-8 text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50">
          <Save size={16} /><span>{saving ? 'Đang lưu...' : 'Lưu cài đặt phí'}</span>
        </button>
        {reason && !saving && loaded && !message && <p className="text-xs text-neutral-600 dark:text-neutral-300">{reason}</p>}
        {message && <p role={message.ok ? 'status' : 'alert'} className={`text-xs font-bold ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</p>}
      </div>
    </div>
  );
}
