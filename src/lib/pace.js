// Walking pace: learnt from GPX recordings of walks you've done, then used to
// predict walking times on new routes. Shared by the browser and the edit
// server, so no browser- or Node-only APIs here.
//
// The model, per stretch of walking:
//   minutes = flat × km + up × (metres up / 100) + down × (metres down / 100)
// then × (1 + rest) for short stops along the way.
// `flat`, `up` and `down` are fitted by least squares over ~250 m chunks of
// each recording, ignoring time spent stopped. Stops of 20 minutes or more
// (activations, lunch) don't count towards `rest`.

import { distanceM } from './gpx.js';

export const TERRAINS = {
  easy: 'Easy: good paths',
  moderate: 'Moderate: rough paths',
  rough: 'Rough: pathless, boggy or rocky',
};
export const DEFAULT_TERRAIN = 'moderate';

/** Naismith's rule, used until you've added some walks: 5 km/h plus 10 min per 100 m up. */
export const NAISMITH = { flat: 12, up: 10, down: 0, rest: 0 };

const STEP_S = 30;          // group track points into steps of at least this many seconds
const MOVING_M = 10;        // a step that moves less than this (and doesn't climb) is a stop
const CHUNK_KM = 0.25;      // fit over chunks of about this much walking
const LONG_STOP_MIN = 20;   // stops this long are activations or lunch, not rests
const ELE_STEP = 5;         // ignore elevation wobbles smaller than this (as gpxStats does)

/**
 * Elevation with changes under ELE_STEP ignored, so summed ups and downs match
 * gpxStats. Points without elevation take the last known value.
 */
export function cleanElevations(pts, threshold = ELE_STEP) {
  let ref = null;
  return pts.map((p) => {
    if (p.ele != null && (ref == null || Math.abs(p.ele - ref) >= threshold)) ref = p.ele;
    return ref;
  });
}

function upDown(ele, from, to) {
  let up = 0, down = 0;
  for (let k = from; k < to; k++) {
    if (ele[k] == null || ele[k + 1] == null) continue;
    const dz = ele[k + 1] - ele[k];
    if (dz > 0) up += dz; else down -= dz;
  }
  return { up, down };
}

function pathKm(pts, from, to) {
  let d = 0;
  for (let k = from; k < to; k++) d += distanceM(pts[k], pts[k + 1]);
  return d / 1000;
}

const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Learn from one recorded walk.
 * @param {import('./gpx.js').Point[][]} lines parsed GPX with times
 * @returns a walk record (without name/terrain), or throws if the GPX has no times
 */
