<script>
  import { onMount, tick } from 'svelte';
  import L from 'leaflet';
  import { createMap, summitMarker, hillMarker, parkingMarker, trackLayer } from '../lib/map.js';
  import {
    getSummits, getHills, getTrip, getIndex, getGpxText, photoUrl, parseLatLon,
    createTrip, saveTrip, deleteTrip, getStatus,
  } from '../lib/store.js';
  import { showFlash } from '../lib/flash.svelte.js';
  import { parseGpx, gpxStats, distanceM } from '../lib/gpx.js';
  import { resizeImage, photoFileName } from '../lib/image.js';
  import { normalizeTrip, blankRoute, routeInfo, routeLabel, stageRouteId, newId } from '../lib/trip.js';
  import SummitPicker from '../components/SummitPicker.svelte';
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

  /** Copy a route (GPX, parking, summits and its timetable stages) from another trip. */
  async function copyRoute(value) {
    if (!value) return;
    const [tripId, routeId] = value.split('|');
    try {
      const src = await getTrip(tripId);
      const from = src.routes.find((r) => r.id === routeId);
      // A new trip starts with one empty route: replace it rather than add after it.
      const empty = (x) => !x.gpx && !lines[x.id]?.length && !x.summits.length && !x.hills.length && !x.parking && !x.name;
      if (trip.routes.length === 1 && empty(trip.routes[0])) trip.routes = [];
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
      const stages = src.timetable.stages
        .filter((s) => stageRouteId(s, src) === from.id && s.type !== 'drive')
        .map((s) => ({ ...s, id: newId(), ...(s.route ? { route: r.id } : {}) }));
      if (stages.length) {
        const drive = { id: newId(), type: 'drive', label: '', minutes: 30, route: r.id };
        // Put it before the final drive home, if there is one.
        const last = trip.timetable.stages.at(-1);
        const at = last && last.type === 'drive' && !last.route ? trip.timetable.stages.length - 1 : trip.timetable.stages.length;
        trip.timetable.stages.splice(at, 0, drive, ...stages);
      }
      notice = `Copied "${routeLabel(from, 0, summitsData.byRef)}" from ${src.name}${stages.length ? `, with ${stages.length} timetable stages and a drive to it` : ''}.`;
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

  // ---- tags
  let tagsText = $state('');
  $effect(() => {
    if (!trip) return;
    trip.tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean);
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
        overlay.addLayer(summitMarker(s, { selected: true })
          .bindTooltip(`${multi ? `${ri.number}: ` : ''}${s.ref} ${s.name}`, { permanent: true, direction: 'right', offset: [8, 0] })
          .on('click', () => toggleOnMap('summit', ref)));
      }
      for (const hid of r.hills) {
        const h = hill(hid);
        if (!h) continue;
        overlay.addLayer(hillMarker(h, { selected: true })
          .bindTooltip(`${multi ? `${ri.number}: ` : ''}${h.name}`, { permanent: true, direction: 'right', offset: [6, 0] })
          .on('click', () => toggleOnMap('hill', hid)));
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
    map.on('click', (e) => {
      if (!pickParking || !active) return;
      setParking(active, { lat: round6(e.latlng.lat), lon: round6(e.latlng.lng) });
      pickParking = false;
    });

    (async () => {
      try {
        let index;
        [summitsData, hillsData, index] = await Promise.all([getSummits(), getHills(), getIndex()]);
        otherTrips = index.filter((t) => t.id !== id);
        const t = id ? await getTrip(id) : normalizeTrip({ routes: [blankRoute({ summits: startSummit ? [startSummit] : [] })] });
        if (!t.routes.length) t.routes.push(blankRoute());
        tagsText = t.tags.join(', ');
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
        background.addLayer(summitMarker(s).setStyle({ fillOpacity: 0.55 })
          .bindTooltip(`${s.ref} ${s.name} · click to add`).on('click', () => toggleOnMap('summit', s.ref, s)));
      }
      for (const h of hillsData.hills) {
        if (h.sota) continue;
        background.addLayer(hillMarker(h).bindTooltip(`${h.name} (${h.type}) · click to add`)
          .on('click', () => toggleOnMap('hill', h.id, h)));
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
          <input id="tags" class="wide" bind:value={tagsText} placeholder="winter, bike, long day" />
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
                <span class="chip summit"><span class="ref">{s.ref}</span> {s.name}
                  <button class="small icon" onclick={() => removeFrom(r, 'summit', ref)} aria-label="Remove">✕</button></span>
              {/each}
              {#each r.hills as hid}
                {@const h = hill(hid)}
                <span class="chip hill">{h?.name ?? hid} <span class="muted">{h?.type}</span>
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
              <p class="muted small stat">No GPX yet. Export one from plotaroute{multi ? '' : ' and drop it here'}.</p>
            {/if}
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
          <TimetableEditor timetable={trip.timetable} {trip} routes={info} summitsByRef={summitsData.byRef} {statsFor} />
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
