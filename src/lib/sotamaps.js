// Routes that people have uploaded to SOTAmaps for a summit. The API allows
// cross-origin requests, so the browser asks it directly.
import { gpxStats } from './gpx.js';

const API = 'https://api-db.sota.org.uk/smp/gpx/summit';

/** Dashed-line colours for SOTAmaps tracks, picked to stand apart from the route colours. */
export const SMP_COLORS = ['#d6336c', '#7048e8', '#1098ad', '#f76707', '#37b24d', '#495057'];

const cache = new Map(); // ref -> Promise<route[]>

/**
 * SOTAmaps routes for a summit ref like "GM/ES-063", newest first.
 * Each: { id, callsign, title, notes, posted, points: [{lat,lon,ele}], distanceKm, ascentM }.
 * Resolves to [] when there are none; rejects if the API can't be reached.
 */
export function getSummitRoutes(ref) {
  if (!cache.has(ref)) {
    const p = fetchRoutes(ref);
    p.catch(() => cache.delete(ref)); // let a later call try again
    cache.set(ref, p);
  }
  return cache.get(ref);
}

async function fetchRoutes(ref) {
  const res = await fetch(`${API}/${ref.split('/').map(encodeURIComponent).join('/')}`);
  if (!res.ok) throw new Error(`SOTAmaps answered ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) return []; // e.g. {"error":"Invalid Summit Code"}
  return data.map((t) => {
    const points = (t.points ?? [])
      .map((p) => ({ lat: Number(p.latitude), lon: Number(p.longitude), ele: p.altitude == null ? null : Number(p.altitude) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const stats = gpxStats([points]);
    return {
      id: String(t.hdr_id),
      callsign: t.callsign ?? '',
      title: (t.track_title ?? '').trim() || 'Untitled route',
      notes: (t.track_notes ?? '').trim(),
      posted: (t.posted_date ?? '').slice(0, 10),
      points,
      distanceKm: stats.distanceKm,
      ascentM: stats.ascentM,
    };
  }).filter((t) => t.points.length > 1)
    .sort((a, b) => b.posted.localeCompare(a.posted));
}
