/**
 * Which side owns invoices and profiles right now: the Google Sheet or the Worker. The Worker is
 * asked (GET /api/source) and the answer kept for 30 s; a Worker that cannot be reached counts as
 * the Sheet, so the old behaviour is always the fallback.
 */
export type DataSource = 'sheet' | 'worker';

export const SOURCE_TTL_MS = 30_000;

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<any> }>;

export function createSourceReader(baseUrl: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, now: () => number = Date.now) {
  let cached: { value: DataSource; at: number } | null = null;
  return async function readSource(): Promise<DataSource> {
    if (cached && now() - cached.at < SOURCE_TTL_MS) return cached.value;
    let value: DataSource = 'sheet';
    try {
      const res = await fetchImpl(`${baseUrl}/api/source`, { signal: AbortSignal.timeout(5000) });
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (body?.source === 'worker') value = 'worker';
    } catch {
      value = 'sheet';
    }
    cached = { value, at: now() };
    return value;
  };
}
