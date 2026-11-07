// Loading data. All paths are relative so the site works from any base URL
// (GitHub Pages project sites live under /<repo>/).

async function loadJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

function once(fn) {
  let p;
  return () => (p ??= fn());
}

export const getSummits = once(async () => {
  const d = await loadJson('data/summits.json');
  return { ...d, byRef: new Map(d.summits.map((s) => [s.ref, s])) };
});

export const getHills = once(async () => {
  const d = await loadJson('data/hills.json');
  return { ...d, byId: new Map(d.hills.map((h) => [h.id, h])) };
});

/** Edit mode is on when the edit API answers; the static site has none. */
export const getStatus = once(async () => {
  try {
    const res = await fetch('api/status', { cache: 'no-store' });
    if (!res.ok) return { edit: false };
    return await res.json();
  } catch {
    return { edit: false };
  }
});

export function getIndex() {
  return loadJson('data/routes/index.json').catch(() => []);
}

export function getRoute(id) {
  return loadJson(`data/routes/${encodeURIComponent(id)}/route.json`);
}

export async function getGpxText(id, file) {
  const res = await fetch(`data/routes/${encodeURIComponent(id)}/${file}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GPX: ${res.status}`);
  return res.text();
}

export function photoUrl(routeId, file) {
  return `data/routes/${encodeURIComponent(routeId)}/photos/${encodeURIComponent(file)}`;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${method} ${url}: ${res.status}`);
  return data;
}

export const createRoute = (body) => api('POST', 'api/routes', body);
export const saveRoute = (id, body) => api('PUT', `api/routes/${encodeURIComponent(id)}`, body);
export const deleteRoute = (id) => api('DELETE', `api/routes/${encodeURIComponent(id)}`);
export const publish = () => api('POST', 'api/publish');

/** Read a coordinate from pasted text: "56.5, -4.2" or a Google Maps URL. */
export function parseLatLon(text) {
  const s = String(text ?? '');
  const m = /(-?\d{1,2}\.\d+)\s*[,\s]\s*(-?\d{1,3}\.\d+)/.exec(s);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
}

export function googleMapsUrl(p) {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
}
