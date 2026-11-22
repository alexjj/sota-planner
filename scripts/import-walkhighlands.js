// Which Walkhighlands walks go over each summit and hill, so links can go
// straight to the walk's page instead of a web search.
//
//   npm run import-walkhighlands
//
// Reads sources/walkhighlands/full.geojson, a copy of
// https://www.walkhighlands.co.uk/full.geojson (the routes on their big map).
// Save it from a browser: the site's bot check blocks scripts. That file stays
// out of git: Walkhighlands' tracks are their copyright, so only each walk's
// name, page, distance and grade are kept, in data/walkhighlands.json:
//   { walks: { [id]: [name, path, km, grade] }, summits: { [ref]: [id...] }, hills: { [hillId]: [id...] } }
// A walk's page is https://www.walkhighlands.co.uk/<path>.shtml. Walks are
// listed closest first. Run it again after `npm run import-data`.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'sources', 'walkhighlands', 'full.geojson');
const out = path.join(root, 'data', 'walkhighlands.json');
const NEAR_M = 100; // a walk goes over a summit if its track passes this close

let geo;
try {
  geo = JSON.parse(await readFile(source, 'utf8'));
} catch (e) {
  console.error(`Can't read ${path.relative(root, source)} (${e.code ?? e.message}).`);
  console.error('Open https://www.walkhighlands.co.uk/full.geojson in a browser and save it there.');
  process.exit(1);
}
const { summits } = JSON.parse(await readFile(path.join(root, 'data', 'summits.json'), 'utf8'));
const { hills } = JSON.parse(await readFile(path.join(root, 'data', 'hills.json'), 'utf8'));

// Tracks with a bounding box, to skip far-off walks quickly.
const walks = [];
for (const f of geo.features ?? []) {
  const p = f.properties ?? {};
  const line = f.geometry?.type === 'LineString' ? f.geometry.coordinates
    : f.geometry?.type === 'MultiLineString' ? f.geometry.coordinates.flat() : null;
  if (!line?.length || f.id == null || !p.l) continue;
  let s = 90, n = -90, w = 180, e = -180;
  for (const [lon, lat] of line) { s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lon); e = Math.max(e, lon); }
  walks.push({ id: String(f.id), p, line, s, n, w, e });
}

/** Closest distance in metres from a point to a track. */
function distance(lat, lon, line) {
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110574;
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const ax = (line[i][0] - lon) * kx, ay = (line[i][1] - lat) * ky;
    if (i === line.length - 1) { best = Math.min(best, Math.hypot(ax, ay)); break; }
    const bx = (line[i + 1][0] - lon) * kx, by = (line[i + 1][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

const padLat = NEAR_M / 110574 * 1.5;
function walksOver(lat, lon) {
  const padLon = padLat / Math.cos(lat * Math.PI / 180);
  return walks
    .filter((w) => lat >= w.s - padLat && lat <= w.n + padLat && lon >= w.w - padLon && lon <= w.e + padLon)
    .map((w) => ({ w, d: distance(lat, lon, w.line) }))
    .filter((x) => x.d <= NEAR_M)
    .sort((a, b) => a.d - b.d || Number(a.w.p.d) - Number(b.w.p.d))
    .map((x) => x.w);
}

const used = new Map();
const pick = (list) => list.map((w) => { used.set(w.id, w); return w.id; });
const bySummit = {};
for (const s of summits) {
  const list = walksOver(s.lat, s.lon);
  if (list.length) bySummit[s.ref] = pick(list);
}
const byHill = {};
for (const h of hills) {
  if (h.type === 'Munro Top') continue; // not shown anywhere in the app
  const list = walksOver(h.lat, h.lon);
  if (list.length) byHill[h.id] = pick(list);
}

const walkInfo = Object.fromEntries([...used.values()]
  .sort((a, b) => Number(a.id) - Number(b.id))
  .map((w) => [w.id, [String(w.p.name ?? '').trim(), w.p.l, Number(w.p.d) || null, Number(w.p.r) || null]]));

await writeFile(out, JSON.stringify({
  source: 'Walkhighlands walk pages (names, distances and grades; no tracks), matched to summits by track',
  updated: new Date().toISOString().slice(0, 10),
  walks: walkInfo,
  summits: bySummit,
  hills: byHill,
}) + '\n');
const munros = hills.filter((h) => h.type === 'Munro');
console.log(`${walks.length} walks: ${Object.keys(bySummit).length} of ${summits.length} summits and `
  + `${Object.keys(byHill).length} hills (${munros.filter((h) => byHill[h.id]).length} of ${munros.length} Munros) have one; `
  + `${used.size} walks kept -> ${path.relative(root, out)}`);
