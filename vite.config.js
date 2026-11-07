import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { apiMiddleware, dataDir, rebuildIndex } from './server/api.js';
import { serveFile } from './server/static.js';

// Dev server: adds the edit API and serves data/ live.
// Build: copies data/ into dist/ so the static site is self-contained.
function tripData() {
  return {
    name: 'trip-data',
    async configureServer(server) {
      await rebuildIndex();
      server.middlewares.use(apiMiddleware);
      server.middlewares.use(async (req, res, next) => {
        const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (!pathname.startsWith('/data/')) return next();
        if (!(await serveFile(res, dataDir, pathname.slice(6)))) next();
      });
    },
    async closeBundle() {
      await rebuildIndex();
      await cp(dataDir, path.resolve('dist', 'data'), { recursive: true });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [svelte(), tripData()],
  server: { port: 5173, watch: { ignored: ['**/data/**'] } },
});
