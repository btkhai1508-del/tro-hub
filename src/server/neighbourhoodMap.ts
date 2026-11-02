/**
 * Khu phố and ấp were renamed ward by ward after the 2025 merger, with no shared list, so the landlord
 * keeps the renames that matter in the "KHU PHỐ" tab: A Phường cũ | B Khu phố cũ | C Phường mới | D Khu phố mới.
 * Row 1 is the header. The tab is read at most every ten minutes; without it there is simply nothing to rename.
 */
import type { Express } from 'express';
import { requireAuth } from './authToken.js';
import { DEFAULT_SPREADSHEET_ID } from './googleSheetsBackendService.js';

export interface NeighbourhoodRename {
  oldWard: string;
  oldArea: string;
  newWard: string;
  newArea: string;
}

const TAB = 'KHU PHỐ';
const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; rows: NeighbourhoodRename[] } | null = null;

async function readRenames(): Promise<NeighbourhoodRename[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const { fetchSheetXlsx, parseSheetXmlRows } = await import('./adminService.js');
  const zip = await fetchSheetXlsx(DEFAULT_SPREADSHEET_ID);
  if (!zip) return cache?.rows || [];
  const { rows } = await parseSheetXmlRows(zip, TAB);
  const renames = rows
    .filter((row: any) => row.rowNumber > 1)
    .map((row: any) => ({
      oldWard: String(row.cells.A?.value ?? '').trim(),
      oldArea: String(row.cells.B?.value ?? '').trim(),
      newWard: String(row.cells.C?.value ?? '').trim(),
      newArea: String(row.cells.D?.value ?? '').trim(),
    }))
    .filter(row => row.oldWard && row.oldArea && row.newArea);
  cache = { at: Date.now(), rows: renames };
  return renames;
}

export function registerNeighbourhoodMap(app: Express) {
  app.get('/api/khu-pho', requireAuth, async (_req, res) => {
    try {
      res.json({ success: true, rows: await readRenames() });
    } catch {
      res.json({ success: true, rows: cache?.rows || [] });
    }
  });
}
