// The trip model, shared by the browser and the edit server.
//
// A trip is one outing (usually a day). It has one or more routes. Each route
// is a walk (or bike-and-walk) from a parking spot, with its own GPX file and
// the summits and hills it visits. Driving between routes goes in the trip's
// timetable, whose stages can be linked to a route.

export const ROUTE_COLORS = ['#1c7ed6', '#e8590c', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#c2255c', '#5c940d'];

export function routeColor(index) {
  return ROUTE_COLORS[index % ROUTE_COLORS.length];
}

export function newId(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 8);
}

export function blankRoute(fields = {}) {
  return { id: newId('r'), name: '', gpx: null, stats: null, parking: null, summits: [], hills: [], ...fields };
}

/**
 * Fill in defaults, and convert the original single-route format (summits,
 * parking and gpx at the top level) into a trip with one route.
 */
export function normalizeTrip(t) {
  t = { ...t };
  if (!Array.isArray(t.routes)) {
    const route = blankRoute({
      id: 'r1',
      gpx: t.gpx ?? null,
      stats: t.stats ?? null,
      parking: t.parking ?? null,
      summits: t.summits ?? [],
      hills: t.hills ?? [],
    });
    t.routes = [route];
    // Everything except driving happened on that one route.
    for (const s of t.timetable?.stages ?? []) {
      if (s.type !== 'drive' && s.type !== 'activate') s.route ??= route.id;
    }
  }
  for (const key of ['gpx', 'stats', 'parking', 'summits', 'hills']) delete t[key];
  // `done: true` archives the trip: it moves to the closed "Done" list on the home page.
  t.name ??= '';
  t.tags ??= [];
  t.notes ??= '';
  t.links ??= [];
  t.photos ??= [];
  t.timetable ??= { start: '07:00', stages: [] };
  t.timetable.stages ??= [];
  t.routes = t.routes.map((r) => ({ ...blankRoute(), ...r, summits: r.summits ?? [], hills: r.hills ?? [] }));
  return t;
}

/** All summit refs (or hill ids) across the trip's routes, without repeats. */
export function tripSummits(trip) {
  return [...new Set(trip.routes.flatMap((r) => r.summits))];
}
export function tripHills(trip) {
  return [...new Set(trip.routes.flatMap((r) => r.hills))];
}

/** Which route a timetable stage belongs to: its own link, or the route holding its summit. */
export function stageRouteId(stage, trip) {
  if (stage.route) return stage.route;
  if (stage.type === 'activate' && stage.summit) {
    return trip.routes.find((r) => r.summits.includes(stage.summit))?.id ?? null;
  }
  return null;
}

/**
 * The timetable stages for one route: the drive to it, and the stages on the hill.
 * Multi-route trips link stages to routes. Single-route trips usually don't, so
 * there it's the first drive and the stages after it up to the next drive
 * (leaving out a later cafe stop or the drive home).
 * @returns {{ drive: object|null, stages: object[] }}
 */
export function routeStages(trip, routeId) {
  const all = trip.timetable?.stages ?? [];
  const linked = trip.routes.length > 1 || all.some((s) => s.route);
  if (linked) {
    return {
      drive: all.find((s) => s.type === 'drive' && stageRouteId(s, trip) === routeId) ?? null,
      stages: all.filter((s) => s.type !== 'drive' && stageRouteId(s, trip) === routeId),
    };
  }
  let i = all.findIndex((s) => s.type !== 'drive');
  if (i < 0) return { drive: null, stages: [] };
  const drive = i > 0 ? all[i - 1] : null;
  const stages = [];
  for (; i < all.length && all[i].type !== 'drive'; i++) stages.push(all[i]);
  return { drive, stages };
}

/** A readable name: the route's own, else its summits, else "Route n". */
export function routeLabel(route, index, summitsByRef) {
  if (route.name?.trim()) return route.name.trim();
  const names = route.summits.map((ref) => summitsByRef?.get(ref)?.name ?? ref);
  return names.length ? names.join(' & ') : `Route ${index + 1}`;
}

/** Map of route id -> { index, number, color, label, route } for display. */
export function routeInfo(trip, summitsByRef) {
  return new Map(trip.routes.map((r, i) => [r.id, {
    index: i, number: i + 1, color: routeColor(i), label: routeLabel(r, i, summitsByRef), route: r,
  }]));
}

/** Totals across routes that have a GPX. */
export function tripStats(routes) {
  const withStats = routes.filter((r) => r.stats);
  if (!withStats.length) return null;
  return {
    distanceKm: Math.round(withStats.reduce((a, r) => a + r.stats.distanceKm, 0) * 100) / 100,
    ascentM: withStats.reduce((a, r) => a + r.stats.ascentM, 0),
  };
}
