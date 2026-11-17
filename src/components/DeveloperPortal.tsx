import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, Landmark, Link2, RefreshCw, Unplug, ChevronLeft, ChevronRight, Copy, Lock, LogOut, Download, Pencil, Plus, QrCode, RotateCcw, Settings, Tags, Trash2, Unlock, UserPlus, X, Zap } from 'lucide-react';
import { vietQrUrl } from '../lib/paymentPortal';
import { useApp } from '../context/AppContext';
import { workerFetch } from '../lib/api';
import { useDialogFocus } from '../lib/useDialogFocus';
import { loadProvinces, type VnProvince } from '../lib/vnAddress';
import { cn } from '../lib/utils';
import { Background } from './Background';

interface House {
  id: string;
  name: string;
  abbreviation: string;
  address_detail: string;
  ward: string;
  province: string;
  floors: number | null;
  /** Tiện ích (admin tools) this house pays for. */
  modules: string[];
  /** Rooms × sum of the tools' prices per room. */
  monthly_fee: number;
  room_count: number;
  resident_count: number;
  /** Set while the house waits out its 7 days before being deleted for good (UTC, 'YYYY-MM-DD HH:MM:SS'). */
  delete_after: string | null;
  /** Số căn trong mã thanh toán XXXPPPMMYYYY. */
  pay_no: number | null;
}

interface Landlord {
  id: number;
  full_name: string;
  phone: string;
  email: string | null;
  status: 'active' | 'locked';
  houses: House[];
}

type Notice = { ok: boolean; text: string } | null;

/** D1 time (UTC, no zone) as a Vietnamese date and time. */
const d1Time = (value: string) =>
  new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Downloads everything D1 holds for the house as a JSON file. */
