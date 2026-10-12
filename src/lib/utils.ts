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
