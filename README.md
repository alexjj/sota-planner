# SOTA Trip Planner

Plan future SOTA activations: GPX routes, summits, other Munros on the way,
parking spots, photos, and a timetable you can shift to see when you'll be on
the summit and when you'll be home. Maps use OpenTopoMap.

The site is static. Everything is stored as plain files in `data/`, kept in
git, and published to GitHub Pages. Editing happens through a small local
server that writes those files.

## Quick start

```bash
npm install
npm run edit          # editor + live site on http://localhost:5173
```

Add or change trips in the browser. Then commit and push `data/`, either
with git or with the **Publish** button in the header. GitHub Actions
rebuilds the site.

## How it fits together

There are three ways the app runs. It picks one automatically.

| Mode | How you start it | Where saves go |
|---|---|---|
| **Local** | `npm run edit`, or `npm run build && npm run serve` | Files in `data/` on disk. Commit them yourself or with **Publish**. |
| **GitHub** | The public site, after pasting a token under **Edit** | A commit straight to the repo through the GitHub API |
| **Read-only** | The public site, with no token | Nowhere. Browse only. |

- **`npm run edit`:** the Vite dev server with the edit API added.
- **`npm run serve`:** the built app, live `data/` and the edit API, all in one Node process with no dependencies. Use this on a server (see below). Set `PORT` and `HOST` as needed; the defaults are `8080` and `127.0.0.1`.
- **Shared save logic:** both the edit API and GitHub mode use `src/lib/save.js` to work out which files a save writes and deletes, so they behave the same.

## Data layout

A **trip** is one outing, usually a day. It holds one or more **routes**. Each
route is a walk, or bike and walk, from its own parking spot, with its own GPX
and the summits and hills it visits. The drives to and between routes go in
the trip's timetable.

```
data/
  summits.json              GM summits from the SOTA summits list
  hills.json                Scottish Munros, Munro Tops, Corbetts, Grahams (DoBIH)
  pace.json                 your walking pace, learnt from walks you've recorded (Settings)
  trips/
    index.json              summary of all trips, rebuilt on every save
    <trip-id>/
      trip.json             name, routes, timetable, notes, links, photos
      <route-id>.gpx        one GPX per route
      photos/*.jpg          resized to 1600 px when added
```

`trip.json` example, with two routes and a drive between them:

```json
{
  "id": "lui-then-oss-and-dubhchraig",
  "name": "Ben Lui, then Ben Oss and Beinn Dubhchraig",
  "tags": ["long day"],
  "routes": [
    {
      "id": "r1",
      "name": "Ben Lui from Glen Lochy",
      "gpx": "r1.gpx",
      "stats": { "distanceKm": 7.69, "ascentM": 981, "maxEleM": 1131 },
      "parking": { "lat": 56.4235, "lon": -4.8505, "label": "Layby on A85" },
      "summits": ["GM/SS-003"],
      "hills": []
    },
    {
      "id": "r2",
      "name": "",
      "gpx": "r2.gpx",
      "parking": { "lat": 56.4108, "lon": -4.7322, "label": "Dalrigh car park" },
      "summits": ["GM/SS-009", "GM/SS-005"],
      "hills": []
    }
  ],
  "timetable": {
    "start": "06:30",
    "stages": [
      { "type": "drive", "route": "r1", "minutes": 90 },
      { "type": "walk", "route": "r1", "label": "Walk up", "minutes": 110 },
      { "type": "activate", "summit": "GM/SS-003", "minutes": 40 },
      { "type": "walk", "route": "r1", "label": "Walk down", "minutes": 80 },
      { "type": "drive", "route": "r2", "minutes": 20 },
      { "type": "cycle", "route": "r2", "label": "Cycle to Cononish", "minutes": 30 },
      { "type": "camp", "until": "06:00" }
    ]
  },
  "notes": "",
  "links": [{ "label": "plotaroute", "url": "https://www.plotaroute.com/route/..." }],
  "photos": [{ "file": "parking.jpg", "caption": "Streetview of the car park" }]
}
```

- **Stages:** the types are `drive`, `cycle`, `walk`, `activate`, `break`, `camp` and `other`. A stage either has `minutes`, or `until` a clock time (for overnight camps).
- **Linking stages to routes:** a stage's `route` links it to a route. On a drive, it means "drive to that route's parking". An `activate` stage belongs to whichever route holds its summit.
- **`hills`:** Database of British and Irish Hills numbers.
- **`stats`:** worked out from the GPX when you save.

