// Surveyed activation zones: turns sources/az/gm.geojson.gz (AD8IS's GM zones
// from Scottish LiDAR terrain, as published in manuelkasper/sotlas-tiles) into
// data/zones-lidar.json, which trip pages use before working a zone out
// themselves. Outlines are simplified to about 1 m, and hollows inside a zone
// (ground more than 25 m down) are kept as holes.
//
//   npm run import-zones              # from the copy in sources/az/
//   npm run import-zones -- --download   # fetch the latest copy first
//
// Each zone keeps its LiDAR source, date and licence. Most are under the Open
// Government Licence v3; a few are non-commercial only (see README).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { simplifyRing } from '../src/lib/zones.js';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'sources', 'az', 'gm.geojson.gz');
const out = path.join(root, 'data', 'zones-lidar.json');
// The repo stores it with Git LFS, so the raw.githubusercontent.com address is only a pointer.
const URL = 'https://media.githubusercontent.com/media/manuelkasper/sotlas-tiles/master/az/gm.geojson.gz';

const TOLERANCE_M = 1; // simplify outlines to within this
const MIN_HOLE_M2 = 25; // smaller hollows aren't worth drawing

if (process.argv.includes('--download')) {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`${URL}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  gunzipSync(buf); // check it's really the gzipped file, not an LFS pointer
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, buf);
  console.log(`Downloaded ${(buf.length / 1e6).toFixed(1)} MB to ${path.relative(root, source)}`);
}

const geo = JSON.parse(gunzipSync(await readFile(source)).toString('utf8'));

/** Ring of [lon, lat] -> simplified [[lat, lon], ...] and its area in m². */
function convert(ring) {
  const pts = ring.slice(0, -1); // GeoJSON repeats the first point at the end
  const [lon0, lat0] = pts[0];
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
  const xy = pts.map(([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]);
  let area = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x0, y0] = xy[i], [x1, y1] = xy[(i + 1) % xy.length];
    area += x0 * y1 - x1 * y0;
  }
  const simple = simplifyRing(xy, TOLERANCE_M);
  return {
    area: Math.abs(area / 2),
    ring: simple.map(([x, y]) => [Math.round((lat0 + y / ky) * 1e6) / 1e6, Math.round((lon0 + x / kx) * 1e6) / 1e6]),
  };
}

const licence = (text) => (/non-commercial/i.test(text) ? 'Non-Commercial Government Licence' : 'Open Government Licence v3');
const resolution = (text) => /DTM ([\d.]+m)/.exec(text)?.[1] ?? '';

const zones = {};
let points = 0, before = 0;
for (const f of geo.features) {
  const p = f.properties ?? {};
  if (f.geometry?.type !== 'Polygon' || !/^GM\/[A-Z]{2}-\d{3}$/.test(p.summitCode ?? '')) continue;
  const [outer, ...inner] = f.geometry.coordinates;
  before += f.geometry.coordinates.reduce((n, r) => n + r.length, 0);
  const holes = inner.map(convert).filter((h) => h.area >= MIN_HOLE_M2 && h.ring.length >= 3).map((h) => h.ring);
  const ring = convert(outer).ring;
  points += ring.length + holes.reduce((n, h) => n + h.length, 0);
  zones[p.summitCode] = {
    top: Math.round(p.demSummitElevationM * 10) / 10,
    threshold: Math.round(p.lowerContourM * 10) / 10,
    ring,
    ...(holes.length ? { holes } : {}),
    source: `LiDAR ${resolution(p.Source)}`.trim(),
    credit: p.sourceAttribution ?? '',
    licence: licence(p.sourceLicence ?? ''),
    by: p.Creator ?? '',
    date: String(p.Date ?? '').slice(0, 10),
  };
}

const sorted = Object.fromEntries(Object.entries(zones).sort(([a], [b]) => a.localeCompare(b)));
const text = JSON.stringify({
  source: 'AD8IS activation zones from Scottish Remote Sensing Portal LiDAR, via manuelkasper/sotlas-tiles',
  zones: sorted,
}) + '\n';
await writeFile(out, text);
console.log(`${Object.keys(sorted).length} zones, ${before} points simplified to ${points}, ${(text.length / 1e3).toFixed(0)} kB -> ${path.relative(root, out)}`);
