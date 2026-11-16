// Summits you've activated, from your public SOTA activator log. Set
// VITE_SOTA_USER_ID in .env to your SOTA database user id (the number in
// https://api-db2.sota.org.uk/logs/activator/<id>/0/1). The API allows
// cross-origin requests, so the browser asks it directly.

const USER_ID = String(import.meta.env.VITE_SOTA_USER_ID ?? '').trim();

let loaded = null;

/**
 * Map of summit ref -> { count, last } (last = latest activation date, YYYY-MM-DD),
 * or null when no user id is set.
 * @returns {Promise<Map<string, {count: number, last: string}> | null>}
 */
export function getMyActivations() {
  if (!USER_ID) return Promise.resolve(null);
  loaded ??= (async () => {
    const res = await fetch(`https://api-db2.sota.org.uk/logs/activator/${encodeURIComponent(USER_ID)}/0/1`);
    if (!res.ok) throw new Error(`SOTA activator log answered ${res.status}`);
    const rows = await res.json();
    const out = new Map();
    for (const a of Array.isArray(rows) ? rows : []) {
      if (!a.SummitCode) continue;
      const cur = out.get(a.SummitCode) ?? { count: 0, last: '' };
      cur.count++;
      if ((a.ActivationDate ?? '') > cur.last) cur.last = a.ActivationDate;
      out.set(a.SummitCode, cur);
    }
    return out;
  })();
  loaded.catch(() => { loaded = null; });
  return loaded;
}
