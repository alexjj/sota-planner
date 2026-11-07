// Minimal static file serving shared by the dev and standalone servers.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from './api.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.gpx': 'application/gpx+xml', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

export async function serveFile(res, base, rel) {
  const file = path.join(base, rel);
  if (!file.startsWith(base + path.sep) && file !== base) return false;
  try {
    const s = await stat(file);
    if (!s.isFile()) return false;
    res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Content-Length', s.size);
    // Data changes as you edit, so never let the browser cache it.
    if (base === dataDir) res.setHeader('Cache-Control', 'no-store');
    createReadStream(file).pipe(res);
    return true;
  } catch { return false; }
}

