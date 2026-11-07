// Standalone edit server for running on your own machine or a home server
// (e.g. behind Caddy with basic auth). Serves the built app from dist/, the
// live data/ folder, and the edit API.
//
//   npm run build && npm run serve        (PORT=8080 HOST=127.0.0.1 by default)

import { createServer } from 'node:http';
import path from 'node:path';
import { apiMiddleware, rootDir, dataDir, rebuildIndex } from './api.js';
import { serveFile } from './static.js';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '127.0.0.1';
const distDir = path.join(rootDir, 'dist');

await rebuildIndex();

createServer((req, res) => {
  apiMiddleware(req, res, async () => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let ok;
    if (pathname.startsWith('/data/')) ok = await serveFile(res, dataDir, pathname.slice(6));
    else ok = await serveFile(res, distDir, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!ok) { res.statusCode = 404; res.end('Not found'); }
  });
}).listen(PORT, HOST, () => {
  console.log(`SOTA Trip Planner edit server on http://${HOST}:${PORT}`);
});
