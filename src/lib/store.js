import { normalizeTrip } from './trip.js';
import * as github from './github.js';

// Loading and saving data. There are three modes:
//   local  - `npm run edit` / `npm run serve`: the edit API reads and writes data/ on disk
//   github - a GitHub token is saved in this browser: reads and commits go through the GitHub API
//   static - the public site: read-only, from the deployed data/ files
// All paths are relative so the site works from any base URL
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

let mode = 'static';
let gh = null; // GitHub settings in github mode

/**
 * Which mode we're in. The local edit API wins when it answers; otherwise
 * a saved GitHub token turns on GitHub mode.
 * @returns {Promise<{ edit: boolean, mode: 'local'|'github'|'static', git?: boolean, repo?: string }>}
 */
export const getStatus = once(async () => {
  try {
    const res = await fetch('api/status', { cache: 'no-store' });
    if (res.ok) {
      const status = await res.json();
      mode = 'local';
      return { ...status, mode };
    }
  } catch {}
  gh = github.loadSettings();
  if (gh) {
    mode = 'github';
    return { edit: true, mode, repo: gh.repo, branch: gh.branch };
  }
  return { edit: false, mode };
});

export async function getIndex() {
  await getStatus();
  if (mode === 'github') {
    const text = await github.readFile(gh, 'data/trips/index.json');
    return text ? JSON.parse(text) : [];
  }
  return loadJson('data/trips/index.json').catch(() => []);
}

export async function getTrip(id) {
  await getStatus();
  if (mode === 'github') return github.getTrip(gh, id);
  return normalizeTrip(await loadJson(`data/trips/${encodeURIComponent(id)}/trip.json`));
}

/** URL of a file in a trip folder. In GitHub mode it points at the repo, so new files show before the site redeploys. */
function tripFileUrl(tripId, file) {
  if (mode === 'github') return github.rawUrl(gh, `data/trips/${tripId}/${file}`);
  return `data/trips/${encodeURIComponent(tripId)}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

export function gpxUrl(tripId, file) {
  return tripFileUrl(tripId, file);
}

export function photoUrl(tripId, file) {
  return tripFileUrl(tripId, `photos/${file}`);
}

export async function getGpxText(tripId, file) {
  await getStatus();
  if (mode === 'github') {
    const text = await github.readFile(gh, `data/trips/${tripId}/${file}`);
    if (text == null) throw new Error(`GPX ${file}: not found`);
    return text;
  }
  const res = await fetch(gpxUrl(tripId, file), { cache: 'no-store' });
  if (!res.ok) throw new Error(`GPX: ${res.status}`);
  return res.text();
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

export const createTrip = (body) =>
  mode === 'github' ? github.saveTrip(gh, null, body) : api('POST', 'api/trips', body);
export const saveTrip = (id, body) =>
  mode === 'github' ? github.saveTrip(gh, id, body) : api('PUT', `api/trips/${encodeURIComponent(id)}`, body);
export const deleteTrip = (id) =>
  mode === 'github' ? github.deleteTrip(gh, id) : api('DELETE', `api/trips/${encodeURIComponent(id)}`);
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

/** Google Maps directions to `to`, from `from` if given (else your location). */
/** Google Maps with a pin at a point (not directions). */
export function googleMapsPlaceUrl(p) {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
}

export function googleMapsUrl(to, from = null) {
  const origin = from ? `&origin=${from.lat},${from.lon}` : '';
  return `https://www.google.com/maps/dir/?api=1${origin}&destination=${to.lat},${to.lon}&travelmode=driving`;
}
