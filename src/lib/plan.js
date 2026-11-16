// Turning a route's GPX into timetable stages: walk in, activate each summit,
// walk between them, walk out. Times come from your walking pace (pace.js).
// No browser- or Node-only APIs here.

import { legsAt, walkMinutes, round5 } from './pace.js';
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

/** A hill or waypoint counts as on the route if the track passes within this distance. */
const ON_TRACK_HILL_M = 150;

/**
 * The first time the track reaches p (within maxM): the nearest point of that
 * first pass, so an out-and-back summit is reached on the way up, not the way down.
 * @returns {{ index: number, distanceM: number } | null}
 */
export function firstPass(lines, p, maxM) {
  const pts = lines.flat();
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const d = distanceM(pts[i], p);
    if (d <= maxM) {
      if (!best || d < best.distanceM) best = { index: i, distanceM: d };
    } else if (best && d > maxM * 2) {
      break; // left the first pass
    }
  }
  return best;
}

/**
 * The stops along a route's track, in walking order: SOTA summits (activated),
 * hills (just a point to time the walk to) and named waypoints (with an optional
 * stop, e.g. lunch). Summits the track doesn't reach are returned as offTrack.
 * @returns {{ stops: { index: number, kind: 'summit'|'hill'|'waypoint', name: string, ref?: string, id?: string, minutes?: number }[], offTrack: string[] }}
 */
export function routeStops(route, lines, summitsByRef, hillsById = null) {
  const stops = [], offTrack = [];
  for (const ref of route.summits ?? []) {
    const s = summitsByRef.get(ref);
    const at = s ? firstPass(lines, s, ON_TRACK_M) : null;
    if (at) stops.push({ index: at.index, kind: 'summit', ref, name: s.name ?? ref });
    else offTrack.push(ref);
  }
  for (const id of route.hills ?? []) {
    const h = hillsById?.get(id);
    if (h?.sota && route.summits?.includes(h.sota)) continue; // already a stop as a summit
    const at = h ? firstPass(lines, h, ON_TRACK_HILL_M) : null;
    if (at) stops.push({ index: at.index, kind: 'hill', id, name: h.name });
  }
  for (const w of route.waypoints ?? []) {
    const at = firstPass(lines, w, ON_TRACK_HILL_M);
    if (at) stops.push({ index: at.index, kind: 'waypoint', id: w.id, name: w.label || 'Waypoint', minutes: Number(w.minutes) || 0 });
  }
  stops.sort((a, b) => a.index - b.index);
  return { stops, offTrack };
}

/**
 * Stages for one route, in walking order: walk to each stop, activate summits,
 * stop at waypoints that have minutes, walk out (or back, for a one-way track).
 * With bike drops (route.bikeDrops) there are cycle stages too: see bikeStages.
 * @param route         the trip route ({ id, summits, hills?, waypoints?, bikeDrops? })
 * @param lines         its parsed GPX (may be empty: then typical times are used)
 * @param params        pace numbers from paceFor()
 * @param summitsByRef  Map of SOTA ref -> summit
 * @param rideParams    cycling pace numbers from ridePaceFor(), for routes with bike drops
 * @param hillsById     Map of DoBIH number -> hill, so the route's hills split the walk too
 * @returns {{ stages: object[], offTrack: string[], oneWayKm: number|null, arrivals: { name: string, kind: string, at: number }[] }}
 *   offTrack: summits the track doesn't reach; oneWayKm: for a one-way track, how far its end is
 *   from its start; arrivals: minutes from setting off to reaching each stop
 */
export function walkStages(route, lines, params, summitsByRef, rideParams = null, hillsById = null) {
  const stages = [];
  const name = (ref) => summitsByRef.get(ref)?.name ?? ref;
  const walk = (label, minutes) => stages.push({ id: newId(), type: 'walk', label, minutes, route: route.id });
  const activate = (ref) => stages.push({ id: newId(), type: 'activate', label: '', minutes: STAGE_TYPES.activate.minutes, summit: ref });

  if (!lines?.length) {
    walk('Walk in', 120);
    route.summits.forEach((ref, k) => { if (k) walk(`Walk to ${name(ref)}`, 60); activate(ref); });
    walk('Walk out', 90);
    return { stages, offTrack: [], oneWayKm: null, arrivals: [] };
  }

  const { stops, offTrack } = routeStops(route, lines, summitsByRef, hillsById);
  if (route.bikeDrops?.length && dropPasses(lines, route.bikeDrops).length) {
    return withArrivals(bikeStages(route, lines, stops, offTrack, params, rideParams ?? params));
  }
  const marks = []; // where each stop is reached: { stop, n: stages before it }

  const legs = legsAt(lines, stops.map((s) => s.index));
  const mins = (leg) => round5(walkMinutes(leg, params));
  const oneWay = oneWayKm(lines) != null;
  const whole = plus(...legs);
  const lastSummit = stops.findLastIndex((s) => s.kind === 'summit');
  if (!stops.length) {
    walk(oneWay ? 'Walk there and back' : 'Walk', mins(oneWay ? plus(whole, reverse(whole)) : whole));
  } else {
    stops.forEach((s, k) => {
      walk(k === 0 && s.kind === 'summit' ? 'Walk in' : `Walk to ${s.name}`, mins(legs[k]));
      marks.push({ stop: s, n: stages.length });
      stopStages(stages, route, s, activate);
      if (k === lastSummit) offTrack.forEach(activate);
    });
  }
  if (lastSummit < 0) offTrack.forEach(activate);
  if (stops.length) {
    // Round trip: the rest of the track. One-way: on to its end, then all the way back.
    if (oneWay) walk('Walk back', mins(plus(legs.at(-1), reverse(whole))));
    else walk('Walk out', mins(legs.at(-1)));
  }
  return withArrivals({ stages, offTrack, oneWayKm: oneWayKm(lines), marks });
}