Trips saved in the original single-route format (`data/routes/<id>/route.json`)
are converted to this layout automatically when the edit server starts.

## Editing tips

- **More than one route:** use **+ Add another route** when you'll drive to more hills the same day. Each route gets a number and colour. These match its line on the map, its parking marker (P1, P2…), and its stages in the timetable.
- **Drop in a GPX and the timetable fills itself in:** drive from home to the parking, walk in, activate (40 min) each summit on the track, walk out, and drive home. Walk times use your walking pace, and drives are routed by road. Add another route and drop its GPX, and it goes before the drive home, with a drive from the previous parking. Stages you already have are kept. If the route has no summits yet, the SOTA summits on the track are added.
- **Terrain:** each route has an easy / moderate / rough setting, which picks which of your walks its times are based on. After changing it (or the GPX), **Re-estimate walk times** updates that route's walk stages.
- **Copy a route from another trip:** this brings over the route's GPX, parking, summits and its non-driving timetable stages, plus a drive to it. Use it to try combining walks you've already planned into one day.
- **Summits:**
  - Search by ref (`SS-003`) or name in a route's box.
  - Or click markers on the editor map. Clicks apply to the highlighted (active) route.
  - Once a GPX is loaded, any summit or hill within 150 m of its track is offered as a one-click add, in walking order.
- **Parking:** paste `lat, lon` or a Google Maps link, pick a spot on the map, drag the P marker, or use the GPX start. If parking is empty when you load a GPX, the GPX start is used.
- **Timetable:**
  - Type durations as `90`, `1:30` or `1h30`.
  - **Fill in a typical day** (on an empty timetable) does the same as dropping in each route's GPX.
  - With several routes, each stage has a route picker.
  - The 🕕 button switches a stage to "until a clock time".
- **Photos**: choose files, drag them onto the page, or paste a screenshot with Ctrl+V.
- **Ctrl+S** saves.

## Publishing to GitHub Pages

1. Create a GitHub repo and push this project to it.
2. In the repo, go to **Settings → Pages → Source** and choose **GitHub Actions**.
3. Each push to `main` runs `.github/workflows/deploy.yml`, which builds and deploys the site.

The app uses relative paths and `#/` URLs, so it works at
`https://<user>.github.io/<repo>/` without any configuration.

## Editing from the public site (GitHub mode)

You can add and edit trips on the GitHub Pages site itself. No server is needed.

1. Create a **fine-grained personal access token** at
   <https://github.com/settings/personal-access-tokens/new>:
   - **Repository access:** "Only select repositories", then pick this repo.
   - **Permissions:** Repository permissions → **Contents: Read and write**. Leave everything else as "No access".
   - **Expiration:** pick a date. When it expires, saving stops working until you paste in a new token.
