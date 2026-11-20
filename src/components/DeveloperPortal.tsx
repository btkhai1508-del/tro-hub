import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, KeyRound, Landmark, Search, Link2, RefreshCw, Unplug, Copy, LogOut, Loader2, Pencil, Plus, QrCode, RotateCcw, Settings, Trash2, UserPlus, X, Zap } from 'lucide-react';
import { ChevronDown, ChevronLeft, ChevronRight, Lock, Unlock, Download, Tags } from './LineIcons';
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
  const [editLandlord, setEditLandlord] = useState<Landlord | null>(null);
  const [deleteLandlordId, setDeleteLandlordId] = useState<number | null>(null);
  const [deleteHouse, setDeleteHouse] = useState<House | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [tab, setTab] = useState<'landlords' | 'billing' | 'storage'>('landlords');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

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

  const deleteLandlord = landlords?.find((l) => l.id === deleteLandlordId) ?? null;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return landlords ?? [];
    return (landlords ?? []).filter((l) => l.full_name.toLowerCase().includes(q) || l.phone.includes(q.replace(/\s/g, '')));
  }, [landlords, query]);

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
          <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => setPasswordOpen(true)} aria-label="Đổi mật khẩu" className="soft-button min-h-11 min-w-11 px-3 inline-flex items-center justify-center gap-1.5 text-sm font-semibold">
            <KeyRound size={16} /> <span className="hidden sm:inline">Mật khẩu</span>
          </button>
          <button
            type="button"
            onClick={() => { logoutUser(); navigate('/login'); }}
            aria-label="Đăng xuất"
            className="soft-button min-h-11 min-w-11 shrink-0 px-3 inline-flex items-center justify-center gap-1.5 text-sm font-semibold"
            title={profile.name}
          >
            <LogOut size={16} /> <span className="hidden sm:inline">Đăng xuất</span>
          </button>
          </div>
        </header>

        <dl className="liquid-panel mb-4 grid grid-cols-4 rounded-[22px] px-2 py-3 sm:py-4">
          {([['Chủ trọ', String(totals.landlords)], ['Căn', String(totals.houses)], ['Phòng', String(totals.rooms)], ['Phí/tháng', money(totals.fee)]] as const).map(([label, value], i) => (
            <div key={label} className={cn('min-w-0 px-2 text-center', i > 0 && 'border-l border-black/[0.08] dark:border-white/[0.1]')}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide kit-text-secondary truncate">{label}</dt>
              <dd className="mt-0.5 text-base sm:text-xl font-bold kit-text-primary font-num truncate">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Khu vực" className="inline-flex rounded-2xl bg-black/[0.05] p-1 dark:bg-white/[0.07]">
            {([['landlords', 'Chủ trọ'], ['billing', 'Thu phí'], ['storage', 'Lưu trữ']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn('min-h-11 rounded-xl px-4 sm:px-5 text-sm font-semibold', tab === key ? 'bg-white shadow-sm kit-text-primary dark:bg-white/15' : 'kit-text-secondary')}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'landlords' && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setPrices(true)} className="soft-button min-h-11 px-4 inline-flex items-center gap-2 text-sm font-semibold">
                <Tags size={16} /> Bảng giá
              </button>
              <button type="button" onClick={() => setNewLandlord(true)} className="primary-button min-h-11 px-4 inline-flex items-center gap-2 text-sm font-semibold">
                <Plus size={18} /> Chủ trọ
              </button>
            </div>
          )}
        </div>

        {notice && tab === 'landlords' && (
          <p role={notice.ok ? 'status' : 'alert'} className={cn('mb-4 apple-callout font-semibold', notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600')}>
            {notice.text}
          </p>
        )}

        {tab === 'billing' ? (
          <BillingCard />
        ) : tab === 'storage' ? (
          <>
            <SourceCard />
            <HouseDeleteModeCard />
            <StorageCard />
          </>
        ) : (
          <section className="liquid-panel rounded-[28px] p-3 sm:p-4">
            <label className="relative block">
              <span className="sr-only">Tìm chủ trọ</span>
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 kit-text-secondary" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm tên hoặc số điện thoại"
                className={cn(inputClass, 'pl-10')}
              />
            </label>

            {landlords === null && <p className="px-2 py-6 apple-body kit-text-secondary">Đang tải…</p>}
            {landlords?.length === 0 && (
              <p className="px-2 py-6 apple-body kit-text-secondary">Chưa có chủ trọ nào. Bấm <b>+ Chủ trọ</b> để tạo người đầu tiên.</p>
            )}
            {landlords && landlords.length > 0 && shown.length === 0 && (
              <p className="px-2 py-6 apple-body kit-text-secondary">Không có chủ trọ nào khớp “{query}”.</p>
            )}

            <ul className="mt-2 divide-y divide-black/[0.06] dark:divide-white/[0.08]">
              {shown.map((l) => {
                const open = openId === l.id;
                const linked = sepay?.connections[l.id]?.connected === true || Boolean(sepay?.manual?.[l.id]);
                const fee = l.houses.filter((h) => !h.delete_after).reduce((n, h) => n + h.monthly_fee, 0);
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : l.id)}
                      className="flex w-full min-h-11 items-center gap-3 rounded-2xl px-2 py-3 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 apple-headline kit-text-primary">
                          <span className="min-w-0 truncate">{l.full_name}</span>
                          {l.status === 'locked' && <Pill tone="red">Đã khoá</Pill>}
                          <Pill tone={linked ? 'green' : 'gray'}>{linked ? 'SePay' : 'Chưa SePay'}</Pill>
                        </p>
                        <p className="apple-callout kit-text-secondary font-num truncate">
                          {l.phone} · {l.houses.length} căn · {money(fee)}/tháng
                        </p>
                      </div>
                      <ChevronDown size={18} className={cn('shrink-0 kit-text-secondary transition-transform', open && 'rotate-180')} />
                    </button>

                    {open && (
                      <div className="space-y-4 px-2 pb-4">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => setEditLandlord(l)} className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                            <Pencil size={14} /> Sửa
                          </button>
                          <button type="button" onClick={() => toggleLock(l)} className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                            {l.status === 'locked' ? <Unlock size={15} /> : <Lock size={15} />}
                            {l.status === 'locked' ? 'Mở khoá' : 'Khoá'}
                          </button>
                          <button type="button" onClick={() => setHouseFor(l)} className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                            <Plus size={16} /> Căn trọ
                          </button>
                          <button type="button" onClick={() => setDeleteLandlordId(l.id)} aria-label={`Xoá chủ trọ ${l.full_name}`} className={deleteBtn}>
                            <Trash2 size={15} /> Xoá
                          </button>
                        </div>

                        <SepayLine status={sepay?.connections[l.id]} manual={sepay?.manual?.[l.id]} onOpen={() => setSepayFor(l)} />

                        {l.houses.length === 0 && <p className="apple-callout kit-text-secondary">Chưa có căn nào. Bấm <b>+ Căn trọ</b> để tạo.</p>}
                {l.houses.length > 0 && (
                  <ul className="space-y-3">
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
                          <div className="flex shrink-0 flex-wrap justify-end gap-2">
                            <button type="button" onClick={() => setEditHouse(h.id)} aria-label={`Sửa căn ${h.name}`} className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                              <Pencil size={14} /> Sửa
                            </button>
                            <button type="button" onClick={() => setDeleteHouse(h)} aria-label={`Xoá căn ${h.name}`} className={deleteBtn}>
                              <Trash2 size={14} /> Xoá
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>

      {newLandlord && (
        <LandlordDialog
          onClose={() => setNewLandlord(false)}
          onCreated={(name) => { setNewLandlord(false); setNotice({ ok: true, text: `Đã tạo chủ trọ ${name}.` }); load(); }}
        />
      )}
      {editLandlord && (
        <LandlordEditDialog
          landlord={editLandlord}
          onClose={() => { setEditLandlord(null); load(); }}
          onChanged={(text) => { setEditLandlord(null); setNotice({ ok: true, text }); load(); }}
          onOpenDelete={(l) => { setEditLandlord(null); setDeleteLandlordId(l.id); load(); }}
        />
      )}
      {deleteLandlord && (
        <LandlordDeleteDialog
          landlord={deleteLandlord}
          onClose={() => { setDeleteLandlordId(null); load(); }}
          onHouseDeleted={(name, when) => { setNotice({ ok: true, text: houseDeletedText(name, when) }); load(); }}
          onDeleted={(text) => { setDeleteLandlordId(null); setNotice({ ok: true, text }); load(); }}
          onLock={toggleLock}
        />
      )}
      {deleteHouse && (
        <HouseDeleteDialog
          house={deleteHouse}
          onClose={() => setDeleteHouse(null)}
          onDone={(name, when) => { setDeleteHouse(null); setNotice({ ok: true, text: houseDeletedText(name, when) }); load(); }}
        />
      )}
      {passwordOpen && (
        <PasswordDialog
          onClose={() => setPasswordOpen(false)}
          onDone={() => { setPasswordOpen(false); setNotice({ ok: true, text: 'Đã đổi mật khẩu Developer. Các thiết bị khác đã bị đăng xuất.' }); }}
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
          onDeleted={(name, when) => { setEditHouse(null); setNotice({ ok: true, text: houseDeletedText(name, when) }); load(); }}
        />
      )}
    </div>
  );
}

const houseDeletedText = (name: string, when: string | null) =>
  when ? `${name} sẽ bị xoá hẳn lúc ${d1Time(when)}. Trước đó bạn vẫn tải sao lưu hoặc khôi phục được.` : `Đã xoá hẳn ${name}`;

/** Small status label: red for problems, green for done, grey for not yet. */
function Pill({ tone, children }: { tone: 'red' | 'green' | 'gray' | 'amber'; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
      tone === 'red' && 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
      tone === 'green' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      tone === 'amber' && 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
      tone === 'gray' && 'bg-black/[0.05] kit-text-secondary dark:bg-white/[0.08]')}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Lưu trữ: where each landlord's data lives, and the dry run / move / rollback of one landlord

type Backend = 'd1' | 'migrating' | 'do';
interface StorageOwner {
  ownerId: number; name: string; phone: string; houses: number; backend: Backend;
  lockExpiresAt: number | null; migratedAt: string | null; sizeBytes: number | null; rowsWrittenToday: number | null; lastWriteAt: number | null;
}
interface StorageOverview {
  owners: StorageOwner[]; totalBytes: number; rowsWrittenToday: number; warnings: string[];
  freeLimits: { perStoreBytes: number; totalBytes: number; rowsWrittenPerDay: number };
  lastReconcile: { ranAt?: string; indexMismatches?: unknown[]; houseMismatches?: unknown[] } | null;
}
interface StorageReport {
  mode: 'dry-run' | 'migrate' | 'rollback'; ok: boolean; error?: string; warnings?: string[]; deferredReplayed?: number; lockedMs?: number;
  tables: { table: string; d1Count: number; doCount: number; ok: boolean }[];
}
type StorageAction = 'dry-run' | 'migrate' | 'rollback' | 'unlock' | 'clear-store' | 'export';

const BACKEND_PILL: Record<Backend, { tone: 'gray' | 'green' | 'amber'; label: string }> = {
  d1: { tone: 'gray', label: 'D1' },
  migrating: { tone: 'amber', label: 'Đang chuyển' },
  do: { tone: 'green', label: 'Kho riêng' },
};
const ACTION_LABEL: Record<StorageAction, string> = { 'dry-run': 'Chạy thử', migrate: 'Chuyển', rollback: 'Quay lại', unlock: 'Mở khoá', 'clear-store': 'Xoá kho', export: 'Xuất dữ liệu' };

// Cloudflare measures Durable Object storage in decimal units (1 GB = 1,000,000,000 bytes).
const fmtBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
/** A confirming click counts only this long after arming, so a fast double click cannot arm and run in one go. */
const CONFIRM_DELAY_MS = 700;

function UsageBar({ label, value, text, limit }: { label: string; value: number; text: string; limit: number }) {
  const ratio = Math.min(1, value / limit);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="font-semibold kit-text-secondary">{label}</span>
        <span className="font-num kit-text-primary">{text}</span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.1]">
        <div className={cn('h-full rounded-full', ratio >= 0.7 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${Math.max(ratio * 100, value > 0 ? 1.5 : 0)}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nguồn dữ liệu: which side owns invoices (Google Sheet or Worker), the export queue, and the switch

interface SourceOverview { source?: 'sheet' | 'worker'; exportQueue?: { pending: number; failed: { id: number; kind: string; lastError: string }[] } }

function SourceCard() {
  const [data, setData] = useState<SourceOverview | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await send<SourceOverview>('/api/dev/storage', 'GET');
    if (!d.success) return setNotice({ ok: false, text: d.error || 'Chưa tải được nguồn dữ liệu.' });
    setData(d);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toWorker = data?.source !== 'worker';
  const failed = data?.exportQueue?.failed ?? [];

  const requeue = async () => {
    setBusy(true);
    const d = await send<{ requeued: number }>('/api/dev/export-queue/requeue', 'POST');
    setBusy(false);
    setNotice(d.success ? { ok: true, text: `Đã đưa ${d.requeued} dòng lỗi vào hàng đợi để thử lại.` } : { ok: false, text: d.error || 'Chưa thử lại được.' });
    load();
  };

  const flip = async (acknowledgeFailed = false) => {
    if (!acknowledgeFailed) {
      const ok = window.confirm(toWorker
        ? 'Chuyển sang Worker làm nguồn chính? Google Sheet sẽ chỉ còn nhận dữ liệu một chiều, và hệ thống sẽ đọc Sheet lần cuối ngay bây giờ.'
        : 'Quay lại dùng Google Sheet làm nguồn chính? Dữ liệu trên Sheet sẽ được đọc lại và có thể ghi đè số liệu nhập ở Worker.');
      if (!ok) return;
    }
    setBusy(true);
    const d = await send<{ source: string; workerOnlyResidents?: number; draftsCreated?: number; errorCode?: string }>('/api/dev/source', 'PUT', { source: toWorker ? 'worker' : 'sheet', ...(acknowledgeFailed && { acknowledgeFailed: true }) });
    setBusy(false);
    if (d.success) {
      const n = d.workerOnlyResidents ?? 0;
      const drafts = d.draftsCreated ?? 0;
      setNotice({ ok: true, text: `Đã chuyển nguồn dữ liệu sang ${d.source === 'worker' ? 'Worker' : 'Google Sheet'}.${n > 0 ? ` Cảnh báo: ${n} cư dân chỉ có ở Worker, chưa có trên Sheet.` : ''}${drafts > 0 ? ` Đã tạo ${drafts} hoá đơn nháp cho tháng hiện tại.` : ''}` });
    } else if (d.errorCode === 'EXPORT_FAILED') {
      setNotice({ ok: false, text: d.error || 'Có dòng không chép được sang Google Sheet.' });
      if (window.confirm(`${d.error ?? ''}\n\nBỏ qua các dòng lỗi và vẫn quay về Sheet? Số liệu các dòng đó sẽ không có trên Sheet.`)) return flip(true);
    } else {
      // EXPORT_PENDING, ZALO_NOT_CONFIGURED, SYNC_FAILED and the rest: the server's Vietnamese message says what to do.
      setNotice({ ok: false, text: d.error || 'Chưa chuyển được nguồn dữ liệu.' });
    }
    load();
  };

  return (
    <section className="liquid-panel mb-4 rounded-[28px] p-3 sm:p-4" aria-label="Nguồn dữ liệu">
      <h2 className="apple-headline kit-text-primary px-1">Nguồn dữ liệu</h2>
      {notice && <p role="status" className={cn('mt-2 rounded-2xl px-3 py-2 text-[13px] font-semibold', notice.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300')}>{notice.text}</p>}
      {data ? (
        <div className="mt-3 space-y-3 px-1">
          <p className="flex flex-wrap items-center gap-2 text-[13.5px] kit-text-primary">
            Đang dùng: <Pill tone={toWorker ? 'gray' : 'green'}>{toWorker ? 'Google Sheet' : 'Worker'}</Pill>
            <span className="kit-text-secondary">Hàng đợi chép sang Sheet: {data.exportQueue?.pending ?? 0} dòng chờ, {failed.length} dòng lỗi</span>
          </p>
          {failed.length > 0 && (
            <ul className="space-y-1 rounded-2xl bg-black/[0.03] p-3 text-[12.5px] dark:bg-white/[0.05]">
              {failed.map((f) => <li key={f.id} className="font-num kit-text-primary">#{f.id} {f.kind}: <span className="text-rose-600">{f.lastError || 'lỗi'}</span></li>)}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {failed.length > 0 && <button type="button" disabled={busy} onClick={requeue} className="soft-button min-h-11 px-3 text-sm font-semibold disabled:opacity-50">Thử lại</button>}
            <button type="button" disabled={busy} onClick={() => flip()} className="soft-button min-h-11 px-3 text-sm font-semibold disabled:opacity-50">
              {toWorker ? 'Chuyển sang Worker' : 'Quay lại Sheet'}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 px-1 text-[13px] kit-text-secondary">Đang tải…</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Chế độ xoá căn: 7-day grace period (default, for production) or immediate (testing only)

function HouseDeleteModeCard() {
  const [mode, setMode] = useState<'grace' | 'immediate' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    send<{ mode: 'grace' | 'immediate' }>('/api/dev/house-delete-mode', 'GET').then((d) => {
      if (d.success) setMode(d.mode);
      else setNotice({ ok: false, text: d.error || 'Chưa tải được chế độ xoá căn.' });
    });
  }, []);

  const choose = async (next: 'grace' | 'immediate') => {
    if (next === mode) return;
    if (next === 'immediate' && !window.confirm('Chuyển sang xoá ngay? Căn bị xoá sẽ mất hẳn tức thì, không có thời gian chờ 7 ngày, không sao lưu và không hoàn tác được. Chỉ dùng cho tài khoản thử nghiệm.')) return;
    setBusy(true);
    const d = await send<{ mode: 'grace' | 'immediate' }>('/api/dev/house-delete-mode', 'PUT', { mode: next });
    setBusy(false);
    if (d.success) {
      setMode(d.mode);
      setNotice({ ok: true, text: d.mode === 'immediate' ? 'Đã bật xoá ngay (thử nghiệm).' : 'Đã chuyển về chờ 7 ngày.' });
    } else setNotice({ ok: false, text: d.error || 'Chưa đổi được chế độ xoá căn.' });
  };

  return (
    <section className="liquid-panel mb-4 rounded-[28px] p-3 sm:p-4" aria-label="Chế độ xoá căn">
      <h2 className="apple-headline kit-text-primary px-1">Chế độ xoá căn</h2>
      {notice && <p role="status" className={cn('mt-2 rounded-2xl px-3 py-2 text-[13px] font-semibold', notice.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300')}>{notice.text}</p>}
      {mode ? (
        <div className="mt-3 space-y-3 px-1">
          <p className="flex flex-wrap items-center gap-2 text-[13.5px] kit-text-primary">
            Đang dùng: <Pill tone={mode === 'immediate' ? 'red' : 'green'}>{mode === 'immediate' ? 'Xoá ngay' : 'Chờ 7 ngày'}</Pill>
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} aria-pressed={mode === 'immediate'} onClick={() => choose('immediate')} className={cn('min-h-11 rounded-2xl px-3 text-sm font-semibold disabled:opacity-50', mode === 'immediate' ? 'bg-rose-600 text-white' : 'soft-button')}>
              Xoá ngay (đang thử nghiệm)
            </button>
            <button type="button" disabled={busy} aria-pressed={mode === 'grace'} onClick={() => choose('grace')} className={cn('min-h-11 rounded-2xl px-3 text-sm font-semibold disabled:opacity-50', mode === 'grace' ? 'bg-emerald-600 text-white' : 'soft-button')}>
              Chờ 7 ngày (khuyến nghị khi chạy thật)
            </button>
          </div>
          <p className="text-[12.5px] font-semibold text-rose-600">
            Xoá ngay không thể hoàn tác và không có thời gian sao lưu: căn, phòng, cư dân, hoá đơn và thu tiền mất hẳn tức thì. Chỉ bật cho tài khoản thử nghiệm.
          </p>
        </div>
      ) : (
        <p className="mt-2 px-1 text-[13px] kit-text-secondary">Đang tải…</p>
      )}
    </section>
  );
}

function StorageCard() {
  const [data, setData] = useState<StorageOverview | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<{ ownerId: number; action: StorageAction } | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const armedAt = useRef(0);
  const [reports, setReports] = useState<Record<number, { report: StorageReport | null; error?: string }>>({});

  const load = useCallback(async () => {
    const d = await send<StorageOverview>('/api/dev/storage', 'GET');
    if (!d.success) return setNotice({ ok: false, text: d.error || 'Chưa tải được phần lưu trữ.' });
    setData(d);
  }, []);
  useEffect(() => { load(); }, [load]);

  // The first click of a dangerous button arms it for 5 seconds; a second click after 0.7 s and inside that time runs it.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const exportData = async (o: StorageOwner) => {
    const res = await workerFetch(`/api/dev/storage/${o.ownerId}/export`, {}).catch(() => null);
    if (!res || !res.ok) {
      const body = await res?.json().catch(() => null);
      return setNotice({ ok: false, text: body?.error || 'Chưa xuất được dữ liệu.' });
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `tro-hub-chu-tro-${o.ownerId}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice({ ok: true, text: `Đã tải dữ liệu của ${o.name}.` });
  };

  const run = async (o: StorageOwner, action: StorageAction, needConfirm = false) => {
    if (busy) return;
    if (needConfirm) {
      if (armed !== `${o.ownerId}:${action}`) {
        armedAt.current = Date.now();
        return setArmed(`${o.ownerId}:${action}`);
      }
      if (Date.now() - armedAt.current < CONFIRM_DELAY_MS) return; // too soon: still the first click of a double click
    }
    setArmed(null);
    setNotice(null);
    setBusy({ ownerId: o.ownerId, action });
    try {
      if (action === 'export') return await exportData(o);
      const d = await send<{ report?: StorageReport }>(`/api/dev/storage/${o.ownerId}/${action}`, 'POST');
      if (action === 'dry-run' || action === 'migrate' || action === 'rollback') {
        setReports((r) => ({ ...r, [o.ownerId]: { report: d.report ?? null, error: d.success ? undefined : d.error || 'Chưa thực hiện được.' } }));
      } else {
        setNotice(d.success ? { ok: true, text: `${ACTION_LABEL[action]}: xong (${o.name}).` } : { ok: false, text: d.error || 'Chưa thực hiện được.' });
      }
    } finally {
      setBusy(null);
      load();
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.owners ?? []).filter((o) => !q || o.name.toLowerCase().includes(q) || o.phone.includes(q.replace(/\s/g, '')));
  }, [data, query]);

  const btn = 'soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold disabled:opacity-50';
  const dangerBtn = (key: string) => cn(btn, armed === key && 'bg-rose-600 text-white');

  return (
    <section className="liquid-panel rounded-[28px] p-3 sm:p-4">
      {notice && <p role={notice.ok ? 'status' : 'alert'} className={cn('mb-3 apple-callout font-semibold', notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600')}>{notice.text}</p>}

      {data && (
        <div className="mb-3 space-y-3 rounded-2xl bg-black/[0.03] p-3 dark:bg-white/[0.05]">
          <UsageBar label="Tổng dung lượng kho riêng" value={data.totalBytes} text={`${fmtBytes(data.totalBytes)} / ${fmtBytes(data.freeLimits.totalBytes)}`} limit={data.freeLimits.totalBytes} />
          <UsageBar label="Dòng ghi hôm nay" value={data.rowsWrittenToday} text={`${data.rowsWrittenToday.toLocaleString('vi-VN')} / ${data.freeLimits.rowsWrittenPerDay.toLocaleString('vi-VN')}`} limit={data.freeLimits.rowsWrittenPerDay} />
          {data.warnings.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-xl bg-amber-500/10 px-3 py-2 text-[13px] font-semibold text-amber-800 dark:text-amber-300">
              {data.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          {data.lastReconcile?.ranAt && (
            <p className="text-[12px] kit-text-secondary">
              Đối soát gần nhất: {new Date(data.lastReconcile.ranAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} · {(data.lastReconcile.indexMismatches?.length ?? 0) + (data.lastReconcile.houseMismatches?.length ?? 0)} lệch
            </p>
          )}
        </div>
      )}

      <label className="relative block">
        <span className="sr-only">Tìm chủ trọ</span>
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 kit-text-secondary" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tên hoặc số điện thoại" className={cn(inputClass, 'pl-10')} />
      </label>

      {data === null && !notice && <p className="px-2 py-6 apple-body kit-text-secondary">Đang tải…</p>}
      {data && shown.length === 0 && <p className="px-2 py-6 apple-body kit-text-secondary">Không có chủ trọ nào.</p>}

      <ul className="mt-2 divide-y divide-black/[0.06] dark:divide-white/[0.08]">
        {shown.map((o) => {
          const open = openId === o.ownerId;
          const pill = BACKEND_PILL[o.backend];
          const mine = busy?.ownerId === o.ownerId ? busy.action : null;
          const rep = reports[o.ownerId];
          const key = (a: StorageAction) => `${o.ownerId}:${a}`;
          const locked = o.backend === 'migrating';
          return (
            <li key={o.ownerId}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : o.ownerId)}
                className="flex w-full min-h-11 items-center gap-3 rounded-2xl px-2 py-3 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 apple-headline kit-text-primary">
                    <span className="min-w-0 truncate">{o.name}</span>
                    <Pill tone={pill.tone}>{pill.label}</Pill>
                    {mine && <Loader2 size={14} className="animate-spin kit-text-secondary" aria-label="Đang xử lý" />}
                  </p>
                  <p className="apple-callout kit-text-secondary font-num truncate">
                    {o.sizeBytes === null ? 'Chưa có kho riêng' : fmtBytes(o.sizeBytes)} · {o.houses} căn
                  </p>
                </div>
                <ChevronDown size={18} className={cn('shrink-0 kit-text-secondary transition-transform', open && 'rotate-180')} />
              </button>

              {open && (
                <div className="space-y-3 px-2 pb-4">
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
                    <dt className="kit-text-secondary">Dòng ghi hôm nay</dt><dd className="font-num kit-text-primary">{o.rowsWrittenToday === null ? '—' : o.rowsWrittenToday.toLocaleString('vi-VN')}</dd>
                    <dt className="kit-text-secondary">Ghi gần nhất</dt><dd className="font-num kit-text-primary">{o.lastWriteAt ? new Date(o.lastWriteAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—'}</dd>
                    {locked && <><dt className="kit-text-secondary">Khoá hết hạn</dt><dd className="font-num kit-text-primary">{o.lockExpiresAt ? new Date(o.lockExpiresAt).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—'}</dd></>}
                  </dl>

                  <div className="flex flex-wrap gap-2">
                    {o.backend === 'd1' && <button type="button" disabled={!!busy} onClick={() => run(o, 'dry-run')} className={btn}>Chạy thử</button>}
                    {o.backend === 'd1' && (
                      <button type="button" disabled={!!busy} onClick={() => run(o, 'migrate', true)} className={dangerBtn(key('migrate'))}>
                        {armed === key('migrate') ? 'Bấm lần nữa để chuyển' : 'Chuyển'}
                      </button>
                    )}
                    {o.backend === 'do' && (
                      <button type="button" disabled={!!busy} onClick={() => run(o, 'rollback', true)} className={dangerBtn(key('rollback'))}>
                        {armed === key('rollback') ? 'Bấm lần nữa để quay lại' : 'Quay lại'}
                      </button>
                    )}
                    {locked && <button type="button" disabled={!!busy} onClick={() => run(o, 'unlock')} className={btn}><Unlock size={15} /> Mở khoá</button>}
                    {o.backend === 'd1' && (
                      <button type="button" disabled={!!busy} onClick={() => run(o, 'clear-store', true)} className={dangerBtn(key('clear-store'))}>
                        <Trash2 size={15} /> {armed === key('clear-store') ? 'Bấm lần nữa để xoá kho' : 'Xoá kho'}
                      </button>
                    )}
                    <button type="button" disabled={!!busy || locked} onClick={() => run(o, 'export')} className={btn}><Download size={15} /> Xuất dữ liệu</button>
                  </div>

                  {mine && (
                    <p role="status" className="flex items-center gap-2 text-[13px] font-semibold kit-text-secondary">
                      <Loader2 size={15} className="animate-spin" />
                      {mine === 'migrate' || mine === 'rollback' ? `${ACTION_LABEL[mine]}: đang chờ ghi dở dang, mất khoảng 15–20 giây. Đừng đóng trang.` : `${ACTION_LABEL[mine]}…`}
                    </p>
                  )}

                  {rep && (
                    <div className="rounded-2xl bg-black/[0.03] p-3 text-[13px] dark:bg-white/[0.05]">
                      <p className={cn('font-semibold', rep.error ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-300')}>
                        {rep.report ? `${ACTION_LABEL[rep.report.mode]}: ${rep.report.ok ? 'đạt' : 'không đạt'}` : 'Kết quả'}
                        {rep.error ? ` — ${rep.error}` : ''}
                      </p>
                      {rep.report?.warnings?.map((w) => <p key={w} className="mt-1 text-amber-700 dark:text-amber-300">{w}</p>)}
                      {rep.report && rep.report.tables.length > 0 && (
                        <table className="mt-2 w-full text-left font-num">
                          <thead><tr className="kit-text-secondary"><th className="py-0.5 font-semibold">Bảng</th><th className="py-0.5 text-right font-semibold">D1</th><th className="py-0.5 text-right font-semibold">Kho riêng</th><th className="w-6" /></tr></thead>
                          <tbody>
                            {rep.report.tables.map((t) => (
                              <tr key={t.table} className="border-t border-black/[0.06] dark:border-white/[0.08]">
                                <td className="py-0.5">{t.table}</td>
                                <td className="py-0.5 text-right">{t.d1Count}</td>
                                <td className="py-0.5 text-right">{t.doCount}</td>
                                <td className="py-0.5 text-right">{t.ok ? <Check size={13} className="inline text-emerald-600" /> : <X size={13} className="inline text-rose-600" />}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
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

/** The Developer's own password. Every other session of the account is signed out. */
function PasswordDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { updatePassword } = useApp();
  const [form, setForm] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    if (form.next.trim().length < 8) return setError('Mật khẩu Developer nên có ít nhất 8 ký tự.');
    if (form.next !== form.again) return setError('Hai lần nhập mật khẩu mới không khớp.');
    setBusy(true);
    const result = await updatePassword(form.current, form.next);
    setBusy(false);
    if (!result.success) return setError(result.error || 'Chưa đổi được mật khẩu.');
    onDone();
  };

  return (
    <Dialog
      title="Đổi mật khẩu"
      subtitle="Tài khoản Developer. Các thiết bị khác đang đăng nhập sẽ bị đăng xuất."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="soft-button min-h-11 flex-1 px-4">Huỷ</button>
          <button type="button" onClick={() => submit()} disabled={busy} className="primary-button min-h-11 flex-1 px-4 font-semibold inline-flex items-center justify-center gap-2">
            <KeyRound size={17} /> {busy ? 'Đang lưu…' : 'Đổi mật khẩu'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Mật khẩu hiện tại">
          <input className={inputClass} type="password" value={form.current} onChange={set('current')} autoComplete="current-password" />
        </Field>
        <Field label="Mật khẩu mới" hint="Ít nhất 8 ký tự">
          <input className={inputClass} type="password" value={form.next} onChange={set('next')} autoComplete="new-password" />
        </Field>
        <Field label="Nhập lại mật khẩu mới">
          <input className={inputClass} type="password" value={form.again} onChange={set('again')} autoComplete="new-password" />
        </Field>
        {error && <p role="alert" className="apple-callout font-semibold text-rose-600">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Edit a landlord: details, a new password (shown once), or delete one created by mistake. */
function LandlordEditDialog({ landlord, onClose, onChanged, onOpenDelete }: { landlord: Landlord; onClose: () => void; onChanged: (text: string) => void; onOpenDelete: (l: Landlord) => void }) {
  const [form, setForm] = useState({ fullName: landlord.full_name, phone: landlord.phone, email: landlord.email ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<'reset' | 'delete' | null>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  const base = `/api/dev/landlords/${landlord.id}`;
  const canDelete = landlord.houses.length === 0;

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    const data = await send(base, 'PATCH', form);
    setBusy(false);
    if (!data.success) return setError(data.error || 'Chưa lưu được.');
    onChanged(`Đã cập nhật ${form.fullName.trim()}.`);
  };

  const reset = async () => {
    if (confirm !== 'reset') return setConfirm('reset');
    setBusy(true);
    setError('');
    const data = await send<{ password: string }>(`${base}/reset-password`, 'POST', {});
    setBusy(false);
    setConfirm(null);
    if (!data.success) return setError(data.error || 'Chưa đặt lại được mật khẩu.');
    setNewPassword(data.password);
  };

  const remove = async () => {
    if (confirm !== 'delete') return setConfirm('delete');
    setBusy(true);
    setError('');
    const data = await send(`${base}/delete`, 'POST');
    setBusy(false);
    setConfirm(null);
    if (!data.success) return setError(data.error || 'Chưa xoá được.');
    onChanged(`Đã xoá chủ trọ ${landlord.full_name}.`);
  };

  return (
    <Dialog
      title="Sửa chủ trọ"
      subtitle={landlord.full_name}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="soft-button min-h-11 flex-1 px-4">{newPassword ? 'Xong' : 'Huỷ'}</button>
          <button type="button" onClick={() => save()} disabled={busy} className="primary-button min-h-11 flex-1 px-4 font-semibold inline-flex items-center justify-center gap-2">
            <Check size={17} /> {busy ? 'Đang lưu…' : 'Lưu thông tin'}
          </button>
        </>
      }
    >
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Họ tên" className="sm:col-span-2">
          <input className={inputClass} value={form.fullName} onChange={set('fullName')} autoComplete="off" />
        </Field>
        <Field label="Số điện thoại" hint="Dùng để đăng nhập">
          <input className={cn(inputClass, 'font-num')} value={form.phone} onChange={set('phone')} inputMode="tel" autoComplete="off" />
        </Field>
        <Field label="Email (tuỳ chọn)">
          <input className={inputClass} value={form.email} onChange={set('email')} type="email" inputMode="email" autoComplete="off" />
        </Field>
        <button type="submit" hidden />
      </form>

      <div className="mt-5 space-y-3 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
        <p className="apple-headline kit-text-primary">Mật khẩu</p>
        {newPassword ? (
          <div className="rounded-2xl bg-emerald-500/10 p-3 space-y-2">
            <p className="apple-callout text-emerald-800 dark:text-emerald-200">
              Mật khẩu mới của {landlord.full_name}. Mọi thiết bị của chủ trọ đã bị đăng xuất.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 rounded-xl bg-white/70 px-3 py-2 text-lg font-num tracking-wider kit-text-primary dark:bg-black/30">{newPassword}</code>
              <button
                type="button"
                aria-label="Chép mật khẩu"
                onClick={async () => { await navigator.clipboard?.writeText(newPassword).catch(() => null); setCopied(true); }}
                className="soft-button min-h-11 min-w-11 inline-flex items-center justify-center"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <p className="apple-callout font-semibold text-rose-600">Chỉ hiện một lần. Gửi riêng cho chủ trọ và nhắc họ đổi lại sau khi đăng nhập.</p>
          </div>
        ) : (
          <p className="apple-callout kit-text-secondary">Khi chủ trọ quên mật khẩu hoặc nghi bị lộ: tạo mật khẩu tạm, mọi thiết bị của họ bị đăng xuất ngay.</p>
        )}
        <button type="button" disabled={busy} onClick={reset} className={cn('soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold', confirm === 'reset' && 'text-rose-600')}>
          <KeyRound size={15} /> {confirm === 'reset' ? 'Bấm lần nữa: mật khẩu cũ sẽ ngừng' : 'Đặt lại mật khẩu'}
        </button>
      </div>

      <div className="mt-5 space-y-2 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
        <p className="apple-headline kit-text-primary">Xoá chủ trọ</p>
        <p className="apple-callout kit-text-secondary">
          {canDelete
            ? 'Chỉ xoá được chủ trọ tạo nhầm: chưa có căn và chưa có hoá đơn phí. Không hoàn tác được.'
            : `Chủ trọ đang có ${landlord.houses.length} căn nên chưa xoá được. Hãy xoá từng căn trước; khi không còn căn nào mới xoá được chủ trọ. Muốn ngừng dịch vụ, hãy bấm Khoá.`}
        </p>
        {!canDelete && (
          <button type="button" disabled={busy} onClick={() => onOpenDelete(landlord)} aria-label={`Mở hộp xoá chủ trọ ${landlord.full_name}`} className={deleteBtn}>
            <Trash2 size={15} /> Mở hộp xoá
          </button>
        )}
        {canDelete && (
          <button type="button" disabled={busy} onClick={remove} className={cn('soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold', confirm === 'delete' && 'text-rose-600')}>
            <Trash2 size={15} /> {confirm === 'delete' ? 'Bấm lần nữa để xoá hẳn' : 'Xoá chủ trọ'}
          </button>
        )}
      </div>

      {error && <p role="alert" className="mt-4 apple-callout font-semibold text-rose-600">{error}</p>}
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

/** Delete mode for houses (Developer setting): grace = 7-day wait, immediate = purged at once (test accounts). */
function useHouseDeleteMode() {
  const [mode, setMode] = useState<{ immediate: boolean; days: number }>({ immediate: false, days: 7 });
  useEffect(() => {
    send<{ mode: string; graceDays?: number }>('/api/dev/house-delete-mode', 'GET').then((d) => {
      if (d.success) setMode({ immediate: d.mode === 'immediate', days: d.graceDays ?? 7 });
    });
  }, []);
  return mode;
}

/** The one call that deletes a house: immediate mode returns deleted:true, grace mode returns deleteAfter. */
async function deleteHouseCall(houseId: string): Promise<{ error: string | null; deleteAfter: string | null }> {
  const data = await send<{ deleteAfter?: string; deleted?: boolean }>(`/api/dev/houses/${encodeURIComponent(houseId)}/delete`, 'POST');
  if (!data.success) return { error: data.error || 'Chưa xoá được căn trọ.', deleteAfter: null };
  return { error: null, deleteAfter: data.deleted ? null : data.deleteAfter ?? null };
}

function houseDeleteLabel(mode: { immediate: boolean; days: number }, armed: boolean, idle = 'Xoá căn trọ') {
  if (mode.immediate) return armed ? 'Bấm lần nữa: xoá ngay, không hoàn tác' : 'Xoá ngay, không hoàn tác';
  return armed ? `Bấm lần nữa để xoá sau ${mode.days} ngày` : idle;
}

function HouseDeleteExplain({ mode }: { mode: { immediate: boolean; days: number } }) {
  return mode.immediate ? (
    <p className="apple-callout mt-1 font-semibold text-rose-600">
      Đang ở chế độ xoá ngay (thử nghiệm): căn bị xoá hẳn tức thì, không có thời gian chờ, không sao lưu và không hoàn tác được.
    </p>
  ) : (
    <p className="apple-callout kit-text-secondary mt-1">
      Căn chuyển sang <b>chờ xoá</b> trong {mode.days} ngày. Trong thời gian đó bạn tải được bản sao lưu (phòng, cư dân, hoá đơn, thu tiền, thông báo) hoặc khôi phục lại. Hết {mode.days} ngày, mọi dữ liệu của căn bị xoá hẳn và không lấy lại được.
    </p>
  );
}

/** Delete confirmation for one house, opened from the house row, the landlord delete box, or reused by name. Always needs two clicks. */
function HouseDeleteDialog({ house, onClose, onDone }: { house: Pick<House, 'id' | 'name' | 'abbreviation'>; onClose: () => void; onDone: (name: string, deleteAfter: string | null) => void }) {
  const mode = useHouseDeleteMode();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const remove = async () => {
    if (!armed) return setArmed(true);
    setBusy(true);
    const r = await deleteHouseCall(house.id);
    setBusy(false);
    setArmed(false);
    if (r.error) return setNotice({ ok: false, text: r.error });
    onDone(house.name, r.deleteAfter);
  };

  return (
    <Dialog
      title="Xoá căn trọ"
      subtitle={`${house.name} · ${house.abbreviation}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="soft-button min-h-11 flex-1 px-4">Huỷ</button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            aria-label={`Xoá căn ${house.name}`}
            className={cn('min-h-11 flex-1 rounded-2xl px-4 text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50', armed ? 'bg-rose-600 text-white' : 'soft-button text-rose-600')}
          >
            <Trash2 size={15} /> {busy ? 'Đang xoá…' : houseDeleteLabel(mode, armed)}
          </button>
        </>
      }
    >
      <HouseDeleteExplain mode={mode} />
      <div className="mt-3">
        <button
          type="button"
          disabled={busy}
          onClick={async () => { const problem = await downloadBackup(house.id); setNotice(problem ? { ok: false, text: problem } : { ok: true, text: 'Đã tải bản sao lưu.' }); }}
          className="soft-button min-h-11 px-4 text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <Download size={15} /> Tải sao lưu
        </button>
      </div>
      {notice && <p role={notice.ok ? 'status' : 'alert'} className={cn('mt-3 apple-callout font-semibold', notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600')}>{notice.text}</p>}
    </Dialog>
  );
}

const deleteBtn = 'min-h-11 shrink-0 rounded-2xl border border-rose-500/50 px-3 text-sm font-semibold text-rose-600 inline-flex items-center gap-1.5 transition-colors hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-400';

/**
 * "Xoá chủ trọ" box: explains what blocks the delete, lets the Developer delete the landlord's houses one by one
 * (same call and wording as the house editor) and stays open so the landlord delete is available right after.
 */
function LandlordDeleteDialog({ landlord, onClose, onHouseDeleted, onDeleted, onLock }: {
  landlord: Landlord;
  onClose: () => void;
  onHouseDeleted: (name: string, deleteAfter: string | null) => void;
  onDeleted: (text: string) => void;
  onLock: (l: Landlord) => void;
}) {
  const mode = useHouseDeleteMode();
  const [houseDel, setHouseDel] = useState<House | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const pending = landlord.houses.filter((h) => h.delete_after);
  const live = landlord.houses.filter((h) => !h.delete_after);
  const latest = pending.map((h) => h.delete_after as string).sort().pop();

  if (houseDel) {
    return (
      <HouseDeleteDialog
        house={houseDel}
        onClose={() => setHouseDel(null)}
        onDone={(name, when) => {
          setHouseDel(null);
          setInfo(when ? `${name} đã chuyển sang chờ xoá, xoá hẳn lúc ${d1Time(when)}.` : `Đã xoá hẳn ${name}.`);
          onHouseDeleted(name, when);
        }}
      />
    );
  }

  const remove = async () => {
    if (!armed) return setArmed(true);
    setBusy(true);
    setError('');
    const data = await send(`/api/dev/landlords/${landlord.id}/delete`, 'POST');
    setBusy(false);
    setArmed(false);
    if (!data.success) return setError(data.error || 'Chưa xoá được chủ trọ.');
    onDeleted(`Đã xoá chủ trọ ${landlord.full_name}.`);
  };

  const hasHouses = landlord.houses.length > 0;

  return (
    <Dialog
      title="Xoá chủ trọ"
      subtitle={landlord.full_name}
      onClose={onClose}
      busy={busy}
      footer={<button type="button" onClick={onClose} disabled={busy} className="soft-button min-h-11 flex-1 px-4">Đóng</button>}
    >
      <div className="space-y-4">
        {hasHouses ? (
          <>
            <p className="apple-callout kit-text-secondary">
              {landlord.full_name} còn <b>{landlord.houses.length} căn</b> nên chưa xoá được. Hãy xoá từng căn bên dưới; khi không còn căn nào, bạn xoá được chủ trọ.
            </p>
            <ul className="space-y-2">
              {landlord.houses.map((h) => (
                <li key={h.id} className="flex items-start gap-2.5 rounded-2xl bg-black/[0.03] p-3 dark:bg-white/[0.05]">
                  <Building2 size={16} className="mt-0.5 shrink-0 kit-text-secondary" />
                  <div className="min-w-0 flex-1">
                    <p className="apple-body font-medium kit-text-primary">{h.name} <span className="kit-text-secondary font-normal">· {h.abbreviation}</span></p>
                    <p className="text-[13px] leading-[18px] kit-text-secondary font-num">{h.room_count} phòng · {h.resident_count} người ở</p>
                    {h.delete_after && <p className="text-[13px] leading-[18px] font-semibold text-rose-600">Chờ xoá · xoá hẳn lúc {d1Time(h.delete_after)}</p>}
                  </div>
                  {!h.delete_after && (
                    <button type="button" onClick={() => setHouseDel(h)} aria-label={`Xoá căn ${h.name}`} className={deleteBtn}>
                      <Trash2 size={14} /> Xoá căn
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="apple-callout kit-text-secondary">
              {mode.immediate
                ? 'Xoá căn: Xoá ngay, không hoàn tác. Căn bị xoá hẳn tức thì nên xoá xong căn cuối là xoá được chủ trọ ngay.'
                : `Xoá căn: chuyển sang chờ xoá ${mode.days} ngày. Sau ${mode.days} ngày căn bị xoá hẳn mới xoá được chủ trọ.`}
            </p>
            {live.length === 0 && pending.length > 0 && (
              <p className="apple-callout font-semibold text-amber-700 dark:text-amber-300">
                Tất cả các căn đang chờ xoá{latest ? `; căn cuối bị xoá hẳn lúc ${d1Time(latest)}` : ''}. Sau đó mới xoá được chủ trọ.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="apple-callout kit-text-secondary">
              {landlord.full_name} không còn căn nào. Chỉ xoá được chủ trọ chưa có hoá đơn phí. Không hoàn tác được.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              aria-label={`Xoá chủ trọ ${landlord.full_name}`}
              className={cn('min-h-11 rounded-2xl px-4 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50', armed ? 'bg-rose-600 text-white' : 'border border-rose-500/50 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400')}
            >
              <Trash2 size={15} /> {busy ? 'Đang xoá…' : armed ? 'Bấm lần nữa để xoá hẳn' : 'Xoá chủ trọ'}
            </button>
          </>
        )}
        {info && <p role="status" className="apple-callout font-semibold text-emerald-700 dark:text-emerald-300">{info}</p>}
        {error && <p role="alert" className="apple-callout font-semibold text-rose-600">{error}</p>}
        {(error || hasHouses) && landlord.status === 'active' && (
          <p className="apple-callout kit-text-secondary">
            Chỉ muốn ngừng dịch vụ?{' '}
            <button type="button" onClick={() => { onLock(landlord); onClose(); }} aria-label={`Khoá ${landlord.full_name}`} className="font-semibold text-sky-700 underline underline-offset-2 dark:text-sky-300">Bấm Khoá</button>
            {' '}để chủ trọ bị đăng xuất và không dùng được nữa, dữ liệu vẫn giữ nguyên.
          </p>
        )}
      </div>
    </Dialog>
  );
}

function HouseEditor({ houseId, onClose, onDeleted }: { houseId: string; onClose: () => void; onDeleted: (name: string, deleteAfter: string | null) => void }) {
  const [tab, setTab] = useState<'info' | 'rooms'>('rooms');
  const deleteMode = useHouseDeleteMode();
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
    const r = await deleteHouseCall(houseId);
    setBusy(false);
    setConfirmHouseDelete(false);
    if (r.error) return setNotice({ ok: false, text: r.error });
    onDeleted(house.name, r.deleteAfter);
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
            <HouseDeleteExplain mode={deleteMode} />
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
                <Trash2 size={15} /> {houseDeleteLabel(deleteMode, confirmHouseDelete)}
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
    <section className="liquid-panel rounded-[28px] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="apple-title2 font-semibold kit-text-primary">Phí dịch vụ tháng {monthLabel(month)}</h2>
          <p className="apple-callout kit-text-secondary font-num">
            Đã thu {money(totals.paid)} / {money(totals.due)}
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
        <div className="mt-4 rounded-2xl bg-black/[0.03] p-3 dark:bg-white/[0.05]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 apple-callout">
            <span className="kit-text-secondary">Nhận tiền</span>
            <span className={cn('min-w-0 font-num', ready ? 'kit-text-primary' : 'text-rose-600')}>
              {ready ? `${s.bankName} · ${s.accountNo}` : 'Chưa cài đặt'}
            </span>
            <Pill tone={s.keySet ? 'green' : 'red'}>{s.keySet ? 'API key ✓' : 'Chưa có API key'}</Pill>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer apple-callout kit-text-secondary">Webhook URL cho SePay</summary>
            <div className="mt-2 flex min-w-0 items-center gap-2">
              <code className="min-w-0 truncate text-[13px] kit-text-primary">{s.webhookUrl}</code>
              <button type="button" onClick={() => navigator.clipboard?.writeText(s.webhookUrl).then(() => setNotice({ ok: true, text: 'Đã chép webhook URL.' }))} aria-label="Chép webhook URL" className="soft-button h-9 w-9 shrink-0 inline-flex items-center justify-center">
                <Copy size={14} />
              </button>
            </div>
          </details>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
        <p className="apple-headline kit-text-primary">Hoá đơn</p>
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
        <details className="mt-4 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
          <summary className="cursor-pointer apple-headline kit-text-primary">Tiền về qua webhook SePay <span className="apple-callout font-normal kit-text-secondary">· {data.events.length} giao dịch gần nhất</span></summary>
          <p className="mt-2 mb-2 text-[13px] leading-[18px] kit-text-secondary">Tiền trọ được nhận diện theo căn, phòng, tháng.</p>
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
        </details>
      )}

      {data && data.payments.length > 0 && (
        <details className="mt-4 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
          <summary className="cursor-pointer apple-headline kit-text-primary mb-2">Thanh toán phí dịch vụ <span className="apple-callout font-normal kit-text-secondary">· {data.payments.length} khoản gần nhất</span></summary>
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
        </details>
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
              className="w-56 h-auto rounded-xl bg-white p-2"
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
interface SepayManual { keyHint: string; createdAt: string; lastEventAt: string | null }
interface SepayOverview {
  configured: boolean;
  redirectUri: string;
  webhookUrl: string;
  connections: Record<string, SepayStatus>;
  manual: Record<string, SepayManual>;
}

function SepayLine({ status, manual, onOpen }: { status?: SepayStatus; manual?: SepayManual; onOpen: () => void }) {
  const connected = status?.connected === true;
  if (!connected && manual) {
    return (
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] leading-[18px] kit-text-secondary inline-flex items-center gap-1.5 min-w-0">
          <Landmark size={14} className="shrink-0" />
          <span className="truncate">
            {manual.lastEventAt
              ? <><b className="text-emerald-700 dark:text-emerald-300">SePay đã kết nối</b> · webhook tự tạo</>
              : <><b className="text-amber-700 dark:text-amber-300">Chờ webhook đầu tiên</b> · key ••{manual.keyHint}</>}
          </span>
        </p>
        <button type="button" onClick={onOpen} className="soft-button min-h-11 shrink-0 whitespace-nowrap px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
          <Link2 size={14} /> SePay
        </button>
      </div>
    );
  }
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

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="apple-callout font-semibold kit-text-primary">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className={cn('min-w-0 flex-1 rounded-2xl bg-black/[0.04] p-3 text-[13px] leading-[18px] font-num break-all dark:bg-white/[0.06]', secret ? 'kit-text-primary' : 'kit-text-secondary')}>
          {value}
        </p>
        <button
          type="button"
          aria-label={`Chép ${label}`}
          onClick={async () => { await navigator.clipboard.writeText(value).catch(() => null); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="soft-button min-h-11 min-w-11 shrink-0 inline-flex items-center justify-center"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  );
}

/**
 * No OAuth needed: Trọ Hub gives the landlord a URL and their own API key, and the landlord adds a webhook
 * with them on my.sepay.vn. The key is shown once; making a new one stops the old one at once.
 */
function ManualWebhookPanel({ landlord, webhookUrl, initial }: { landlord: Landlord; webhookUrl: string; initial: SepayManual | null }) {
  const [manual, setManual] = useState<SepayManual | null>(initial);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'new' | 'delete' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const base = `/api/dev/landlords/${landlord.id}/sepay/manual-key`;

  const makeKey = async () => {
    if (manual && confirm !== 'new') { setConfirm('new'); return; }
    setBusy(true);
    const data = await send<{ key: string; manual: SepayManual }>(base, 'POST');
    setBusy(false);
    setConfirm(null);
    if (!data.success) { setNotice({ ok: false, text: data.error || 'Chưa tạo được key.' }); return; }
    setKey(data.key);
    setManual(data.manual);
    setNotice(manual ? { ok: true, text: 'Đã tạo key mới. Key cũ đã ngừng hoạt động: chủ trọ phải dán key mới vào webhook trên SePay.' } : null);
  };

  const remove = async () => {
    if (confirm !== 'delete') { setConfirm('delete'); return; }
    setBusy(true);
    const data = await send(`${base}/delete`, 'POST');
    setBusy(false);
    setConfirm(null);
    if (!data.success) { setNotice({ ok: false, text: data.error || 'Chưa xoá được.' }); return; }
    setManual(null);
    setKey(null);
    setNotice({ ok: true, text: 'Đã xoá key. Trọ Hub từ chối mọi webhook dùng key này; chủ trọ nên xoá webhook trên my.sepay.vn.' });
  };

  return (
    <div className="space-y-3">
      <p className="apple-body kit-text-primary">
        Không cần SePay duyệt. Chủ trọ tự thêm webhook trên SePay của họ bằng địa chỉ và key dưới đây.
        Tiền vẫn vào thẳng tài khoản chủ trọ.
      </p>

      {manual && (
        <p className={cn('rounded-2xl p-3 apple-callout', manual.lastEventAt ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' : 'bg-amber-500/10 text-amber-800 dark:text-amber-200')}>
          {manual.lastEventAt
            ? <>Đang hoạt động · giao dịch gần nhất lúc {d1Time(manual.lastEventAt)} · key ••{manual.keyHint}</>
            : <>Đã cấp key ••{manual.keyHint} lúc {d1Time(manual.createdAt)}. Chưa nhận được webhook nào: chủ trọ bấm <b>Gửi thử</b> trên SePay để kiểm tra.</>}
        </p>
      )}

      {key && (
        <div className="space-y-3 rounded-2xl border border-black/10 p-3 dark:border-white/15">
          <CopyRow label="URL webhook" value={webhookUrl} />
          <CopyRow label="API Key" value={key} secret />
          <p className="apple-callout font-semibold text-rose-600">Key chỉ hiện một lần. Chép ngay và chỉ gửi riêng cho chủ trọ.</p>
        </div>
      )}

      <ol className="list-decimal pl-5 apple-callout kit-text-secondary space-y-1">
        <li>Chủ trọ đăng nhập <b>my.sepay.vn</b> → <b>WebHooks</b> → <b>Thêm webhooks</b>.</li>
        <li>Sự kiện: <b>Tiền vào</b>; chọn tài khoản ngân hàng nhận tiền trọ.</li>
        <li>Dán <b>URL webhook</b>. Kiểu chứng thực: <b>API Key</b>, dán <b>API Key</b> ở trên. Kiểu nội dung: <b>application/json</b>.</li>
        <li>Bật <b>Dùng để xác thực thanh toán</b>. Để <b>tắt</b> “Chỉ gửi khi có mã thanh toán”.</li>
        <li>Lưu, rồi bấm <b>Gửi thử</b>: dòng trạng thái ở trên chuyển sang “Đang hoạt động”.</li>
      </ol>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={makeKey} className={cn(manual ? 'soft-button' : 'primary-button', 'min-h-11 px-4 inline-flex items-center gap-2 text-sm font-semibold disabled:opacity-50', confirm === 'new' && 'text-rose-600')}>
          <Zap size={16} /> {manual ? (confirm === 'new' ? 'Bấm lần nữa: key cũ sẽ ngừng' : 'Tạo key mới') : 'Tạo URL và key'}
        </button>
        {manual && (
          <button type="button" disabled={busy} onClick={remove} className={cn('soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold', confirm === 'delete' && 'text-rose-600')}>
            <Trash2 size={14} /> {confirm === 'delete' ? 'Bấm lần nữa để xoá' : 'Xoá key'}
          </button>
        )}
      </div>

      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={cn('apple-callout font-semibold', notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600')}>
          {notice.text}
        </p>
      )}
    </div>
  );
}

function SepayDialog({ landlord, overview, onClose }: { landlord: Landlord; overview: SepayOverview; onClose: () => void }) {
  const [status, setStatus] = useState<SepayStatus>(overview.connections[landlord.id] ?? { connected: false });
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [mode, setMode] = useState<'manual' | 'oauth'>(
    overview.manual?.[landlord.id] || !overview.configured ? 'manual' : 'oauth'
  );
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
      {!status.connected && (
        <div role="tablist" aria-label="Cách kết nối" className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-black/[0.04] p-1 dark:bg-white/[0.06]">
          {([['manual', 'Webhook tự tạo'], ['oauth', 'Tự động (OAuth)']] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn('min-h-11 rounded-xl px-2 text-sm font-semibold', mode === m ? 'bg-white shadow-sm kit-text-primary dark:bg-white/15' : 'kit-text-secondary')}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {!status.connected && mode === 'manual' ? (
        <ManualWebhookPanel landlord={landlord} webhookUrl={overview.webhookUrl} initial={overview.manual?.[landlord.id] ?? null} />
      ) : (<>
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
      </>)}

      <BankHubBlock landlord={landlord} />

      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={cn('mt-4 apple-callout font-semibold', notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600')}>
          {notice.text}
        </p>
      )}
    </Dialog>
  );
}

interface BankHubView {
  configured: boolean;
  base: string;
  landlords: Record<number, { company: { xid: string; fullName: string; status: string } | null; accounts: { xid: string; bank: string | null; accountMasked: string | null; status: string }[] }>;
}

/** SePay Bank Hub (thử nghiệm sandbox): a company per landlord, a Hosted Link to link a bank account, the linked accounts. */
function BankHubBlock({ landlord }: { landlord: Landlord }) {
  const [view, setView] = useState<BankHubView | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Notice>(null);
  const [hosted, setHosted] = useState<string | null>(null);
  const base = `/api/dev/landlords/${landlord.id}/bankhub`;

  const load = useCallback(async () => {
    const data = await send<BankHubView>('/api/dev/bankhub', 'GET');
    if (data.success) setView(data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (path: string, done: (d: any) => string | void) => {
    setBusy(true);
    setNote(null);
    const data = await send<any>(`${base}/${path}`, 'POST');
    setBusy(false);
    if (!data.success) { setNote({ ok: false, text: data.error || 'Chưa làm được.' }); return; }
    const text = done(data);
    if (text) setNote({ ok: true, text });
    void load();
  };

  const mine = view?.landlords[landlord.id];
  const company = mine?.company ?? null;
  const status = !view ? 'Đang tải…' : !view.configured ? 'Không cấu hình' : company ? 'Đã có công ty' : 'Chưa có công ty';

  return (
    <section aria-label="Bank Hub (thử nghiệm)" className="mt-5 border-t border-black/10 pt-4 dark:border-white/10">
      <p className="apple-headline kit-text-primary">Bank Hub <span className="apple-callout font-normal kit-text-secondary">(thử nghiệm)</span></p>
      <p className="mt-1 apple-callout kit-text-secondary">Trạng thái: <b className="kit-text-primary">{status}</b>{view?.configured ? <> · {view.base}</> : null}</p>
      {view?.configured && (
        <div className="mt-2 flex flex-wrap gap-2">
          {!company && (
            <button type="button" disabled={busy} onClick={() => run('company', () => 'Đã tạo công ty Bank Hub.')} className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
              <Plus size={14} /> Tạo công ty Bank Hub
            </button>
          )}
          {company && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run('link-token', (d) => { setHosted(d.hostedLinkUrl); window.open(d.hostedLinkUrl, '_blank', 'noopener,noreferrer'); return 'Đã tạo link liên kết ngân hàng (dùng một lần). Xong thì bấm Đồng bộ tài khoản.'; })}
              className="primary-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold"
            >
              <Link2 size={14} /> Mở liên kết ngân hàng
            </button>
          )}
          {company && (
            <button type="button" disabled={busy} onClick={() => run('sync', (d) => `Đã đồng bộ ${d.count} tài khoản.`)} className="soft-button min-h-11 px-3 inline-flex items-center gap-1.5 text-sm font-semibold">
              <RefreshCw size={14} /> Đồng bộ tài khoản
            </button>
          )}
        </div>
      )}
      {company && (
        mine!.accounts.length ? (
          <ul className="mt-2 space-y-1">
            {mine!.accounts.map((a) => (
              <li key={a.xid} className="apple-callout kit-text-secondary font-num">
                {a.bank ?? 'Ngân hàng'} {a.accountMasked ?? ''}{a.status === 'active' ? '' : ` (${a.status === 'unlinked' ? 'đã huỷ liên kết' : 'đang tắt'})`}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 apple-callout kit-text-secondary">Chưa liên kết tài khoản ngân hàng nào.</p>
        )
      )}
      {hosted && <a href={hosted} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block apple-callout font-semibold underline">Trình duyệt chặn thẻ mới? Bấm vào đây để mở trang liên kết.</a>}
      {note && <p role={note.ok ? 'status' : 'alert'} className={cn('mt-2 apple-callout font-semibold', note.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600')}>{note.text}</p>}
    </section>
  );
}