/** The stages for reaching a stop: activate a summit, or a break at a waypoint with minutes. */
function stopStages(stages, route, s, activate) {
  if (s.kind === 'summit') activate(s.ref);
  else if (s.kind === 'waypoint' && s.minutes > 0) {
    stages.push({ id: newId(), type: 'break', label: s.name, minutes: s.minutes, route: route.id, waypoint: s.id });
  }
}

/**
 * Turn a builder's `marks` into `arrivals`: minutes from setting off to reaching
 * each stop, counting earlier activations and breaks.
 */
function withArrivals({ marks = [], ...result }) {
  const starts = [];
  let t = 0;
  for (const st of result.stages) { starts.push(t); t += st.minutes ?? 0; }
  starts.push(t);
  return { ...result, arrivals: marks.map((m) => ({ name: m.stop.name, kind: m.stop.kind, at: starts[m.n] })) };
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
 * The route in order: stretches ({ mode, leg }) and stops ({ stop }, see routeStops).
 * With bike drops you start on the bike and swap between cycling and walking each
 * time the track passes a drop. A one-way track is followed by the same stretches
 * in reverse, each the same mode as on the way out (stops aren't repeated).
 */
function routePieces(lines, drops, stops = []) {
  const passes = dropPasses(lines, drops);
  const events = [
    ...passes.map((index) => ({ index, toggle: true })),
    ...stops.map((stop) => ({ index: stop.index, stop })),
  ].sort((a, b) => a.index - b.index);
  const legs = legsAt(lines, events.map((e) => e.index));
  let mode = passes.length ? 'cycle' : 'walk';
  const out = [], stretches = [];
  legs.forEach((leg, k) => {
    out.push({ mode, leg });
    stretches.push({ mode, leg });
    const e = events[k];
    if (e?.stop) out.push({ stop: e.stop });
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
function bikeStages(route, lines, stops, offTrack, walkParams, rideParams) {
  const stages = [];
  const marks = [];
  const activate = (ref) => stages.push({ id: newId(), type: 'activate', label: '', minutes: STAGE_TYPES.activate.minutes, summit: ref });

  // Join stretches of the same mode that no stop separates; skip slivers.
  const groups = [];
  for (const p of routePieces(lines, route.bikeDrops, stops)) {
    if (p.leg && p.leg.distanceKm < 0.05) continue;
    const last = groups.at(-1);
    if (p.leg && last?.leg && last.mode === p.mode) last.leg = plus(last.leg, p.leg);
    else groups.push(p.leg ? { ...p } : p);
  }

  const n = stops.length;
  const lastSummit = stops.findLastIndex((x) => x.kind === 'summit');
  const oneWay = oneWayKm(lines) != null;
  let done = 0; // stops reached so far
  groups.forEach((g, i) => {
    if (g.stop) {
      marks.push({ stop: g.stop, n: stages.length });
      stopStages(stages, route, g.stop, activate);
      if (done++ === lastSummit) offTrack.forEach(activate);
      return;
    }
    const next = groups[i + 1];
    let label;
    if (g.mode === 'cycle') {
      label = done === 0 ? 'Cycle in' : done < n ? 'Cycle on' : 'Cycle out';
    } else if (next?.mode === 'cycle') {
      label = done === 0 ? 'Walk' : 'Walk back to the bike';
    } else if (done === 0 && stops[0]?.kind === 'summit') {
      label = 'Walk in';
    } else if (done < n) {
      label = `Walk to ${stops[done].name}`;
    } else {
      label = oneWay ? 'Walk back' : 'Walk out';
    }
    const minutes = round5(walkMinutes(g.leg, g.mode === 'cycle' ? rideParams : walkParams));
    stages.push({ id: newId(), type: g.mode, label, minutes, route: route.id });
  });
  if (lastSummit < 0) offTrack.forEach(activate);
  return { stages, offTrack, oneWayKm: oneWayKm(lines), marks };
}
