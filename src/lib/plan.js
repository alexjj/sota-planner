// Turning a route's GPX into timetable stages: walk in, activate each summit,
// walk between them, walk out. Times come from your walking pace (pace.js).
// No browser- or Node-only APIs here.

import { legsAt, nearestPoint, walkMinutes, round5 } from './pace.js';
import { distanceM } from './gpx.js';
import { STAGE_TYPES } from './time.js';
import { newId } from './trip.js';

/** A summit counts as on the route if the track passes within this distance. */
const ON_TRACK_M = 300;
/**
 * A track that ends further than this from where it starts is one-way (e.g. drawn
 * only up to the summit): you come back the same way, so the walk back is the
 * track in reverse.
 */
const ROUND_TRIP_M = 400;

/** The same stretch walked the other way: climbs become descents. */
const reverse = (leg) => ({ distanceKm: leg.distanceKm, upM: leg.downM, downM: leg.upM });
const plus = (...legs) => legs.reduce((a, b) => ({
  distanceKm: a.distanceKm + b.distanceKm, upM: a.upM + b.upM, downM: a.downM + b.downM,
}));

/** For a one-way track (see ROUND_TRIP_M), how far its end is from its start in km; else null. */
export function oneWayKm(lines) {
  const pts = lines?.flat() ?? [];
  if (pts.length < 2) return null;
  const gap = distanceM(pts[0], pts.at(-1));
  return gap > ROUND_TRIP_M ? Math.round(gap / 100) / 10 : null;
}

/** Walking minutes for a whole route: the track, plus the way back if it's one-way. */
export function routeWalkMinutes(lines, params) {
  const whole = plus(...legsAt(lines, []));
  return walkMinutes(oneWayKm(lines) != null ? plus(whole, reverse(whole)) : whole, params);
}

/**
 * Walk and activation stages for one route, in walking order.
 * @param route         the trip route ({ id, summits })
 * @param lines         its parsed GPX (may be empty: then typical times are used)
 * With bike drops (route.bikeDrops) there are cycle stages too: see bikeStages.
 * @param params        pace numbers from paceFor()
 * @param summitsByRef  Map of SOTA ref -> summit
 * @param rideParams    cycling pace numbers from ridePaceFor(), for routes with bike drops
 * @returns {{ stages: object[], offTrack: string[], oneWayKm: number|null }} offTrack: summits the
 *   track doesn't reach; oneWayKm: for a one-way track, how far its end is from its start
 */
export function walkStages(route, lines, params, summitsByRef, rideParams = null) {
  const stages = [];
  const name = (ref) => summitsByRef.get(ref)?.name ?? ref;
  const walk = (label, minutes) => stages.push({ id: newId(), type: 'walk', label, minutes, route: route.id });
  const activate = (ref) => stages.push({ id: newId(), type: 'activate', label: '', minutes: STAGE_TYPES.activate.minutes, summit: ref });

  if (!lines?.length) {
    walk('Walk in', 120);
    route.summits.forEach((ref, k) => { if (k) walk(`Walk to ${name(ref)}`, 60); activate(ref); });
    walk('Walk out', 90);
    return { stages, offTrack: [], oneWayKm: null };
  }

  const on = [], offTrack = [];
  for (const ref of route.summits) {
    const s = summitsByRef.get(ref);
    const near = s ? nearestPoint(lines, s) : null;
    if (near && near.distanceM <= ON_TRACK_M) on.push({ ref, index: near.index });
    else offTrack.push(ref);
  }
  on.sort((a, b) => a.index - b.index);
  if (route.bikeDrops?.length && dropPasses(lines, route.bikeDrops).length) {
    return bikeStages(route, lines, on, offTrack, params, rideParams ?? params, name);
  }

  const legs = legsAt(lines, on.map((o) => o.index));
  const mins = (leg) => round5(walkMinutes(leg, params));
  const oneWay = oneWayKm(lines) != null;
  const whole = plus(...legs);
  if (!on.length) {
    walk(oneWay ? 'Walk there and back' : 'Walk', mins(oneWay ? plus(whole, reverse(whole)) : whole));
  } else {
    walk('Walk in', mins(legs[0]));
    on.forEach((o, k) => {
      if (k > 0) walk(`Walk to ${name(o.ref)}`, mins(legs[k]));
      activate(o.ref);
    });
  }
  for (const ref of offTrack) activate(ref);
  if (on.length) {
    // Round trip: the rest of the track. One-way: on to its end, then all the way back.
    if (oneWay) walk('Walk back', mins(plus(legs.at(-1), reverse(whole))));
    else walk('Walk out', mins(legs.at(-1)));
  }
  return { stages, offTrack, oneWayKm: oneWayKm(lines) };
}

// ---- Bike drops: cycle in, walk from the bike, cycle on or out.

/** Passing within this of a bike drop counts as being at it (allows for GPS wander on the way back). */
const DROP_M = 75;

