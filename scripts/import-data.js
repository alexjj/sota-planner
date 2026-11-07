// Downloads the SOTA summit list (GM only) and the Database of British and
// Irish Hills (Munros, Munro Tops, Corbetts, Grahams in Scotland), and writes
// compact JSON files into data/.
//
//   npm run import-data
//
// Re-run it occasionally to pick up new summits or changed activation counts.

import { writeFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const ASSOCIATION = 'GM/';
const SOTA_URL = 'https://storage.sota.org.uk/summitslist.csv';
const DOBIH_URL = 'https://www.hill-bagging.co.uk/dobih-downloads/hillcsv.zip';
const dataDir = path.resolve(import.meta.dirname, '..', 'data');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function toObjects(rows) {
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.length > 1).map((r) =>
    Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function ukDate(s) {
  const [d, m, y] = s.split('/').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function importSummits() {
  console.log('Downloading SOTA summit list…');
  const res = await fetch(SOTA_URL);
  if (!res.ok) throw new Error(`SOTA download failed: ${res.status}`);
  const text = await res.text();
  // First line is a title, the second is the header.
  const rows = parseCsv(text.slice(text.indexOf('\n') + 1));
  const now = new Date();
  const summits = toObjects(rows)
    .filter((s) => s.SummitCode.startsWith(ASSOCIATION))
    .filter((s) => ukDate(s.ValidFrom) <= now && ukDate(s.ValidTo) >= now)
    .map((s) => ({
      ref: s.SummitCode,
      name: s.SummitName,
      region: s.RegionName,
      alt: Number(s.AltM),
      lat: Number(s.Latitude),
      lon: Number(s.Longitude),
      points: Number(s.Points),
      bonus: Number(s.BonusPoints),
      activations: Number(s.ActivationCount),
    }));
  console.log(`  ${summits.length} valid ${ASSOCIATION} summits`);
  return summits;
}

async function importHills(summits) {
  console.log('Downloading Database of British and Irish Hills…');
  const res = await fetch(DOBIH_URL);
  if (!res.ok) throw new Error(`DoBIH download failed: ${res.status}`);
  const tmp = await mkdtemp(path.join(tmpdir(), 'dobih-'));
  try {
    const zip = path.join(tmp, 'hills.zip');
    await writeFile(zip, Buffer.from(await res.arrayBuffer()));
    await run('unzip', ['-q', '-o', zip, '-d', tmp]);
    const csvName = (await readdir(tmp)).find((f) => f.toLowerCase().endsWith('.csv'));
    const rows = parseCsv(await readFile(path.join(tmp, csvName), 'latin1'));
    const classes = [['M', 'Munro'], ['MT', 'Munro Top'], ['C', 'Corbett'], ['G', 'Graham']];
    const hills = toObjects(rows)
      .filter((h) => h.Country === 'S')
      .map((h) => {
        const cls = classes.find(([col]) => h[col] === '1');
        if (!cls) return null;
        const hill = {
          id: Number(h.Number),
          name: h.Name,
          type: cls[1],
          alt: Number(h.Metres),
          lat: Number(h.Latitude),
          lon: Number(h.Longitude),
        };
        // Link hills that are also SOTA summits, so the app can tell them apart.
        const near = summits.find((s) => distanceM(s, hill) < 150);
        if (near) hill.sota = near.ref;
        return hill;
      })
      .filter(Boolean);
    console.log(`  ${hills.length} Scottish hills (${hills.filter((h) => !h.sota).length} not SOTA summits)`);
    return hills;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

const summits = await importSummits();
const hills = await importHills(summits);
await mkdir(dataDir, { recursive: true });
const updated = new Date().toISOString().slice(0, 10);
await writeFile(path.join(dataDir, 'summits.json'),
  JSON.stringify({ updated, source: 'SOTA summits list, sota.org.uk', summits }) + '\n');
await writeFile(path.join(dataDir, 'hills.json'),
  JSON.stringify({ updated, source: 'Database of British and Irish Hills v18 (CC BY 4.0), hills-database.co.uk', hills }) + '\n');
console.log('Wrote data/summits.json and data/hills.json');
