// SOTA activation zones: the ground around a summit no more than 25 m below
// its top, reachable without dropping below that height. Worked out once from
// a height grid (see elevation.js activationZone) and saved in data/zones.json:
//   { "GM/SS-011": { v, top, threshold, ring: [[lat, lon], ...], truncated? } }
// Shared by the browser and the edit server, so no browser- or Node-only APIs here.

/** Bump when the method changes, so older saved zones are worked out again. */
export const ZONE_VERSION = 1;

/** Vertical drop that defines the zone (SOTA General Rules). */
export const ZONE_DROP = 25;

/**
 * The zone in a height grid: cells joined edge to edge (not just at corners)
 * to the summit cell and no lower than `threshold`, outlined by a contour at
 * that height. Holes (hollows inside the zone) are left out.
 * @param grid { w, h, z: Float32Array (row by row), toLatLon(x, y) -> [lat, lon] } (cell centres at whole numbers)
 * @param start index of the summit cell in grid.z
 * @returns { ring: [[lat, lon], ...], cells, touchesEdge } or null if the summit cell is below threshold
 */
export function zoneFromGrid(grid, start, threshold) {
  const { w, h, z } = grid;
  if (!(z[start] >= threshold)) return null;
  const inside = new Uint8Array(w * h);
  const stack = [start];
  inside[start] = 1;
  let cells = 0, touchesEdge = false;
  while (stack.length) {
    const i = stack.pop();
    cells++;
    const x = i % w, y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !inside[j] && z[j] >= threshold) { inside[j] = 1; stack.push(j); }
    }
  }

  // Heights for contouring: the zone as it is, everything else held just below
  // the threshold (or well below, past the grid's edge) so only the zone's own
  // outline comes out.
  const val = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return threshold - ZONE_DROP;
    const i = y * w + x;
    return inside[i] ? z[i] : Math.min(z[i], threshold - 0.01);
  };
  const isIn = (x, y) => x >= 0 && y >= 0 && x < w && y < h && inside[y * w + x] === 1;

  // Marching squares over squares whose corners are cell centres, one cell
  // beyond the grid on each side so every ring closes. Crossing points are
  // keyed by the edge they sit on, then joined into rings.
  const points = new Map(); // edge key -> [x, y]
  const links = new Map(); // edge key -> [edge key, ...]
  const cross = (key, x0, y0, x1, y1) => {
    if (!points.has(key)) {
      const a = val(x0, y0), b = val(x1, y1);
      const t = Math.min(1, Math.max(0, (threshold - a) / (b - a)));
      points.set(key, [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
    return key;
  };
  const link = (a, b) => {
    if (!links.has(a)) links.set(a, []);
    if (!links.has(b)) links.set(b, []);
    links.get(a).push(b);
    links.get(b).push(a);
  };
  // Squares that can hold part of the outline: those touching a zone cell.
  const squares = new Set();
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue;
    const x = i % w, y = (i - x) / w;
    for (const [sx, sy] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]) squares.add(`${sx},${sy}`);
  }
  for (const s of squares) {
    const [x, y] = s.split(',').map(Number);
    const tl = isIn(x, y), tr = isIn(x + 1, y), br = isIn(x + 1, y + 1), bl = isIn(x, y + 1);
    const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (c === 0 || c === 15) continue;
    const top = () => cross(`h${x},${y}`, x, y, x + 1, y);
    const bottom = () => cross(`h${x},${y + 1}`, x, y + 1, x + 1, y + 1);
    const left = () => cross(`v${x},${y}`, x, y, x, y + 1);
    const right = () => cross(`v${x + 1},${y}`, x + 1, y, x + 1, y + 1);
    switch (c) {
      case 1: case 14: link(left(), bottom()); break;
      case 2: case 13: link(bottom(), right()); break;
      case 3: case 12: link(left(), right()); break;
      case 4: case 11: link(top(), right()); break;
      case 6: case 9: link(top(), bottom()); break;
      case 7: case 8: link(left(), top()); break;
      // Opposite corners only: the zone doesn't join across a corner (it was
      // filled edge to edge), so cut each corner off on its own.
      case 5: link(left(), bottom()); link(top(), right()); break;
      case 10: link(left(), top()); link(bottom(), right()); break;
    }
  }

  // Walk the links into closed rings and keep the biggest: the outer edge.
  const seen = new Set();
  let best = null, bestArea = 0;
  for (const startKey of links.keys()) {
    if (seen.has(startKey)) continue;
    const ring = [];
    let prev = null, cur = startKey;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      ring.push(points.get(cur));
      const next = links.get(cur).find((k) => k !== prev && !seen.has(k));
      prev = cur;
      cur = next;
    }
    const area = Math.abs(ringArea(ring));
    if (area > bestArea) { bestArea = area; best = ring; }
  }
  if (!best) return null;
  const simple = simplifyRing(best, 0.35);
  return { ring: simple.map(([x, y]) => grid.toLatLon(x, y).map((v) => Math.round(v * 1e5) / 1e5)), cells, touchesEdge };
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Douglas–Peucker on a closed ring of [x, y] (tolerance in the same units). */
export function simplifyRing(ring, tol) {
  if (ring.length < 8) return ring;
  // Split at the point furthest from the first, simplify both halves.
  let far = 0, farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > farD) { farD = d; far = i; }
  }
  const a = simplifyLine(ring.slice(0, far + 1), tol);
  const b = simplifyLine([...ring.slice(far), ring[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function simplifyLine(pts, tol) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1e-9;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplifyLine(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplifyLine(pts.slice(idx), tol)];
}

/** A saved zone that's still good (worked out with the current method). */
export const zoneCurrent = (zone) => zone?.v === ZONE_VERSION && Array.isArray(zone.ring) && zone.ring.length >= 3;

/** Keep only well-formed zones, for saving data/zones.json. */
export function cleanZones(body) {
  const out = {};
  const ref = /^[A-Z0-9]+\/[A-Z]{2}-\d{3}$/;
  const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : null);
  for (const [k, zone] of Object.entries(body ?? {}).slice(0, 5000)) {
    if (!ref.test(k) || !Array.isArray(zone?.ring)) continue;
    const ring = zone.ring.slice(0, 5000)
      .map((p) => [Number(p?.[0]), Number(p?.[1])])
      .filter(([lat, lon]) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
      .map(([lat, lon]) => [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]);
    if (ring.length < 3) continue;
    out[k] = {
      v: Number.isInteger(zone.v) ? zone.v : 0,
      top: num(zone.top),
      threshold: num(zone.threshold),
      ring,
      ...(zone.truncated ? { truncated: true } : {}),
    };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Saved zones with new ones added (new ones win). */
export const mergeZones = (saved, added) => cleanZones({ ...(saved ?? {}), ...added });
