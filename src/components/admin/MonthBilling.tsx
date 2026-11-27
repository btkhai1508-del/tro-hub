import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Lock } from '../LineIcons';
import { useAdminHouses, workerCall } from './workerAdmin';
import { refreshBilling, refreshDashboard, refreshRooms } from '../../lib/adminRefresh';
import { meterCellError, meterUsage } from '../../lib/meterSheet';

interface Row {
  houseId?: string; roomId: number; roomName: string; invoiceId: number | null; draft: boolean; paymentStatus: string;
  dienCu: number; dienMoi: number; nuocCu: number; nuocMoi: number; missingMeters: boolean;
}
type Edits = Record<number, { e?: string; w?: string }>;
type Kind = 'e' | 'w';

const WIDE_QUERY = '(min-width: 1024px)';

/** True on wide screens (desktop, landscape tablet): the full table; otherwise one card per room. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE_QUERY);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

const cellInput = 'w-full min-w-0 bg-white dark:bg-neutral-900 px-2.5 py-2 rounded-lg border font-bold text-sm font-num tabular-nums text-right text-neutral-900 dark:text-white outline-none focus:ring-2 disabled:opacity-60 disabled:bg-neutral-100 dark:disabled:bg-neutral-800';
const okBorder = 'border-neutral-200 dark:border-neutral-700 focus:ring-neutral-500';
const badBorder = 'border-rose-500 dark:border-rose-400 focus:ring-rose-500 bg-rose-50 dark:bg-rose-950/40';

/**
 * Meter entry on the Worker (Điện nước tool): only readings and usage, no money (issuing is the Tạo hoá đơn button of
 * the Hoá đơn tab). Wide screens get a table (Cũ / Mới per meter), phones one card per room with only the new readings.
 * The old reading is last month's new one (read-only). A new reading saves on blur or Enter; one smaller than the old
 * reading shows its error in place and is not sent.
 */
