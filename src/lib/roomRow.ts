/**
 * Room rows of the admin screens (Phòng & Khách, Thu tiền, room detail).
 *
 * Sheet mode reads cells of a Google Sheet, where a resident cell can hold junk (a head count "1" as a name,
 * the header "Họ và tên", a single digit as a plate). Worker mode reads the database: what the Worker returns
 * is what was saved, so nothing of it is ever hidden (a plate "1" is a real plate the admin typed).
 */

/** A row of the Worker (`GET /api/admin/rooms`, `/api/admin/room-detail`): it carries its residents and its room id. */
export const isWorkerRoomRow = (r: any): boolean => Boolean(r) && Array.isArray(r.occupants) && r.roomId !== undefined;

const clean = (val: any, junk: RegExp[]) => {
  if (!val) return '';
  const s = String(val).trim();
  return junk.some((re) => re.test(s)) ? '' : s;
};
const NAME_JUNK = [/^\d+(\.\d+)?$/, /^họ\s*(?:và\s*)?tên/i];
const DIGIT_JUNK = [/^[0-9](\.0+)?$/];
const PLATE_JUNK = [/^\d+(\.\d+)?$/];

/** Sheet rows: junk resident cells show as empty. Worker rows come back untouched. The Save baseline is cleaned the same way. */
export function sanitizeRoomRow<T>(r: T): T {
  if (!r || isWorkerRoomRow(r)) return r;
  const out: any = { ...(r as any) };
  for (const slot of [1, 2, 3]) {
    out[`nguoi${slot}`] = clean((r as any)[`nguoi${slot}`], NAME_JUNK);
    out[`cccd${slot}`] = clean((r as any)[`cccd${slot}`], DIGIT_JUNK);
    out[`sdt${slot}`] = clean((r as any)[`sdt${slot}`], DIGIT_JUNK);
    out[`xe${slot}`] = clean((r as any)[`xe${slot}`], PLATE_JUNK);
  }
  return out;
}

/** A sheet name cell holding only a head count ("1", "2.0") or the header text is not a resident. */
export const isOccupantName = (value: any) => {
  const text = String(value ?? '').trim();
  return Boolean(text) && !NAME_JUNK.some((re) => re.test(text));
};

export const ROOM_SLOTS = [1, 2, 3];

/** The resident slots (1-based) someone lives in. Worker rows: one per resident the Worker returned. */
export function occupiedSlots(room: any): number[] {
  if (isWorkerRoomRow(room)) return room.occupants.map((_: unknown, i: number) => i + 1);
  return ROOM_SLOTS.filter((slot) => isOccupantName(room?.[`nguoi${slot}`]));
}

/** How many people the room is meant for: the Developer's capacity (Worker), else the 3 slots of the sheet. */
export function roomCapacity(room: any): number {
  const n = Number(room?.capacity);
  const people = occupiedSlots(room).length;
  return Number.isInteger(n) && n > 0 ? Math.max(n, people) : Math.max(ROOM_SLOTS.length, people);
}

export type RoomStatusFilter = 'all' | 'vacant' | 'occupied' | 'unpaid' | 'pending' | 'paid' | 'notissued' | 'issued-unpaid';

/** House and status filters of the room / billing lists (the search box is applied separately). */
export function matchesRoomFilters(row: any, houseId: string, status: RoomStatusFilter | string): boolean {
  if (houseId && houseId !== 'all' && row?.houseId !== houseId) return false;
  if (status === 'all' || !status) return true;
  if (status === 'vacant') return occupiedSlots(row).length === 0;
  if (status === 'occupied') return occupiedSlots(row).length > 0;
  // Hoá đơn tab: a room with no invoice yet, or only a draft, is "not issued"; "issued-unpaid" is issued and not paid.
  const notIssued = row?.invoiceId == null || row?.draft === true;
  if (status === 'notissued') return notIssued;
  if (status === 'issued-unpaid') return !notIssued && (row?.paymentStatus || row?.status || 'unpaid') === 'unpaid';
  return (row?.paymentStatus || row?.status || 'unpaid') === status;
}
