// The edit API. Used by the Vite dev server (`npm run edit`) and by the
// standalone server (`npm run serve`). The static site on GitHub Pages has no
// API, so the app falls back to read-only there.
//
//   GET    /api/status          -> { edit: true, git: bool }
//   POST   /api/trips           -> create a trip, returns { id }
//   PUT    /api/trips/:id       -> save a trip
//   DELETE /api/trips/:id       -> delete a trip and its files
//   POST   /api/publish         -> git pull, commit data/, push
//
// Save/create body: { trip, gpx, newPhotos }
//   gpx:       { [routeId]: string | null }. A string replaces that route's
//              GPX, null removes it; routes not listed keep the GPX they had.
//   newPhotos: [{ file, dataUrl }] written into the trip's photos/ folder.
//   GPX and photo files no longer referenced by the trip are deleted.

import { readFile, writeFile, mkdir, readdir, rm, stat, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { parseGpx, simplify } from '../src/lib/gpx.js';
import { normalizeTrip } from '../src/lib/trip.js';
import { TRIP_ID_RE, planTripSave, indexEntry, sortIndex, indexText, uniqueTripId } from '../src/lib/save.js';

const run = promisify(execFile);
export const rootDir = path.resolve(import.meta.dirname, '..');
export const dataDir = path.join(rootDir, 'data');
const tripsDir = path.join(dataDir, 'trips');
const legacyDir = path.join(dataDir, 'routes');
const MAX_BODY = 60 * 1024 * 1024;

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

/** Files in a trip folder, relative to it: "trip.json", "r1.gpx", "photos/a.jpg". */
async function listTripFiles(dir) {
  if (!(await exists(dir))) return [];
  const out = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (d.isFile()) out.push(d.name);
    else if (d.isDirectory() && d.name === 'photos') {
      for (const f of await readdir(path.join(dir, 'photos'))) out.push(`photos/${f}`);
    }
  }
  return out;
}

/** Move data/routes/<id>/route.json (single-route format) to data/trips/<id>/trip.json. */
async function migrateLegacy() {
  if (!(await exists(legacyDir))) return;
  await mkdir(tripsDir, { recursive: true });
  for (const dirent of await readdir(legacyDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const from = path.join(legacyDir, dirent.name);
    const to = path.join(tripsDir, dirent.name);
    if (!(await exists(path.join(from, 'route.json'))) || await exists(to)) continue;
    await rename(from, to);
    const trip = normalizeTrip(await readJson(path.join(to, 'route.json')));
    await writeFile(path.join(to, 'trip.json'), JSON.stringify(trip, null, 2) + '\n');
    await rm(path.join(to, 'route.json'));
    console.log(`Migrated data/routes/${dirent.name} to data/trips/${dirent.name}`);
  }
  await rm(path.join(legacyDir, 'index.json'), { force: true });
  if (!(await readdir(legacyDir)).length) await rm(legacyDir, { recursive: true });
}

/** Rebuild data/trips/index.json: the summary list the browse view loads. */
export async function rebuildIndex() {
  await migrateLegacy();
  await mkdir(tripsDir, { recursive: true });
  const entries = [];
  for (const dirent of await readdir(tripsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const dir = path.join(tripsDir, dirent.name);
    const file = path.join(dir, 'trip.json');
    if (!(await exists(file))) continue;
    const trip = normalizeTrip(await readJson(file));
    const tracks = {};
    for (const r of trip.routes) {
      if (r.gpx && await exists(path.join(dir, r.gpx))) {
        tracks[r.id] = simplify(parseGpx(await readFile(path.join(dir, r.gpx), 'utf8')));
      }
    }
    entries.push(indexEntry(trip, tracks));
  }
  const sorted = sortIndex(entries);
  await writeFile(path.join(tripsDir, 'index.json'), indexText(sorted));
  return sorted;
}

async function saveTrip(id, body) {
  const dir = path.join(tripsDir, id);
  const prevFile = path.join(dir, 'trip.json');
  const prev = await exists(prevFile) ? await readJson(prevFile) : null;
  const plan = planTripSave(id, body, prev, await listTripFiles(dir));
  await mkdir(path.join(dir, 'photos'), { recursive: true });
  for (const w of plan.writes) {
    await writeFile(path.join(dir, w.path), w.base64 != null ? Buffer.from(w.base64, 'base64') : w.text);
  }
  for (const f of plan.deletes) await rm(path.join(dir, f), { force: true });
  await rebuildIndex();
  return plan.trip;
}

async function publish() {
  const git = (...args) => run('git', args, { cwd: rootDir });
  const log = [];
  const step = async (...args) => {
    const { stdout, stderr } = await git(...args);
    log.push(`$ git ${args.join(' ')}`, stdout.trim(), stderr.trim());
  };
  const { stdout: remotes } = await git('remote');
  const hasRemote = remotes.trim().length > 0;
  if (hasRemote) await step('pull', '--rebase', '--autostash');
  await step('add', '--all', 'data');
  const { stdout: staged } = await git('diff', '--cached', '--name-only');
  if (staged.trim()) await step('commit', '-m', `Update trips (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`);
  else log.push('Nothing new to commit.');
  if (hasRemote) await step('push');
  else log.push('No git remote set, so nothing was pushed.');
  return log.filter(Boolean).join('\n');
}

async function gitAvailable() {
  try {
    await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: rootDir });
    return true;
  } catch { return false; }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw httpError(413, 'Upload too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

/** Connect-style middleware: handles /api/*, passes everything else on. */
export async function apiMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) return next();
  try {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
    const method = req.method;

    if (parts[0] === 'status' && method === 'GET') {
      return send(res, 200, { edit: true, git: await gitAvailable() });
    }
    if (parts[0] === 'publish' && method === 'POST') {
      return send(res, 200, { log: await publish() });
    }
    if (parts[0] === 'trips' && parts.length === 1 && method === 'POST') {
      const body = await readBody(req);
      await mkdir(tripsDir, { recursive: true });
      const taken = new Set(await readdir(tripsDir));
      const id = uniqueTripId(body.trip?.name, taken);
      const trip = await saveTrip(id, body);
      return send(res, 201, { id, trip });
    }
    if (parts[0] === 'trips' && parts.length === 2) {
      const id = parts[1];
      if (!TRIP_ID_RE.test(id)) throw httpError(400, 'Bad trip id');
      const dir = path.join(tripsDir, id);
      if (method === 'PUT') {
        if (!(await exists(dir))) throw httpError(404, 'No such trip');
        const trip = await saveTrip(id, await readBody(req));
        return send(res, 200, { id, trip });
      }
      if (method === 'DELETE') {
        await rm(dir, { recursive: true, force: true });
        await rebuildIndex();
        return send(res, 200, { ok: true });
      }
    }
    throw httpError(404, 'Unknown API call');
  } catch (err) {
    const status = err.status ?? 500;
    if (status === 500) console.error(err);
    send(res, status, { error: err.stderr?.trim() || err.message });
  }
}
