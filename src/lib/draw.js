// Drawing routes in the trip editor: each stretch between two clicked points
// either follows paths (BRouter's hiking profile, from OpenStreetMap, with
// heights) or is a straight line (heights from terrain tiles). Browser only.
import { distanceM } from './gpx.js';
import { addElevation } from './elevation.js';

const BROUTER = 'https://brouter.de/brouter';
const PROFILE = 'hiking-mountain';
/** A path that starts or ends further than this from the clicked point gets a straight join to it. */
const JOIN_M = 25;

export const DRAW_MODES = { path: 'Follow paths', line: 'Straight line' };
export const DRAW_SOURCE = 'Drawn in SOTA Trip Planner (paths: BRouter, OpenStreetMap contributors)';

const cache = new Map(); // segment key -> Promise<segment>

/** Identifies a stretch: its two ends and how it's drawn. */
export const segmentKey = (a, b, mode) => `${a.lat.toFixed(6)},${a.lon.toFixed(6)}|${b.lat.toFixed(6)},${b.lon.toFixed(6)}|${mode}`;

/**
 * The points of one stretch from a to b: { mode, pts: [{lat, lon, ele}], fallback }.
 * fallback is set when paths couldn't be followed, so a straight line was used.
 */
export function segment(a, b, mode) {
  const key = segmentKey(a, b, mode);
  if (!cache.has(key)) {
    const p = mode === 'path'
      ? followPaths(a, b).catch((e) => straight(a, b).then((s) => ({ ...s, fallback: e.message })))
      : straight(a, b);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key);
}

async function followPaths(a, b) {
  const ll = (p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
  const res = await fetch(`${BROUTER}?lonlats=${ll(a)}|${ll(b)}&profile=${PROFILE}&alternativeidx=0&format=geojson`);
  const text = await res.text();
  if (!res.ok) throw new Error(text.trim().slice(0, 120) || `BRouter answered ${res.status}`);
  const coords = JSON.parse(text).features?.[0]?.geometry?.coordinates;
  if (!coords?.length) throw new Error('no path found');
  const pts = coords.map(([lon, lat, ele]) => ({ lat, lon, ele: Number.isFinite(ele) ? ele : null }));
  // BRouter starts and ends on the nearest path: join it to the points you clicked.
  if (distanceM(a, pts[0]) > JOIN_M) pts.unshift({ lat: a.lat, lon: a.lon, ele: null });
  if (distanceM(b, pts.at(-1)) > JOIN_M) pts.push({ lat: b.lat, lon: b.lon, ele: null });
  return { mode: 'path', pts };
}

async function straight(a, b) {
  const ends = [{ lat: a.lat, lon: a.lon, ele: null }, { lat: b.lat, lon: b.lon, ele: null }];
  try {
    const [pts] = await addElevation([ends]); // a point every 25 m, with heights
    return { mode: 'line', pts };
  } catch {
    return { mode: 'line', pts: ends };
  }
}

/** Join stretches into one line, dropping the repeated point where they meet. */
export function joinSegments(segs) {
  const out = [];
  for (const s of segs) {
    for (const p of s.pts) {
      const last = out.at(-1);
      if (last && Math.abs(last.lat - p.lat) < 1e-7 && Math.abs(last.lon - p.lon) < 1e-7) continue;
      out.push(p);
    }
  }
  return out;
}