async function downloadBackup(houseId: string): Promise<string | null> {
  const data = await send<{ backup: unknown }>(`/api/dev/houses/${encodeURIComponent(houseId)}/backup`, 'GET');
  if (!data.success) return data.error || 'Chưa tải được bản sao lưu.';
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data.backup, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `tro-hub-${houseId}-saoluu-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return null;
}

const pad3 = (n: number) => String(n).padStart(3, '0');
/** Tháng này theo giờ Việt Nam, 'MMYYYY'. */
const vnMMYYYY = () => { const d = new Date(Date.now() + 7 * 3600_000).toISOString(); return d.slice(5, 7) + d.slice(0, 4); };
const vnMonthLabel = () => { const m = vnMMYYYY(); return `${m.slice(0, 2)}/${m.slice(2)}`; };
/** Mã chuyển khoản tiền trọ XXXPPPMMYYYY. */
const payCode = (house: number, room: number, mmyyyy = vnMMYYYY()) => `${pad3(house)}${pad3(room)}${mmyyyy}`;

async function send<T = any>(path: string, method: string, body?: unknown): Promise<T & { success: boolean; error?: string }> {
  const res = await workerFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  return (await res?.json().catch(() => null)) ?? { success: false, error: 'Không kết nối được máy chủ.' };
}

/**
 * Developer: sells Trọ Hub. One card lists every landlord (Admin Tổng) and their houses.
 * "+ Chủ trọ" creates a landlord; "+ Căn trọ" on a landlord opens the house wizard.
 */
export function DeveloperPortal() {
  const { profile, logoutUser } = useApp();
  const navigate = useNavigate();
  const [landlords, setLandlords] = useState<Landlord[] | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [newLandlord, setNewLandlord] = useState(false);
  const [houseFor, setHouseFor] = useState<Landlord | null>(null);
  const [editHouse, setEditHouse] = useState<string | null>(null);
  const [prices, setPrices] = useState(false);
  const [sepay, setSepay] = useState<SepayOverview | null>(null);
  const [sepayFor, setSepayFor] = useState<Landlord | null>(null);

  const load = useCallback(async () => {
    const data = await send<{ landlords: Landlord[] }>('/api/dev/landlords', 'GET');
    if (!data.success) {
      setNotice({ ok: false, text: data.error || 'Chưa tải được danh sách chủ trọ.' });
      setLandlords([]);
      return;
    }
    setLandlords(data.landlords);
    const s = await send<SepayOverview>('/api/dev/sepay', 'GET');
    if (s.success) setSepay(s);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleLock = async (l: Landlord) => {
    const status = l.status === 'locked' ? 'active' : 'locked';
    const data = await send(`/api/dev/landlords/${l.id}`, 'PATCH', { status });
    setNotice(data.success
      ? { ok: true, text: status === 'locked' ? `Đã khoá ${l.full_name}. Chủ trọ này bị đăng xuất ngay.` : `Đã mở khoá ${l.full_name}.` }
      : { ok: false, text: data.error || 'Chưa cập nhật được.' });
    load();
  };

  const backup = async (h: House) => {
    const problem = await downloadBackup(h.id);
    setNotice(problem ? { ok: false, text: problem } : { ok: true, text: `Đã tải bản sao lưu ${h.name}.` });
  };

  const restore = async (h: House) => {
    const data = await send(`/api/dev/houses/${encodeURIComponent(h.id)}/restore`, 'POST');
    setNotice(data.success ? { ok: true, text: `Đã huỷ xoá ${h.name}. Căn hoạt động lại như cũ.` } : { ok: false, text: data.error || 'Chưa khôi phục được.' });
    load();
  };

  const totals = useMemo(() => {
    // A house shared by two landlords is counted once.
    const houses = [...new Map((landlords ?? []).flatMap((l) => l.houses).map((h) => [h.id, h])).values()];
    return { landlords: landlords?.length ?? 0, houses: houses.length, rooms: houses.reduce((n, h) => n + h.room_count, 0), fee: houses.filter((h) => !h.delete_after).reduce((n, h) => n + h.monthly_fee, 0) };
  }, [landlords]);

  return (
    <div className="relative min-h-screen">
      <Background />
      <main className="relative z-10 mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:pt-10">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="apple-callout kit-text-secondary">Trọ Hub · Developer</p>
            <h1 className="apple-title1 font-bold kit-text-primary truncate">Cung cấp dịch vụ</h1>
          </div>
          <button
            type="button"
            onClick={() => { logoutUser(); navigate('/login'); }}
            className="soft-button min-h-11 shrink-0 px-3 inline-flex items-center gap-1.5 text-sm font-semibold"
            title={profile.name}
          >
            <LogOut size={16} /> <span>Đăng xuất</span>
          </button>
        </header>

        <section className="liquid-panel rounded-[28px] p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="apple-title2 font-semibold kit-text-primary">Chủ trọ</h2>
              <p className="apple-callout kit-text-secondary font-num">
                {totals.landlords} chủ trọ · {totals.houses} căn · {totals.rooms} phòng · {money(totals.fee)}/tháng
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPrices(true)} className="soft-button min-h-11 px-4 inline-flex items-center gap-2 text-sm font-semibold">
                <Tags size={16} /> Bảng giá
              </button>
              <button type="button" onClick={() => setNewLandlord(true)} className="primary-button min-h-11 px-4 inline-flex items-center gap-2 text-sm font-semibold">
                <Plus size={18} /> Chủ trọ
              </button>
            </div>
          </div>

          {notice && (
            <p role={notice.ok ? 'status' : 'alert'} className={cn('mt-4 apple-callout font-semibold', notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600')}>
              {notice.text}
            </p>
          )}

          {landlords === null && <p className="mt-6 apple-body kit-text-secondary">Đang tải…</p>}
          {landlords?.length === 0 && !notice && (
            <p className="mt-6 apple-body kit-text-secondary">Chưa có chủ trọ nào. Bấm <b>+ Chủ trọ</b> để tạo người đầu tiên.</p>
          )}

          <ul className="mt-4 divide-y divide-black/[0.06] dark:divide-white/[0.08]">
            {landlords?.map((l) => (
              <li key={l.id} className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="apple-headline kit-text-primary truncate">
                      {l.full_name}
                      {l.status === 'locked' && <span className="ml-2 text-xs font-bold text-rose-600">Đã khoá</span>}
                    </p>
                    <p className="apple-callout kit-text-secondary">
                      <span className="font-num">{l.phone}</span>
                      {l.email ? ` · ${l.email}` : ''} · {l.houses.length} căn
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => toggleLock(l)} className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                      {l.status === 'locked' ? <Unlock size={15} /> : <Lock size={15} />}
                      {l.status === 'locked' ? 'Mở khoá' : 'Khoá'}
                    </button>
                    <button type="button" onClick={() => setHouseFor(l)} className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                      <Plus size={16} /> Căn trọ
                    </button>
                  </div>
                </div>

                <SepayLine status={sepay?.connections[l.id]} onOpen={() => setSepayFor(l)} />

                {l.houses.length > 0 && (
                  <ul className="mt-3 space-y-2 border-l-2 border-black/[0.08] pl-4 dark:border-white/[0.12]">
                    {l.houses.map((h) => (
                      <li key={h.id} className="flex items-start gap-2.5">
                        <Building2 size={16} className="mt-0.5 shrink-0 kit-text-secondary" />
                        <div className="min-w-0 flex-1">
                          <p className="apple-body font-medium kit-text-primary">
                            {h.name} <span className="kit-text-secondary font-normal">· {h.abbreviation}{h.pay_no != null && <> · mã căn <span className="font-num">{pad3(h.pay_no)}</span></>}</span>
                          </p>
                          {h.delete_after && (
                            <p className="text-[13px] leading-[18px] font-semibold text-rose-600">Chờ xoá · xoá hẳn lúc {d1Time(h.delete_after)}</p>
                          )}
                          <p className="text-[13px] leading-[18px] kit-text-secondary font-num">
                            {h.floors ? `${h.floors} tầng · ` : ''}{h.room_count} phòng · {h.resident_count} người ở
                            {` · ${h.modules.length} tiện ích · ${money(h.monthly_fee)}/tháng`}
                          </p>
                          {(h.address_detail || h.ward) && (
                            <p className="text-[13px] leading-[18px] kit-text-secondary">{[h.address_detail, h.ward, h.province].filter(Boolean).join(', ')}</p>
                          )}
                        </div>
                        {h.delete_after ? (
                          <div className="flex shrink-0 flex-wrap justify-end gap-2">
                            <button type="button" onClick={() => backup(h)} className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                              <Download size={14} /> Sao lưu
                            </button>
                            <button type="button" onClick={() => restore(h)} className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                              <RotateCcw size={14} /> Khôi phục
                            </button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setEditHouse(h.id)} className="soft-button min-h-11 shrink-0 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                            <Pencil size={14} /> Sửa
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>

        <BillingCard />
      </main>

      {newLandlord && (
        <LandlordDialog
          onClose={() => setNewLandlord(false)}
          onCreated={(name) => { setNewLandlord(false); setNotice({ ok: true, text: `Đã tạo chủ trọ ${name}.` }); load(); }}
        />
      )}
      {houseFor && (
        <HouseWizard
          landlord={houseFor}
          onClose={() => setHouseFor(null)}
          onCreated={(name, rooms) => { setHouseFor(null); setNotice({ ok: true, text: `Đã tạo ${name} với ${rooms} phòng cho ${houseFor.full_name}.` }); load(); }}
        />
      )}
      {prices && (
        <PriceDialog onClose={() => setPrices(false)} onSaved={() => { setPrices(false); setNotice({ ok: true, text: 'Đã lưu bảng giá tiện ích.' }); load(); }} />
      )}
      {sepayFor && sepay && (
        <SepayDialog
          landlord={sepayFor}
          overview={sepay}
          onClose={() => { setSepayFor(null); load(); }}
        />
      )}
      {editHouse && (
        <HouseEditor
          houseId={editHouse}
          onClose={() => { setEditHouse(null); load(); }}
          onDeleted={(name, when) => { setEditHouse(null); setNotice({ ok: true, text: `${name} sẽ bị xoá hẳn lúc ${d1Time(when)}. Trước đó bạn vẫn tải sao lưu hoặc khôi phục được.` }); load(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared dialog shell
// ---------------------------------------------------------------------------

function Dialog({ title, subtitle, onClose, busy, children, footer }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  busy?: boolean;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const ref = useDialogFocus(true, () => { if (!busy) onClose(); });
  return (
    <div className="tahoe-dialog-overlay fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-3 sm:p-4" onClick={() => { if (!busy) onClose(); }}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dev-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="tahoe-dialog kit-dialog flex max-h-[92vh] w-full max-w-2xl flex-col"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6">
          <div className="min-w-0">
            <h2 id="dev-dialog-title" className="apple-title2 font-semibold kit-text-primary">{title}</h2>
            {subtitle && <p className="apple-callout kit-text-secondary mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Đóng" className="soft-button h-11 w-11 shrink-0 inline-flex items-center justify-center">
            <X size={18} />
          </button>
        </div>
        <div className="kit-dialog-body min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">{children}</div>
        <div className="kit-dialog-footer flex gap-2.5 border-t border-black/[0.06] px-5 pt-4 dark:border-white/[0.08] sm:px-6">{footer}</div>
      </div>
    </div>
  );
}

function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="apple-callout font-medium kit-text-secondary">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-[13px] leading-[18px] kit-text-secondary mt-1 block">{hint}</span>}
    </label>
  );
}

const inputClass = 'kit-field w-full px-3 min-h-11';

// ---------------------------------------------------------------------------
// + Chủ trọ
// ---------------------------------------------------------------------------

function LandlordDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const [form, setForm] = useState({ fullName: '', phone: '', password: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    const data = await send('/api/dev/landlords', 'POST', form);
    setBusy(false);
    if (!data.success) return setError(data.error || 'Chưa tạo được chủ trọ.');
    onCreated(form.fullName.trim());
  };

  return (
    <Dialog
      title="Chủ trọ mới"
      subtitle="Tài khoản Admin Tổng. Chủ trọ đăng nhập bằng số điện thoại này."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="soft-button min-h-11 flex-1 px-4">Huỷ</button>
          <button type="button" onClick={() => submit()} disabled={busy} className="primary-button min-h-11 flex-1 px-4 font-semibold inline-flex items-center justify-center gap-2">
            <UserPlus size={17} /> {busy ? 'Đang tạo…' : 'Tạo chủ trọ'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Họ tên" className="sm:col-span-2">
          <input className={inputClass} value={form.fullName} onChange={set('fullName')} autoComplete="off" placeholder="Nguyễn Văn A" />
        </Field>
        <Field label="Số điện thoại">
          <input className={cn(inputClass, 'font-num')} value={form.phone} onChange={set('phone')} inputMode="tel" autoComplete="off" placeholder="09xxxxxxxx" />
        </Field>
        <Field label="Mật khẩu ban đầu">
          <input className={inputClass} value={form.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Field label="Email (tuỳ chọn)" className="sm:col-span-2">
          <input className={inputClass} value={form.email} onChange={set('email')} type="email" inputMode="email" autoComplete="off" />
        </Field>
        {error && <p role="alert" className="sm:col-span-2 apple-callout font-semibold text-rose-600">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// + Căn trọ: four steps, the last one creates everything at once.
// ---------------------------------------------------------------------------

interface ServiceModule { key: string; label: string; price_per_room: number; core: number }

const money = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} đ`;

/** The tiện ích price list, shared by every dialog. reload() after prices change. */
let catalogCache: Promise<ServiceModule[]> | null = null;
function fetchCatalog(fresh = false): Promise<ServiceModule[]> {
  if (fresh || !catalogCache) {
    catalogCache = send<{ modules: ServiceModule[] }>('/api/dev/modules', 'GET').then((d) => {
      if (!d.success) { catalogCache = null; return []; }
      return d.modules;
    });
  }
  return catalogCache;
}
function useCatalog() {
  const [catalog, setCatalog] = useState<ServiceModule[]>([]);
  useEffect(() => { fetchCatalog().then(setCatalog); }, []);
  return catalog;
}

const STEPS = ['Thông tin', 'Cấu trúc', 'Tên phòng', 'Tiện ích'] as const;

type Scheme = 'floor' | 'sequence';
interface PlannedRoom { key: string; floor: number; name: string; capacity: number }

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** "Nhà trọ Trung Kim" → "NTTK". */
const initials = (name: string) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'D').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 10);

/**
 * Room names from the structure. "floor": 101, 102 … 201 (with a ground floor, floor 1 is G01, G02 and
 * floor 2 becomes 101). "sequence": P01, P02 … across the whole house. The prefix goes in front of either.
 */
function planRooms(perFloor: number[], scheme: Scheme, prefix: string, ground: boolean, capacity: number): Omit<PlannedRoom, 'key'>[] {
  const total = perFloor.reduce((a, b) => a + b, 0);
  const seqWidth = Math.max(2, String(total).length);
  const rooms: Omit<PlannedRoom, 'key'>[] = [];
  let seq = 0;
  perFloor.forEach((count, index) => {
    const floor = index + 1;
    const width = Math.max(2, String(count).length);
    for (let i = 1; i <= count; i++) {
      seq++;
      let name: string;
      if (scheme === 'sequence') name = `${prefix || 'P'}${pad(seq, seqWidth)}`;
      else if (ground && floor === 1) name = `${prefix}G${pad(i, width)}`;
      else name = `${prefix}${ground ? floor - 1 : floor}${pad(i, width)}`;
      rooms.push({ floor, name: name.toUpperCase(), capacity });
    }
  });
  return rooms;
}

const floorLabel = (floor: number, ground: boolean) => (ground ? (floor === 1 ? 'Tầng trệt' : `Lầu ${floor - 1}`) : `Tầng ${floor}`);

