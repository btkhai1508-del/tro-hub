import { useEffect, useRef, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { money, useAdminHouses, workerCall } from './workerAdmin';
import { refreshBilling, refreshDashboard, refreshGate, refreshRooms } from '../../lib/adminRefresh';

type Per = 'room' | 'person' | 'vehicle';
interface ServiceRow { key: string; id?: number; name: string; price: string; per: Per; maxQty: string; active: boolean }

const PER_LABEL: Record<Per, string> = { room: 'Mỗi phòng', person: 'Mỗi người', vehicle: 'Mỗi xe' };
const digits = (s: string) => s.replace(/\D/g, '');
const show = (s: string) => (s === '' ? '' : money(Number(s)));
const field = 'w-full min-h-11 bg-white dark:bg-neutral-900 px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 font-bold text-sm text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-neutral-500';
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

/** Đơn giá dịch vụ (fee settings) of one house, stored on the Worker. The actual (cost) electricity price is never shown or sent. */
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

  const sectionCls = 'rounded-2xl border border-neutral-200/80 dark:border-neutral-700/60 bg-white/60 dark:bg-neutral-900/40 p-3 sm:p-4 space-y-3';
  const headCls = 'font-bold text-sm text-neutral-900 dark:text-white';
  const labelCls = 'text-[11px] font-bold text-neutral-600 dark:text-neutral-300 uppercase';
  const moneyField = (id: string, label: string, value: string, set: (v: string) => void, opts: { disabled: boolean; placeholder: string; suffix?: string }) => (
    <div key={id} className="space-y-1 min-w-0">
      <label htmlFor={id} className={labelCls}>{label}</label>
      <div className="relative">
        <input id={id} type="text" inputMode="numeric" value={show(value)} placeholder={opts.placeholder} disabled={opts.disabled}
          onChange={(e) => set(digits(e.target.value))} className={`${field} pr-14 text-right tabular-nums`} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none whitespace-nowrap">{opts.suffix ?? 'đ'}</span>
      </div>
    </div>
  );

  return (
    <div className="soft-card kit-form-surface p-3 sm:p-6 space-y-4">
      {/* Header: what this is, which house and which month, and the Save button always in reach */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="type-h3 font-bold text-neutral-900 dark:text-white">Đơn giá dịch vụ</h3>
          <p className="text-xs text-neutral-700 dark:text-neutral-200 mt-1">Giá điện, nước và dịch vụ lưu theo từng tháng; giá mới chỉ áp dụng cho hoá đơn nháp của tháng đang chọn.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 items-end">
        {houses.length > 1 && (
          <label className="block min-w-0">
            <span className={labelCls}>Nhà trọ</span>
            <select aria-label="Chọn nhà trọ" value={houseId} onChange={(e) => setHouseId(e.target.value)} className={`${field} mt-1`}>
              {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
        )}
        <label className="block min-w-0">
          <span className={labelCls}>Tháng áp dụng · <span className="normal-case text-neutral-900 dark:text-white">{monthLabel(month)}</span></span>
          <input type="month" aria-label="Chọn tháng" value={month} max={nextMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${field} mt-1`} />
        </label>
      </div>
      {houseError && <p role="alert" className="text-xs font-bold text-rose-600">{houseError}</p>}
      {loaded && !known && <p role="status" className="text-xs font-bold text-amber-700 dark:text-amber-400">Chưa lưu phí của {monthLabel(month)}: đang hiện phí hiện tại để tham khảo.</p>}
      {loaded && month > vnMonth() && <p role="status" data-testid="fee-prep-note" className="text-xs font-bold text-amber-700 dark:text-amber-400">Phí tháng này được sao chép từ tháng trước lúc bắt đầu chuẩn bị; nếu bạn vừa đổi phí tháng trước, hãy kiểm tra lại ở đây.</p>}
      {loaded && !editable && <p role="status" className="text-xs font-bold text-amber-700 dark:text-amber-400">{monthLabel(month)} đã qua nên chỉ xem, không sửa được.</p>}

      {/* 1. Electricity and water of the month */}
      <section className={sectionCls} aria-labelledby="fee-meter-head">
        <h4 id="fee-meter-head" className={headCls}>Điện &amp; nước</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {moneyField('fee-electric', 'Điện', electric, setElectric, { disabled: !loaded || !editable, placeholder: '0', suffix: 'đ/kW' })}
          {moneyField('fee-water', 'Nước', water, setWater, { disabled: !loaded || !editable, placeholder: '0', suffix: 'đ/m³' })}
        </div>
      </section>

      {/* 2. House-wide rent and deposit (not per month) */}
      <section className={sectionCls} aria-labelledby="fee-rent-head">
        <div>
          <h4 id="fee-rent-head" className={headCls}>Tiền phòng chung &amp; tiền cọc chung</h4>
          <p className="text-xs text-neutral-600 dark:text-neutral-300 mt-0.5">Áp dụng cho cả nhà, không theo tháng. Hoá đơn đã đóng không bị đổi, giá mới tính từ hoá đơn kế tiếp.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {moneyField('fee-rent', 'Tiền phòng chung', rent, setRent, { disabled: !loaded, placeholder: 'Chưa đặt' })}
          {moneyField('fee-deposit', 'Tiền cọc chung', deposit, setDeposit, { disabled: !loaded, placeholder: 'Chưa đặt' })}
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-neutral-700 dark:text-neutral-200 min-h-11 cursor-pointer">
          <input type="checkbox" checked={applyAll} disabled={!loaded} onChange={(e) => setApplyAll(e.target.checked)} className="w-5 h-5 shrink-0" />
          <span>Áp dụng cho tất cả phòng (kể cả phòng đang có giá riêng)</span>
        </label>
      </section>

      {/* 3. Services of the month */}
      <section className={sectionCls} aria-labelledby="fee-services-head">
        <div className="flex items-center justify-between gap-3">
          <h4 id="fee-services-head" className={headCls}>Dịch vụ</h4>
          <button type="button" disabled={!loaded || !editable}
            onClick={() => setServices((l) => [...l, { key: nextKey(), name: '', price: '', per: 'room', maxQty: '', active: true }])}
            className="soft-button min-h-11 px-4 text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50">
            <Plus size={16} /><span>Thêm dịch vụ</span>
          </button>
        </div>
        {loaded && services.length === 0 && <p className="text-xs text-neutral-600 dark:text-neutral-300">Chưa có dịch vụ nào.</p>}
        {services.length > 0 && (
          <div aria-hidden="true" className="hidden md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto_auto] gap-2 px-1">
            <span className={labelCls}>Tên</span><span className={labelCls}>Giá</span><span className={labelCls}>Tính theo</span><span className={labelCls}>Tối đa</span><span className={`${labelCls} w-24`}>Bật/tắt</span><span className={`${labelCls} w-11`} />
          </div>
        )}
        <fieldset disabled={!editable} className="space-y-2 border-0 p-0 m-0 min-w-0">
        {services.map((s, i) => (
          <div key={s.key} data-testid="service-row" className={`grid grid-cols-2 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto_auto] items-center gap-2 rounded-xl border border-neutral-100 dark:border-neutral-700/60 bg-neutral-50 dark:bg-neutral-800/60 p-2 ${s.active ? '' : 'opacity-70'}`}>
            <label className="col-span-2 md:col-span-1 min-w-0">
              <span className={`${labelCls} md:sr-only`}>Tên</span>
              <input type="text" value={s.name} maxLength={40} aria-label={`Tên dịch vụ ${i + 1}`} placeholder="Tên dịch vụ" onChange={(e) => patch(s.key, { name: e.target.value })} className={`${field} mt-1 md:mt-0`} />
            </label>
            <label className="min-w-0">
              <span className={`${labelCls} md:sr-only`}>Giá</span>
              <span className="relative block mt-1 md:mt-0">
                <input type="text" inputMode="numeric" value={show(s.price)} aria-label={`Giá dịch vụ ${i + 1}`} placeholder="0" onChange={(e) => patch(s.key, { price: digits(e.target.value) })} className={`${field} pr-7 text-right tabular-nums`} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
              </span>
            </label>
            <label className="min-w-0">
              <span className={`${labelCls} md:sr-only`}>Tính theo</span>
              <select value={s.per} aria-label={`Tính theo dịch vụ ${i + 1}`} onChange={(e) => patch(s.key, { per: e.target.value as Per, ...(e.target.value === 'person' ? {} : { maxQty: '' }) })} className={`${field} mt-1 md:mt-0`}>
                {(Object.keys(PER_LABEL) as Per[]).map((p) => <option key={p} value={p}>{PER_LABEL[p]}</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <span className={`${labelCls} md:sr-only`}>Tối đa (người)</span>
              {s.per === 'person'
                ? <input type="text" inputMode="numeric" value={s.maxQty} aria-label={`Tối đa dịch vụ ${i + 1}`} placeholder="Không giới hạn" onChange={(e) => patch(s.key, { maxQty: digits(e.target.value) })} className={`${field} mt-1 md:mt-0 tabular-nums`} />
                : <span className="mt-1 md:mt-0 flex min-h-11 items-center px-3 text-xs text-neutral-500 dark:text-neutral-400">—</span>}
            </label>
            <div className="flex items-center justify-between gap-2 self-end md:contents">
            <label className="flex items-center gap-2 text-xs font-bold text-neutral-700 dark:text-neutral-200 min-h-11 w-24 cursor-pointer">
              <input type="checkbox" checked={s.active} onChange={(e) => patch(s.key, { active: e.target.checked })} className="w-5 h-5" />
              {s.active ? 'Đang tính' : 'Đã tắt'}
            </label>
            <button type="button" aria-label={`Xoá dịch vụ ${i + 1}`} title="Xoá dịch vụ" onClick={() => setServices((l) => l.filter((x) => x.key !== s.key))}
              className="soft-button min-h-11 min-w-11 justify-self-end px-3 text-xs font-bold flex items-center justify-center gap-2 text-rose-600 cursor-pointer">
              <Trash2 size={16} /><span className="md:sr-only">Xoá</span>
            </button>
            </div>
          </div>
        ))}
        </fieldset>
      </section>

      <div className="sticky bottom-24 lg:bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-neutral-200/80 dark:border-neutral-700/60 bg-white/90 dark:bg-neutral-900/90 backdrop-blur p-3">
        <button type="button" onClick={save} disabled={!!reason} title={reason || undefined} className="primary-button min-h-11 py-3 px-8 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50 w-full sm:w-auto">
          <Save size={16} /><span>{saving ? 'Đang lưu...' : 'Lưu đơn giá dịch vụ'}</span>
        </button>
        {reason && !saving && loaded && !message && <p className="text-xs text-neutral-600 dark:text-neutral-300">{reason}</p>}
        {message && <p role={message.ok ? 'status' : 'alert'} className={`text-xs font-bold ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</p>}
      </div>
    </div>
  );
}
