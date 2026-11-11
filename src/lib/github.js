// GitHub mode: read and save trips through the GitHub API using a
// fine-grained personal access token pasted into the site. Each save is a
// single commit containing the trip's files and the updated trips index.
// The GitHub Pages workflow then rebuilds the public site.

import { normalizeTrip } from './trip.js';
import { planTripSave, upsertIndex, sortIndex, indexText, uniqueTripId, TRIP_ID_RE } from './save.js';

const API = 'https://api.github.com';
const SETTINGS_KEY = 'sota-trip-github';
const TRIPS = 'data/trips';
const INDEX = `${TRIPS}/index.json`;

// ---- settings (kept in this browser's local storage)

/**
 * `relay` is optional: the address of a Cloudflare Worker (see relay/) that
 * passes requests on to GitHub, for networks that block api.github.com.
 * @returns {{ token: string, repo: string, branch: string, relay?: string } | null}
 */
export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return s?.token && s?.repo ? s : null;
  } catch { return null; }
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function clearSettings() {
  try { localStorage.removeItem(SETTINGS_KEY); } catch {}
}

/** "owner/repo" from a GitHub Pages address like owner.github.io/repo/. */
export function guessRepo(loc = location) {
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(loc.hostname);
  if (!m) return '';
  const first = loc.pathname.split('/').filter(Boolean)[0];
  return `${m[1]}/${first ?? `${m[1]}.github.io`}`;
}

