// Turning a route's GPX into timetable stages: walk in, activate each summit,
// walk between them, walk out. Times come from your walking pace (pace.js).
// No browser- or Node-only APIs here.

import { legsAt, nearestPoint, walkMinutes, round5 } from './pace.js';
import { STAGE_TYPES } from './time.js';
import { newId } from './trip.js';

/** A summit counts as on the route if the track passes within this distance. */
const ON_TRACK_M = 300;

/**
 * Walk and activation stages for one route, in walking order.
 * @param route         the trip route ({ id, summits })
 * @param lines         its parsed GPX (may be empty: then typical times are used)
 * @param params        pace numbers from paceFor()
 * @param summitsByRef  Map of SOTA ref -> summit
 * @returns {{ stages: object[], offTrack: string[] }} offTrack: summits the track doesn't reach
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
    return { stages, offTrack: [] };
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
  if (!on.length) {
    walk('Walk', round5(legs.reduce((t, leg) => t + walkMinutes(leg, params), 0)));
  } else {
    walk('Walk in', mins(legs[0]));
    on.forEach((o, k) => {
      if (k > 0) walk(`Walk to ${name(o.ref)}`, mins(legs[k]));
      activate(o.ref);
    });
  }
  for (const ref of offTrack) activate(ref);
  if (on.length) walk('Walk out', mins(legs.at(-1)));
  return { stages, offTrack };
}