export function learnWalk(lines) {
  const pts = lines.flat().filter((p) => p.time != null).sort((a, b) => a.time - b.time);
  if (pts.length < 20) {
    throw new Error('it has no timestamps. Use the recording from your watch, phone or GPS, not a planned route.');
  }
  const ele = cleanElevations(pts);

  // 1. Steps of ~30 s: moving or stopped.
  const rows = [];
  let chunk = { d: 0, up: 0, down: 0, t: 0 };
  let stop = 0, restMin = 0, stopMin = 0, movingMin = 0;
  let distanceKm = 0, ascentM = 0, descentM = 0;
  const endStop = () => {
    if (stop >= LONG_STOP_MIN) stopMin += stop; else restMin += stop;
    stop = 0;
  };
  const endChunk = () => {
    if (chunk.d > 0.05) rows.push(chunk);
    chunk = { d: 0, up: 0, down: 0, t: 0 };
  };
  for (let i = 0; i < pts.length - 1;) {
    let j = i + 1;
    while (j < pts.length - 1 && (pts[j].time - pts[i].time) / 1000 < STEP_S) j++;
    const t = (pts[j].time - pts[i].time) / 60000;
    const { up, down } = upDown(ele, i, j);
    const moved = distanceM(pts[i], pts[j]) >= MOVING_M || up + down > 0;
    if (moved && t < 30) {
      endStop();
      const d = pathKm(pts, i, j);
      chunk.d += d; chunk.up += up; chunk.down += down; chunk.t += t;
      distanceKm += d; ascentM += up; descentM += down; movingMin += t;
      if (chunk.d >= CHUNK_KM) endChunk();
    } else {
      stop += t; // also covers gaps in the recording
    }
    i = j;
  }
  endStop();
  endChunk();
  if (rows.length < 4) throw new Error('there is too little walking in it to learn from.');

  // 2. Least-squares sums for t = flat·d + up·(u/100) + down·(v/100).
  const xtx = [0, 0, 0, 0, 0, 0]; // a00 a01 a02 a11 a12 a22
  const xty = [0, 0, 0];
  for (const r of rows) {
    const x = [r.d, r.up / 100, r.down / 100];
    xtx[0] += x[0] * x[0]; xtx[1] += x[0] * x[1]; xtx[2] += x[0] * x[2];
    xtx[3] += x[1] * x[1]; xtx[4] += x[1] * x[2]; xtx[5] += x[2] * x[2];
    xty[0] += x[0] * r.t; xty[1] += x[1] * r.t; xty[2] += x[2] * r.t;
  }
  const sums = { xtx: xtx.map((v) => round(v, 4)), xty: xty.map((v) => round(v, 4)), n: rows.length };
  return {
    date: new Date(pts[0].time).toISOString().slice(0, 10),
    distanceKm: round(distanceKm),
    ascentM: Math.round(ascentM),
    descentM: Math.round(descentM),
    movingMin: Math.round(movingMin),
    restMin: Math.round(restMin),
    stopMin: Math.round(stopMin),
    sums,
    fit: fitSums(sums, restMin / movingMin),
  };
}

function solve3(a, b) {
  const m = [[a[0], a[1], a[2], b[0]], [a[1], a[3], a[4], b[1]], [a[2], a[4], a[5], b[2]]];
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-9) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

const sensible = ({ flat, up, down }) =>
  flat >= 5 && flat <= 40 && up >= 1 && up <= 40 && down >= -5 && down <= 25;

/** Fit flat/up/down from least-squares sums, falling back to simpler fits if the data can't support it. */
export function fitSums(sums, rest = 0) {
  const [a00, a01, , a11] = sums.xtx;
  const out = (flat, up, down) => ({ flat: round(flat), up: round(up), down: round(down), rest: round(rest, 3) });
  const full = solve3(sums.xtx, sums.xty);
  if (full && sensible({ flat: full[0], up: full[1], down: full[2] })) return out(...full);
  // No separate descent term (e.g. too little descent to tell).
  const det = a00 * a11 - a01 * a01;
  if (Math.abs(det) > 1e-9) {
    const flat = (sums.xty[0] * a11 - a01 * sums.xty[1]) / det;
    const up = (a00 * sums.xty[1] - a01 * sums.xty[0]) / det;
    if (sensible({ flat, up, down: 0 })) return out(flat, up, 0);
  }
  // Naismith's shape, scaled to your speed.
  const naismithX = sums.xtx[0] * 144 + 2 * a01 * 120 + a11 * 100; // x·[12,10,0] squared, summed
  const naismithY = sums.xty[0] * 12 + sums.xty[1] * 10;
  const k = naismithX > 0 ? naismithY / naismithX : 1;
  return out(NAISMITH.flat * k, NAISMITH.up * k, 0);
}

/**
 * Combine several walks into one set of pace numbers: each walk's own fit,
 * averaged by walking time. (Pooling every chunk into one fit would mix fast
 * and slow terrain and can give odd answers.)
 */
