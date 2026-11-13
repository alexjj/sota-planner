<script>
  import { onMount, tick } from 'svelte';
  import L from 'leaflet';
  import { createMap, summitMarker, hillMarker, parkingMarker, trackLayer, esc, summitLinks, hillLinks, sizeSummitsOnZoom } from '../lib/map.js';
  import {
    getSummits, getHills, getTrip, getIndex, getGpxText, photoUrl, parseLatLon, googleMapsPlaceUrl,
    createTrip, saveTrip, deleteTrip, getStatus, getPace,
  } from '../lib/store.js';
  import { paceFor, statsMinutes, round5, TERRAINS, DEFAULT_TERRAIN } from '../lib/pace.js';
  import { walkStages } from '../lib/plan.js';
  import { fmtDuration } from '../lib/time.js';
  import { driveTime } from '../lib/routing.js';
  import { loadHome } from '../lib/home.js';
  import { showFlash } from '../lib/flash.svelte.js';
  import { parseGpx, gpxStats, distanceM } from '../lib/gpx.js';
  import { resizeImage, photoFileName } from '../lib/image.js';
  import { normalizeTrip, blankRoute, routeInfo, routeLabel, stageRouteId, routeStages, newId } from '../lib/trip.js';
  import SummitPicker from '../components/SummitPicker.svelte';
  import TagInput from '../components/TagInput.svelte';
  import TimetableEditor from '../components/TimetableEditor.svelte';
  import Timetable from '../components/Timetable.svelte';

  // id = existing trip; summit = pre-select a summit for a new one.
  let { id = null, summit: startSummit = null } = $props();

  let trip = $state(null);
  let summitsData = $state(null);
  let hillsData = $state(null);
  let otherTrips = $state([]);     // index entries, for "copy a route from another trip"
  let lines = $state({});          // route id -> GPX lines (preview)
  let gpxChanges = $state({});     // route id -> new GPX text, or null = removed
  let newPhotos = $state([]);      // [{ file, dataUrl }]
  let parkingText = $state({});    // route id -> coordinate text box
  let activeId = $state(null);     // route that map clicks apply to
  let error = $state('');
  let notice = $state('');
  let pace = $state.raw({ walks: [] }); // walking pace records (data/pace.json)
  let planning = $state(false);
  let saving = $state(false);
  let pickParking = $state(false);
  let dirty = $state(false);
  let initial = '';
  let mapEl;
  let map = $state.raw(null);
  let overlay;

  const info = $derived(trip && summitsData ? routeInfo(trip, summitsData.byRef) : new Map());
  const multi = $derived((trip?.routes.length ?? 0) > 1);
  const active = $derived(trip?.routes.find((r) => r.id === activeId) ?? trip?.routes[0]);

  function statsFor(r) {
    if (r.id in gpxChanges) return lines[r.id]?.length ? gpxStats(lines[r.id]) : null;
    return r.stats;
  }

  const summit = (ref) => summitsData?.byRef.get(ref) ?? { ref, name: '?' };
  const hill = (hid) => hillsData?.byId.get(hid);

  // Summits and hills close to each route's GPX track that aren't on it yet.
  const suggestions = $derived.by(() => {
    const out = {};
    if (!trip || !summitsData || !hillsData) return out;
    for (const r of trip.routes) {
      const pts = (lines[r.id] ?? []).flat();
      if (!pts.length) continue;
      let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
      for (const p of pts) {
        minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
        minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
      }
      const near = (o) => o.lat > minLat - 0.01 && o.lat < maxLat + 0.01 && o.lon > minLon - 0.02 &&
        o.lon < maxLon + 0.02 && pts.some((p) => distanceM(p, o) < 150);
      const list = [];
      for (const s of summitsData.summits) if (!r.summits.includes(s.ref) && near(s)) list.push({ kind: 'summit', item: s });
      for (const h of hillsData.hills) if (!h.sota && !r.hills.includes(h.id) && near(h)) list.push({ kind: 'hill', item: h });
      // In the order the track reaches them, so they're added in walking order.
      const reached = (o) => pts.findIndex((p) => distanceM(p, o) < 150);
      out[r.id] = list.map((x) => ({ ...x, at: reached(x.item) })).sort((x, y) => x.at - y.at);
    }
    return out;
  });

  const photoList = $derived((trip?.photos ?? []).map((p) => ({
    ...p,
    src: newPhotos.find((n) => n.file === p.file)?.dataUrl ?? photoUrl(trip.id ?? id, p.file),
  })));

  // ---- routes
  function addRoute(fields = {}) {
    const r = blankRoute(fields);
    trip.routes.push(r);
    activeId = r.id;
    return r;
  }

  function moveRoute(i, d) {
    const j = i + d;
    if (j < 0 || j >= trip.routes.length) return;
    const [r] = trip.routes.splice(i, 1);
    trip.routes.splice(j, 0, r);
  }

  function removeRoute(r) {
    const linked = trip.timetable.stages.filter((s) => stageRouteId(s, trip) === r.id);
    const label = routeLabel(r, trip.routes.indexOf(r), summitsData.byRef);
    const what = [r.gpx || lines[r.id]?.length ? 'its GPX' : null, linked.length ? `${linked.length} timetable stage(s)` : null]
      .filter(Boolean).join(' and ');
    if (what && !confirm(`Remove "${label}" with ${what}?`)) return;
    trip.timetable.stages = trip.timetable.stages.filter((s) => !linked.includes(s));
    trip.routes = trip.routes.filter((x) => x.id !== r.id);
    delete gpxChanges[r.id];
    delete lines[r.id];
    if (activeId === r.id) activeId = trip.routes[0]?.id ?? null;
  }

  /** When a trip gets a second route, link the first route's stages (not yet linked to any route) to it. */
  function linkFirstRoute(first) {
    if (!first || trip.timetable.stages.some((st) => st.route)) return;
    const own = routeStages({ ...trip, routes: [first] }, first.id);
    for (const st of [own.drive, ...own.stages]) {
      if (st && st.type !== 'activate') st.route = first.id;
    }
  }

  /** Does the timetable already have stages for this route? */
  function hasStages(r) {
    const stages = trip.timetable.stages;
    if (trip.routes.length === 1) return stages.some((st) => st.type !== 'drive');
    return stages.some((st) => stageRouteId(st, trip) === r.id);
  }

  /** This route's walk stages, in order. */
  function routeWalks(r) {
    return trip.timetable.stages.filter((st) => st.type === 'walk' &&
      (trip.routes.length === 1 ? !st.route || st.route === r.id : stageRouteId(st, trip) === r.id));
  }

  /** Estimated walking time for a route from its GPX stats and your pace. */
  function estimateFor(r) {
    const st = statsFor(r);
    if (!st) return null;
    const p = paceFor(pace, r.terrain);
    return { minutes: round5(statsMinutes(st, p.params)), basis: p.basis };
  }

  const driveNote = (d, what) => d.how === 'guess' ? `${what} is a rough guess (couldn't reach the road router)` : null;

  /**
   * Fill in the timetable for a route from its GPX: drive there, walk in,
   * activate each summit, walk out, then drive home. Stages already in the
   * timetable stay as they are; a new route goes before the drive home, and
   * the drive home is re-worked from the new last parking spot.
   * @returns {string|null} a note for the user, or null if the route already had stages
   */
  async function planRoute(r) {
    if (hasStages(r)) return null;
    const tt = trip.timetable;
    const notes = [];
    // Summits the track goes over, if none were picked.
    if (!r.summits.length) {
      const found = (suggestions[r.id] ?? []).filter((sg) => sg.kind === 'summit').map((sg) => sg.item.ref);
      if (found.length) {
        r.summits.push(...found);
        notes.push(`Added ${found.join(', ')} from the track`);
      }
    }
    const others = trip.routes.filter((x) => x !== r);
    linkFirstRoute(others[0]);
    const p = paceFor(pace, r.terrain);
    const { stages, offTrack } = walkStages(r, lines[r.id], p.params, summitsData.byRef);
    if (offTrack.length) notes.push(`${offTrack.join(', ')} isn't on the GPX track: check where its activation goes`);
    const home = loadHome();

    if (!tt.stages.length) {
      const [there, back] = await Promise.all([driveTime(home, r.parking), driveTime(r.parking, home)]);
      tt.stages.push({ id: newId(), type: 'drive', label: '', minutes: there.minutes, route: r.id },
        ...stages, { id: newId(), type: 'drive', label: 'Drive home', minutes: back.minutes });
      notes.push(driveNote(there, 'The drive there'), driveNote(back, 'The drive home'));
    } else {
      // Drive on from the route whose stages are last so far.
      const lastId = [...tt.stages].reverse().map((st) => stageRouteId(st, trip)).find((x) => x && x !== r.id);
      const prev = trip.routes.find((x) => x.id === lastId) ?? others.at(-1);
      const there = await driveTime(prev?.parking, r.parking, 30);
      notes.push(driveNote(there, 'The drive between them'));
      const last = tt.stages.at(-1);
      const homeDrive = last && last.type === 'drive' && !last.route ? last : null;
      tt.stages.splice(homeDrive ? tt.stages.length - 1 : tt.stages.length, 0,
        { id: newId(), type: 'drive', label: '', minutes: there.minutes, route: r.id }, ...stages);
      if (homeDrive && home && r.parking) {
        const back = await driveTime(r.parking, home);
        homeDrive.minutes = back.minutes;
        notes.push('the drive home now starts from here', driveNote(back, 'The drive home'));
      }
    }
    if (!home) notes.push('set your home in Settings to work out drives to and from home (left at 1 hour)');
    const kept = notes.filter(Boolean);
    return `Timetable filled in using ${p.basis}${p.count ? ` (${p.count})` : ''}.` +
      (kept.length ? ` ${kept.map((n) => n[0].toUpperCase() + n.slice(1)).join('. ')}.` : '');
  }

  /** Update this route's walk times from its GPX and your pace, keeping everything else. */
  async function reestimate(r) {
    const p = paceFor(pace, r.terrain);
    const fresh = walkStages(r, lines[r.id], p.params, summitsData.byRef).stages.filter((st) => st.type === 'walk');
    const mine = routeWalks(r);
    if (!mine.length) {
      notice = (await planRoute(r)) ?? 'Nothing to update.';
    } else if (mine.length !== fresh.length) {
      notice = `This route has ${mine.length} walk stage(s) but the GPX splits into ${fresh.length} (${fresh.map((f) => `${f.label} ${fmtDuration(f.minutes)}`).join(', ')}). Times weren't changed: adjust them by hand.`;
    } else {
      mine.forEach((st, i) => (st.minutes = fresh[i].minutes));
      notice = `Walk times updated using ${p.basis}: ${fresh.map((f) => `${f.label} ${fmtDuration(f.minutes)}`).join(', ')}.`;
    }
  }

  /** "Fill in a typical day": plan every route in order. */
  async function planAll() {
    planning = true;
    try {
      const out = [];
      for (const r of trip.routes) {
        const n = await planRoute(r);
        if (n) out.push(n);
      }
      notice = out.join(' ');
    } finally {
      planning = false;
    }
  }

  /**
   * Copy a route (GPX, parking, summits) from another trip, with its timetable
   * stages. Stages already in this trip are kept: the copied ones go after them,
   * before the drive home.
   */
  async function copyRoute(value) {
    if (!value) return;
    const [tripId, routeId] = value.split('|');
    try {
      const src = await getTrip(tripId);
      const from = src.routes.find((r) => r.id === routeId);
      const tt = trip.timetable;
      // A new trip starts with one empty route: replace it rather than add after it.
      const empty = (x) => !x.gpx && !lines[x.id]?.length && !x.summits.length && !x.hills.length && !x.parking && !x.name;
      if (trip.routes.length === 1 && empty(trip.routes[0])) {
        trip.routes = [];
      } else if (trip.routes.length === 1) {
        // Going from one route to two: link this trip's own stages to its first route.
        linkFirstRoute(trip.routes[0]);
      }
      const prev = trip.routes.at(-1);
      const r = addRoute({
        name: from.name, parking: from.parking ? { ...from.parking } : null,
        summits: [...from.summits], hills: [...from.hills],
      });
      if (from.gpx) {
        const text = await getGpxText(tripId, from.gpx);
        gpxChanges[r.id] = text;
        lines[r.id] = parseGpx(text);
      }
      if (r.parking) parkingText[r.id] = `${r.parking.lat}, ${r.parking.lon}`;

      const theirs = routeStages(src, from.id);
      const copy = (st) => {
        const c = { ...$state.snapshot(st), id: newId() };
        // Labels like "Walk in (route 2)" would point at the wrong route here.
        if (c.label) c.label = c.label.replace(/\s*\(route \d+\)$/, '');
        if (c.type === 'activate') delete c.route; // follows the route holding its summit
        else c.route = r.id;
        return c;
      };
      const copied = theirs.stages.map(copy);
      let added = copied.length, how = '';
      if (!tt.stages.length) {
        // Empty timetable: take their drive there and drive home too.
        const home = src.timetable.stages.at(-1);
        // Their drive there is from home only if this was their first route.
        const fromHome = theirs.drive && src.routes[0]?.id === from.id;
        const there = fromHome ? copy(theirs.drive) : { id: newId(), type: 'drive', label: '', minutes: 60, route: r.id };
        tt.stages.push(there, ...copied);
        added += 1;
        if (home?.type === 'drive' && home !== theirs.drive && !home.route) {
          tt.stages.push({ ...$state.snapshot(home), id: newId() });
          added += 1;
        }
      } else if (copied.length || from.parking) {
        // Add a drive from the last route's parking, then their stages, before the drive home.
        const d = await driveTime(prev?.parking, r.parking, 30);
        const minutes = d.minutes;
        const drive = { id: newId(), type: 'drive', label: '', minutes, route: r.id };
        const last = tt.stages.at(-1);
        const at = last && last.type === 'drive' && !last.route ? tt.stages.length - 1 : tt.stages.length;
        tt.stages.splice(at, 0, drive, ...copied);
        added += 1;
        how = d.how === 'road' ? ` Drive there: ${fmtDuration(minutes)} by road.`
          : d.how === 'guess' ? ` The ${minutes} min drive there is a rough guess: check it with the drive-time links.` : '';
      }
      notice = `Copied "${routeLabel(from, 0, summitsData.byRef)}" from ${src.name}` +
        (added ? `, with ${added} timetable stage${added === 1 ? '' : 's'}.${how}` : '.');
      fitAll();
    } catch (e) {
      error = `Couldn't copy that route: ${e.message}`;
    }
  }

  // ---- summits & hills
  function pick(r, kind, item) {
    if (kind === 'summit' && !r.summits.includes(item.ref)) r.summits.push(item.ref);
    if (kind === 'hill' && !r.hills.includes(item.id)) r.hills.push(item.id);
  }
  function removeFrom(r, kind, key) {
    if (kind === 'summit') r.summits = r.summits.filter((x) => x !== key);
    else r.hills = r.hills.filter((x) => x !== key);
  }
  // Map click: remove it from whichever route has it, else add to the active route.
  function toggleOnMap(kind, key, item) {
    const holder = trip.routes.find((r) => (kind === 'summit' ? r.summits : r.hills).includes(key));
    if (holder) removeFrom(holder, kind, key);
    else if (active) pick(active, kind, item);
  }

  /** Map popup for a summit or hill: research links, and a button to add or remove it. */
  function itemPopup(kind, item) {
    const key = kind === 'summit' ? item.ref : item.id;
    const holder = trip.routes.find((r) => (kind === 'summit' ? r.summits : r.hills).includes(key));
    const routeName = (r) => (multi ? `route ${info.get(r.id)?.number}` : 'the route');
    const div = document.createElement('div');
    if (kind === 'summit') {
      const l = summitLinks(item.ref, item.name);
      div.innerHTML = `<h4><span class="ref">${esc(item.ref)}</span> ${esc(item.name)}</h4>
        <div class="muted">${item.alt} m · ${item.points} pts${item.bonus ? ` (+${item.bonus} winter)` : ''} · ${item.activations} activations</div>
        <div class="row small"><a href="${l.sotlas}" target="_blank" rel="noopener">SOTLAS</a>
          <a href="${l.walkhighlands}" target="_blank" rel="noopener">Search WH</a></div>`;
    } else {
      const l = hillLinks(item);
      div.innerHTML = `<h4>${esc(item.name)}</h4>
        <div class="muted">${esc(item.type)} · ${Math.round(item.alt)} m</div>
        <div class="row small"><a href="${l.hillBagging}" target="_blank" rel="noopener">Hill Bagging</a>
          <a href="${l.walkhighlands}" target="_blank" rel="noopener">Search WH</a></div>`;
    }
    if (holder || active) {
      const b = document.createElement('button');
      b.className = 'small popup-action' + (holder ? ' danger' : ' primary');
      b.textContent = holder ? `Remove from ${routeName(holder)}` : `+ Add to ${routeName(active)}`;
      b.onclick = () => { toggleOnMap(kind, key, item); map.closePopup(); };
      div.append(b);
    }
    return div;
  }

  // ---- GPX
  async function loadGpxFile(r, file) {
    if (!file) return;
    const text = await file.text();
    const parsed = parseGpx(text);
    if (!parsed.length) { error = `${file.name} has no track or route points.`; return; }
    error = '';
    gpxChanges[r.id] = text;
    lines[r.id] = parsed;
    const st = gpxStats(parsed);
    if (!r.parking && st.start) setParking(r, { ...st.start }, 'Start of GPX route');
    const nice = file.name.replace(/\.gpx$/i, '').replace(/[_-]+/g, ' ');
    if (!trip.name) trip.name = nice;
    else if (multi && !r.name) r.name = nice;
    activeId = r.id;
    fitAll();
    planning = true;
    try {
      notice = (await planRoute(r)) ??
        'GPX loaded. The timetable already has stages for this route, so they were kept: use "Re-estimate walk times" to update them.';
    } finally {
      planning = false;
    }
  }
  function removeGpx(r) {
    gpxChanges[r.id] = null;
    lines[r.id] = [];
  }

  // ---- parking
  function setParking(r, p, label) {
    r.parking = { label: r.parking?.label ?? label ?? '', lat: p.lat, lon: p.lon };
    parkingText[r.id] = `${p.lat}, ${p.lon}`;
  }
  function parkingFromText(r) {
    const p = parseLatLon(parkingText[r.id]);
    if (p) setParking(r, p);
    else if (parkingText[r.id]?.trim()) error = 'Couldn\'t read those coordinates. Paste "lat, lon" or a Google Maps link.';
  }
  function parkingFromGpx(r) {
    const st = gpxStats(lines[r.id] ?? []);
    if (st.start) setParking(r, st.start);
  }
  const round6 = (n) => Math.round(n * 1e6) / 1e6;

  // ---- photos
  async function addPhotos(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const dataUrl = await resizeImage(file);
        const name = photoFileName(file.name === 'image.png' ? 'pasted' : file.name);
        newPhotos.push({ file: name, dataUrl });
        trip.photos.push({ file: name, caption: '' });
      } catch (e) {
        error = `Couldn't read ${file.name}: ${e.message}`;
      }
    }
  }
  function removePhoto(i) {
    const [p] = trip.photos.splice(i, 1);
    newPhotos = newPhotos.filter((n) => n.file !== p.file);
  }
  function movePhoto(i, d) {
    const j = i + d;
    if (j < 0 || j >= trip.photos.length) return;
    const [p] = trip.photos.splice(i, 1);
    trip.photos.splice(j, 0, p);
  }
  function onPaste(e) {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addPhotos(files); }
  }
  let dragging = $state(false);
  function onDrop(e) {
    e.preventDefault();
    dragging = false;
    const files = [...(e.dataTransfer?.files ?? [])];
    const gpx = files.find((f) => /\.gpx$/i.test(f.name));
    if (gpx && active) loadGpxFile(active, gpx);
    addPhotos(files.filter((f) => f.type.startsWith('image/')));
  }

  // ---- tags used on other trips, most used first, for autocomplete
  const knownTags = $derived.by(() => {
    const count = new Map();
    for (const t of otherTrips) for (const tag of t.tags ?? []) count.set(tag, (count.get(tag) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, n]) => ({ tag, count: n }));
  });

  // ---- save / delete
  async function save() {
    if (!trip.name.trim()) { error = 'Give the trip a name first.'; return; }
    saving = true;
    error = '';
    try {
      const body = {
        trip: $state.snapshot(trip),
        gpx: $state.snapshot(gpxChanges),
        newPhotos: $state.snapshot(newPhotos).filter((n) => trip.photos.some((p) => p.file === n.file)),
      };
      body.trip.links = body.trip.links.filter((l) => l.url.trim());
      const res = id ? await saveTrip(id, body) : await createTrip(body);
      if ((await getStatus()).mode === 'github') {
        showFlash(`Saved "${trip.name}" to GitHub. The public site updates in a minute or two.`);
      }
      dirty = false;
      location.hash = `#/trip/${encodeURIComponent(res.id)}`;
    } catch (e) {
      error = `Save failed: ${e.message}`;
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!confirm(`Delete "${trip.name}" with all its GPX files and photos? This can't be undone (except through git).`)) return;
    try {
      await deleteTrip(id);
      if ((await getStatus()).mode === 'github') showFlash(`Deleted "${trip.name}" on GitHub.`);
      dirty = false;
      location.hash = '#/';
    } catch (e) {
      error = `Delete failed: ${e.message}`;
    }
  }

  function cancel() {
    if (dirty && !confirm('Discard your changes?')) return;
    dirty = false;
    location.hash = id ? `#/trip/${encodeURIComponent(id)}` : '#/';
  }

  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
  }

  $effect(() => {
    if (!trip) return;
    const snap = JSON.stringify($state.snapshot(trip)) + JSON.stringify(Object.keys(gpxChanges)) + newPhotos.length;
    if (!initial) initial = snap;
    else dirty = snap !== initial;
  });

  function beforeUnload(e) {
    if (dirty) e.preventDefault();
  }

  // ---- map
  async function fitAll(routes = trip?.routes ?? []) {
    if (!map) return;
    await tick(); // let the form re-render first: it can change the map's size
    map.invalidateSize();
    const b = L.latLngBounds([]);
    for (const r of routes) {
      for (const l of lines[r.id] ?? []) for (const p of l) b.extend([p.lat, p.lon]);
      for (const ref of r.summits) { const s = summit(ref); if (s.lat != null) b.extend([s.lat, s.lon]); }
      if (r.parking) b.extend([r.parking.lat, r.parking.lon]);
    }
    if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 14 });
  }

  $effect(() => {
    // Redraw the trip's own layers whenever they change.
    if (!map || !trip) return;
    overlay.clearLayers();
    for (const r of trip.routes) {
      const ri = info.get(r.id);
      if (!ri) continue;
      const isActive = r.id === active?.id;
      if (lines[r.id]?.length) {
        overlay.addLayer(trackLayer(lines[r.id], { color: ri.color, opacity: isActive || !multi ? 0.95 : 0.5, weight: isActive && multi ? 5 : 4 })
          .bindTooltip(multi ? `${ri.number}. ${ri.label}` : ri.label, { sticky: true })
          .on('click', () => (activeId = r.id)));
      }
      for (const ref of r.summits) {
        const s = summit(ref);
        if (s.lat == null) continue;
        overlay.addLayer(summitMarker(s, { planned: true, ring: ri.color })
          .bindTooltip(`${multi ? `${ri.number}: ` : ''}${s.ref} ${s.name}`, { permanent: true, direction: 'right', offset: [8, 0] })
          .bindPopup(() => itemPopup('summit', s)));
      }
      for (const hid of r.hills) {
        const h = hill(hid);
        if (!h) continue;
        overlay.addLayer(hillMarker(h, { selected: true })
          .bindTooltip(`${multi ? `${ri.number}: ` : ''}${h.name}`, { permanent: true, direction: 'right', offset: [6, 0] })
          .bindPopup(() => itemPopup('hill', h)));
      }
      if (r.parking) {
        const m = parkingMarker(r.parking, { draggable: true, label: multi ? `P${ri.number}` : 'P', color: multi ? ri.color : null })
          .bindTooltip(`${multi ? `P${ri.number} · ` : ''}Parking (drag to move)`);
        m.on('dragend', () => {
          const ll = m.getLatLng();
          setParking(r, { lat: round6(ll.lat), lon: round6(ll.lng) });
        });
        overlay.addLayer(m);
      }
    }
  });

  $effect(() => {
    if (mapEl) mapEl.style.cursor = pickParking ? 'crosshair' : '';
  });

  onMount(() => {
    const created = createMap(mapEl);
    overlay = L.layerGroup().addTo(created.map);
    map = created.map;
    sizeSummitsOnZoom(map);
    map.on('click', (e) => {
      if (!pickParking || !active) return;
      setParking(active, { lat: round6(e.latlng.lat), lon: round6(e.latlng.lng) });
      pickParking = false;
    });

    (async () => {
      try {
        let index;
        [summitsData, hillsData, index, pace] = await Promise.all([
          getSummits(), getHills(), getIndex(), getPace().catch(() => ({ walks: [] })),
        ]);
        otherTrips = index.filter((t) => t.id !== id);
        const t = id ? await getTrip(id) : normalizeTrip({ routes: [blankRoute({ summits: startSummit ? [startSummit] : [] })] });
        if (!t.routes.length) t.routes.push(blankRoute());
        const loaded = {}, texts = {};
        for (const r of t.routes) {
          if (r.parking) texts[r.id] = `${r.parking.lat}, ${r.parking.lon}`;
          if (id && r.gpx) loaded[r.id] = parseGpx(await getGpxText(id, r.gpx));
        }
        lines = loaded;
        parkingText = texts;
        activeId = t.routes[0].id;
        trip = t;
      } catch (e) {
        error = `Couldn't load: ${e.message}`;
        return;
      }

      // All summits and other hills, faint, so you can click to add them.
      const background = L.layerGroup();
      for (const s of summitsData.summits) {
        background.addLayer(summitMarker(s)
          .bindTooltip(`${s.ref} ${s.name}`).bindPopup(() => itemPopup('summit', s)));
      }
      for (const h of hillsData.hills) {
        if (h.sota) continue;
        background.addLayer(hillMarker(h).bindTooltip(`${h.name} (${h.type})`)
          .bindPopup(() => itemPopup('hill', h)));
      }
      background.addTo(map);
      created.control.addOverlay(background, 'All summits and hills');
      setTimeout(() => fitAll(), 0);
    })();

    return () => map.remove();
  });
