import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, Send } from 'lucide-react';
import { money, useAdminHouses, workerCall } from './workerAdmin';

interface Row {
  roomId: number; roomName: string; invoiceId: number | null; draft: boolean; paymentStatus: string; surplus: number;
  dienCu: number; dienMoi: number; nuocCu: number; nuocMoi: number; tongTien: number | null; missingMeters: boolean;
}
type Edits = Record<number, { e?: string; w?: string }>;

const inputCls = 'w-full min-w-0 bg-white dark:bg-neutral-900 px-3 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 font-bold text-sm font-num text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-neutral-500 disabled:opacity-60 disabled:bg-neutral-100 dark:disabled:bg-neutral-800';

function badgeOf(r: Row): { text: string; cls: string } {
  if (r.paymentStatus === 'paid') return { text: 'Đã đóng', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' };
  if (r.draft) return { text: 'Nháp', cls: 'bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100' };
  return { text: 'Chưa đóng', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' };
}

/** "11/2026" -> 11 */
const monthNumber = (m: string) => String(Number(m.split(/[/-]/).find((p) => p.length <= 2) ?? m));

/** Meter entry and month issuing on the Worker, one row per room. Meters save on blur, one request per change. */
export default function MonthBilling({ month }: { month: string }) {
  const { houses, houseId, setHouseId, error: houseError } = useAdminHouses();
  const [rooms, setRooms] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [edits, setEdits] = useState<Edits>({});
  const [rowError, setRowError] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [issuing, setIssuing] = useState(false);
  const [issueMsg, setIssueMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmMissing, setConfirmMissing] = useState<string[] | null>(null);
  // Saves of one room run one after another, so two quick blurs cannot overtake each other.
  const queue = useRef<Record<number, Promise<unknown>>>({});

  const load = useCallback(async () => {
    if (!houseId) return;
    setLoaded(false);
    setLoadError('');
    setEdits({});
    setRowError({});
    const r = await workerCall(`/api/admin/rooms?month=${encodeURIComponent(month)}&houseId=${encodeURIComponent(houseId)}`);
    if (!r.ok) { setLoadError(r.error); return; }
    setRooms(r.data.rooms ?? []);
    setLoaded(true);
  }, [houseId, month]);

  useEffect(() => { load(); }, [load]);

  const setEdit = (roomId: number, key: 'e' | 'w', value: string) =>
    setEdits((cur) => ({ ...cur, [roomId]: { ...cur[roomId], [key]: value.replace(/\D/g, '') } }));

  const saveField = (room: Row, key: 'e' | 'w') => {
    const text = edits[room.roomId]?.[key];
    if (text === undefined) return;
    const current = key === 'e' ? room.dienMoi : room.nuocMoi;
    const clear = () => setEdits((cur) => { const { [key]: _gone, ...rest } = cur[room.roomId] ?? {}; return { ...cur, [room.roomId]: rest }; });
    // Empty or unchanged: nothing to save, no write.
    if (text === '' || Number(text) === current) { clear(); return; }
    const body = { month, houseId, room: room.roomName, data: key === 'e' ? { dienMoi: Number(text) } : { nuocMoi: Number(text) } };
    const run = async () => {
      setSaving((cur) => ({ ...cur, [room.roomId]: true }));
      const r = await workerCall('/api/admin/room-detail', { method: 'POST', body: JSON.stringify(body) });
      setSaving((cur) => ({ ...cur, [room.roomId]: false }));
      if (!r.ok) { setRowError((cur) => ({ ...cur, [room.roomId]: r.error })); return; }
      setRowError((cur) => { const { [room.roomId]: _gone, ...rest } = cur; return rest; });
      clear();
      const fresh: Row | undefined = r.data.data;
      if (fresh) setRooms((list) => list.map((x) => (x.roomId === fresh.roomId ? { ...x, ...fresh } : x)));
    };
    queue.current[room.roomId] = (queue.current[room.roomId] ?? Promise.resolve()).then(run, run);
  };

  const issue = async (force: boolean) => {
    if (issuing || !houseId) return;
    setIssuing(true);
    setIssueMsg(null);
    setConfirmMissing(null);
    // Pending meter saves must land before the server counts missing meters.
    await Promise.all(Object.values(queue.current));
    const r = await workerCall('/api/admin/issue-month', { method: 'POST', body: JSON.stringify({ houseId, month, force }) });
    setIssuing(false);
    if (!r.ok) { setIssueMsg({ ok: false, text: r.error }); return; }
    const { issued, missingMeters } = r.data as { issued: number; missingMeters: string[] };
    if (!force && issued === 0 && missingMeters.length) { setConfirmMissing(missingMeters); return; }
    if (issued === 0) setIssueMsg({ ok: true, text: 'Không có hoá đơn nháp nào để mở thu.' });
    else setIssueMsg({ ok: true, text: `Đã mở thu tiền tháng ${monthNumber(month)} cho ${issued} phòng.` });
    load();
  };

  return (
    <div className="soft-card kit-form-surface p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="type-h3 font-bold text-neutral-900 dark:text-white">Nhập chỉ số điện nước tháng {month}</h3>
        <button type="button" onClick={() => issue(false)} disabled={issuing || !loaded}
          className="primary-button min-h-11 py-2 px-5 text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50">
          <Send size={15} /><span>{issuing ? 'Đang mở thu...' : `Mở thu tiền tháng ${monthNumber(month)}`}</span>
        </button>
      </div>

      {houses.length > 1 && (
        <label className="block text-xs font-bold text-neutral-600 dark:text-neutral-300 uppercase">
          Nhà trọ
          <select aria-label="Chọn nhà trọ" value={houseId} onChange={(e) => setHouseId(e.target.value)} className={`${inputCls} mt-2`}>
            {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </label>
      )}
      {(houseError || loadError) && <p role="alert" className="text-xs font-bold text-rose-600">{houseError || loadError}</p>}
      {issueMsg && <p role={issueMsg.ok ? 'status' : 'alert'} className={`text-xs font-bold ${issueMsg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{issueMsg.text}</p>}
      <p className="text-xs text-neutral-600 dark:text-neutral-300">Nhập số mới rồi chạm ra ngoài ô để lưu. Hoá đơn ở trạng thái Nháp, cư dân chỉ thấy sau khi mở thu.</p>

      {!loaded && !loadError && !houseError && <p role="status" className="text-xs text-neutral-600 dark:text-neutral-300">Đang tải danh sách phòng...</p>}

      <ul className="space-y-3">
        {rooms.map((r) => {
          const paid = r.paymentStatus === 'paid';
          const badge = r.invoiceId === null ? null : badgeOf(r);
          const e = edits[r.roomId]?.e ?? (r.dienMoi ? String(r.dienMoi) : '');
          const w = edits[r.roomId]?.w ?? (r.nuocMoi ? String(r.nuocMoi) : '');
          return (
            <li key={r.roomId} data-testid="month-room" data-room={r.roomName} className="rounded-2xl border border-neutral-100 dark:border-neutral-700/60 bg-neutral-50 dark:bg-neutral-800/60 p-3 sm:p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-neutral-900 dark:text-white">Phòng {r.roomName}</span>
                  {badge && <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.text}</span>}
                  {paid && <Lock size={14} aria-label="Đã khoá" className="text-neutral-500" />}
                </div>
                <div className="text-right">
                  <span data-testid="room-total" className="font-bold font-num text-neutral-900 dark:text-white">{r.tongTien === null ? '—' : `${money(r.tongTien)} đ`}</span>
                  {r.surplus > 0 && <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">dư {money(r.surplus)} đ</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-bold text-neutral-600 dark:text-neutral-300">
                  Điện mới (cũ {r.dienCu})
                  <input type="text" inputMode="numeric" value={e} disabled={paid} aria-label={`Điện mới phòng ${r.roomName}`} placeholder="0"
                    onChange={(ev) => setEdit(r.roomId, 'e', ev.target.value)} onBlur={() => saveField(r, 'e')}
                    onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} className={`${inputCls} mt-1`} />
                </label>
                <label className="text-xs font-bold text-neutral-600 dark:text-neutral-300">
                  Nước mới (cũ {r.nuocCu})
                  <input type="text" inputMode="numeric" value={w} disabled={paid} aria-label={`Nước mới phòng ${r.roomName}`} placeholder="0"
                    onChange={(ev) => setEdit(r.roomId, 'w', ev.target.value)} onBlur={() => saveField(r, 'w')}
                    onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} className={`${inputCls} mt-1`} />
                </label>
              </div>
              {saving[r.roomId] && <p className="text-[11px] text-neutral-600 dark:text-neutral-300">Đang lưu...</p>}
              {rowError[r.roomId] && <p role="alert" className="text-xs font-bold text-rose-600">{rowError[r.roomId]}</p>}
            </li>
          );
        })}
      </ul>
      {loaded && rooms.length === 0 && <p className="text-xs text-neutral-600 dark:text-neutral-300">Nhà này chưa có phòng.</p>}

      {confirmMissing && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="missing-title">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-neutral-900 p-5 space-y-4 shadow-xl">
            <h4 id="missing-title" className="font-bold text-neutral-900 dark:text-white">Còn phòng chưa nhập chỉ số</h4>
            <p className="text-sm text-neutral-700 dark:text-neutral-200">Các phòng sau chưa có số điện nước tháng {month}, hoá đơn sẽ tính 0 số:</p>
            <p data-testid="missing-list" className="text-sm font-bold text-neutral-900 dark:text-white">{confirmMissing.join(', ')}</p>
            <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
              <button type="button" onClick={() => setConfirmMissing(null)} className="soft-button min-h-11 px-5 text-sm font-bold cursor-pointer">Quay lại nhập</button>
              <button type="button" onClick={() => issue(true)} className="primary-button min-h-11 px-5 text-sm font-bold cursor-pointer">Vẫn mở</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
