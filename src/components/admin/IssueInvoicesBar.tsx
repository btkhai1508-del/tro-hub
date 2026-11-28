import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { workerCall } from './workerAdmin';
import ConfirmSaveDialog from './ConfirmSaveDialog';
import { houseResultText, issueScope, missingMeterRooms, monthLabel, type IssueRow } from '../../lib/issueMonth';
import { refreshBilling, refreshDashboard, refreshGate, refreshRooms } from '../../lib/adminRefresh';

interface House { id: string; name: string }
interface Plan { houseId: string; force: boolean; roomIds?: number[] }
interface Dialog { count: number; missing: string[]; plan: Plan[] }

/**
 * Worker mode, Hoá đơn tab: "Tạo hoá đơn" issues the draft invoices of the rooms ticked in the list (POST /api/admin/issue-month
 * with roomIds, which also opens payment for the house and sends each room its payment notice). Until then the invoices
 * are drafts and residents do not see them.
 */
export default function IssueInvoicesBar({ month, rows, houses, houseFilter, onToast, selected, onIssued, extra }: {
  month: string;
  rows: IssueRow[];
  houses: House[];
  houseFilter: string;
  onToast: (message: string, type: 'success' | 'error' | 'info') => void;
  /** Rooms ticked in the list below. */
  selected: IssueRow[];
  /** Called after invoices were issued (the list clears its ticks). */
  onIssued?: () => void;
  /** Shown right after the button (the phone list puts its "Tất cả" box there). */
  extra?: ReactNode;
}) {
  // The Hoá đơn list (/api/admin/billing) carries only the room code ('LVC-101'); the fresh read (/api/admin/rooms)
  // carries the same code plus roomName and roomId. Rows are matched by house + code.
  const keyOf = (r: IssueRow) => `${r.houseId || ''}|${r.room || r.roomName || ''}`;
  // checking: reading the scope fresh · confirm: the dialog is open · running: issuing. Any of them blocks a second press.
  const [phase, setPhase] = useState<'idle' | 'checking' | 'confirm' | 'running'>('idle');
  const busyRef = useRef(false);
  const busy = phase !== 'idle';
  const spinning = phase === 'checking' || phase === 'running';
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const draftCounts = useRef(new Map<string, number>());
  const [note, setNote] = useState<{ ok: boolean; lines: string[] } | null>(null);

  const label = monthLabel(month);
  const houseName = (id: string) => houses.find((h) => h.id === id)?.name || id;
  const allHouses = houseFilter === 'all' && houses.length > 1;

  // A result line belongs to the scope it was made for.
  useEffect(() => { setNote(null); }, [houseFilter, month]);

  const start = () => { busyRef.current = true; setPhase('checking'); };
  const stop = () => { busyRef.current = false; setPhase('idle'); };

  const refreshAll = () => {
    refreshBilling(month);
    refreshRooms(month);
    refreshGate(month);
    refreshDashboard(month);
  };

  /** Reads the scope fresh from the Worker, then asks once (with the rooms still missing meters, if any). */
  const prepare = async (mode: 'all' | 'selected' = 'all', pick: IssueRow[] = selected) => {
    if (busyRef.current) return;
    if (mode === 'selected' && pick.length === 0) { onToast('Vui lòng chọn phòng để tạo hoá đơn.', 'info'); return; }
    start();
    setNote(null);
    const picked = new Set(pick.map(keyOf));
    const ids = mode === 'selected'
      ? [...new Set(pick.map((r) => r.houseId).filter((x): x is string => !!x))]
      : houseFilter !== 'all'
      ? [houseFilter]
      : (houses.length ? houses.map((h) => h.id) : [...new Set(rows.map((r) => r.houseId).filter((x): x is string => !!x))]);
    const reads = await Promise.all(ids.map((id) => workerCall(`/api/admin/rooms?month=${encodeURIComponent(month)}&houseId=${encodeURIComponent(id)}`)));
    const failed = reads.find((r) => !r.ok);
    if (failed) { stop(); setNote({ ok: false, lines: [failed.error] }); return; }
    const freshAll: IssueRow[] = reads.flatMap((r) => r.data?.rooms ?? []);
    const fresh = mode === 'selected' ? freshAll.filter((r) => picked.has(keyOf(r))) : freshAll;
    const s = issueScope(fresh, mode === 'selected' ? 'all' : houseFilter);
    if (s.drafts === 0) {
      stop();
      onToast(s.invoices ? `Đã tạo hết hoá đơn tháng ${label}.` : `Chưa có hoá đơn nháp nào của tháng ${label}.`, 'info');
      refreshBilling(month);
      return;
    }
    draftCounts.current = new Map([...s.draftsByHouse.entries()].map(([id, list]) => [id, list.length]));
    const plan: Plan[] = [...s.draftsByHouse.entries()].map(([houseId, list]) => ({ houseId, force: list.some((r) => r.missingMeters), roomIds: mode === 'selected' ? list.map((r) => Number(r.roomId)).filter((n) => n > 0) : undefined }));
    setPhase('confirm');
    setDialog({ count: s.drafts, missing: missingMeterRooms(s, houseName, allHouses), plan });
  };

  const cancel = () => { setDialog(null); stop(); };

  const runningRef = useRef(false);
  const run = async (plan: Plan[]) => {
    if (runningRef.current) return; // a double click on the dialog's button
    runningRef.current = true;
    setDialog(null);
    setPhase('running');
    const several = plan.length > 1 || allHouses;
    const lines: string[] = [];
    let issued = 0;
    let errors = 0;
    const later: { houseId: string; rooms: string[]; pick?: number[] }[] = [];
    // One house after another: each house is its own batch on the server.
    for (const p of plan) {
      const r = await workerCall<{ issued: number; missingMeters: string[] }>('/api/admin/issue-month', {
        method: 'POST', body: JSON.stringify({ houseId: p.houseId, month, force: p.force, roomIds: p.roomIds }),
      });
      const n = r.ok ? Number(r.data?.issued ?? 0) : 0;
      const missing = r.ok ? r.data?.missingMeters ?? [] : [];
      if (r.ok && !p.force && n === 0 && missing.length) {
        // The server found rooms without meters that the list did not show: ask about those too.
        later.push({ houseId: p.houseId, rooms: missing, pick: p.roomIds });
        continue;
      }
      if (!r.ok) errors += 1;
      issued += n;
      lines.push(houseResultText(houseName(p.houseId), { ok: r.ok, issued: n, error: r.error }, several));
    }
    runningRef.current = false;
    refreshAll();
    if (lines.length) setNote({ ok: errors === 0, lines });
    // The Worker also sends each issued room its payment notice (once per invoice).
    if (issued > 0) {
      onToast(`Đã tạo ${issued} hoá đơn tháng ${label} và gửi thông báo thanh toán cho cư dân.`, 'success');
      onIssued?.();
    }
    if (errors > 0) onToast(lines.join(' · '), 'error');
    if (later.length) {
      const multi = later.length > 1 || several;
      const missing = later.flatMap((l) => l.rooms.map((room) => (multi ? `${room} (${houseName(l.houseId)})` : room)));
      const count = later.reduce((sum, l) => sum + (draftCounts.current.get(l.houseId) ?? l.rooms.length), 0);
      setPhase('confirm');
      setDialog({ count, missing, plan: later.map((l) => ({ houseId: l.houseId, force: true, roomIds: l.pick })) });
      return;
    }
    stop();
  };

  return (
    <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3" data-testid="issue-selection-bar">
      <button type="button" data-testid="issue-selected-button" onClick={() => prepare('selected')} disabled={busy} aria-busy={spinning}
        className="primary-button min-h-11 px-5 text-xs font-bold inline-flex items-center gap-2 disabled:opacity-50">
        {spinning && <Loader2 size={16} className="animate-spin" />}
        <span>{phase === 'running' ? 'Đang tạo hoá đơn…' : phase === 'checking' ? 'Đang kiểm tra…' : selected.length > 0 ? `Tạo ${selected.length} hoá đơn` : 'Tạo hoá đơn'}</span>
      </button>
      {extra}
      {selected.length === 0 && <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">Vui lòng chọn phòng tạo hoá đơn</span>}
    </div>
    {note && (
      <ul role={note.ok ? 'status' : 'alert'} data-testid="issue-note" className={`text-xs font-bold space-y-0.5 ${note.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
        {note.lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    )}
    <ConfirmSaveDialog
      open={dialog !== null}
      title={dialog?.missing.length
        ? `Còn ${dialog.missing.length} phòng chưa nhập chỉ số điện nước tháng ${label}`
        : `Tạo hoá đơn tháng ${label} cho ${dialog?.count ?? 0} phòng? Cư dân sẽ thấy và thanh toán được.`}
      message={dialog?.missing.length
        ? `Hoá đơn các phòng này sẽ tính 0 số điện nước. Vẫn tạo hoá đơn tháng ${label} cho ${dialog.count} phòng? Cư dân sẽ thấy và thanh toán được.`
        : undefined}
      lines={dialog?.missing ?? []}
      confirmLabel={dialog?.missing.length ? 'Vẫn tạo' : 'Tạo hoá đơn'}
      onCancel={cancel}
      onConfirm={() => { if (dialog) run(dialog.plan); }}
    />
    </div>
  );
}
