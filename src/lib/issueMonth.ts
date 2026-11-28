/**
 * "Tạo hoá đơn" (worker mode): what the button on the Hoá đơn tab can issue for the house filter on screen.
 * Pure helpers, the component is src/components/admin/IssueInvoicesBar.tsx.
 */

export interface IssueRow {
  houseId?: string;
  roomId?: number;
  roomName?: string;
  room?: string;
  invoiceId?: number | null;
  draft?: boolean;
  missingMeters?: boolean;
}

export interface IssueScope {
  /** Rooms of the scope that have an invoice this month (draft or issued). */
  invoices: number;
  /** Draft invoices still to issue, grouped by house (only houses with at least one draft). */
  draftsByHouse: Map<string, IssueRow[]>;
  drafts: number;
  /** Every invoice of the scope is issued (and there is at least one). */
  allIssued: boolean;
}

/** `houseFilter` is a house id or 'all' (every house of the admin). */
export function issueScope(rows: IssueRow[], houseFilter: string): IssueScope {
  const draftsByHouse = new Map<string, IssueRow[]>();
  let invoices = 0;
  for (const r of rows) {
    if (!r.houseId || (houseFilter !== 'all' && r.houseId !== houseFilter)) continue;
    if (r.invoiceId === null || r.invoiceId === undefined) continue;
    invoices += 1;
    if (!r.draft) continue;
    const list = draftsByHouse.get(r.houseId) ?? [];
    list.push(r);
    draftsByHouse.set(r.houseId, list);
  }
  let drafts = 0;
  draftsByHouse.forEach((l) => { drafts += l.length; });
  return { invoices, draftsByHouse, drafts, allIssued: invoices > 0 && drafts === 0 };
}

/**
 * Draft rooms without meters, as "101" or "101 (Căn A)" when several houses are involved (`severalHouses`: the scope
 * covers more than one house, so a bare "101" could be either).
 */
export function missingMeterRooms(scope: IssueScope, houseName: (id: string) => string, severalHouses = false): string[] {
  const several = severalHouses || scope.draftsByHouse.size > 1;
  const out: string[] = [];
  scope.draftsByHouse.forEach((list, houseId) => {
    for (const r of list) {
      if (!r.missingMeters) continue;
      const name = r.roomName || r.room || '';
      out.push(several ? `${name} (${houseName(houseId)})` : name);
    }
  });
  return out;
}

/** "11/2026" or "2026-11" -> "11/2026". */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${m[2]}/${m[1]}` : month;
}

/** Result line for one house after POST /api/admin/issue-month. */
export function houseResultText(name: string, r: { ok: boolean; issued?: number; error?: string }, several: boolean): string {
  const prefix = several ? `${name}: ` : '';
  if (!r.ok) return `${prefix}${r.error || 'Chưa tạo được hoá đơn.'}`;
  return `${prefix}${r.issued ? `đã tạo ${r.issued} hoá đơn` : 'không còn hoá đơn nháp'}`;
}