export default function MonthBilling({ month, months = [], onMonthChange }: { month: string; months?: string[]; onMonthChange?: (m: string) => void }) {
  const wide = useWide();
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

  const input = (r: Row, k: Kind, compact: boolean) => {
    const label = `${k === 'e' ? 'Điện' : 'Nước'} mới phòng ${r.roomName}`;
    const err = errorOf(r, k);
    const errId = `meter-err-${r.roomId}-${k}`;
    return (
      <>
        <input type="text" inputMode="numeric" value={textOf(r, k)} disabled={r.paymentStatus === 'paid' || !loaded} aria-label={label} placeholder="—"
          aria-invalid={err ? true : undefined} aria-describedby={err ? errId : undefined}
          onChange={(ev) => setEdit(r.roomId, k, ev.target.value)} onBlur={() => saveRoom(r)}
          onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); saveRoom(r); } }}
          className={`${cellInput} ${err ? badBorder : okBorder} ${compact ? '' : 'mt-1'}`} />
        {err && <span id={errId} role="alert" className="mt-1 block text-[11px] font-bold leading-tight text-rose-600 dark:text-rose-400 text-left">{err}</span>}
      </>
    );
  };

  const statusLine = (r: Row) => (
    <>
      {saving[r.roomId] && <span role="status" className="text-xs font-bold text-neutral-600 dark:text-neutral-300">Đang lưu...</span>}
      {!saving[r.roomId] && saved[r.roomId] && Object.keys(dirtyOf(r)).length === 0 && <span role="status" className="text-xs font-bold text-emerald-600">Đã lưu ✓</span>}
      {rowError[r.roomId] && <span role="alert" className="block text-xs font-bold text-rose-600">{rowError[r.roomId]}</span>}
    </>
  );

  const houseName = (id?: string) => houses.find((h) => h.id === id)?.name || id || '';
  const showHouseHeads = houseFilter === 'all' && houses.length > 1;
  const newHouse = (i: number) => showHouseHeads && (i === 0 || rooms[i - 1].houseId !== rooms[i].houseId);
  const used = (r: Row, k: Kind) => meterUsage(k === 'e' ? r.dienCu : r.nuocCu, textOf(r, k));

  const th = 'px-3 font-bold text-[11px] uppercase tracking-wide';
  const elecHead = 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100';
  const waterHead = 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100';
  const groupEdge = 'border-l-2 border-neutral-300 dark:border-neutral-600';

  return (
    <div className="soft-card kit-form-surface p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="type-h3 font-bold text-neutral-900 dark:text-white">Chỉ số điện nước tháng {month}</h3>
        {months.length > 0 && onMonthChange && (
          <label className="admin-status-filter">
            <span className="sr-only">Tháng</span>
            <select value={month} onChange={(e) => onMonthChange(e.target.value)} aria-label="Chọn tháng">
              {(months.includes(month) ? months : [month, ...months]).map((m) => <option key={m} value={m}>Tháng {m}</option>)}
            </select>
          </label>
        )}
      </div>

      {houses.length > 1 && (
        <div className="admin-list-filters">
          <label className="admin-status-filter"><span className="sr-only">Căn</span><select value={houseFilter} onChange={(e) => setHouseFilter(e.target.value)} aria-label="Lọc theo căn"><option value="all">Tất cả căn</option>{houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
        </div>
      )}
      {(houseError || loadError) && <p role="alert" className="text-xs font-bold text-rose-600">{houseError || loadError}</p>}
      <p className="text-xs text-neutral-600 dark:text-neutral-300">Số cũ là số mới của tháng trước. Nhập số mới, tự lưu khi rời ô hoặc nhấn Enter.</p>

      {!loaded && !loadError && !houseError && <p role="status" className="text-xs text-neutral-600 dark:text-neutral-300">Đang tải danh sách phòng...</p>}

      {loaded && rooms.length > 0 && wide && (
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-neutral-200 dark:border-neutral-700" data-testid="meter-table">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="h-9">
                <th rowSpan={2} scope="col" className={`${th} w-28 sticky top-0 left-0 z-30 text-left bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-white border-b-2 border-neutral-300 dark:border-neutral-600`}>Phòng</th>
                <th colSpan={3} scope="colgroup" className={`${th} sticky top-0 z-20 text-center ${elecHead} ${groupEdge}`}>Điện (kWh)</th>
                <th colSpan={3} scope="colgroup" className={`${th} sticky top-0 z-20 text-center ${waterHead} ${groupEdge}`}>Nước (m³)</th>
              </tr>
              <tr className="h-8">
                {(['e', 'w'] as Kind[]).flatMap((k) => ['Cũ', 'Mới', 'Dùng'].map((t, j) => (
                  <th key={k + t} scope="col" className={`${th} sticky top-9 z-20 text-right border-b-2 border-neutral-300 dark:border-neutral-600 ${k === 'e' ? elecHead : waterHead} ${j === 0 ? groupEdge : ''}`}>{t}</th>
                )))}
              </tr>
            </thead>
            <tbody>
              {rooms.map((r, i) => {
                const paid = r.paymentStatus === 'paid';
                const td = 'px-3 py-2 align-top border-b border-neutral-200 dark:border-neutral-700';
                return (
                  <Fragment key={r.roomId}>
                    {newHouse(i) && (
                      <tr><td colSpan={7} className="px-3 pt-3 pb-1 text-xs font-bold uppercase text-neutral-600 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-800/60 border-b border-neutral-200 dark:border-neutral-700">{houseName(r.houseId)}</td></tr>
                    )}
                    <tr data-testid="month-room" data-room={r.roomName} className="bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                      <th scope="row" className={`${td} sticky left-0 z-10 text-left bg-inherit`}>
                        <span className="flex items-center gap-1.5 font-bold text-neutral-900 dark:text-white whitespace-nowrap">
                          {r.roomName}{paid && <Lock size={13} aria-label="Đã đóng, đã khoá" className="text-neutral-500" />}
                        </span>
                        <span className="block min-w-[5rem]">{statusLine(r)}</span>
                      </th>
                      {(['e', 'w'] as Kind[]).map((k) => (
                        <Fragment key={k}>
                          <td className={`${td} ${groupEdge} text-right font-num tabular-nums text-neutral-600 dark:text-neutral-300`}><span className="inline-block pt-2">{k === 'e' ? r.dienCu : r.nuocCu}</span></td>
                          <td className={`${td} w-36`}>{input(r, k, true)}</td>
                          <td className={`${td} text-right font-num tabular-nums font-bold text-neutral-900 dark:text-white`}><span className="inline-block pt-2">{used(r, k)}</span></td>
                        </Fragment>
                      ))}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {loaded && rooms.length > 0 && !wide && (
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-700">
          {rooms.map((r, i) => {
            const paid = r.paymentStatus === 'paid';
            return (
              <Fragment key={r.roomId}>
                {newHouse(i) && <li className="pt-3 pb-1 text-xs font-bold uppercase text-neutral-600 dark:text-neutral-300">{houseName(r.houseId)}</li>}
                <li data-testid="month-room" data-room={r.roomName} className="py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-neutral-900 dark:text-white">Phòng {r.roomName}</span>
                    {paid && <Lock size={14} aria-label="Đã đóng, đã khoá" className="text-neutral-500" />}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {(['e', 'w'] as Kind[]).map((k) => (
                      <label key={k} className="text-xs font-bold text-neutral-600 dark:text-neutral-300">
                        <span className={k === 'e' ? 'text-amber-800 dark:text-amber-200' : 'text-sky-800 dark:text-sky-200'}>{k === 'e' ? 'Điện mới' : 'Nước mới'}</span>
                        {input(r, k, false)}
                        <span className="mt-1 flex justify-between gap-2 font-semibold font-num tabular-nums text-[11px] text-neutral-500 dark:text-neutral-400">
                          <span>Cũ {k === 'e' ? r.dienCu : r.nuocCu}</span>
                          <span>Dùng {used(r, k)} {k === 'e' ? 'kWh' : 'm³'}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div>{statusLine(r)}</div>
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
      {loaded && rooms.length === 0 && <p className="text-xs text-neutral-600 dark:text-neutral-300">Nhà này chưa có phòng.</p>}
    </div>
  );
}