/** Tidy a relay address. Returns '' for none; throws if it isn't a usable URL. */
export function normalizeRelay(value) {
  const v = (value ?? '').trim().replace(/\/+$/, '');
  if (!v) return '';
  let url;
  try { url = new URL(v); } catch { throw new Error('The relay address should look like https://name.workers.dev'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('The relay address must start with https://');
  }
  return v;
}

// ---- low-level API

const enc = (path) => path.split('/').map(encodeURIComponent).join('/');

async function gh(s, method, path, body, accept = 'application/vnd.github+json') {
  const base = s.relay || API;
  const res = await fetch(`${base}${path}`, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${s.token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {
    throw new Error(s.relay
      ? `Couldn't reach the relay at ${s.relay}. Check the address, and that this network allows it.`
      : "Couldn't reach api.github.com. If this network blocks GitHub, set up a relay (see the GitHub settings).");
  });
  if (res.ok) return accept.includes('raw') ? res.text() : res.json();
  let detail = '';
  try { detail = (await res.json()).message ?? ''; } catch {}
  const message = res.status === 401
    ? 'GitHub rejected the token. It may have expired: create a new one and paste it into the GitHub settings.'
    : res.status === 403 || (res.status === 404 && method !== 'GET')
      ? `GitHub refused (${res.status}). Check the token has "Contents: Read and write" for ${s.repo}. ${detail}`
      : `GitHub ${method} ${path}: ${res.status} ${detail}`;
  throw Object.assign(new Error(message), { status: res.status });
}

/** Check the token works and can push. Returns the repo's default branch. */
export async function checkAccess(s) {
  const repo = await gh(s, 'GET', `/repos/${s.repo}`);
  if (!repo.permissions?.push) {
    throw new Error(`This token can read ${s.repo} but not write to it. Give it "Contents: Read and write".`);
  }
  return { defaultBranch: repo.default_branch, private: repo.private };
}

/** A file's text at the tip of the branch, or null if it doesn't exist. */
export async function readFile(s, path) {
  try {
    return await gh(s, 'GET', `/repos/${s.repo}/contents/${enc(path)}?ref=${encodeURIComponent(s.branch)}`,
      null, 'application/vnd.github.raw+json');
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/** Public URL for a file in the repo (for <img> and downloads). Works for public repos. */
export function rawUrl(s, path) {
  const base = s.relay ? `${s.relay}/raw` : 'https://raw.githubusercontent.com';
  return `${base}/${s.repo}/${encodeURIComponent(s.branch)}/${enc(path)}`;
}

function decodeBase64Text(b64) {
  const bytes = Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The branch tip: its commit and every file path in it, with blob shas. */
async function snapshot(s) {
  const ref = await gh(s, 'GET', `/repos/${s.repo}/git/ref/heads/${enc(s.branch)}`);
  const commit = await gh(s, 'GET', `/repos/${s.repo}/git/commits/${ref.object.sha}`);
  const tree = await gh(s, 'GET', `/repos/${s.repo}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error('The repository is too large to read in one go.');
  const files = new Map(tree.tree.filter((t) => t.type === 'blob').map((t) => [t.path, t.sha]));
  return { commitSha: ref.object.sha, treeSha: commit.tree.sha, files };
}

async function blobText(s, sha) {
  const blob = await gh(s, 'GET', `/repos/${s.repo}/git/blobs/${sha}`);
  return blob.encoding === 'base64' ? decodeBase64Text(blob.content) : blob.content;
}

async function readJsonAt(s, snap, path) {
  const sha = snap.files.get(path);
  return sha ? JSON.parse(await blobText(s, sha)) : null;
}

/**
 * Make one commit on top of `snap` and move the branch to it.
 * writes: [{ path, text } | { path, base64 }], deletes: [path].
 * Throws with status 409 if the branch moved on in the meantime.
 */
async function commit(s, snap, writes, deletes, message) {
  const tree = [];
  for (const w of writes) {
    if (w.base64 != null) {
      const blob = await gh(s, 'POST', `/repos/${s.repo}/git/blobs`, { content: w.base64, encoding: 'base64' });
      tree.push({ path: w.path, mode: '100644', type: 'blob', sha: blob.sha });
    } else {
      tree.push({ path: w.path, mode: '100644', type: 'blob', content: w.text });
    }
  }
  for (const path of deletes) {
    if (snap.files.has(path)) tree.push({ path, mode: '100644', type: 'blob', sha: null });
  }
  const newTree = await gh(s, 'POST', `/repos/${s.repo}/git/trees`, { base_tree: snap.treeSha, tree });
  const newCommit = await gh(s, 'POST', `/repos/${s.repo}/git/commits`,
    { message, tree: newTree.sha, parents: [snap.commitSha] });
  try {
    await gh(s, 'PATCH', `/repos/${s.repo}/git/refs/heads/${enc(s.branch)}`, { sha: newCommit.sha, force: false });
  } catch (e) {
    // 422 "Update is not a fast forward": someone else committed first.
    if (e.status === 422) throw Object.assign(new Error('Branch moved'), { status: 409 });
    throw e;
  }
  return newCommit.sha;
}

/** Run `attempt` against a fresh snapshot, retrying if the branch moves underneath. */
async function withRetry(s, attempt) {
  for (let i = 0; ; i++) {
    try {
      return await attempt(await snapshot(s));
    } catch (e) {
      if (e.status !== 409 || i >= 2) throw e;
    }
  }
}

// ---- trips

function tripIdsIn(snap) {
  const ids = new Set();
  for (const p of snap.files.keys()) {
    const m = /^data\/trips\/([^/]+)\//.exec(p);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/** Save a trip (id = null for a new one) as one commit. Returns { id, trip }. */
export function saveTrip(s, id, body) {
  return withRetry(s, async (snap) => {
    const isNew = !id;
    const tripId = id ?? uniqueTripId(body.trip?.name, tripIdsIn(snap));
    if (!TRIP_ID_RE.test(tripId)) throw new Error('Bad trip id');
    const dir = `${TRIPS}/${tripId}/`;
    if (!isNew && !snap.files.has(`${dir}trip.json`)) throw new Error('That trip no longer exists on GitHub.');
    const prev = await readJsonAt(s, snap, `${dir}trip.json`);
    const existing = [...snap.files.keys()].filter((p) => p.startsWith(dir)).map((p) => p.slice(dir.length));
    const plan = planTripSave(tripId, body, prev, existing);
    const index = (await readJsonAt(s, snap, INDEX)) ?? [];
    const writes = plan.writes.map((w) => ({ ...w, path: dir + w.path }));
    writes.push({ path: INDEX, text: indexText(upsertIndex(index, plan.trip, plan.tracks)) });
    const verb = isNew ? 'Add trip'
      : !!plan.trip.done !== !!prev?.done ? (plan.trip.done ? 'Mark trip done' : 'Mark trip not done')
      : 'Update trip';
    await commit(s, snap, writes, plan.deletes.map((f) => dir + f), `${verb}: ${plan.trip.name}`);
    return { id: tripId, trip: plan.trip };
  });
}

/** Delete a trip folder and its index entry as one commit. */
export function deleteTrip(s, id) {
  return withRetry(s, async (snap) => {
    const dir = `${TRIPS}/${id}/`;
    const files = [...snap.files.keys()].filter((p) => p.startsWith(dir));
    if (!files.length) return { ok: true };
    const prev = await readJsonAt(s, snap, `${dir}trip.json`);
    const index = ((await readJsonAt(s, snap, INDEX)) ?? []).filter((e) => e.id !== id);
    await commit(s, snap, [{ path: INDEX, text: indexText(sortIndex(index)) }], files,
      `Delete trip: ${prev?.name ?? id}`);
    return { ok: true };
  });
}

export async function getTrip(s, id) {
  const text = await readFile(s, `${TRIPS}/${id}/trip.json`);
  if (text == null) throw new Error(`${id}: not found`);
  return normalizeTrip(JSON.parse(text));
}
