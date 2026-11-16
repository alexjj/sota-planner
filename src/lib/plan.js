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
 * @param params        pace numbers from paceFor()
 * @param summitsByRef  Map of SOTA ref -> summit
 * @returns {{ stages: object[], offTrack: string[], oneWayKm: number|null }} offTrack: summits the
 *   track doesn't reach; oneWayKm: for a one-way track, how far its end is from its start
 */
export function walkStages(route, lines, params, summitsByRef) {
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
