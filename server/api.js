// The edit API. Used by the Vite dev server (`npm run edit`) and by the
// standalone server (`npm run serve`). The static site on GitHub Pages has no
// API, so the app falls back to read-only there.
//
//   GET    /api/status          -> { edit: true, git: bool }
//   POST   /api/routes          -> create a route, returns { id }
//   PUT    /api/routes/:id      -> save a route
//   DELETE /api/routes/:id      -> delete a route and its files
//   POST   /api/publish         -> git pull, commit data/, push
//
// Save/create body: { route, gpx, newPhotos }
//   gpx:       string = replace the GPX, null = remove it, omitted = keep it
//   newPhotos: [{ file, dataUrl }] written into the route's photos/ folder.
//   Photos no longer listed in route.photos are deleted.

import { readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { parseGpx, gpxStats, simplify } from '../src/lib/gpx.js';
import { schedule } from '../src/lib/time.js';

const run = promisify(execFile);
export const rootDir = path.resolve(import.meta.dirname, '..');
export const dataDir = path.join(rootDir, 'data');
const routesDir = path.join(dataDir, 'routes');

const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const PHOTO_RE = /^[a-z0-9][a-z0-9._-]{0,100}\.(jpe?g|png|webp)$/i;
const MAX_BODY = 60 * 1024 * 1024;

export function slugify(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'route';
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

/** Rebuild data/routes/index.json: the summary list the browse view loads. */
export async function rebuildIndex() {
  await mkdir(routesDir, { recursive: true });
  const entries = [];
  for (const dirent of await readdir(routesDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const dir = path.join(routesDir, dirent.name);
    const file = path.join(dir, 'route.json');
    if (!(await exists(file))) continue;
    const r = await readJson(file);
    let track = [];
    if (r.gpx && await exists(path.join(dir, r.gpx))) {
      track = simplify(parseGpx(await readFile(path.join(dir, r.gpx), 'utf8')));
    }
    entries.push({
      id: r.id, name: r.name, summits: r.summits ?? [], hills: r.hills ?? [],
      parking: r.parking ?? null, stats: r.stats ?? null, tags: r.tags ?? [],
      totalMinutes: r.timetable?.stages?.length
        ? schedule(r.timetable.start, r.timetable.stages).total : null,
      updated: r.updated, track,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(path.join(routesDir, 'index.json'), JSON.stringify(entries) + '\n');
  return entries;
}

async function saveRoute(id, body) {
  const { route, gpx, newPhotos = [] } = body;
  if (!route || typeof route.name !== 'string' || !route.name.trim()) {
    throw httpError(400, 'Route needs a name');
  }
  const dir = path.join(routesDir, id);
  const photoDir = path.join(dir, 'photos');
  await mkdir(photoDir, { recursive: true });

  // GPX: replace, remove, or keep.
  if (typeof gpx === 'string') {
    const lines = parseGpx(gpx);
    if (!lines.length) throw httpError(400, 'GPX file has no track or route points');
    await writeFile(path.join(dir, 'route.gpx'), gpx);
    route.gpx = 'route.gpx';
    route.stats = gpxStats(lines);
  } else if (gpx === null) {
    await rm(path.join(dir, 'route.gpx'), { force: true });
    route.gpx = null;
    route.stats = null;
  } else {
    const prev = await exists(path.join(dir, 'route.json')) ? await readJson(path.join(dir, 'route.json')) : {};
    route.gpx = prev.gpx ?? null;
    route.stats = prev.stats ?? null;
  }

  // New photos arrive as data URLs.
  for (const p of newPhotos) {
    if (!PHOTO_RE.test(p.file)) throw httpError(400, `Bad photo name: ${p.file}`);
    const m = /^data:image\/[\w+.-]+;base64,(.*)$/s.exec(p.dataUrl ?? '');
    if (!m) throw httpError(400, `Bad photo data: ${p.file}`);
    await writeFile(path.join(photoDir, p.file), Buffer.from(m[1], 'base64'));
  }
  // Remove photo files that the route no longer lists.
  route.photos = (route.photos ?? []).filter((p) => PHOTO_RE.test(p.file));
  const keep = new Set(route.photos.map((p) => p.file));
  for (const f of await readdir(photoDir)) {
    if (!keep.has(f)) await rm(path.join(photoDir, f), { force: true });
  }

  route.id = id;
  route.updated = new Date().toISOString();
  route.created ??= route.updated;
  await writeFile(path.join(dir, 'route.json'), JSON.stringify(route, null, 2) + '\n');
  await rebuildIndex();
  return route;
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
  await step('add', 'data');
  const { stdout: staged } = await git('diff', '--cached', '--name-only');
  if (staged.trim()) await step('commit', '-m', `Update routes (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`);
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
    if (parts[0] === 'routes' && parts.length === 1 && method === 'POST') {
      const body = await readBody(req);
      const base = slugify(body.route?.name ?? '');
      let id = base;
      for (let n = 2; await exists(path.join(routesDir, id)); n++) id = `${base}-${n}`;
      const route = await saveRoute(id, body);
      return send(res, 201, { id, route });
    }
    if (parts[0] === 'routes' && parts.length === 2) {
      const id = parts[1];
      if (!ID_RE.test(id)) throw httpError(400, 'Bad route id');
      const dir = path.join(routesDir, id);
      if (method === 'PUT') {
        if (!(await exists(dir))) throw httpError(404, 'No such route');
        const route = await saveRoute(id, await readBody(req));
        return send(res, 200, { id, route });
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
