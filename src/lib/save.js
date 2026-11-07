// Saving a trip, shared by the local edit server (writes files to disk) and
// the browser's GitHub mode (commits through the GitHub API). This module only
// works out *what* to write; the caller does the writing.

import { parseGpx, gpxStats, simplify } from './gpx.js';
import { schedule } from './time.js';
import { normalizeTrip, tripSummits, tripHills, tripStats } from './trip.js';

export const TRIP_ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
export const ROUTE_ID_RE = /^[a-z0-9]{1,20}$/;
export const PHOTO_RE = /^[a-z0-9][a-z0-9._-]{0,100}\.(jpe?g|png|webp)$/i;

export function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function slugify(name) {
  return String(name ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'trip';
}

/** A trip id from its name that isn't in `taken`: "ben-lui", "ben-lui-2", … */
export function uniqueTripId(name, taken) {
  const base = slugify(name);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * Work out the files to write and delete when saving a trip.
 *
 * @param {string} id        trip id (folder name)
 * @param {object} body      { trip, gpx, newPhotos } as sent by the editor:
 *                           gpx = { [routeId]: text | null } for changed routes,
 *                           newPhotos = [{ file, dataUrl }]
 * @param {object|null} prev the trip as currently saved, or null if new
 * @param {string[]} existing files now in the trip folder, relative to it
 *                           (e.g. "trip.json", "r1.gpx", "photos/a.jpg")
 * @returns {{ trip, writes: {path, text?, base64?}[], deletes: string[], tracks }}
 *   Paths are relative to the trip folder. `tracks` holds simplified lines
 *   for routes whose GPX changed (empty array if removed), for the index.
 */
export function planTripSave(id, body, prev, existing, now = new Date()) {
  if (!TRIP_ID_RE.test(id)) throw badRequest('Bad trip id');
  if (!body?.trip || typeof body.trip.name !== 'string' || !body.trip.name.trim()) {
    throw badRequest('Trip needs a name');
  }
  const { gpx = {}, newPhotos = [] } = body;
  const trip = normalizeTrip(body.trip);
  prev = prev ? normalizeTrip(prev) : { routes: [] };
  const writes = [];
  const tracks = {};

  // Each route's GPX: replace, remove, or keep what it had.
  for (const route of trip.routes) {
    if (!ROUTE_ID_RE.test(route.id)) throw badRequest(`Bad route id: ${route.id}`);
    const change = gpx[route.id];
    if (typeof change === 'string') {
      const lines = parseGpx(change);
      if (!lines.length) throw badRequest(`GPX for "${route.name || route.id}" has no track or route points`);
      route.gpx = `${route.id}.gpx`;
      route.stats = gpxStats(lines);
      writes.push({ path: route.gpx, text: change });
      tracks[route.id] = simplify(lines);
    } else if (change === null) {
      route.gpx = null;
      route.stats = null;
      tracks[route.id] = [];
    } else {
      const old = prev.routes.find((r) => r.id === route.id);
      route.gpx = old?.gpx ?? null;
      route.stats = old?.stats ?? null;
    }
  }

  // New photos arrive as data URLs.
  for (const p of newPhotos) {
    if (!PHOTO_RE.test(p.file)) throw badRequest(`Bad photo name: ${p.file}`);
    const m = /^data:image\/[\w+.-]+;base64,(.*)$/s.exec(p.dataUrl ?? '');
    if (!m) throw badRequest(`Bad photo data: ${p.file}`);
    if (trip.photos.some((x) => x.file === p.file)) writes.push({ path: `photos/${p.file}`, base64: m[1] });
  }
  trip.photos = trip.photos.filter((p) => PHOTO_RE.test(p.file));

  // Remove GPX and photo files the trip no longer refers to.
  const keep = new Set([
    ...trip.routes.map((r) => r.gpx).filter(Boolean),
    ...trip.photos.map((p) => `photos/${p.file}`),
  ]);
  const deletes = existing.filter((f) =>
    (f.toLowerCase().endsWith('.gpx') && !f.includes('/') && !keep.has(f)) ||
    (f.startsWith('photos/') && !keep.has(f)));

  trip.id = id;
  trip.updated = now.toISOString();
  trip.created = prev.created ?? trip.created ?? trip.updated;
  writes.push({ path: 'trip.json', text: JSON.stringify(trip, null, 2) + '\n' });
  return { trip, writes, deletes, tracks };
}

/** One trip's line in data/trips/index.json. `tracks`: route id -> simplified line. */
export function indexEntry(trip, tracks = {}) {
  trip = normalizeTrip(trip);
  return {
    id: trip.id, name: trip.name, tags: trip.tags,
    summits: tripSummits(trip), hills: tripHills(trip),
    stats: tripStats(trip.routes),
    totalMinutes: trip.timetable.stages.length ? schedule(trip.timetable.start, trip.timetable.stages).total : null,
    updated: trip.updated,
    routes: trip.routes.map((r) => ({
      id: r.id, name: r.name, summits: r.summits, hills: r.hills,
      parking: r.parking, stats: r.stats, track: tracks[r.id] ?? [],
    })),
  };
}

export function sortIndex(entries) {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

/** Replace (or add) one trip in the index, keeping tracks of unchanged routes. */
export function upsertIndex(index, trip, changedTracks) {
  const old = index.find((e) => e.id === trip.id);
  const tracks = {};
  for (const r of old?.routes ?? []) tracks[r.id] = r.track;
  Object.assign(tracks, changedTracks);
  return sortIndex([...index.filter((e) => e.id !== trip.id), indexEntry(trip, tracks)]);
}

export function indexText(entries) {
  return JSON.stringify(entries) + '\n';
}
