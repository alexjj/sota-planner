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

## Goals

**Goals** (in the header) groups summits into things to work through, each with a progress bar:
activated out of total (from your activator log, below), how many more are planned in trips, and
points. Open a goal for a map of its summits (activated faded, planned ringed) and a list of the ones
left, nearest to home first (or by points), with links to SOTLAS, Walkhighlands, the trip planning
it, or **+ New trip**.

A goal is a rule, hand-picked summits, or both. A rule is any of: regions (GM/CS, GM/WS, ...), being
a Munro, Corbett or Graham too, and a minimum number of points; an empty part matches anything, so
an empty rule is every GM summit. Not every Munro is a SOTA summit, so a Munros goal only counts the
ones that are (the card says how many it leaves out). **Uncategorised** at the end is every GM summit
in none of your goals (a goal of every summit doesn't count, or nothing would ever be left).

Until you save your own, you get starting goals: all of GM, the SOTA Munros and each region. Use
**Edit goals** to rename, reorder, delete or add goals, then **Save goals**: they go in
`data/goals.json`, in local and GitHub mode like walking pace.

## Your activated summits

`SOTA_USER_ID` in `.env` is your SOTA database user id: the number in your activator log address,
`https://api-db2.sota.org.uk/logs/activator/<id>/9999/1`. Every night the **Update my activations**
GitHub Action downloads that log to `data/activations.json` (run `npm run import-activations` to do
it by hand) and, if it changed, commits it and redeploys the site.

The home map then puts the summits you've activated in their own layer, **Activated by me**, drawn
faded with a dark outline, and their popups say how often and when you last activated them. Switch
that layer off in the map's layer menu to see only summits you still need. A new activation shows up
the morning after you log it.

## Editing tips

- **More than one route:** use **+ Add another route** when you'll drive to more hills the same day. Each route gets a number and colour. These match its line on the map, its parking marker (P1, P2…), and its stages in the timetable.
- **Drop in a GPX and the timetable fills itself in:** drive from home to the parking, walk in, activate (40 min) each summit on the track, walk out, and drive home. Walk times use your walking pace, and drives are routed by road. Add another route and drop its GPX, and it goes before the drive home, with a drive from the previous parking. Stages you already have are kept. If the route has no summits yet, the SOTA summits on the track are added.
- **Stops along the route:** the walk is split at every stop on the track, in walking order: the route's SOTA summits (activated), its hills (Munros, Corbetts, Grahams: just a time to walk to) and **waypoints**. Add a waypoint with **+ Waypoint** and a click on the track, then name it (a bealach, lunch spot, river crossing) and give it minutes if you'll stop there; it shows as 📍 on the map. Loading or drawing a GPX adds the summits and hills it goes over. A stop the track passes twice (out and back) counts the first time, on the way up. The route shows the time from setting off to each stop, e.g. "Bealach 1h 10m · Summit A 2h 15m". After adding or changing stops, **Re-estimate walk times** updates the timetable (stops at waypoints become breaks).
- **Draw a route:** instead of loading a GPX, click **Draw route** under the route's GPX and click the map to add points. Choose how the next stretch is drawn: **Follow paths** routes along OpenStreetMap paths and tracks with [BRouter](https://brouter.de)'s hill-walking profile (free, no key), and **Straight line** draws a direct line, for pathless ground. Click a summit or hill to put a point exactly on it and add it to the route's stops; the times to each stop update as you draw. Drag a point to move it, click it to remove it, and click a stretch to switch it between the two. Distance, ascent and walking time update as you go. **Done** turns the drawing into the route's GPX, like loading a file (parking from the start, summits on the track, the timetable). The points are saved with the route, so **Edit drawing** carries on where you left off; loading a GPX file replaces the drawing. Straight lines get heights from terrain tiles; paths come with BRouter's.
- **GPX without heights** (e.g. a route planned on Walkhighlands): heights are looked up from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (open DEM data, about 30 m detail), after adding a point every 25 m along the line, and the GPX is saved with them. Summits come out 10–20 m low and ascent a few percent low, as terrain data smooths off the tops. A route saved earlier without heights shows an **Add heights** button.
- **Terrain and company:** each route has an easy / moderate / rough setting and who you're walking with (solo, with Fraser, with others), which pick which of your walks its times are based on. With company and no matching walks yet, your solo walks are used. After changing either (or the GPX), **Re-estimate walk times** updates that route's walk stages.
- **Bike drops:** cycling in? Under the GPX, click **+ Bike drop**, then click the route's track where you'll leave the bike (add one per hill if you cycle between them). Drops show as 🚲 on the map: drag one to move it along the track, or ✕ to remove it. The route then starts on the bike and swaps between cycling and walking each time the track passes a drop (only the first two passes of a drop count, so riding past it later doesn't). A one-way track comes back the same way. The timetable gets **Cycle in**, **Walk in**, **Walk back to the bike**, **Cycle on** and **Cycle out** stages, timed from your cycling pace (Settings), or typical mountain-bike numbers (15 km/h on the flat, 6 min per 100 m up) until you've added rides. After adding drops to a route that already has stages, **Re-estimate walk times** rebuilds its walking, cycling and activation stages, keeping your activation times and other stages. The route's estimate and the trip page show walking and cycling times separately.
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

### OS Leisure maps (1:25k / 1:50k)

The map can show Ordnance Survey Leisure mapping (Landranger 1:50,000 and Explorer 1:25,000)
through the same Worker, which adds your OS API key so it never appears in the public site.

1. At <https://osdatahub.os.uk>, create a project with the **OS Maps API** and copy its key.
   The detailed Leisure zoom levels are Premium data: they count against your plan's free
   monthly allowance, and beyond it you pay.
2. In the Worker's **Settings → Variables and Secrets**, add a **Secret** named `OS_API_KEY` with that key.
   Make sure `ALLOWED_ORIGINS` lists every address the site is used from (including
   `http://localhost:5173` for `npm run edit`). Tiles are only served to those pages.
3. Deploy the Worker with the current `relay/worker.js`.
4. Put the Worker's address in `.env` as `VITE_OS_TILES=https://sota-relay.<you>.workers.dev`,
   commit and push. The next deploy adds **OS Leisure (1:25k/1:50k)** to the map's layer menu.

OS tiles only come in British National Grid, so the map switches projection when you pick that
layer. Browsers keep tiles for a week to save on OS requests.

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

  Mark each walk as easy, moderate or rough terrain, and who you walked with: solo, **With Fraser** or **With others**. A route uses your solo walks with its terrain, else all your solo walks, else Naismith's rule. Walks with company are summarised separately, so they capture those timings without changing your own pace (older walks count as solo). 
- **Cycling in:** a recording with cycling in it (cycle in, walk up and back, cycle out) isn't added straight away. The page finds each bike drop from your speed (over about 9 km/h is cycling) and where you stopped at the bike, so a day with two or more hills and a ride between them gets a drop for each. It shows the split on a map: orange for cycling, blue for walking. Click the track to add a bike drop, click a drop to remove it, or choose **All walking** or **All cycling**, then add it. The walk and the ride become separate records: the walk counts towards your walking pace as usual, and the ride goes in a separate **Cycling pace** table (flat speed, and time per 100 m up and down, where down is usually negative). Cycling doesn't change walk times.

  Only these numbers go into `data/pace.json` (not the tracks), so every browser and the public site use the same pace. Saving works in local and GitHub mode, like a trip.

## Credits

- Summits: [SOTA](https://www.sota.org.uk/) summits list.
- Hills: [Database of British and Irish Hills](https://www.hills-database.co.uk/) v18, CC BY 4.0.
- Maps: [OpenTopoMap](https://opentopomap.org/) (CC-BY-SA), © OpenStreetMap contributors, Esri World Imagery.
- Drive times: [OSRM](https://project-osrm.org) demo server, © OpenStreetMap contributors.

## Ideas for later

- Planning routes in the app with BRouter instead of plotaroute.
- Sunrise and sunset times on the timetable for a chosen date.
- OS grid reference input for parking.