</script>

<svelte:window onkeydown={onKey} onbeforeunload={beforeUnload} />

<div class="page" role="presentation" onpaste={onPaste}
     ondragover={(e) => { e.preventDefault(); dragging = true; }}
     ondragleave={(e) => { if (e.target === e.currentTarget) dragging = false; }}
     ondrop={onDrop}
     class:dragging>
  {#if !trip}
    {#if error}<p class="error">{error}</p>{:else}<p class="muted">Loading…</p>{/if}
  {/if}

  <div class="layout" class:hidden={!trip}>
    <div class="form">
      {#if trip}
        <div class="row head">
          <h1>{id ? 'Edit trip' : 'New trip'}</h1>
          <span class="spacer"></span>
          <button onclick={cancel}>Cancel</button>
          <button class="primary" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
        {#if error}<p class="error">{error}</p>{/if}
        {#if notice}<p class="notice small">{notice} <button class="small icon" onclick={() => (notice = '')}>✕</button></p>{/if}

        <section class="card">
          <label for="name">Trip name</label>
          <input id="name" class="wide" bind:value={trip.name} placeholder="e.g. Ben Lui by bike, then Beinn Dubhchraig" />
          <label for="tags" class="gap">Tags <span class="muted">(comma separated)</span></label>
          <TagInput id="tags" bind:tags={trip.tags} known={knownTags} />
        </section>

        <div class="routes-head row">
          <h2>{multi ? `Routes (${trip.routes.length})` : 'Route'}</h2>
          <span class="spacer"></span>
          <span class="muted small">
            {multi ? 'Each route has its own GPX, parking and hills. Add the drives between them in the timetable.'
                   : 'Driving to more hills the same day? Add another route below.'}
          </span>
        </div>

        {#each trip.routes as r, i (r.id)}
          {@const ri = info.get(r.id)}
          {@const st = statsFor(r)}
          {@const est = estimateFor(r)}
          <section class="card route" class:active={multi && r.id === active?.id} style="--route: {ri?.color}"
                   role="group" onfocusin={() => (activeId = r.id)} onpointerdown={() => (activeId = r.id)}>
            <div class="row route-head">
              {#if multi}<span class="route-badge" style="background:{ri.color}">{ri.number}</span>{/if}
              <input class="grow route-name" bind:value={r.name} aria-label="Route name"
                     placeholder={multi ? `Route name (default: ${ri?.label})` : 'Route name (optional)'} />
              {#if multi}
                <button class="small icon" onclick={() => moveRoute(i, -1)} disabled={i === 0} title="Earlier in the day">↑</button>
                <button class="small icon" onclick={() => moveRoute(i, 1)} disabled={i === trip.routes.length - 1} title="Later in the day">↓</button>
                <button class="small danger" onclick={() => removeRoute(r)}>Remove</button>
              {/if}
            </div>
            {#if multi && r.id === active?.id}
              <p class="muted small active-note">Map clicks add summits and set parking for this route.</p>
            {/if}

            <h3>Summits and hills</h3>
            <SummitPicker summits={summitsData.summits} hills={hillsData.hills} onpick={(kind, item) => pick(r, kind, item)} />
            <div class="chips">
              {#each r.summits as ref}
                {@const s = summit(ref)}
                {@const l = summitLinks(s.ref, s.name)}
                <span class="chip summit"><span class="ref">{s.ref}</span> {s.name}
                  <a class="chip-link" href={l.sotlas} target="_blank" rel="noopener" title="Open on SOTLAS">SOTLAS</a>
                  <a class="chip-link" href={l.walkhighlands} target="_blank" rel="noopener" title="Search Walkhighlands">WH</a>
                  <button class="small icon" onclick={() => removeFrom(r, 'summit', ref)} aria-label="Remove">✕</button></span>
              {/each}
              {#each r.hills as hid}
                {@const h = hill(hid)}
                <span class="chip hill">{h?.name ?? hid} <span class="muted">{h?.type}</span>
                  {#if h}<a class="chip-link" href={hillLinks(h).walkhighlands} target="_blank" rel="noopener" title="Search Walkhighlands">WH</a>{/if}
                  <button class="small icon" onclick={() => removeFrom(r, 'hill', hid)} aria-label="Remove">✕</button></span>
              {/each}
              {#if !r.summits.length && !r.hills.length}<span class="muted small">None yet. Search above, or click them on the map.</span>{/if}
            </div>
            {#if suggestions[r.id]?.length}
              <div class="suggest small">
                <span class="muted">On this GPX track:</span>
                {#each suggestions[r.id] as sg}
                  <button class="small" onclick={() => pick(r, sg.kind, sg.item)}>
                    + {sg.kind === 'summit' ? sg.item.ref + ' ' : ''}{sg.item.name}{sg.kind === 'hill' ? ` (${sg.item.type})` : ''}
                  </button>
                {/each}
              </div>
            {/if}

            <h3>GPX</h3>
            {#if lines[r.id]?.length && st}
              <p class="tabular stat">{st.distanceKm} km · {st.ascentM} m ascent · high point {st.maxEleM ?? '?'} m</p>
            {:else}
              <p class="muted small stat">No GPX yet. Export one from plotaroute{multi ? '' : ' and drop it here'}: the timetable fills itself in.</p>
            {/if}
            <div class="row small terrain">
              <label for="terrain-{r.id}" class="inline">Terrain</label>
              <select id="terrain-{r.id}" value={r.terrain ?? DEFAULT_TERRAIN} onchange={(e) => (r.terrain = e.currentTarget.value)}>
                {#each Object.entries(TERRAINS) as [key, label]}<option value={key}>{label}</option>{/each}
              </select>
              {#if est}<span>Walking about <strong>{fmtDuration(est.minutes)}</strong> <span class="muted">({est.basis})</span></span>{/if}
              {#if lines[r.id]?.length}
                <button class="small" onclick={() => reestimate(r)} title="Work out this route's walk stages again from the GPX and your pace">Re-estimate walk times</button>
              {/if}
            </div>
            <div class="row">
              <label class="button file small">
                {lines[r.id]?.length ? 'Replace GPX…' : 'Choose GPX…'}
                <input type="file" accept=".gpx,application/gpx+xml" onchange={(e) => loadGpxFile(r, e.currentTarget.files[0])} />
              </label>
              {#if lines[r.id]?.length}<button class="small danger" onclick={() => removeGpx(r)}>Remove GPX</button>{/if}
            </div>

            <h3>{multi ? `Parking P${ri.number}` : 'Parking'}</h3>
            <div class="row">
              <input class="grow tabular" bind:value={parkingText[r.id]} onchange={() => parkingFromText(r)}
                     placeholder='Paste "lat, lon" or a Google Maps link' aria-label="Parking coordinates" />
              <button class="small" class:primary={pickParking && r.id === active?.id}
                      onclick={() => { activeId = r.id; pickParking = !pickParking; }}>
                {pickParking && r.id === active?.id ? 'Click the map…' : 'Pick on map'}
              </button>
              {#if lines[r.id]?.length}<button class="small" onclick={() => parkingFromGpx(r)}>Use GPX start</button>{/if}
              {#if r.parking}
                <a class="button small" href={googleMapsPlaceUrl(r.parking)} target="_blank" rel="noopener"
                   title="Open this spot in Google Maps in a new tab">Google Maps</a>
              {/if}
              {#if r.parking}<button class="small danger" onclick={() => { r.parking = null; parkingText[r.id] = ''; }}>Clear</button>{/if}
            </div>
            {#if r.parking}
              <input class="wide park-label" placeholder="Description, e.g. layby on A82, room for 4 cars" bind:value={r.parking.label} aria-label="Parking description" />
            {/if}
          </section>
        {/each}

        <div class="row add-route">
          <button onclick={() => addRoute()}>+ Add another route</button>
          {#if otherTrips.some((t) => t.routes.length)}
            <select onchange={(e) => { copyRoute(e.currentTarget.value); e.currentTarget.value = ''; }} aria-label="Copy a route from another trip">
              <option value="">Copy a route from another trip…</option>
              {#each otherTrips as t (t.id)}
                <optgroup label={t.name}>
                  {#each t.routes as r, i (r.id)}
                    <option value="{t.id}|{r.id}">{routeLabel(r, i, summitsData.byRef)}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
          {/if}
        </div>

        <section class="card">
          <h2>Timetable</h2>
          <TimetableEditor timetable={trip.timetable} {trip} routes={info} summitsByRef={summitsData.byRef} {statsFor}
                           {estimateFor} onfill={planAll} {planning} />
          {#if trip.timetable.stages.length}
            <details>
              <summary class="small">Preview</summary>
              <Timetable timetable={trip.timetable} summitsByRef={summitsData.byRef} adjustable={false} {trip} routes={info} />
            </details>
          {/if}
        </section>

        <section class="card">
          <h2>Notes</h2>
          <textarea rows="6" bind:value={trip.notes} placeholder="Access, river crossings, bike parking, where to set up…"></textarea>
        </section>

        <section class="card">
          <h2>Links</h2>
          {#each trip.links as link, i}
            <div class="row link">
              <input placeholder="Label" bind:value={link.label} />
              <input class="grow" placeholder="https://www.plotaroute.com/route/…" bind:value={link.url} />
              <button class="small icon danger" onclick={() => trip.links.splice(i, 1)} aria-label="Remove link">✕</button>
            </div>
          {/each}
          <button class="small" onclick={() => trip.links.push({ label: '', url: '' })}>+ Add link</button>
        </section>

        <section class="card">
          <h2>Photos</h2>
          <p class="muted small">Choose files, drop them anywhere on this page, or paste a screenshot (Ctrl+V). They're resized to 1600 px.</p>
          <label class="button file">
            Add photos…
            <input type="file" accept="image/*" multiple onchange={(e) => addPhotos([...e.currentTarget.files])} />
          </label>
          <div class="photos">
            {#each photoList as p, i (p.file)}
              <div class="photo">
                <img src={p.src} alt="" />
                <input placeholder="Caption" bind:value={trip.photos[i].caption} />
                <div class="row">
                  <button class="small icon" onclick={() => movePhoto(i, -1)} disabled={i === 0} aria-label="Move earlier">←</button>
                  <button class="small icon" onclick={() => movePhoto(i, 1)} disabled={i === photoList.length - 1} aria-label="Move later">→</button>
                  <span class="spacer"></span>
                  <button class="small danger" onclick={() => removePhoto(i)}>Remove</button>
                </div>
              </div>
            {/each}
          </div>
        </section>

        <div class="row foot">
          {#if id}<button class="danger" onclick={remove}>Delete trip</button>{/if}
          <span class="spacer"></span>
          <button onclick={cancel}>Cancel</button>
          <button class="primary" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      {/if}
    </div>

    <div class="side">
      <div class="map" bind:this={mapEl}></div>
      {#if trip && multi}
        <div class="legend small">
          <button class="legend-item" onclick={() => fitAll()}>All routes</button>
          {#each trip.routes as r (r.id)}
            {@const ri = info.get(r.id)}
            <button class="legend-item" class:active={r.id === active?.id}
                    onclick={() => { activeId = r.id; fitAll([r]); }}>
              <span class="route-badge" style="background:{ri.color}">{ri.number}</span>{ri.label}
            </button>
          {/each}
        </div>
      {/if}
      {#if pickParking}<p class="small">Click the map to set the parking spot{multi ? ` for route ${info.get(active?.id)?.number}` : ''}.</p>{/if}
    </div>
  </div>
</div>

<style>
  .page { padding: 1rem; max-width: 1500px; margin: 0 auto; min-height: 100%; }
  .page.dragging { outline: 3px dashed var(--accent); outline-offset: -6px; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1.2rem; align-items: start; }
  .layout.hidden { visibility: hidden; }
  .form { display: flex; flex-direction: column; gap: 0.8rem; }
  .head h1 { margin: 0; }
  .side { position: sticky; top: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .map { height: calc(100vh - 9rem); min-height: 360px; border-radius: var(--radius); border: 1px solid var(--line); }
  .wide { width: 100%; }
  .grow { flex: 1; }
  .gap { margin-top: 0.6rem; }
  .spacer { flex: 1; }
  .notice { background: var(--soft); padding: 0.4rem 0.6rem; border-radius: 6px; margin: 0; }
  .routes-head h2 { margin: 0.4rem 0 0; }
  .route { display: flex; flex-direction: column; gap: 0.45rem; border-left: 5px solid var(--route); }
  .route.active { box-shadow: 0 0 0 2px color-mix(in srgb, var(--route) 45%, transparent); }
  .route h3 { margin: 0.5rem 0 0; }
  .route-name { font-weight: 600; }
  .active-note { margin: 0; }
  .stat { margin: 0; }
  .park-label { margin-top: 0.2rem; }
  .terrain { margin: 0.3rem 0 0.5rem; }
  label.inline { display: inline; margin: 0; }
  .chip-link { font-size: 0.75em; margin-left: 0.15em; text-decoration: none; }
  .chip-link:hover { text-decoration: underline; }
  :global(.leaflet-popup-content .popup-action) { margin-top: 0.4em; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chip button { border: 0; background: none; padding: 0 0.2em; }
  .suggest { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
  .file input { display: none; }
  .add-route select { max-width: 22em; }
  .link { margin-bottom: 0.35rem; }
  .photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.6rem; margin-top: 0.6rem; }
  .photo { display: flex; flex-direction: column; gap: 0.3rem; }
  .photo img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; }
  details { margin-top: 0.8rem; }
  summary { cursor: pointer; color: var(--muted); margin-bottom: 0.5rem; }
  .foot { padding-bottom: 2rem; }
  .legend { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .legend-item { gap: 0.4em; font-size: 0.85rem; }
  .legend-item.active { border-color: var(--text); }
  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
    .side { position: static; order: -1; }
    .map { height: 50vh; }
  }
</style>