function HouseWizard({ landlord, onClose, onCreated }: { landlord: Landlord; onClose: () => void; onCreated: (name: string, rooms: number) => void }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 1. Thông tin
  const [name, setName] = useState('');
  const [abbr, setAbbr] = useState('');
  const [abbrTouched, setAbbrTouched] = useState(false);
  const [province, setProvince] = useState('');
  const [ward, setWard] = useState('');
  const [detail, setDetail] = useState('');

  // 2. Cấu trúc
  const [floors, setFloors] = useState(3);
  const [roomsPerFloor, setRoomsPerFloor] = useState(5);
  const [varies, setVaries] = useState(false);
  const [custom, setCustom] = useState<number[]>([]);
  const [capacity, setCapacity] = useState(3);
  const [price, setPrice] = useState('');

  // 3. Tên phòng
  const [scheme, setScheme] = useState<Scheme>('floor');
  const [prefix, setPrefix] = useState('');
  const [ground, setGround] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, { name?: string; capacity?: number }>>({});
  const [editing, setEditing] = useState<string | null>(null);

  // 4. Tiện ích
  const catalog = useCatalog();
  const [modules, setModules] = useState<string[] | null>(null);
  const picked = modules ?? catalog.map((m) => m.key); // every tool until the developer unticks some

  useEffect(() => { if (!abbrTouched) setAbbr(initials(name)); }, [name, abbrTouched]);

  const clampInt = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
  const perFloor = useMemo(
    () => Array.from({ length: floors }, (_, i) => (varies ? custom[i] ?? roomsPerFloor : roomsPerFloor)),
    [floors, roomsPerFloor, varies, custom]
  );

  // Keys are positions (floor-index), so a rename survives changing the naming scheme.
  const rooms: PlannedRoom[] = useMemo(() => {
    const counters: Record<number, number> = {};
    return planRooms(perFloor, scheme, prefix.trim(), ground && scheme === 'floor', capacity).map((r) => {
      counters[r.floor] = (counters[r.floor] ?? 0) + 1;
      const key = `${r.floor}-${counters[r.floor]}`;
      const o = overrides[key];
      return { key, floor: r.floor, name: (o?.name ?? r.name).toUpperCase(), capacity: o?.capacity ?? r.capacity };
    });
  }, [perFloor, scheme, prefix, ground, capacity, overrides]);

  const duplicates = useMemo(() => {
    const count = new Map<string, number>();
    rooms.forEach((r) => count.set(r.name, (count.get(r.name) ?? 0) + 1));
    return new Set([...count].filter(([, n]) => n > 1).map(([n]) => n));
  }, [rooms]);

  const totalBeds = rooms.reduce((n, r) => n + r.capacity, 0);

  const stepError = (): string => {
    if (step === 0 && (!name.trim() || !abbr.trim())) return 'Vui lòng nhập tên căn trọ và tên viết tắt.';
    if (step === 1 && (rooms.length === 0 || perFloor.some((n) => n < 1))) return 'Mỗi tầng cần ít nhất 1 phòng.';
    if (step === 1 && rooms.length > 500) return 'Một căn tối đa 500 phòng.';
    if (step === 2 && rooms.some((r) => !r.name.trim())) return 'Có phòng chưa có tên.';
    if (step === 2 && duplicates.size) return `Tên phòng bị trùng: ${[...duplicates].slice(0, 5).join(', ')}.`;
    return '';
  };

  const next = () => {
    const problem = stepError();
    setError(problem);
    if (!problem) setStep((s) => s + 1);
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    const data = await send<{ id: string; rooms: number }>(`/api/dev/landlords/${landlord.id}/houses`, 'POST', {
      name: name.trim(),
      abbreviation: abbr.trim(),
      address_detail: detail.trim(),
      ward,
      province,
      floors,
      price: Number(String(price).replace(/\D/g, '')) || 0,
      modules: picked,
      rooms: rooms.map(({ name, floor, capacity }) => ({ name, floor, capacity })),
    });
    setBusy(false);
    if (!data.success) return setError(data.error || 'Chưa tạo được căn trọ.');
    onCreated(name.trim(), data.rooms);
  };

  const editRoom = rooms.find((r) => r.key === editing);
  const setOverride = (key: string, patch: { name?: string; capacity?: number }) =>
    setOverrides((o) => ({ ...o, [key]: { ...o[key], ...patch } }));

  const isLast = step === STEPS.length - 1;

  return (
    <Dialog
      title="Căn trọ mới"
      subtitle={`Cho chủ trọ ${landlord.full_name}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={() => (step ? (setError(''), setStep(step - 1)) : onClose())} disabled={busy} className="soft-button min-h-11 flex-1 px-4 inline-flex items-center justify-center gap-1.5">
            {step ? <><ChevronLeft size={17} /> Quay lại</> : 'Huỷ'}
          </button>
          <button
            type="button"
            onClick={isLast ? submit : next}
            disabled={busy}
            className="primary-button min-h-11 flex-1 px-4 font-semibold inline-flex items-center justify-center gap-1.5"
          >
            {isLast ? <><Check size={17} /> {busy ? 'Đang tạo…' : `Tạo căn trọ (${rooms.length} phòng)`}</> : <>Tiếp <ChevronRight size={17} /></>}
          </button>
        </>
      }
    >
      <ol className="mb-5 grid grid-cols-4 gap-1.5" aria-label="Các bước">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined}>
            <div className={cn('h-1 rounded-full', i <= step ? 'bg-neutral-900 dark:bg-white' : 'bg-black/10 dark:bg-white/15')} />
            <p className={cn('mt-1.5 text-[13px] leading-[18px] truncate', i === step ? 'kit-text-primary font-semibold' : 'kit-text-secondary')}>
              {i + 1}. {label}
            </p>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tên căn trọ" className="sm:col-span-2">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nhà trọ Trung Kim" autoComplete="off" />
          </Field>
          <Field label="Tên viết tắt" hint="Mã của căn, không trùng với căn khác.">
            <input className={cn(inputClass, 'uppercase')} value={abbr} onChange={(e) => { setAbbrTouched(true); setAbbr(e.target.value.toUpperCase()); }} maxLength={20} autoComplete="off" />
          </Field>
          <div className="hidden sm:block" />
          <AddressSelect province={province} ward={ward} onChange={(p, w) => { setProvince(p); setWard(w); }} />
          <Field label="Số nhà, tên đường" className="sm:col-span-2">
            <input className={inputClass} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="116/32 Đường 17" autoComplete="off" />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div className="grid gap-4 grid-cols-2">
            <Field label="Số tầng">
              <input className={cn(inputClass, 'font-num')} type="number" min={1} max={50} value={floors} onChange={(e) => setFloors(clampInt(e.target.value, 1, 50))} />
            </Field>
            <Field label="Số phòng mỗi tầng">
              <input className={cn(inputClass, 'font-num disabled:opacity-60')} type="number" min={1} max={100} value={roomsPerFloor} disabled={varies} onChange={(e) => setRoomsPerFloor(clampInt(e.target.value, 1, 100))} />
            </Field>
            <Field label="Số người tối đa / phòng">
              <input className={cn(inputClass, 'font-num')} type="number" min={1} max={20} value={capacity} onChange={(e) => setCapacity(clampInt(e.target.value, 1, 20))} />
            </Field>
            <Field label="Giá thuê mặc định (đ/tháng)" hint="Có thể để trống, sửa sau.">
              <input className={cn(inputClass, 'font-num')} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, '') ? Number(e.target.value.replace(/\D/g, '')).toLocaleString('vi-VN') : '')} placeholder="3.000.000" />
            </Field>
          </div>

          <label className="flex min-h-11 items-center gap-3 cursor-pointer">
            <input type="checkbox" className="h-5 w-5" checked={varies} onChange={(e) => { setVaries(e.target.checked); setCustom(perFloor); }} />
            <span className="apple-body kit-text-primary">Mỗi tầng có số phòng khác nhau</span>
          </label>

          {varies && (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              {Array.from({ length: floors }, (_, i) => (
                <Field key={i} label={`Tầng ${i + 1}`}>
                  <input
                    className={cn(inputClass, 'font-num')}
                    type="number"
                    min={1}
                    max={100}
                    value={perFloor[i]}
                    onChange={(e) => setCustom((c) => { const list = [...perFloor]; list[i] = clampInt(e.target.value, 1, 100); return list; })}
                  />
                </Field>
              ))}
            </div>
          )}

          <p className="apple-callout kit-text-secondary font-num">
            Tổng: <b className="kit-text-primary">{rooms.length} phòng</b> · tối đa {totalBeds} người
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cách đặt tên">
              <select className={inputClass} value={scheme} onChange={(e) => { setScheme(e.target.value as Scheme); setOverrides({}); }}>
                <option value="floor">Theo tầng (101, 102, 201…)</option>
                <option value="sequence">Đánh số liên tục (P01, P02…)</option>
              </select>
            </Field>
            <Field label="Tiền tố (tuỳ chọn)" hint={scheme === 'floor' ? 'Ví dụ A → A101, A102.' : 'Để trống sẽ dùng P.'}>
              <input className={cn(inputClass, 'uppercase')} value={prefix} maxLength={4} onChange={(e) => { setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setOverrides({}); }} />
            </Field>
          </div>
          {scheme === 'floor' && (
            <label className="flex min-h-11 items-center gap-3 cursor-pointer">
              <input type="checkbox" className="h-5 w-5" checked={ground} onChange={(e) => { setGround(e.target.checked); setOverrides({}); }} />
              <span className="apple-body kit-text-primary">Tầng 1 là tầng trệt (G01, G02…), tầng 2 là lầu 1 (101…)</span>
            </label>
          )}

          <p className="apple-callout kit-text-secondary">Bấm vào một phòng để đổi tên hoặc số người.</p>

          <div className="space-y-3">
            {perFloor.map((_, i) => {
              const floor = i + 1;
              return (
                <div key={floor} className="border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
                  <p className="text-[13px] leading-[18px] font-semibold kit-text-secondary mb-2">{floorLabel(floor, ground && scheme === 'floor')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {rooms.filter((r) => r.floor === floor).map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => setEditing(editing === r.key ? null : r.key)}
                        aria-pressed={editing === r.key}
                        className={cn(
                          'min-h-11 min-w-[64px] rounded-xl border px-2.5 text-left transition-colors',
                          duplicates.has(r.name) ? 'border-rose-500 text-rose-600' : 'border-black/10 dark:border-white/15',
                          editing === r.key ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'kit-text-primary hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                        )}
                      >
                        <span className="block text-sm font-semibold font-num leading-tight">{r.name || '—'}</span>
                        <span className="block text-[11px] opacity-70 font-num leading-tight">{r.capacity} người</span>
                      </button>
                    ))}
                  </div>
                  {editRoom && editRoom.floor === floor && (
                    <div className="mt-3 grid grid-cols-[1fr_120px_auto] items-end gap-2">
                      <Field label="Tên phòng">
                        <input className={cn(inputClass, 'uppercase font-num')} value={editRoom.name} maxLength={20} autoFocus onChange={(e) => setOverride(editRoom.key, { name: e.target.value.toUpperCase() })} />
                      </Field>
                      <Field label="Số người">
                        <input className={cn(inputClass, 'font-num')} type="number" min={1} max={20} value={editRoom.capacity} onChange={(e) => setOverride(editRoom.key, { capacity: clampInt(e.target.value, 1, 20) })} />
                      </Field>
                      <button type="button" onClick={() => setEditing(null)} className="soft-button min-h-11 px-3 text-sm font-semibold">Xong</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <ModulePicker catalog={catalog} value={picked} onChange={setModules} rooms={rooms.length} />

          <dl className="border-t border-black/[0.06] pt-4 dark:border-white/[0.08] grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 apple-callout">
            <dt className="kit-text-secondary">Căn trọ</dt>
            <dd className="kit-text-primary font-medium">{name} · {abbr}</dd>
            <dt className="kit-text-secondary">Địa chỉ</dt>
            <dd className="kit-text-primary">{[detail, ward, province].filter(Boolean).join(', ') || '—'}</dd>
            <dt className="kit-text-secondary">Cấu trúc</dt>
            <dd className="kit-text-primary font-num">{floors} tầng · {rooms.length} phòng · tối đa {totalBeds} người</dd>
            <dt className="kit-text-secondary">Giá thuê</dt>
            <dd className="kit-text-primary font-num">{price ? `${price} đ/tháng` : 'Chưa đặt'}</dd>
            <dt className="kit-text-secondary">Phí dịch vụ</dt>
            <dd className="kit-text-primary font-num font-semibold">{money(rooms.length * perRoom(catalog, picked))}/tháng</dd>
          </dl>
        </div>
      )}

      {error && <p role="alert" className="mt-4 apple-callout font-semibold text-rose-600">{error}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Pieces shared by the wizard and the editor
// ---------------------------------------------------------------------------

/** New provinces and wards only. A value from older data that is not in the list is still shown. */
function AddressSelect({ province, ward, onChange }: { province: string; ward: string; onChange: (province: string, ward: string) => void }) {
  const [provinces, setProvinces] = useState<VnProvince[]>([]);
  useEffect(() => { loadProvinces().then(setProvinces).catch(() => {}); }, []);
  const wards = provinces.find((p) => p.n === province)?.w ?? [];
  const provinceKnown = !province || provinces.some((p) => p.n === province);
  const wardKnown = !ward || wards.includes(ward);
  return (
    <>
      <Field label="Tỉnh / Thành phố">
        <select className={inputClass} value={province} onChange={(e) => onChange(e.target.value, '')}>
          <option value="">Chọn tỉnh / thành phố</option>
          {!provinceKnown && <option value={province}>{province}</option>}
          {provinces.map((p) => <option key={p.n} value={p.n}>{p.n}</option>)}
        </select>
      </Field>
      <Field label="Phường / Xã">
        <select className={cn(inputClass, 'disabled:opacity-60')} value={ward} disabled={!province} onChange={(e) => onChange(province, e.target.value)}>
          <option value="">Chọn phường / xã</option>
          {!wardKnown && <option value={ward}>{ward}</option>}
          {wards.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </Field>
    </>
  );
}

const perRoom = (catalog: ServiceModule[], keys: string[]) =>
  catalog.filter((m) => keys.includes(m.key)).reduce((sum, m) => sum + m.price_per_room, 0);

/**
 * The admin tools (mục Tiện ích of the admin page) this house gets. Core tools are always on.
 * The fee is the number of rooms times the sum of the picked tools' prices per room.
 */
function ModulePicker({ catalog, value, onChange, rooms }: { catalog: ServiceModule[]; value: string[]; onChange: (keys: string[]) => void; rooms: number }) {
  const toggle = (key: string) => onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  const each = perRoom(catalog, value);
  return (
    <div>
      <p className="apple-callout font-medium kit-text-secondary">Tiện ích quản lý (mục Tiện ích của trang admin)</p>
      {catalog.length === 0 && <p className="mt-2 apple-callout kit-text-secondary">Đang tải bảng giá…</p>}
      <ul className="mt-2 divide-y divide-black/[0.06] dark:divide-white/[0.08]">
        {catalog.map((m) => {
          const on = Boolean(m.core) || value.includes(m.key);
          return (
            <li key={m.key}>
              <label className={cn('flex min-h-12 items-center gap-3 py-1.5', m.core ? 'cursor-default' : 'cursor-pointer')}>
                <input type="checkbox" className="h-5 w-5 shrink-0" checked={on} disabled={Boolean(m.core)} onChange={() => toggle(m.key)} />
                <span className="min-w-0 flex-1 apple-body kit-text-primary">
                  {m.label}
                  {Boolean(m.core) && <span className="ml-2 text-[12px] font-semibold kit-text-secondary">Cơ bản · luôn bật</span>}
                </span>
                <span className="shrink-0 apple-callout font-num kit-text-secondary">{m.price_per_room ? `${money(m.price_per_room)}/phòng` : 'Chưa đặt giá'}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 border-t border-black/[0.06] pt-3 apple-callout kit-text-secondary font-num dark:border-white/[0.08]">
        Phí: {rooms} phòng × {money(each)} = <b className="kit-text-primary">{money(rooms * each)}/tháng</b>
      </p>
    </div>
  );
}

/** Developer's price list: price per room per month of each tiện ích. */
function PriceDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<(ServiceModule & { input: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    fetchCatalog(true).then((list) => setRows(list.map((m) => ({ ...m, input: m.price_per_room ? m.price_per_room.toLocaleString('vi-VN') : '' }))));
  }, []);
  const digits = (text: string) => Number(text.replace(/\D/g, '')) || 0;

  const save = async () => {
    setBusy(true);
    setError('');
    for (const r of rows.filter((r) => digits(r.input) !== r.price_per_room)) {
      const data = await send(`/api/dev/modules/${encodeURIComponent(r.key)}`, 'PUT', { price_per_room: digits(r.input) });
      if (!data.success) { setBusy(false); return setError(`${r.label}: ${data.error || 'chưa lưu được.'}`); }
    }
    await fetchCatalog(true);
    setBusy(false);
    onSaved();
  };

  return (
    <Dialog
      title="Bảng giá tiện ích"
      subtitle="Giá theo phòng mỗi tháng. Đổi giá áp dụng cho mọi căn đang dùng tiện ích đó."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="soft-button min-h-11 flex-1 px-4">Huỷ</button>
          <button type="button" onClick={save} disabled={busy || !rows.length} className="primary-button min-h-11 flex-1 px-4 font-semibold inline-flex items-center justify-center gap-2">
            <Check size={17} /> {busy ? 'Đang lưu…' : 'Lưu bảng giá'}
          </button>
        </>
      }
    >
      <ul className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
        {rows.map((r, i) => (
          <li key={r.key} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1 apple-body kit-text-primary">
              {r.label}
              {Boolean(r.core) && <span className="block text-[12px] font-semibold kit-text-secondary">Cơ bản · luôn bật</span>}
            </span>
            <input
              className={cn(inputClass, 'w-36 text-right font-num')}
              inputMode="numeric"
              aria-label={`Giá ${r.label} mỗi phòng`}
              value={r.input}
              placeholder="0"
              onChange={(e) => {
                const n = digits(e.target.value);
                setRows(rows.map((x, j) => (j === i ? { ...x, input: e.target.value.replace(/\D/g, '') ? n.toLocaleString('vi-VN') : '' } : x)));
              }}
            />
            <span className="shrink-0 text-[13px] kit-text-secondary">đ/phòng</span>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-3 apple-callout font-semibold text-rose-600">{error}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sửa căn trọ: info is saved with one button; room changes are saved one at a time, right away.
// ---------------------------------------------------------------------------

interface EditRoom { id: number; name: string; floor: number | null; capacity: number; occupants: number; pay_no: number | null }
interface EditHouse { id: string; name: string; abbreviation: string; address_detail: string; ward: string; province: string; floors: number | null; modules: string[]; pay_no?: number | null }

/** The next free name on a floor: after 101…105 comes 106; an empty floor 3 starts at 301. */
function nextRoomName(floor: number, onFloor: string[], all: Set<string>): string {
  // Follow the highest numbered room already on this floor (G01…, 101… on a house with a ground floor).
  let prefix = '';
  let width = 3;
  let max = -1;
  for (const name of onFloor) {
    const m = name.match(/^(.*?)(\d+)$/);
    if (m && Number(m[2]) > max) { prefix = m[1]; width = m[2].length; max = Number(m[2]); }
  }
  if (max < 0) max = floor * 100;
  let n = max + 1;
  while (all.has(`${prefix}${pad(n, width)}`)) n++;
  return `${prefix}${pad(n, width)}`;
}

function HouseEditor({ houseId, onClose, onDeleted }: { houseId: string; onClose: () => void; onDeleted: (name: string, deleteAfter: string) => void }) {
  const [tab, setTab] = useState<'info' | 'rooms'>('rooms');
  const [house, setHouse] = useState<EditHouse | null>(null);
  const [form, setForm] = useState<EditHouse | null>(null);
  const [rooms, setRooms] = useState<EditRoom[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: '', floor: 1, capacity: 1 });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmHouseDelete, setConfirmHouseDelete] = useState(false);
  const catalog = useCatalog();

  const load = useCallback(async () => {
    const data = await send<{ house: EditHouse; rooms: EditRoom[] }>(`/api/dev/houses/${encodeURIComponent(houseId)}`, 'GET');
    if (!data.success) return setNotice({ ok: false, text: data.error || 'Chưa tải được căn trọ.' });
    const floors = data.house.floors ?? Math.max(1, ...data.rooms.map((r) => r.floor ?? 1));
    setHouse({ ...data.house, floors });
    setForm((f) => f ?? { ...data.house, floors });
    setRooms(data.rooms);
  }, [houseId]);

  useEffect(() => { load(); }, [load]);

  const run = async (path: string, method: string, body: unknown, ok: string) => {
    setBusy(true);
    setNotice(null);
    const data = await send(path, method, body);
    setBusy(false);
    setNotice(data.success ? { ok: true, text: ok } : { ok: false, text: data.error || 'Chưa lưu được.' });
    if (data.success) await load();
    return data.success;
  };

  const base = `/api/dev/houses/${encodeURIComponent(houseId)}`;
  const floors = house?.floors ?? 1;
  const allNames = useMemo(() => new Set(rooms.map((r) => r.name)), [rooms]);
  const usualCapacity = useMemo(() => {
    const count = new Map<number, number>();
    rooms.forEach((r) => count.set(r.capacity, (count.get(r.capacity) ?? 0) + 1));
    return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 3;
  }, [rooms]);

  const pick = (r: EditRoom) => {
    setConfirmDelete(false);
    if (selected === r.id) return setSelected(null);
    setSelected(r.id);
    setDraft({ name: r.name, floor: r.floor ?? 1, capacity: r.capacity });
  };

  const addRoom = async (floor: number) => {
    const name = nextRoomName(floor, rooms.filter((r) => r.floor === floor).map((r) => r.name), allNames);
    if (await run(`${base}/rooms`, 'POST', { rooms: [{ name, floor, capacity: usualCapacity }] }, `Đã thêm phòng ${name}. Bấm vào phòng để đổi tên nếu cần.`)) setSelected(null);
  };

  const addFloor = () => run(base, 'PATCH', { floors: floors + 1 }, `Đã thêm tầng ${floors + 1}.`);
  const removeFloor = () => run(base, 'PATCH', { floors: floors - 1 }, `Đã bỏ tầng ${floors}.`);

  const saveRoom = async (r: EditRoom) => {
    if (await run(`${base}/rooms/${r.id}`, 'PATCH', draft, `Đã lưu phòng ${draft.name.toUpperCase()}.`)) setSelected(null);
  };

  const deleteRoom = async (r: EditRoom) => {
    if (!confirmDelete) return setConfirmDelete(true);
    if (await run(`${base}/rooms/${r.id}`, 'DELETE', undefined, `Đã xoá phòng ${r.name}.`)) setSelected(null);
    setConfirmDelete(false);
  };

  const deleteHouse = async () => {
    if (!house) return;
    if (!confirmHouseDelete) return setConfirmHouseDelete(true);
    setBusy(true);
    const data = await send<{ deleteAfter: string }>(`${base}/delete`, 'POST');
    setBusy(false);
    setConfirmHouseDelete(false);
    if (!data.success) return setNotice({ ok: false, text: data.error || 'Chưa xoá được căn trọ.' });
    onDeleted(house.name, data.deleteAfter);
  };

  const saveInfo = () => {
    if (!form) return;
    const { name, abbreviation, address_detail, ward, province, modules } = form;
    run(base, 'PATCH', { name, abbreviation, address_detail, ward, province, modules }, 'Đã lưu thông tin và tiện ích.');
  };

  const groups: { floor: number | null; label: string }[] = [
    ...Array.from({ length: floors }, (_, i) => ({ floor: i + 1, label: `Tầng ${i + 1}` })),
    ...(rooms.some((r) => r.floor == null) ? [{ floor: null, label: 'Chưa xếp tầng' }] : []),
  ];
  const topFloorEmpty = floors > 1 && !rooms.some((r) => r.floor === floors);

  return (
    <Dialog
      title="Sửa căn trọ"
      subtitle={house ? `${house.name} · ${house.abbreviation}` : 'Đang tải…'}
      onClose={onClose}
      busy={busy}
      footer={
        tab === 'info' ? (
          <>
            <button type="button" onClick={onClose} disabled={busy} className="soft-button min-h-11 flex-1 px-4">Đóng</button>
            <button type="button" onClick={saveInfo} disabled={busy || !form} className="primary-button min-h-11 flex-1 px-4 font-semibold inline-flex items-center justify-center gap-2">
              <Check size={17} /> {busy ? 'Đang lưu…' : 'Lưu thông tin'}
            </button>
          </>
        ) : (
          <button type="button" onClick={onClose} disabled={busy} className="soft-button min-h-11 flex-1 px-4">Xong</button>
        )
      }
    >
      <div className="kit-segmented mb-4 grid grid-cols-2 gap-1 p-1" role="tablist">
        {([['rooms', `Phòng (${rooms.length})`], ['info', 'Thông tin & tiện ích']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => { setTab(key); setNotice(null); }}
            className={cn('kit-segment min-h-11 px-3 apple-body font-medium', tab === key && 'kit-segment-active')}
          >
            {label}
          </button>
        ))}
      </div>

      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={cn('mb-3 apple-callout font-semibold', notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600')}>
          {notice.text}
        </p>
      )}

      {tab === 'info' && form && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tên căn trọ" className="sm:col-span-2">
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Tên viết tắt" hint={`Mã căn ${form.id} giữ nguyên.`}>
              <input className={cn(inputClass, 'uppercase')} value={form.abbreviation} maxLength={20} onChange={(e) => setForm({ ...form, abbreviation: e.target.value.toUpperCase() })} />
            </Field>
            <div className="hidden sm:block" />
            <AddressSelect province={form.province} ward={form.ward} onChange={(province, ward) => setForm({ ...form, province, ward })} />
            <Field label="Số nhà, tên đường" className="sm:col-span-2">
              <input className={inputClass} value={form.address_detail} onChange={(e) => setForm({ ...form, address_detail: e.target.value })} />
            </Field>
          </div>
          <div className="border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
            <ModulePicker catalog={catalog} value={form.modules} onChange={(modules) => setForm({ ...form, modules })} rooms={rooms.length} />
          </div>
          <div className="border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
            <p className="apple-headline text-rose-600">Xoá căn trọ</p>
            <p className="apple-callout kit-text-secondary mt-1">
              Căn chuyển sang <b>chờ xoá</b> trong 7 ngày. Trong thời gian đó bạn tải được bản sao lưu (phòng, cư dân, hoá đơn, thu tiền, thông báo) hoặc khôi phục lại. Hết 7 ngày, mọi dữ liệu của căn bị xoá hẳn và không lấy lại được.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => { const problem = await downloadBackup(houseId); setNotice(problem ? { ok: false, text: problem } : { ok: true, text: 'Đã tải bản sao lưu.' }); }}
                disabled={busy}
                className="soft-button min-h-11 px-4 text-sm font-semibold inline-flex items-center gap-1.5"
              >
                <Download size={15} /> Tải sao lưu
              </button>
              <button
                type="button"
                onClick={deleteHouse}
                disabled={busy}
                className={cn('min-h-11 rounded-2xl px-4 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50', confirmHouseDelete ? 'bg-rose-600 text-white' : 'soft-button text-rose-600')}
              >
                <Trash2 size={15} /> {confirmHouseDelete ? 'Bấm lần nữa để xoá sau 7 ngày' : 'Xoá căn trọ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'rooms' && house && (
        <div className="space-y-3">
          <p className="apple-callout kit-text-secondary">Bấm vào phòng để đổi tên, chuyển tầng, đổi số người hoặc xoá. Thay đổi được lưu ngay.</p>
          {house.pay_no != null && (
            <p className="apple-callout kit-text-secondary">
              Mã chuyển khoản tiền trọ: <b className="font-num kit-text-primary">{pad3(house.pay_no)}</b> (căn) + số phòng 3 số (ghi dưới mỗi phòng) + tháng năm.
              {rooms[0]?.pay_no != null && <> Ví dụ phòng {rooms[0].name} tháng {vnMonthLabel()}: <b className="font-num kit-text-primary">{payCode(house.pay_no, rooms[0].pay_no)}</b>.</>}
            </p>
          )}
          {groups.map(({ floor, label }) => {
            const onFloor = rooms.filter((r) => r.floor === floor);
            const editing = onFloor.find((r) => r.id === selected);
            return (
              <div key={label} className="border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
                <p className="text-[13px] leading-[18px] font-semibold kit-text-secondary mb-2">{label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {onFloor.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => pick(r)}
                      aria-pressed={selected === r.id}
                      className={cn(
                        'min-h-11 min-w-[64px] rounded-xl border border-black/10 px-2.5 text-left transition-colors dark:border-white/15',
                        selected === r.id ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'kit-text-primary hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                      )}
                    >
                      <span className="block text-sm font-semibold font-num leading-tight">{r.name}</span>
                      <span className="block text-[11px] opacity-70 font-num leading-tight">{r.occupants}/{r.capacity} người{r.pay_no != null && ` · ${pad3(r.pay_no)}`}</span>
                    </button>
                  ))}
                  {floor != null && (
                    <button
                      type="button"
                      onClick={() => addRoom(floor)}
                      disabled={busy}
                      aria-label={`Thêm phòng ở ${label}`}
                      className="min-h-11 min-w-[64px] rounded-xl border border-dashed border-black/20 px-2.5 kit-text-secondary inline-flex items-center justify-center gap-1 text-sm font-semibold dark:border-white/25"
                    >
                      <Plus size={15} /> Phòng
                    </button>
                  )}
                </div>

                {editing && (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_120px_110px]">
                      <Field label="Tên phòng" className="col-span-2 sm:col-span-1">
                        <input className={cn(inputClass, 'uppercase font-num')} value={draft.name} maxLength={20} onChange={(e) => setDraft({ ...draft, name: e.target.value.toUpperCase() })} />
                      </Field>
                      <Field label="Tầng">
                        <select className={inputClass} value={draft.floor} onChange={(e) => setDraft({ ...draft, floor: Number(e.target.value) })}>
                          {Array.from({ length: floors }, (_, i) => <option key={i} value={i + 1}>Tầng {i + 1}</option>)}
                        </select>
                      </Field>
                      <Field label="Số người">
                        <input className={cn(inputClass, 'font-num')} type="number" min={Math.max(1, editing.occupants)} max={20} value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: Math.min(20, Math.max(1, Math.round(Number(e.target.value) || 1))) })} />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => saveRoom(editing)} disabled={busy} className="primary-button min-h-11 px-4 text-sm font-semibold inline-flex items-center gap-1.5">
                        <Check size={15} /> Lưu
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRoom(editing)}
                        disabled={busy || editing.occupants > 0}
                        title={editing.occupants > 0 ? 'Phòng đang có người ở' : undefined}
                        className={cn('min-h-11 rounded-2xl px-4 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50', confirmDelete ? 'bg-rose-600 text-white' : 'soft-button text-rose-600')}
                      >
                        <Trash2 size={15} /> {confirmDelete ? `Bấm lần nữa để xoá ${editing.name}` : 'Xoá phòng'}
                      </button>
                      <button type="button" onClick={() => setSelected(null)} disabled={busy} className="soft-button min-h-11 px-4 text-sm font-semibold">Huỷ</button>
                    </div>
                    {editing.occupants > 0 && (
                      <p className="text-[13px] leading-[18px] kit-text-secondary">Phòng đang có {editing.occupants} người nên chưa xoá được.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2 border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
            <button type="button" onClick={addFloor} disabled={busy || floors >= 50} className="soft-button min-h-11 px-4 text-sm font-semibold inline-flex items-center gap-1.5">
              <Plus size={15} /> Thêm tầng
            </button>
            {topFloorEmpty && (
              <button type="button" onClick={removeFloor} disabled={busy} className="soft-button min-h-11 px-4 text-sm font-semibold text-rose-600 inline-flex items-center gap-1.5">
                <Trash2 size={15} /> Bỏ tầng {floors} (đang trống)
              </button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Thu phí dịch vụ qua SePay: the Developer bills each landlord monthly; landlords transfer into the
// Developer's account and SePay's webhook marks the invoice paid from the code in the transfer.
// ---------------------------------------------------------------------------

interface BillingSettings { bankBin: string; bankName: string; accountNo: string; accountName: string; keySet: boolean; webhookUrl: string }
interface ServiceInvoice {
  id: number; full_name: string; phone: string; month: string; amount: number; received: number; code: string;
  status: 'unpaid' | 'paid'; paid_at: string | null; detail: { id: string; name: string; rooms: number; fee: number }[];
}
interface SepayEvent { sepay_id: string; kind: 'service' | 'rent' | 'laundry' | 'none'; amount: number; content: string; house_id: string | null; room: string | null; month: string | null; paid_at: string | null; landlord?: string | null }
const EVENT_LABEL: Record<SepayEvent['kind'], string> = { service: 'Phí dịch vụ', rent: 'Tiền trọ', laundry: 'Giặt sấy', none: 'Không có mã' };
interface ServicePayment { id: number; amount: number; content: string; paid_at: string; simulated: number; code: string | null; full_name: string | null }

const vnMonthNow = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
const monthLabel = (m: string) => `${Number(m.slice(5))}/${m.slice(0, 4)}`;

function BillingCard() {
  const [month, setMonth] = useState(vnMonthNow());
  const [data, setData] = useState<{ settings: BillingSettings; invoices: ServiceInvoice[]; payments: ServicePayment[]; events: SepayEvent[]; unbilled: number } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qrFor, setQrFor] = useState<ServiceInvoice | null>(null);

  const load = useCallback(async () => {
    const d = await send<{ settings: BillingSettings; invoices: ServiceInvoice[]; payments: ServicePayment[]; events: SepayEvent[]; unbilled: number }>(`/api/dev/billing?month=${month}`, 'GET');
    if (!d.success) return setNotice({ ok: false, text: d.error || 'Chưa tải được phần thu phí.' });
    setData(d);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const act = async (path: string, body: unknown, ok: (d: any) => string) => {
    setBusy(true);
    const d = await send(path, 'POST', body);
    setBusy(false);
    setNotice(d.success ? { ok: true, text: ok(d) } : { ok: false, text: d.error || 'Chưa thực hiện được.' });
    load();
  };

  const createInvoices = () =>
    act('/api/dev/billing/invoices', { month }, (d) => (d.created ? `Đã tạo ${d.created} hoá đơn phí tháng ${monthLabel(month)}.` : 'Không có chủ trọ nào cần tạo hoá đơn (đã tạo rồi hoặc phí bằng 0).'));
  const simulate = (inv: ServiceInvoice) =>
    act('/api/dev/billing/simulate', { invoiceId: inv.id, amount: inv.amount - inv.received }, (d) =>
      d.settled ? `Giả lập: đã nhận đủ ${money(d.due)} cho ${inv.code}, hoá đơn chuyển sang Đã thu.` : `Giả lập: đã ghi nhận ${money(d.received)} / ${money(d.due)}.`);

  const s = data?.settings;
  const ready = Boolean(s?.accountNo && s?.bankBin);
  const totals = (data?.invoices ?? []).reduce((t, i) => ({ due: t.due + i.amount, paid: t.paid + (i.status === 'paid' ? i.amount : 0) }), { due: 0, paid: 0 });

  return (
    <section className="liquid-panel mt-5 rounded-[28px] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="apple-title2 font-semibold kit-text-primary">Thu phí dịch vụ · SePay</h2>
          <p className="apple-callout kit-text-secondary font-num">
            Tháng {monthLabel(month)}: đã thu {money(totals.paid)} / {money(totals.due)}
          </p>
        </div>
        <div className="flex gap-2">
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={cn(inputClass, 'w-auto font-num')} aria-label="Tháng" />
          <button type="button" onClick={() => setSettingsOpen(true)} className="soft-button min-h-11 shrink-0 whitespace-nowrap px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
            <Settings size={16} /> Cài đặt
          </button>
        </div>
      </div>

      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={cn('mt-4 apple-callout font-semibold', notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600')}>
          {notice.text}
        </p>
      )}

      {s && (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 apple-callout border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
          <dt className="kit-text-secondary">Nhận tiền vào</dt>
          <dd className="kit-text-primary font-num">{ready ? `${s.bankName} · ${s.accountNo}${s.accountName ? ` · ${s.accountName}` : ''}` : <span className="text-rose-600">Chưa cài đặt</span>}</dd>
          <dt className="kit-text-secondary">API key SePay</dt>
          <dd className={s.keySet ? 'kit-text-primary' : 'text-rose-600'}>{s.keySet ? 'Đã lưu' : 'Chưa có – webhook sẽ từ chối mọi lệnh'}</dd>
          <dt className="kit-text-secondary">Webhook URL</dt>
          <dd className="min-w-0 flex items-center gap-2">
            <code className="truncate text-[13px] kit-text-primary">{s.webhookUrl}</code>
            <button type="button" onClick={() => navigator.clipboard?.writeText(s.webhookUrl).then(() => setNotice({ ok: true, text: 'Đã chép webhook URL.' }))} aria-label="Chép webhook URL" className="soft-button h-9 w-9 shrink-0 inline-flex items-center justify-center">
              <Copy size={14} />
            </button>
          </dd>
        </dl>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
        <p className="apple-headline kit-text-primary">Hoá đơn phí tháng {monthLabel(month)}</p>
        <button type="button" onClick={createInvoices} disabled={busy || !data?.unbilled} className="primary-button min-h-11 px-4 inline-flex items-center gap-2 text-sm font-semibold disabled:opacity-50">
          <Plus size={16} /> {data?.unbilled ? `Tạo hoá đơn (${data.unbilled} chủ trọ)` : 'Đã tạo đủ hoá đơn'}
        </button>
      </div>

      {data && data.invoices.length === 0 && (
        <p className="mt-3 apple-callout kit-text-secondary">Chưa có hoá đơn tháng này. Phí lấy theo số phòng hiện tại × giá trong Bảng giá.</p>
      )}
      <ul className="mt-2 divide-y divide-black/[0.06] dark:divide-white/[0.08]">
        {data?.invoices.map((inv) => (
          <li key={inv.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="apple-body font-medium kit-text-primary">
                {inv.full_name}
                <span className={cn('ml-2 text-[12px] font-bold', inv.status === 'paid' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                  {inv.status === 'paid' ? 'Đã thu' : inv.received ? `Thiếu ${money(inv.amount - inv.received)}` : 'Chưa thu'}
                </span>
              </p>
              <p className="text-[13px] leading-[18px] kit-text-secondary font-num">
                {money(inv.amount)} · mã <b className="kit-text-primary">{inv.code}</b> · {inv.detail.map((h) => `${h.name} (${h.rooms} phòng)`).join(', ')}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => setQrFor(inv)} disabled={!ready} className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold disabled:opacity-50">
                <QrCode size={15} /> QR
              </button>
              {inv.status === 'unpaid' && (
                <button type="button" onClick={() => simulate(inv)} disabled={busy} title="Chạy đúng luồng webhook với một giao dịch giả, không có tiền thật" className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                  <Zap size={15} /> Giả lập chuyển khoản
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {data && data.events.length > 0 && (
        <div className="mt-4 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
          <p className="apple-headline kit-text-primary">Tiền về qua webhook SePay</p>
          <p className="text-[13px] leading-[18px] kit-text-secondary mb-2">Tiền trọ mới được nhận diện (căn, phòng, tháng), chưa tự đánh dấu đã trả.</p>
          <ul className="space-y-1.5">
            {data.events.map((e) => (
              <li key={e.sepay_id} className="flex items-start justify-between gap-3 apple-callout">
                <span className="min-w-0 kit-text-secondary">
                  <span className="kit-text-primary font-medium">{EVENT_LABEL[e.kind]}</span>
                  {e.landlord && ` · SePay của ${e.landlord}`}
                  {e.kind === 'rent' && ` · ${e.house_id ?? 'chưa rõ căn'} · phòng ${e.room} · ${e.month?.slice(5)}/${e.month?.slice(0, 4)}`}
                  {' · '}<span className="break-all">{e.content}</span>
                </span>
                <span className="shrink-0 font-num font-semibold text-emerald-700 dark:text-emerald-300">+{money(e.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && data.payments.length > 0 && (
        <div className="mt-4 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
          <p className="apple-headline kit-text-primary mb-2">Thanh toán phí dịch vụ</p>
          <ul className="space-y-1.5">
            {data.payments.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 apple-callout">
                <span className="min-w-0 kit-text-secondary">
                  <span className="kit-text-primary">{p.code ? `${p.code} · ${p.full_name}` : 'Chưa khớp hoá đơn'}</span>
                  {p.simulated ? ' · giả lập' : ''} · <span className="break-all">{p.content}</span>
                </span>
                <span className="shrink-0 font-num font-semibold text-emerald-700 dark:text-emerald-300">+{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {settingsOpen && s && <BillingSettingsDialog current={s} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); setNotice({ ok: true, text: 'Đã lưu cài đặt thu phí.' }); load(); }} />}
      {qrFor && s && (
        <Dialog
          title={`Chuyển khoản phí tháng ${monthLabel(qrFor.month)}`}
          subtitle={qrFor.full_name}
          onClose={() => setQrFor(null)}
          footer={<button type="button" onClick={() => setQrFor(null)} className="soft-button min-h-11 flex-1 px-4">Đóng</button>}
        >
          <div className="flex flex-col items-center gap-4">
            <img
              src={vietQrUrl({ bankBin: s.bankBin, accountNo: s.accountNo, accountName: s.accountName }, qrFor.amount - qrFor.received, qrFor.code)}
              alt={`Mã QR chuyển ${money(qrFor.amount - qrFor.received)} nội dung ${qrFor.code}`}
              className="h-56 w-56 rounded-xl bg-white p-2"
            />
            <dl className="w-full grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 apple-callout">
              <dt className="kit-text-secondary">Ngân hàng</dt><dd className="kit-text-primary">{s.bankName}</dd>
              <dt className="kit-text-secondary">Số tài khoản</dt><dd className="kit-text-primary font-num">{s.accountNo}</dd>
              <dt className="kit-text-secondary">Nội dung</dt><dd className="kit-text-primary font-num font-bold">{qrFor.code}</dd>
              <dt className="kit-text-secondary">Số tiền</dt><dd className="kit-text-primary font-num font-bold">{money(qrFor.amount - qrFor.received)}</dd>
            </dl>
            <p className="text-[13px] leading-[18px] kit-text-secondary">Gửi QR này cho chủ trọ. Khi tiền về tài khoản, SePay gọi webhook và hoá đơn tự chuyển sang Đã thu.</p>
          </div>
        </Dialog>
      )}
    </section>
  );
}

interface Bank { bin: string; shortName: string; name: string }

function BillingSettingsDialog({ current, onClose, onSaved }: { current: BillingSettings; onClose: () => void; onSaved: () => void }) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [form, setForm] = useState({ bankBin: current.bankBin, accountNo: current.accountNo, accountName: current.accountName, apiKey: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { send<{ banks: Bank[] }>('/api/banks', 'GET').then((d) => setBanks(d.banks ?? [])); }, []);

  const save = async () => {
    setBusy(true);
    setError('');
    const d = await send('/api/dev/billing/settings', 'PUT', form);
    setBusy(false);
    if (!d.success) return setError(d.error || 'Chưa lưu được.');
    onSaved();
  };

  return (
    <Dialog
      title="Cài đặt thu phí SePay"
      subtitle="Tài khoản của bạn (Developer) nhận phí dịch vụ từ chủ trọ."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="soft-button min-h-11 flex-1 px-4">Huỷ</button>
          <button type="button" onClick={save} disabled={busy} className="primary-button min-h-11 flex-1 px-4 font-semibold inline-flex items-center justify-center gap-2">
            <Check size={17} /> {busy ? 'Đang lưu…' : 'Lưu'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ngân hàng" className="sm:col-span-2">
          <select className={inputClass} value={form.bankBin} onChange={(e) => setForm({ ...form, bankBin: e.target.value })}>
            <option value="">{banks.length ? 'Chọn ngân hàng' : 'Đang tải…'}</option>
            {banks.map((b) => <option key={b.bin} value={b.bin}>{b.shortName} – {b.name}</option>)}
          </select>
        </Field>
        <Field label="Số tài khoản (đã liên kết SePay)">
          <input className={cn(inputClass, 'font-num')} inputMode="numeric" value={form.accountNo} onChange={(e) => setForm({ ...form, accountNo: e.target.value })} />
        </Field>
        <Field label="Tên chủ tài khoản">
          <input className={cn(inputClass, 'uppercase')} value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} />
        </Field>
        <Field
          label="API key SePay"
          className="sm:col-span-2"
          hint={current.keySet ? 'Đã có key. Để trống nếu không đổi.' : 'Tạo ở SePay: Cấu hình Webhook → Chứng thực "API Key". Chỉ lưu bản băm, không xem lại được.'}
        >
          <input className={inputClass} type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        </Field>
        <div className="sm:col-span-2 apple-callout kit-text-secondary border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
          Trên SePay, tạo webhook với URL <code className="kit-text-primary break-all">{current.webhookUrl}</code>, sự kiện "Có tiền vào", chứng thực "API Key" bằng đúng key ở trên.
        </div>
        {error && <p role="alert" className="sm:col-span-2 apple-callout font-semibold text-rose-600">{error}</p>}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// SePay OAuth2: the landlord links their own SePay account; Trọ Hub reads their bank accounts and
// puts its webhook on their account. Rent still goes straight to the landlord.
// ---------------------------------------------------------------------------

interface SepayBankAccount { id: number; bank: string; last4: string; holder: string; active: boolean }
type SepayStatus =
  | { connected: false }
  | { connected: true; company: string | null; bankAccounts: SepayBankAccount[]; webhookId: string | null; since: string; updatedAt: string };
interface SepayOverview { configured: boolean; redirectUri: string; connections: Record<string, SepayStatus> }

function SepayLine({ status, onOpen }: { status?: SepayStatus; onOpen: () => void }) {
  const connected = status?.connected === true;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <p className="text-[13px] leading-[18px] kit-text-secondary inline-flex items-center gap-1.5 min-w-0">
        <Landmark size={14} className="shrink-0" />
        {connected
          ? <span className="truncate">
              <b className="text-emerald-700 dark:text-emerald-300">SePay đã kết nối</b>
              {status.bankAccounts.length ? ` · ${status.bankAccounts.map((a) => `${a.bank} ••${a.last4}`).join(', ')}` : ' · chưa có tài khoản ngân hàng'}
              {status.webhookId ? '' : ' · chưa có webhook'}
            </span>
          : <span>Chưa kết nối SePay</span>}
      </p>
      <button type="button" onClick={onOpen} className="soft-button min-h-11 shrink-0 whitespace-nowrap px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
        <Link2 size={14} /> {connected ? 'SePay' : 'Kết nối SePay'}
      </button>
    </div>
  );
}

function SepayDialog({ landlord, overview, onClose }: { landlord: Landlord; overview: SepayOverview; onClose: () => void }) {
  const [status, setStatus] = useState<SepayStatus>(overview.connections[landlord.id] ?? { connected: false });
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const base = `/api/dev/landlords/${landlord.id}/sepay`;

  const makeLink = async () => {
    setBusy(true);
    const data = await send<{ url: string }>(`${base}/connect-url`, 'POST');
    setBusy(false);
    if (data.success) setLink(data.url);
    else setNotice({ ok: false, text: data.error || 'Chưa tạo được link.' });
  };

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link).catch(() => null);
    setNotice({ ok: true, text: 'Đã chép link. Gửi cho chủ trọ qua Zalo, link dùng được 30 phút.' });
  };

  const refresh = async () => {
    setBusy(true);
    const data = await send<{ sepay: SepayStatus }>(`${base}/sync`, 'POST');
    setBusy(false);
    if (data.success) { setStatus(data.sepay); setNotice({ ok: true, text: 'Đã đồng bộ tài khoản ngân hàng và webhook.' }); }
    else setNotice({ ok: false, text: data.error || 'Chưa đồng bộ được.' });
  };

  const disconnect = async () => {
    if (!confirmOff) { setConfirmOff(true); return; }
    setBusy(true);
    const data = await send<{ webhookRemoved: boolean }>(`${base}/disconnect`, 'POST');
    setBusy(false);
    setConfirmOff(false);
    if (!data.success) { setNotice({ ok: false, text: data.error || 'Chưa ngắt được.' }); return; }
    setStatus({ connected: false });
    setLink(null);
    setNotice({ ok: true, text: data.webhookRemoved ? 'Đã ngắt kết nối và xoá webhook Trọ Hub trên SePay của chủ trọ.' : 'Đã ngắt kết nối. Chưa xoá được webhook trên SePay: chủ trọ tự xoá trong my.sepay.vn.' });
  };

  return (
    <Dialog
      title="Kết nối SePay"
      subtitle={landlord.full_name}
      onClose={onClose}
      busy={busy}
      footer={<button type="button" onClick={onClose} className="soft-button min-h-11 px-4 text-sm font-semibold">Xong</button>}
    >
      {!overview.configured && (
        <p className="mb-4 rounded-2xl bg-amber-500/10 p-3 apple-callout text-amber-800 dark:text-amber-200">
          Chưa cài ứng dụng OAuth của Trọ Hub trên SePay. SePay cấp <b>client_id</b> và <b>client_secret</b> khi bạn đăng ký ứng dụng,
          với địa chỉ chuyển hướng <span className="font-num break-all">{overview.redirectUri}</span>.
        </p>
      )}

      {status.connected ? (
        <div className="space-y-3">
          <p className="apple-body kit-text-primary">
            Đã kết nối{status.company ? <> với <b>{status.company}</b></> : ''} lúc {d1Time(status.since)}.
          </p>
          <div>
            <p className="apple-callout font-semibold kit-text-primary">Tài khoản ngân hàng nhận tiền</p>
            {status.bankAccounts.length ? (
              <ul className="mt-1 space-y-1">
                {status.bankAccounts.map((a) => (
                  <li key={a.id} className="apple-callout kit-text-secondary font-num">
                    {a.bank} ••{a.last4}{a.active ? '' : ' (đang tắt)'}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="apple-callout kit-text-secondary">Chủ trọ chưa liên kết tài khoản ngân hàng nào trong SePay.</p>
            )}
          </div>
          <p className="apple-callout kit-text-secondary">
            {status.webhookId
              ? 'Trọ Hub đã tạo webhook “Trọ Hub – báo tiền trọ” trên SePay của chủ trọ: mỗi khoản tiền vào sẽ báo về Trọ Hub.'
              : 'Chưa có webhook. Bấm Đồng bộ sau khi chủ trọ liên kết tài khoản ngân hàng.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={refresh} className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
              <RefreshCw size={14} /> Đồng bộ
            </button>
            <button type="button" disabled={busy} onClick={disconnect} className={cn('soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold', confirmOff && 'text-rose-600')}>
              <Unplug size={14} /> {confirmOff ? 'Bấm lần nữa để ngắt' : 'Ngắt kết nối'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="apple-body kit-text-primary">
            Chủ trọ đăng nhập SePay của chính họ và bấm đồng ý. Trọ Hub không biết mật khẩu SePay hay ngân hàng của họ.
          </p>
          <ol className="list-decimal pl-5 apple-callout kit-text-secondary space-y-1">
            <li>Tạo link, gửi cho chủ trọ (hoặc mở ngay trên máy của chủ trọ).</li>
            <li>Chủ trọ đăng nhập my.sepay.vn và cấp quyền cho Trọ Hub.</li>
            <li>Trọ Hub đọc tài khoản ngân hàng và tự tạo webhook báo tiền trọ.</li>
          </ol>
          {link ? (
            <div className="space-y-2">
              <p className="rounded-2xl bg-black/[0.04] p-3 text-[13px] leading-[18px] font-num break-all kit-text-secondary dark:bg-white/[0.06]">{link}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copy} className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                  <Copy size={14} /> Chép link
                </button>
                <a href={link} target="_blank" rel="noopener noreferrer" className="primary-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                  <Link2 size={14} /> Mở trang SePay
                </a>
                <button type="button" disabled={busy} onClick={refresh} className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                  <RefreshCw size={14} /> Kiểm tra
                </button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={busy || !overview.configured} onClick={makeLink} className="primary-button min-h-11 px-4 inline-flex items-center gap-2 text-sm font-semibold disabled:opacity-50">
              <Link2 size={16} /> Tạo link kết nối
            </button>
          )}
        </div>
      )}

      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={cn('mt-4 apple-callout font-semibold', notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600')}>
          {notice.text}
        </p>
      )}
    </Dialog>
  );
}
