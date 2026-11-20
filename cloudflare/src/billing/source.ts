// Which side owns invoices: the old Google Sheet ('sheet', the default) or this Worker ('worker').
export async function isWorkerSource(db: D1Database): Promise<boolean> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'source_of_truth'`).first<{ value: string }>();
  return row?.value === 'worker';
}
