import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Lock } from '../LineIcons';
import { useAdminHouses, workerCall } from './workerAdmin';
import { refreshBilling, refreshDashboard, refreshRooms } from '../../lib/adminRefresh';
import { meterCellError } from '../../lib/meterSheet';

interface Row {
  houseId?: string; roomId: number; roomName: string; invoiceId: number | null; draft: boolean; paymentStatus: string;
  dienCu: number; dienMoi: number; nuocCu: number; nuocMoi: number; missingMeters: boolean;
}
type Edits = Record<number, { e?: string; w?: string }>;
type Kind = 'e' | 'w';


/**
 * Meter entry on the Worker (Điện nước tool), in the old main table (Phòng | Điện cũ | Điện mới | Nước cũ | Nước mới;
 * admin-meter-table turns rows into cards on phones). Only readings, no money (issuing is the Tạo hoá đơn button of the
 * Hoá đơn tab). The old reading is last month's new one (read-only). A new reading saves on blur or Enter; one smaller than the old
 * reading shows its error in place and is not sent.
 */
export default function MonthBilling({ month, months = [], onMonthChange }: { month: string; months?: string[]; onMonthChange?: (m: string) => void }) {
  const { houses, error: houseError } = useAdminHouses();
  // 'all' = every house of this account (default), else one house id; same filter style as Phòng & Khách.
  const [houseFilter, setHouseFilter] = useState('all');
  const houseIds = houseFilter === 'all' ? houses.map((h) => h.id) : [houseFilter];
  const houseKey = houseIds.join(',');
  const [rooms, setRooms] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [edits, setEdits] = useState<Edits>({});
  const [rowError, setRowError] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const inflight = useRef<Record<number, string>>({});
  // Saves of one room run one after another, so two quick blurs cannot overtake each other.
  const queue = useRef<Record<number, Promise<unknown>>>({});

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (!houseKey) return;
    const seq = ++loadSeq.current;
    setRooms([]);
    setLoaded(false);
    setLoadError('');
    setEdits({});
    setRowError({});
    const ids = houseKey.split(',');
    const answers = await Promise.all(ids.map((id) => workerCall(`/api/admin/rooms?month=${encodeURIComponent(month)}&houseId=${encodeURIComponent(id)}`)));
    if (seq !== loadSeq.current) return; // a newer house/month request replaced this one
    const failed = answers.find((r) => !r.ok);
    if (failed && !failed.ok) { setLoadError(failed.error); return; }
    // Every row carries its house, so a save always goes to the right one.
    setRooms(answers.flatMap((r, i) => (r.ok ? (r.data.rooms ?? []).map((row: Row) => ({ ...row, houseId: row.houseId || ids[i] })) : [])));
    setLoaded(true);
  }, [houseKey, month]);

  useEffect(() => { load(); }, [load]);

  const setEdit = (roomId: number, key: Kind, value: string) =>
    setEdits((cur) => ({ ...cur, [roomId]: { ...cur[roomId], [key]: value.replace(/\D/g, '') } }));

  const textOf = (r: Row, k: Kind) => {
    const saved = k === 'e' ? r.dienMoi : r.nuocMoi;
    return edits[r.roomId]?.[k] ?? (saved ? String(saved) : '');
  };
  const errorOf = (r: Row, k: Kind) => {
    const ed = edits[r.roomId]?.[k];
    return ed === undefined ? null : meterCellError(k === 'e' ? r.dienCu : r.nuocCu, ed);
  };

  const dirtyOf = (room: Row) => {
    const ed = edits[room.roomId] ?? {};
    const data: { dienMoi?: number; nuocMoi?: number } = {};
    if (ed.e !== undefined && ed.e !== '' && Number(ed.e) !== room.dienMoi) data.dienMoi = Number(ed.e);
    if (ed.w !== undefined && ed.w !== '' && Number(ed.w) !== room.nuocMoi) data.nuocMoi = Number(ed.w);
    return data;
  };

  // One save per room with what changed (blur or Enter). A cell with an error is not sent; an identical save already running is not sent twice.
  const saveRoom = (room: Row) => {
    const data = dirtyOf(room);
    if (errorOf(room, 'e')) delete data.dienMoi;
    if (errorOf(room, 'w')) delete data.nuocMoi;
    if (Object.keys(data).length === 0) {
      // Empty or unchanged text: nothing to save, drop it (a wrong number stays on screen with its error).
      setEdits((cur) => {
        const ed = { ...(cur[room.roomId] ?? {}) };
        for (const k of ['e', 'w'] as Kind[]) if (!errorOf(room, k)) delete ed[k];
        return { ...cur, [room.roomId]: ed };
      });
      return;
    }
    const sig = JSON.stringify(data);
    if (inflight.current[room.roomId] === sig) return;
    inflight.current[room.roomId] = sig;
    const body = { month, houseId: room.houseId, room: room.roomName, data };
    const run = async () => {
      setSaving((cur) => ({ ...cur, [room.roomId]: true }));
      const r = await workerCall('/api/admin/room-detail', { method: 'POST', body: JSON.stringify(body) });
      setSaving((cur) => ({ ...cur, [room.roomId]: false }));
      if (inflight.current[room.roomId] === sig) delete inflight.current[room.roomId];
      if (!r.ok) { setRowError((cur) => ({ ...cur, [room.roomId]: r.error })); return; }
      setRowError((cur) => { const { [room.roomId]: _gone, ...rest } = cur; return rest; });
      // Drop only the fields that were saved and still hold the saved text (the admin may have typed on).
      setEdits((cur) => {
        const ed = { ...(cur[room.roomId] ?? {}) };
        if (data.dienMoi !== undefined && Number(ed.e) === data.dienMoi) delete ed.e;
        if (data.nuocMoi !== undefined && Number(ed.w) === data.nuocMoi) delete ed.w;
        return { ...cur, [room.roomId]: ed };
      });
      const fresh: Row | undefined = r.data.data;
      if (fresh) setRooms((list) => list.map((x) => (x.roomId === fresh.roomId ? { ...x, ...fresh } : x)));
      setSaved((cur) => ({ ...cur, [room.roomId]: true }));
      window.setTimeout(() => setSaved((cur) => ({ ...cur, [room.roomId]: false })), 2000);
      refreshBilling(month);
      refreshRooms(month);
      refreshDashboard(month);
    };
    queue.current[room.roomId] = (queue.current[room.roomId] ?? Promise.resolve()).then(run, run);
  };

  const fieldCls = 'w-24 bg-white dark:bg-neutral-900 p-2 rounded-lg border border-neutral-200 dark:border-neutral-700 font-bold text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white';
  const oldCls = 'w-24 bg-neutral-100 dark:bg-neutral-800 p-2 rounded-lg border border-neutral-200 dark:border-neutral-700 font-bold text-neutral-500 dark:text-neutral-400 outline-none cursor-default';
  const badCls = '!border-rose-500 focus:!ring-rose-500';

  /** "Mới" cell as in the old table; a reading below the old one shows its error under the field and is not saved. */
  const reading = (r: Row, k: Kind) => {
    const err = errorOf(r, k);
    const errId = `meter-err-${r.roomId}-${k}`;
    return (
      <>
        <input type="text" inputMode="numeric" value={textOf(r, k)} disabled={r.paymentStatus === 'paid' || !loaded}
          aria-label={`${k === 'e' ? 'Điện' : 'Nước'} mới phòng ${r.roomName}`}
          aria-invalid={err ? true : undefined} aria-describedby={err ? errId : undefined}
          onChange={(ev) => setEdit(r.roomId, k, ev.target.value)} onBlur={() => saveRoom(r)}
          onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); saveRoom(r); } }}
          className={`${fieldCls} disabled:opacity-60 ${err ? badCls : ''}`} />
        {err && <span id={errId} role="alert" className="mt-1 block text-[11px] font-bold text-rose-600 dark:text-rose-400">{err}</span>}
      </>
    );
  };
  /** "Cũ" cell: last month's new reading, read-only. */
  const oldCell = (r: Row, k: Kind) => (
    <input type="text" readOnly tabIndex={-1} value={k === 'e' ? r.dienCu : r.nuocCu} aria-label={`${k === 'e' ? 'Điện' : 'Nước'} cũ phòng ${r.roomName}`} className={oldCls} />
  );

  const roomState = (r: Row) => {
    if (saving[r.roomId]) return <span role="status" className="block text-[11px] font-bold text-neutral-500">Đang lưu...</span>;
    if (rowError[r.roomId]) return <span role="alert" className="block text-[11px] font-bold text-rose-600">{rowError[r.roomId]}</span>;
    if (saved[r.roomId] && Object.keys(dirtyOf(r)).length === 0) return <span role="status" className="block text-[11px] font-bold text-emerald-600">Đã lưu ✓</span>;
    return null;
  };

  const houseName = (id?: string) => houses.find((h) => h.id === id)?.name || id || '';
  const showHouseHeads = houseFilter === 'all' && houses.length > 1;
  const newHouse = (i: number) => showHouseHeads && (i === 0 || rooms[i - 1].houseId !== rooms[i].houseId);

  return (
    <div className="soft-card kit-form-surface p-4 sm:p-6 space-y-4">
      <div className="admin-section-toolbar flex flex-wrap items-center justify-between gap-3">
        <h3 className="type-h3 font-bold text-neutral-900 dark:text-white">Nhập chỉ số điện nước tháng {month}</h3>
        <div className="admin-list-filters">
          {months.length > 0 && onMonthChange && (
            <label className="admin-status-filter">
              <span className="sr-only">Tháng</span>
              <select value={month} onChange={(e) => onMonthChange(e.target.value)} aria-label="Chọn tháng">
                {(months.includes(month) ? months : [month, ...months]).map((m) => <option key={m} value={m}>Tháng {m}</option>)}
              </select>
            </label>
          )}
          {houses.length > 1 && (
            <label className="admin-status-filter"><span className="sr-only">Căn</span><select value={houseFilter} onChange={(e) => setHouseFilter(e.target.value)} aria-label="Lọc theo căn"><option value="all">Tất cả căn</option>{houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
          )}
        </div>
      </div>
      {(houseError || loadError) && <p role="alert" className="text-xs font-bold text-rose-600">{houseError || loadError}</p>}
      <p className="text-xs text-neutral-600 dark:text-neutral-300">Số cũ là số mới của tháng trước. Nhập số mới, tự lưu khi rời ô hoặc nhấn Enter.</p>
      {!loaded && !loadError && !houseError && <p role="status" className="text-xs text-neutral-600 dark:text-neutral-300">Đang tải danh sách phòng...</p>}

      {loaded && rooms.length > 0 && (
        <div className="overflow-x-auto">
          <table className="admin-meter-table w-full text-left text-xs">
            <thead>
              <tr className="bg-neutral-50 dark:bg-neutral-800/80 text-neutral-600 dark:text-neutral-200 font-bold uppercase">
                <th className="p-3">Phòng</th>
                <th className="p-3">Điện cũ</th>
                <th className="p-3">Điện mới</th>
                <th className="p-3">Nước cũ</th>
                <th className="p-3">Nước mới</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rooms.map((r, i) => (
                <Fragment key={r.roomId}>
                  {newHouse(i) && (
                    <tr><td colSpan={5} className="p-3 pt-4 font-bold text-neutral-600 dark:text-neutral-300">{houseName(r.houseId)}</td></tr>
                  )}
                  <tr data-testid="month-room" data-room={r.roomName} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/40 transition-colors">
                    <td className="p-3 font-bold text-neutral-900 dark:text-white">
                      <span className="inline-flex items-center gap-1.5">{r.roomName}{r.paymentStatus === 'paid' && <Lock size={13} aria-label="Đã đóng, đã khoá" className="text-neutral-500" />}</span>
                      {roomState(r)}
                    </td>
                    <td data-label="Điện cũ" className="p-2">{oldCell(r, 'e')}</td>
                    <td data-label="Điện mới" className="p-2">{reading(r, 'e')}</td>
                    <td data-label="Nước cũ" className="p-2">{oldCell(r, 'w')}</td>
                    <td data-label="Nước mới" className="p-2">{reading(r, 'w')}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loaded && rooms.length === 0 && <p className="text-xs text-neutral-600 dark:text-neutral-300">Nhà này chưa có phòng.</p>}
    </div>
  );
}
