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
import { parseGpx, gpxStats, simplify } from '../src/lib/gpx.js';
import { schedule } from '../src/lib/time.js';
import { normalizeTrip, tripSummits, tripHills, tripStats } from '../src/lib/trip.js';

const run = promisify(execFile);
export const rootDir = path.resolve(import.meta.dirname, '..');
export const dataDir = path.join(rootDir, 'data');
const tripsDir = path.join(dataDir, 'trips');
const legacyDir = path.join(dataDir, 'routes');

const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const ROUTE_ID_RE = /^[a-z0-9]{1,20}$/;
const PHOTO_RE = /^[a-z0-9][a-z0-9._-]{0,100}\.(jpe?g|png|webp)$/i;
const MAX_BODY = 60 * 1024 * 1024;

export function slugify(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'trip';
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

async function writeTrip(dir, trip) {
  await writeFile(path.join(dir, 'trip.json'), JSON.stringify(trip, null, 2) + '\n');
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
    await writeTrip(to, trip);
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
    const t = normalizeTrip(await readJson(file));
    const routes = [];
    for (const r of t.routes) {
      let track = [];
      if (r.gpx && await exists(path.join(dir, r.gpx))) {
        track = simplify(parseGpx(await readFile(path.join(dir, r.gpx), 'utf8')));
      }
      routes.push({ id: r.id, name: r.name, summits: r.summits, hills: r.hills, parking: r.parking, stats: r.stats, track });
    }
    entries.push({
      id: t.id, name: t.name, tags: t.tags,
      summits: tripSummits(t), hills: tripHills(t),
      stats: tripStats(t.routes),
      totalMinutes: t.timetable.stages.length ? schedule(t.timetable.start, t.timetable.stages).total : null,
      updated: t.updated, routes,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(path.join(tripsDir, 'index.json'), JSON.stringify(entries) + '\n');
  return entries;
}

async function saveTrip(id, body) {
  const { gpx = {}, newPhotos = [] } = body;
  if (!body.trip || typeof body.trip.name !== 'string' || !body.trip.name.trim()) {
    throw httpError(400, 'Trip needs a name');
  }
  const trip = normalizeTrip(body.trip);
  const dir = path.join(tripsDir, id);
  const photoDir = path.join(dir, 'photos');
  await mkdir(photoDir, { recursive: true });
  const prevFile = path.join(dir, 'trip.json');
  const prev = await exists(prevFile) ? normalizeTrip(await readJson(prevFile)) : { routes: [] };

  // Each route's GPX: replace, remove, or keep what it had.
  for (const route of trip.routes) {
    if (!ROUTE_ID_RE.test(route.id)) throw httpError(400, `Bad route id: ${route.id}`);
    const change = gpx[route.id];
    if (typeof change === 'string') {
      const lines = parseGpx(change);
      if (!lines.length) throw httpError(400, `GPX for "${route.name || route.id}" has no track or route points`);
      route.gpx = `${route.id}.gpx`;
      await writeFile(path.join(dir, route.gpx), change);
      route.stats = gpxStats(lines);
    } else if (change === null) {
      route.gpx = null;
      route.stats = null;
    } else {
      const old = prev.routes.find((r) => r.id === route.id);
      route.gpx = old?.gpx ?? null;
      route.stats = old?.stats ?? null;
    }
  }
  const keepGpx = new Set(trip.routes.map((r) => r.gpx).filter(Boolean));
  for (const f of await readdir(dir)) {
    if (f.toLowerCase().endsWith('.gpx') && !keepGpx.has(f)) await rm(path.join(dir, f), { force: true });
  }

  // New photos arrive as data URLs.
  for (const p of newPhotos) {
    if (!PHOTO_RE.test(p.file)) throw httpError(400, `Bad photo name: ${p.file}`);
    const m = /^data:image\/[\w+.-]+;base64,(.*)$/s.exec(p.dataUrl ?? '');
    if (!m) throw httpError(400, `Bad photo data: ${p.file}`);
    await writeFile(path.join(photoDir, p.file), Buffer.from(m[1], 'base64'));
  }
  // Remove photo files that the trip no longer lists.
  trip.photos = trip.photos.filter((p) => PHOTO_RE.test(p.file));
  const keep = new Set(trip.photos.map((p) => p.file));
  for (const f of await readdir(photoDir)) {
    if (!keep.has(f)) await rm(path.join(photoDir, f), { force: true });
  }

  trip.id = id;
  trip.updated = new Date().toISOString();
  trip.created = prev.created ?? trip.created ?? trip.updated;
  await writeTrip(dir, trip);
  await rebuildIndex();
  return trip;
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
      const base = slugify(body.trip?.name ?? '');
      let id = base;
      for (let n = 2; await exists(path.join(tripsDir, id)); n++) id = `${base}-${n}`;
      const trip = await saveTrip(id, body);
      return send(res, 201, { id, trip });
    }
    if (parts[0] === 'trips' && parts.length === 2) {
      const id = parts[1];
      if (!ID_RE.test(id)) throw httpError(400, 'Bad trip id');
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
