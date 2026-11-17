/**
 * Account creation on the Cloudflare Worker for the admin "Tạo tài khoản mới" form: pick a house,
 * then a room or "Admin" (an Admin căn of that house, Admin Tổng only).
 */
import { useEffect, useState } from 'react';
import { workerFetch } from './api';

export const ADMIN_ROOM = 'admin';

export interface WorkerHouse { id: string; name: string }
export interface WorkerRoom { id: number; name: string; capacity: number; occupants: number }

export function useAccountTargets(enabled: boolean) {
  const [houses, setHouses] = useState<WorkerHouse[]>([]);
  const [houseId, setHouseId] = useState('');
  const [rooms, setRooms] = useState<WorkerRoom[]>([]);

  useEffect(() => {
    if (!enabled) return;
    workerFetch('/api/houses')
      .then((res) => res.json())
      .then((data) => {
        const list: WorkerHouse[] = data?.houses ?? [];
        setHouses(list);
        setHouseId((current) => current || list[0]?.id || '');
      })
      .catch(() => {});
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !houseId) return;
    setRooms([]);
    workerFetch(`/api/houses/${encodeURIComponent(houseId)}/rooms`)
      .then((res) => res.json())
      .then((data) => setRooms(data?.rooms ?? []))
      .catch(() => {});
  }, [enabled, houseId]);

  return { houses, houseId, setHouseId, rooms };
}

/** Creates a resident in a room, or an Admin căn when the room is ADMIN_ROOM. */
export async function createAccountOnWorker(input: {
  houseId: string;
  room: string;
  fullName: string;
  phone: string;
  password: string;
  email?: string;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  const isAdmin = input.room === ADMIN_ROOM;
  const res = await workerFetch(isAdmin ? '/api/staff' : `/api/houses/${encodeURIComponent(input.houseId)}/residents`, {
    method: 'POST',
    body: JSON.stringify(
      isAdmin
        ? { fullName: input.fullName, phone: input.phone, password: input.password, role: 'manager', houseIds: [input.houseId] }
        : { fullName: input.fullName, phone: input.phone, password: input.password, email: input.email, roomId: Number(input.room) }
    ),
  }).catch(() => null);
  const data = await res?.json().catch(() => null);
  if (!data?.success) return { success: false, error: data?.error || 'Không thể tạo tài khoản' };
  return {
    success: true,
    message: isAdmin
      ? `Đã tạo Admin căn ${input.fullName.trim()}. Người này đăng nhập bằng số ${input.phone.trim()}.`
      : `Đã tạo tài khoản cư dân phòng ${data.room}.`,
  };
}

/**
 * The Tiện ích tools the signed-in staff member's houses pay for (set by the Developer).
 * null while unknown or without a Worker session: every tool stays visible.
 */
export function useEnabledModules(enabled: boolean): Set<string> | null {
  const [modules, setModules] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    workerFetch('/api/modules')
      .then((res) => res.json())
      .then((data) => { if (data?.success && Array.isArray(data.modules)) setModules(new Set(data.modules)); })
      .catch(() => {});
  }, [enabled]);
  return modules;
}
