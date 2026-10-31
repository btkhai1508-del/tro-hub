import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Returns current month strictly as MM/YYYY (e.g. "10/2026").
 * Automatically calculates the current month when transitioning to a new month.
 */
export function getCurrentMonthStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const y = d.getFullYear();
  return `${m}/${y}`;
}

/**
 * Standard list of room numbers across Trung Kim & Le Van Chi
 */
export const DEFAULT_ROOM_NUMBERS = [
  'G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07',
  '101', '102', '103', '104', '105', '106', '107', '108',
  '201', '202', '203', '204', '205', '206', '207', '208', '209', '210',
  '301', '302', '303', '304', '305', '306', '307', '308', '309', '310',
  'LVC-101', 'LVC-102', 'LVC-103', 'LVC-104',
  'LVC-201', 'LVC-202', 'LVC-203', 'LVC-204'
];