2. On the site, click **Edit** at the top right. Paste the token and check the repository (it's filled in from the address). Then click **Check and save**.
3. The header now shows **GitHub: owner/repo**, and the edit buttons appear.

How it behaves:

- **Each save is one commit.** It contains the trip's `trip.json`, GPX files and photos, plus the updated `data/trips/index.json`.
- **Seeing your changes:** the deploy workflow publishes the change for everyone a minute or two later. Meanwhile, in GitHub mode the site reads straight from the repo, so you see your changes immediately.
- **Saving at the same time:** if someone else commits at the same moment, the save retries on top of their commit.
- **Where the token is kept:** only in that browser's local storage. Use **Edit → Remove token** on a shared computer. If the token leaks, delete it on GitHub's token page and it stops working.
- **Photos:** in GitHub mode they load from `raw.githubusercontent.com` (or through the relay, below), so this needs a public repo. GitHub Pages on a free plan needs one anyway.

If you also edit locally, run `git pull` first to pick up trips saved from the site. **Publish** already pulls before it pushes.

### Relay for networks that block GitHub

Some networks, such as many workplaces, block `api.github.com`, so saving fails there. A
small Cloudflare Worker (free plan) can pass the requests on to GitHub for you. The data
still lives in this repo, and each save is still one commit. The code is in `relay/worker.js`.

1. Sign in at <https://dash.cloudflare.com> (a free account is fine).
2. Go to **Compute (Workers) → Workers & Pages → Create → Worker**. Start from "Hello World",
   name it (e.g. `sota-relay`), and click **Deploy**.
3. Click **Edit code**, replace everything with the contents of `relay/worker.js`, and click **Deploy**.
4. In the Worker's **Settings → Variables and Secrets**, add two **Text** variables, then deploy:
   - `ALLOWED_REPOS` = `owner/repo` (this repo, e.g. `alexjj/sota-planner`)
   - `ALLOWED_ORIGINS` = the site's origin, e.g. `https://alexjj.github.io`
     (comma-separate extras such as `http://localhost:5173`). This is the address without the `/repo/` path.
5. Copy the Worker's address from its overview page, e.g. `https://sota-relay.<you>.workers.dev`.
6. On the site, at work, open **Edit** (or **GitHub: owner/repo**), paste that address into
   **Relay address**, and click **Check and save**.

The relay stores nothing. Your token travels with each request, as it would to GitHub. It only
forwards requests for the repos in `ALLOWED_REPOS`, so it can't be used as a general GitHub proxy.
Photos load through it too (from `/raw/…`). The free plan allows 100,000 requests a day, and a save
uses about 10.

If the network also blocks `*.workers.dev`, add a custom domain to the Worker
(**Settings → Domains & Routes**) if you have a domain on Cloudflare, and use that address instead.
To deploy from the command line instead of the dashboard, edit `relay/wrangler.toml`, then run
`npx wrangler deploy` in `relay/`.

## Editing from your own server (behind Caddy)

GitHub mode is usually simpler. If you'd rather run the editor on a server:

```bash
git clone <your repo> sota-trip-planner && cd sota-trip-planner
npm ci && npm run build
PORT=8080 npm run serve
```

Caddyfile, with a password (create the hash with `caddy hash-password`):

```
trips.example.com {
    basic_auth {
        alex $2a$14$...hash...
    }
    reverse_proxy 127.0.0.1:8080
}
```

The **Publish** button runs `git pull --rebase`, commits `data/` and pushes.
This needs push access from the server, for example a deploy key with write
access.

Rebuild (`npm run build`) only after the app code changes. Trip data is served
live from `data/`.

## Updating summit and hill data

`data/summits.json` (valid GM summits from the SOTA summits list) and
`data/hills.json` (Database of British and Irish Hills) are downloaded copies.
They refresh in two ways:

- **Automatically, once a month:** `.github/workflows/update-data.yml` runs on
  the 1st of each month. It re-downloads both lists. If anything changed, it
  commits the new files and starts the GitHub Pages deploy. To run it straight
  away, go to **Actions → Update summit and hill data → Run workflow**.
- **By hand:** run `npm run import-data` (it needs `unzip`), then commit the two files.

If a download comes back with over 10% fewer summits or hills than before, the
import stops without overwriting anything. That makes the monthly run show as
failed, and GitHub emails you. Both lists change rarely, so a big drop almost
certainly means a broken download.

## Settings: home and walking pace

Open **Settings** at the top right.

- **Home:** where trips start and end, for drive times. Paste `lat, lon` or a Google Maps link, or use your current location. It's kept only in that browser's local storage, like the GitHub token, and is never committed. Drive times come from the free [OSRM](https://project-osrm.org) router, so your home and parking coordinates are sent there. If it can't be reached, the planner makes a rough guess from the straight-line distance. Routed times get a percentage added (15% by default), because the router tends to be quick on Highland roads.
- **Walking pace:** add GPX recordings of walks you've done, from a watch, phone or GPS (they need timestamps). For each walk the planner fits:
  - minutes per km on the flat,
  - extra minutes per 100 m up and per 100 m down,
  - short rests along the way, as a percentage. Stops of 20 minutes or more, like activations and lunch, are left out.

  Mark each walk as easy, moderate or rough terrain. A route uses the walks with its terrain, else all your walks, else Naismith's rule. Only these numbers go into `data/pace.json` (not the tracks), so every browser and the public site use the same pace. Saving works in local and GitHub mode, like a trip.

## Credits

- Summits: [SOTA](https://www.sota.org.uk/) summits list.
- Hills: [Database of British and Irish Hills](https://www.hills-database.co.uk/) v18, CC BY 4.0.
- Maps: [OpenTopoMap](https://opentopomap.org/) (CC-BY-SA), © OpenStreetMap contributors, Esri World Imagery.
- Drive times: [OSRM](https://project-osrm.org) demo server, © OpenStreetMap contributors.

## Ideas for later

- Planning routes in the app with BRouter instead of plotaroute.
- Sunrise and sunset times on the timetable for a chosen date.
- OS grid reference input for parking.
