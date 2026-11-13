// Drive times by road, from the public OSRM router (OpenStreetMap data).
// It's a free demo service for light use, so results are cached, and callers
// fall back to a rough straight-line guess when it can't be reached.

import { distanceM } from './gpx.js';
import { loadDrivePad } from './home.js';

const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const cache = new Map();

/** Minutes by road from a to b as the router has it, or null if routing failed. */
export async function roadMinutes(a, b) {
  const key = `${a.lat.toFixed(5)},${a.lon.toFixed(5)};${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const url = `${OSRM}/${a.lon.toFixed(5)},${a.lat.toFixed(5)};${b.lon.toFixed(5)},${b.lat.toFixed(5)}?overview=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) return null;
    const minutes = data.routes[0].duration / 60;
    cache.set(key, minutes);
    return minutes;
  } catch {
    return null;
  }
}

/** Rough drive time: straight line ×1.4 for the roads, at 50 km/h, rounded to 5 minutes. */
export function guessDriveMinutes(a, b) {
  const km = (distanceM(a, b) / 1000) * 1.4;
  return Math.max(5, Math.round((km * 60) / 50 / 5) * 5);
}

/**
 * Best available drive time. `how` is 'road' (routed), 'guess' (routing failed)
 * or 'unknown' (a or b missing: `minutes` is a placeholder).
 */
export async function driveTime(a, b, placeholder = 60) {
  if (!a || !b) return { minutes: placeholder, how: 'unknown' };
  const raw = await roadMinutes(a, b);
  if (raw == null) return { minutes: guessDriveMinutes(a, b), how: 'guess' };
  // Pad by the Settings percentage, then round up to 5 minutes.
  return { minutes: Math.max(5, Math.ceil((raw * (1 + loadDrivePad() / 100)) / 5) * 5), how: 'road' };
}
