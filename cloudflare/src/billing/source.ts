// Which side owns invoices: the old Google Sheet ('sheet', the default) or this Worker ('worker').
export type Source = 'sheet' | 'worker';

export async function getSource(db: D1Database): Promise<Source> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'source_of_truth'`).first<{ value: string }>();
  return row?.value === 'worker' ? 'worker' : 'sheet';
}

export async function isWorkerSource(db: D1Database): Promise<boolean> {
  return (await getSource(db)) === 'worker';
}

/** Writes the switch. Switching to 'worker' also remembers the moment (UTC), so residents created from then on can be counted. */
export async function setSource(db: D1Database, source: Source): Promise<void> {
  const upsert = (key: string, value: string) =>
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).bind(key, value);
  if (source === 'worker' && (await getSource(db)) !== 'worker') {
    await db.batch([upsert('source_of_truth', source), upsert('source_worker_since', new Date().toISOString().replace('T', ' ').slice(0, 19))]);
  } else {
    await upsert('source_of_truth', source).run();
  }
}
