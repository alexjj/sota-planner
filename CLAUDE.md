# SOTA Trip Planner

Static site for planning SOTA activations in Scotland (GM). Svelte 5 + Vite + Leaflet,
plain JavaScript (no TypeScript). Data is plain JSON/GPX/JPEG files in `data/`, kept in git and
published to GitHub Pages (`alexjj/sota-planner`). See README.md for user-facing docs.

## Commands

- `npm run edit`: Vite dev server plus the local edit API (normal way to develop)
- `npm run build`: production build to `dist/` (also rebuilds `data/trips/index.json` and copies `data/`)
- `npm run serve`: standalone Node server: built app + live `data/` + edit API
- `npm run import-data`: re-download GM summits (SOTA) and Scottish hills (DoBIH)

There is no test suite. At minimum run `npm run build`. Check UI changes in the browser.

## Three modes (picked in `src/lib/store.js` → `getStatus`)

- **local**: `api/status` answers (dev server or `npm run serve`); saves go through `server/api.js` to disk
- **github**: a token is saved in localStorage (`sota-trip-github`); reads and commits go through
  `src/lib/github.js` (Git Data API, one commit per save, retries if the branch moved)
  An optional `relay` setting sends those requests through a Cloudflare Worker (`relay/worker.js`)
  for networks that block api.github.com. Keep the Worker free of npm dependencies.
- **static**: public site with no token; read-only

Local wins whenever the edit API answers, so GitHub mode can't be exercised with `npm run edit`.
Both write paths use `src/lib/save.js` (`planTripSave`, `upsertIndex`) to decide what to write and
delete. Change save behaviour there, not in one backend only.

## Data model (`src/lib/trip.js`)

- A **trip** (`data/trips/<id>/trip.json`) has one or more **routes**. Each route has its own GPX
  (`<routeId>.gpx`), parking, `summits` (SOTA refs) and `hills` (DoBIH numbers).
- Timetable stages may have `route`. Activate stages belong to the route holding their `summit`
  (`stageRouteId`). A stage has `minutes` or `until` (clock time, for overnight camps).
- `data/trips/index.json` is a derived summary (with simplified tracks); never hand-edit it.
- `normalizeTrip` upgrades the old single-route format; `server/api.js` migrates `data/routes/` on start.
  Keep stored-data changes backwards compatible: real trips already live on GitHub.
- Route colours and numbers (P1, P2…) come from route order via `routeInfo`.
- A route may have `terrain` (easy/moderate/rough) for walk estimates.

## Walking pace and planning

- `src/lib/pace.js`: learns pace from recorded GPX (timestamps) and predicts walk times;
  `data/pace.json` holds per-walk fitted numbers only (no tracks), saved via `PUT /api/pace` or
  `github.saveFile`. `cleanPace` validates it for both.
- `src/lib/plan.js`: GPX → walk/activate stages. `TripEdit.planRoute` adds drives and inserts them.
- `src/lib/routing.js`: OSRM drive times (browser), padded by a local setting; falls back to a guess.
- Home location and drive padding live in localStorage only (`src/lib/home.js`). Never commit them.

## Working with this repo

- The user saves trips from the website, so the local checkout is often behind GitHub.
  `git fetch`/pull before committing or pushing.
- Never test against the real `data/trips/`. Use a throwaway copy of the project, or a fake GitHub
  API (in-memory fetch mock) for `github.js`. Delete any test trips you create.
- The **Publish** button (local mode) only commits `data/`, not code.
- Commits made by a GitHub Action don't trigger other workflows, so `update-data.yml` starts
  `deploy.yml` itself with `gh workflow run`.
- Keep URLs relative and routing hash-based (`#/trip/<id>`) so the site works under `/<repo>/` on Pages.
- `src/lib/gpx.js`, `time.js`, `trip.js` and `save.js` must stay free of browser- and Node-only APIs:
  both the browser and the server import them.
- Map tiles: OpenTopoMap (default), OSM, Esri satellite. Keep attributions, including DoBIH (CC BY 4.0).
