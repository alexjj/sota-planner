# SOTA Trip Planner

Plan future SOTA activations: GPX route, summits, other Munros on the way,
parking spot, photos, and a timetable you can shift to see when you'll be on
the summit and when you'll be home. Maps use OpenTopoMap.

The site is static. Everything is stored as plain files in `data/`, kept in
git, and published to GitHub Pages. Editing happens through a small local
server that writes those files.

## Quick start

```bash
npm install
npm run edit          # editor + live site on http://localhost:5173
```

Add or change routes in the browser. Then commit and push `data/`, either
with git or with the **Publish** button in the header. GitHub Actions
rebuilds the site.

## How it fits together

```
npm run edit   ─┐
npm run serve  ─┴─> edit API (server/api.js) ──writes──> data/  ──git push──> GitHub Pages
                                                                                (read-only)
```

- **`npm run edit`**: the Vite dev server with the edit API added. This is the normal way to edit on your PC.
- **`npm run build && npm run serve`**: the built app, live `data/` and the edit API in one Node process with no dependencies. Use this on a server (see below). Set `PORT` and `HOST` as needed; the defaults are `8080` and `127.0.0.1`.
- **GitHub Pages**: the same app, built with a copy of `data/`. It has no API, so it shows the routes read-only with no edit buttons.

## Data layout

```
data/
  summits.json              GM summits from the SOTA summits list
  hills.json                Scottish Munros, Munro Tops, Corbetts, Grahams (DoBIH)
  routes/
    index.json              summary of all routes, rebuilt on every save
    <route-id>/
      route.json            name, summits, hills, parking, timetable, notes, links, photos
      route.gpx
      photos/*.jpg          resized to 1600 px when added
```

`route.json` example:

```json
{
  "id": "ben-lui-from-dalrigh",
  "name": "Ben Lui from Dalrigh by bike",
  "tags": ["bike"],
  "summits": ["GM/SS-003"],
  "hills": [75],
  "parking": { "lat": 56.4108, "lon": -4.7322, "label": "Dalrigh car park" },
  "gpx": "route.gpx",
  "stats": { "distanceKm": 14.36, "ascentM": 1017, "maxEleM": 1131 },
  "timetable": {
    "start": "06:30",
    "stages": [
      { "type": "drive", "label": "Drive to Dalrigh", "minutes": 75 },
      { "type": "cycle", "label": "Cycle to Cononish", "minutes": 30 },
      { "type": "walk", "label": "Walk up", "minutes": 150 },
      { "type": "activate", "summit": "GM/SS-003", "minutes": 40 },
      { "type": "camp", "until": "06:00" }
    ]
  },
  "notes": "",
  "links": [{ "label": "plotaroute", "url": "https://www.plotaroute.com/route/..." }],
  "photos": [{ "file": "parking.jpg", "caption": "Streetview of the car park" }]
}
```

The stage types are `drive`, `cycle`, `walk`, `activate`, `break`, `camp` and
`other`. A stage either has `minutes`, or `until` a clock time (for overnight
camps). `hills` holds Database of British and Irish Hills numbers. `stats` is
worked out from the GPX when you save.

## Editing tips

- **Summits**: search by ref (`SS-003`) or name, or click markers on the editor map. Once a GPX is loaded, any summit or hill within 150 m of the track is offered as a one-click add.
- **Parking**: paste `lat, lon` or a Google Maps link, pick a spot on the map, drag the P marker, or use the GPX start. If parking is empty when you load a GPX, the GPX start is used.
- **Timetable**: type durations as `90`, `1:30` or `1h30`. **Fill in a typical day** builds drive, walk, activate and walk-out stages from your summits and a Naismith estimate. The 🕕 button switches a stage to "until a clock time".
- **Photos**: choose files, drag them onto the page, or paste a screenshot with Ctrl+V.
- **Ctrl+S** saves.

## Publishing to GitHub Pages

1. Create a GitHub repo and push this project to it.
2. In the repo, go to **Settings → Pages → Source** and choose **GitHub Actions**.
3. Each push to `main` runs `.github/workflows/deploy.yml`, which builds and deploys the site.

The app uses relative paths and `#/` URLs, so it works at
`https://<user>.github.io/<repo>/` without any configuration.

## Editing from work (your own server behind Caddy)

On the server:

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
access. If you edit both on your PC and on the server, publish (or pull)
before switching between them to avoid conflicts.

Rebuild (`npm run build`) only after the app code changes. Route data is
served live from `data/`.

## Updating summit and hill data

```bash
npm run import-data
```

This downloads the current SOTA summits list (valid GM summits only) and the
Database of British and Irish Hills, then rewrites `data/summits.json` and
`data/hills.json`. Run it now and again to pick up new summits or changed
points. It needs `unzip`.

## Credits

- Summits: [SOTA](https://www.sota.org.uk/) summits list.
- Hills: [Database of British and Irish Hills](https://www.hills-database.co.uk/) v18, CC BY 4.0.
- Maps: [OpenTopoMap](https://opentopomap.org/) (CC-BY-SA), © OpenStreetMap contributors, Esri World Imagery.

## Ideas for later

- Multi-route day plans: chain routes with drives between them, and reuse routes across plans.
- Driving times from OSRM or OpenRouteService instead of entering them by hand.
- Planning routes in the app with BRouter instead of plotaroute.
- Sunrise and sunset times on the timetable for a chosen date.
- OS grid reference input for parking.