/**
 * Distance in metres from p to the segment a–b, and which end is nearer.
 * Planned and recorded tracks can have points 50–100 m apart, so passing a
 * bike drop has to be measured to the line, not just its points.
 */
function toSegment(p, a, b) {
  const kx = 111320 * Math.cos(p.lat * Math.PI / 180), ky = 110540;
  const ax = (a.lon - p.lon) * kx, ay = (a.lat - p.lat) * ky;
  const bx = (b.lon - p.lon) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return { d: Math.hypot(ax + t * dx, ay + t * dy), nearB: t > 0.5 };
}

/**
 * Track point indexes (into lines.flat()) where you leave and collect the bike at
 * each drop, sorted. Only the first two passes of a drop count: after that you're
 * riding past it (e.g. on the way home from a second drop).
 */
export function dropPasses(lines, drops = []) {
  const pts = lines?.flat() ?? [];
  const out = [];
  for (const d of drops) {
    const passes = [];
    let best = -1, bestD = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const { d: dist, nearB } = toSegment(d, pts[i], pts[i + 1]);
      if (dist <= DROP_M) {
        if (dist < bestD) { best = nearB ? i + 1 : i; bestD = dist; }
      } else if (best >= 0) {
        passes.push(best);
        best = -1; bestD = Infinity;
      }
    }
    if (best >= 0) passes.push(best);
    out.push(...passes.slice(0, 2));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * The route in order: stretches ({ mode, leg }) and summits ({ summit: ref }).
 * With bike drops you start on the bike and swap between cycling and walking each
 * time the track passes a drop. A one-way track is followed by the same stretches
 * in reverse, each the same mode as on the way out (summits aren't repeated).
 */
function routePieces(lines, drops, on = []) {
  const passes = dropPasses(lines, drops);
  const events = [
    ...passes.map((index) => ({ index, toggle: true })),
    ...on.map((o) => ({ index: o.index, summit: o.ref })),
  ].sort((a, b) => a.index - b.index);
  const legs = legsAt(lines, events.map((e) => e.index));
  let mode = passes.length ? 'cycle' : 'walk';
  const out = [], stretches = [];
  legs.forEach((leg, k) => {
    out.push({ mode, leg });
    stretches.push({ mode, leg });
    const e = events[k];
    if (e?.summit) out.push({ summit: e.summit });
    if (e?.toggle) mode = mode === 'cycle' ? 'walk' : 'cycle';
  });
  if (oneWayKm(lines) != null) {
    for (const s of stretches.reverse()) out.push({ mode: s.mode, leg: reverse(s.leg) });
  }
  return out;
}

/**
 * Walking and cycling minutes for a whole route (there and back if it's one-way).
 * Without bike drops it's all walking, as routeWalkMinutes.
 * @returns {{ walk: number, cycle: number }}
 */
export function routeTimes(lines, drops, walkParams, rideParams) {
  let walk = 0, cycle = 0;
  for (const p of routePieces(lines, drops)) {
    if (!p.leg) continue;
    if (p.mode === 'cycle') cycle += walkMinutes(p.leg, rideParams);
    else walk += walkMinutes(p.leg, walkParams);
  }
  return { walk, cycle };
}

/** Stages for a route with bike drops: cycle and walk stretches around each summit. */
function bikeStages(route, lines, on, offTrack, walkParams, rideParams, name) {
  const stages = [];
  const activate = (ref) => stages.push({ id: newId(), type: 'activate', label: '', minutes: STAGE_TYPES.activate.minutes, summit: ref });

  // Join stretches of the same mode that no summit separates; skip slivers.
  const groups = [];
  for (const p of routePieces(lines, route.bikeDrops, on)) {
    if (p.leg && p.leg.distanceKm < 0.05) continue;
    const last = groups.at(-1);
    if (p.leg && last?.leg && last.mode === p.mode) last.leg = plus(last.leg, p.leg);
    else groups.push(p.leg ? { ...p } : p);
  }

  const n = on.length;
  const oneWay = oneWayKm(lines) != null;
  let done = 0; // summits activated so far
  groups.forEach((g, i) => {
    if (g.summit) {
      activate(g.summit);
      if (++done === n) offTrack.forEach(activate);
      return;
    }
    const next = groups[i + 1];
    let label;
    if (g.mode === 'cycle') {
      label = done === 0 ? 'Cycle in' : done < n ? 'Cycle on' : 'Cycle out';
    } else if (next?.mode === 'cycle') {
      label = done === 0 ? 'Walk' : 'Walk back to the bike';
    } else if (done === 0) {
      label = 'Walk in';
    } else if (done < n) {
      label = `Walk to ${name(on[done].ref)}`;
    } else {
      label = oneWay ? 'Walk back' : 'Walk out';
    }
    const minutes = round5(walkMinutes(g.leg, g.mode === 'cycle' ? rideParams : walkParams));
    stages.push({ id: newId(), type: g.mode, label, minutes, route: route.id });
  });
  if (!n) offTrack.forEach(activate);
  return { stages, offTrack, oneWayKm: oneWayKm(lines) };
}