export function combineWalks(walks) {
  let weight = 0, moving = 0, rest = 0;
  const acc = { flat: 0, up: 0, down: 0 };
  for (const w of walks) {
    const fit = w.fit ?? fitSums(w.sums);
    const k = w.movingMin || 1;
    acc.flat += fit.flat * k; acc.up += fit.up * k; acc.down += fit.down * k;
    weight += k; moving += w.movingMin; rest += w.restMin;
  }
  return {
    flat: round(acc.flat / weight), up: round(acc.up / weight), down: round(acc.down / weight),
    rest: round(moving ? rest / moving : 0, 3),
  };
}

/**
 * Pace numbers to use for a terrain: your walks on that terrain, else all your
 * walks, else Naismith. `basis` says which, for showing to the user.
 */
export function paceFor(pace, terrain = DEFAULT_TERRAIN) {
  const walks = pace?.walks ?? [];
  const same = walks.filter((w) => w.terrain === terrain);
  if (same.length) return { params: combineWalks(same), basis: `your ${terrain} walks`, count: same.length };
  if (walks.length) return { params: combineWalks(walks), basis: 'all your walks', count: walks.length };
  return { params: NAISMITH, basis: 'Naismith', count: 0 };
}

/** Minutes for a stretch of walking, before rounding. */
export function walkMinutes({ distanceKm, upM, downM }, params) {
  const moving = params.flat * distanceKm + params.up * (upM / 100) + params.down * (downM / 100);
  return Math.max(0, moving) * (1 + (params.rest ?? 0));
}

/** Round a stage time to 5 minutes (at least 5). */
export const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);

/** Minutes for a whole route from its saved stats ({ distanceKm, ascentM, descentM }). */
export function statsMinutes(stats, params) {
  if (!stats) return null;
  return Math.round(walkMinutes({ distanceKm: stats.distanceKm, upM: stats.ascentM, downM: stats.descentM ?? stats.ascentM }, params));
}

/**
 * Split a route's track into legs at the given point indexes (ascending) and
 * measure each: [start → i1], [i1 → i2], …, [ik → end].
 */
export function legsAt(lines, splits) {
  const pts = lines.flat();
  const ele = cleanElevations(pts);
  const cuts = [0, ...splits, pts.length - 1];
  const legs = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const { up, down } = upDown(ele, cuts[k], cuts[k + 1]);
    legs.push({ distanceKm: pathKm(pts, cuts[k], cuts[k + 1]), upM: up, downM: down });
  }
  return legs;
}

/** Index of the track point nearest to `p`, and its distance in metres. */
export function nearestPoint(lines, p) {
  let best = -1, bestD = Infinity;
  lines.flat().forEach((q, i) => {
    const d = distanceM(p, q);
    if (d < bestD) { bestD = d; best = i; }
  });
  return { index: best, distanceM: bestD };
}

/** Keep only known fields with sensible values, for saving data/pace.json. */
export function cleanPace(body) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const walks = (Array.isArray(body?.walks) ? body.walks : []).slice(0, 500).map((w) => {
    if (!w?.sums || !Array.isArray(w.sums.xtx) || w.sums.xtx.length !== 6 || !Array.isArray(w.sums.xty) || w.sums.xty.length !== 3) {
      throw Object.assign(new Error('Bad walk record'), { status: 400 });
    }
    const sums = { xtx: w.sums.xtx.map(num), xty: w.sums.xty.map(num), n: num(w.sums.n) };
    const movingMin = num(w.movingMin), restMin = num(w.restMin);
    return {
      id: String(w.id ?? '').slice(0, 20) || Math.random().toString(36).slice(2, 8),
      name: String(w.name ?? '').slice(0, 120),
      date: /^\d{4}-\d\d-\d\d$/.test(w.date) ? w.date : null,
      terrain: TERRAINS[w.terrain] ? w.terrain : DEFAULT_TERRAIN,
      distanceKm: num(w.distanceKm), ascentM: num(w.ascentM), descentM: num(w.descentM),
      movingMin, restMin, stopMin: num(w.stopMin),
      sums,
      fit: fitSums(sums, movingMin ? restMin / movingMin : 0),
    };
  });
  return { walks };
}
