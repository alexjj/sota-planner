<script>
  import { onMount } from 'svelte';
  import L from 'leaflet';
  import { createMap, summitMarker, hillMarker, parkingMarker, trackLayer } from '../lib/map.js';
  import {
    getSummits, getHills, getRoute, getGpxText, photoUrl, parseLatLon,
    createRoute, saveRoute, deleteRoute,
  } from '../lib/store.js';
  import { parseGpx, gpxStats, distanceM } from '../lib/gpx.js';
  import { resizeImage, photoFileName } from '../lib/image.js';
  import SummitPicker from '../components/SummitPicker.svelte';
  import TimetableEditor from '../components/TimetableEditor.svelte';
  import Timetable from '../components/Timetable.svelte';

  // id = existing route; summit = pre-select a summit for a new one.
  let { id = null, summit = null } = $props();

  let route = $state(null);
  let summitsData = $state(null);
  let hillsData = $state(null);
  let lines = $state([]);          // GPX preview
  let gpxText = $state(undefined); // undefined = unchanged, string = new, null = removed
  let newPhotos = $state([]);      // [{ file, dataUrl }]
  let error = $state('');
  let saving = $state(false);
  let pickParking = $state(false);
  let parkingText = $state('');
  let dirty = $state(false);
  let initial = '';
  let mapEl;
  let map = $state.raw(null);
  let overlay;

  const stats = $derived(gpxText === undefined ? route?.stats : lines.length ? gpxStats(lines) : null);
  const selectedSummits = $derived((route?.summits ?? []).map((ref) => summitsData?.byRef.get(ref) ?? { ref, name: '?' }));
  const selectedHills = $derived((route?.hills ?? []).map((h) => hillsData?.byId.get(h)).filter(Boolean));

  // Summits and hills close to the GPX track that aren't on the route yet.
  const suggestions = $derived.by(() => {
    if (!lines.length || !summitsData || !hillsData || !route) return [];
    const pts = lines.flat();
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const p of pts) {
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
    }
    const nearTrack = (o) => {
      if (o.lat < minLat - 0.01 || o.lat > maxLat + 0.01 || o.lon < minLon - 0.02 || o.lon > maxLon + 0.02) return false;
      return pts.some((p) => distanceM(p, o) < 150);
    };
    const out = [];
    for (const s of summitsData.summits) {
      if (!route.summits.includes(s.ref) && nearTrack(s)) out.push({ kind: 'summit', item: s });
    }
    for (const h of hillsData.hills) {
      if (!h.sota && !route.hills.includes(h.id) && nearTrack(h)) out.push({ kind: 'hill', item: h });
    }
    return out;
  });

  const photoList = $derived((route?.photos ?? []).map((p) => ({
    ...p,
    src: newPhotos.find((n) => n.file === p.file)?.dataUrl ?? photoUrl(route.id ?? id, p.file),
  })));

  function blankRoute() {
    return {
      name: '', tags: [], notes: '',
      summits: summit ? [summit] : [], hills: [],
      parking: null, gpx: null, stats: null,
      timetable: { start: '07:00', stages: [] },
      photos: [], links: [],
    };
  }

  // ---- summits & hills
  function pick(kind, item) {
    if (kind === 'summit' && !route.summits.includes(item.ref)) route.summits.push(item.ref);
    if (kind === 'hill' && !route.hills.includes(item.id)) route.hills.push(item.id);
  }
  function toggleSummit(ref) {
    const i = route.summits.indexOf(ref);
    if (i >= 0) route.summits.splice(i, 1); else route.summits.push(ref);
  }
  function toggleHill(hid) {
    const i = route.hills.indexOf(hid);
    if (i >= 0) route.hills.splice(i, 1); else route.hills.push(hid);
  }

  // ---- GPX
  async function loadGpxFile(file) {
    if (!file) return;
    const text = await file.text();
    const parsed = parseGpx(text);
    if (!parsed.length) { error = `${file.name} has no track or route points.`; return; }
    error = '';
    gpxText = text;
    lines = parsed;
    const st = gpxStats(parsed);
    if (!route.parking && st.start) {
      route.parking = { ...st.start, label: 'Start of GPX route' };
      parkingText = `${st.start.lat}, ${st.start.lon}`;
    }
    if (!route.name) route.name = file.name.replace(/\.gpx$/i, '').replace(/[_-]+/g, ' ');
    fitAll();
  }
  function removeGpx() {
    gpxText = null;
    lines = [];
  }

  // ---- parking
  function setParking(p) {
    route.parking = { ...(route.parking ?? { label: '' }), lat: p.lat, lon: p.lon };
    parkingText = `${p.lat}, ${p.lon}`;
  }
  function parkingFromText() {
    const p = parseLatLon(parkingText);
    if (p) setParking(p);
    else if (parkingText.trim()) error = 'Couldn\'t read those coordinates. Paste "lat, lon" or a Google Maps link.';
  }
  function parkingFromGpx() {
    const st = gpxStats(lines);
    if (st.start) setParking(st.start);
  }

  // ---- photos
  async function addPhotos(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const dataUrl = await resizeImage(file);
        const name = photoFileName(file.name === 'image.png' ? 'pasted' : file.name);
        newPhotos.push({ file: name, dataUrl });
        route.photos.push({ file: name, caption: '' });
      } catch (e) {
        error = `Couldn't read ${file.name}: ${e.message}`;
      }
    }
  }
  function removePhoto(i) {
    const [p] = route.photos.splice(i, 1);
    newPhotos = newPhotos.filter((n) => n.file !== p.file);
  }
  function movePhoto(i, d) {
    const j = i + d;
    if (j < 0 || j >= route.photos.length) return;
    const [p] = route.photos.splice(i, 1);
    route.photos.splice(j, 0, p);
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
    if (gpx) loadGpxFile(gpx);
    addPhotos(files.filter((f) => f.type.startsWith('image/')));
  }

  // ---- links & tags
  let tagsText = $state('');
  $effect(() => {
    if (!route) return;
    route.tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean);
  });

  // ---- save / delete
  async function save() {
    if (!route.name.trim()) { error = 'Give the route a name first.'; return; }
    saving = true;
    error = '';
    try {
      const body = {
        route: $state.snapshot(route),
        newPhotos: $state.snapshot(newPhotos).filter((n) => route.photos.some((p) => p.file === n.file)),
      };
      body.route.links = body.route.links.filter((l) => l.url.trim());
      if (gpxText !== undefined) body.gpx = gpxText;
      const res = id ? await saveRoute(id, body) : await createRoute(body);
      dirty = false;
      location.hash = `#/route/${encodeURIComponent(res.id)}`;
    } catch (e) {
      error = `Save failed: ${e.message}`;
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!confirm(`Delete "${route.name}" and its GPX and photos? This can't be undone (except through git).`)) return;
    try {
      await deleteRoute(id);
      dirty = false;
      location.hash = '#/';
    } catch (e) {
      error = `Delete failed: ${e.message}`;
    }
  }

  function cancel() {
    if (dirty && !confirm('Discard your changes?')) return;
    dirty = false;
    location.hash = id ? `#/route/${encodeURIComponent(id)}` : '#/';
  }

  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
  }

  $effect(() => {
    if (!route) return;
    const snap = JSON.stringify($state.snapshot(route)) + String(gpxText?.length) + newPhotos.length;
    if (!initial) initial = snap;
    else dirty = snap !== initial;
  });

  function beforeUnload(e) {
    if (dirty) e.preventDefault();
  }

  // ---- map
  function fitAll() {
    if (!map) return;
    const b = L.latLngBounds([]);
    for (const l of lines) for (const p of l) b.extend([p.lat, p.lon]);
    for (const s of selectedSummits) if (s.lat != null) b.extend([s.lat, s.lon]);
    if (route?.parking) b.extend([route.parking.lat, route.parking.lon]);
    if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 14 });
  }

  $effect(() => {
    // Redraw the route's own layers whenever they change.
    if (!map || !route) return;
    overlay.clearLayers();
    if (lines.length) overlay.addLayer(trackLayer(lines));
    for (const s of selectedSummits) {
      if (s.lat == null) continue;
      overlay.addLayer(summitMarker(s, { selected: true })
        .bindTooltip(`${s.ref} ${s.name}`, { permanent: true, direction: 'right', offset: [8, 0] })
        .on('click', () => toggleSummit(s.ref)));
    }
    for (const h of selectedHills) {
      overlay.addLayer(hillMarker(h, { selected: true })
        .bindTooltip(h.name, { permanent: true, direction: 'right', offset: [6, 0] })
        .on('click', () => toggleHill(h.id)));
    }
    if (route.parking) {
      const m = parkingMarker(route.parking, { draggable: true })
        .bindTooltip('Parking (drag to move)');
      m.on('dragend', () => {
        const ll = m.getLatLng();
        setParking({ lat: Math.round(ll.lat * 1e6) / 1e6, lon: Math.round(ll.lng * 1e6) / 1e6 });
      });
      overlay.addLayer(m);
    }
  });

  $effect(() => {
    if (!mapEl) return;
    mapEl.style.cursor = pickParking ? 'crosshair' : '';
  });

  onMount(() => {
    const created = createMap(mapEl);
    overlay = L.layerGroup().addTo(created.map);
    map = created.map;
    map.on('click', (e) => {
      if (!pickParking) return;
      setParking({ lat: Math.round(e.latlng.lat * 1e6) / 1e6, lon: Math.round(e.latlng.lng * 1e6) / 1e6 });
      pickParking = false;
    });

    (async () => {
      try {
        [summitsData, hillsData] = await Promise.all([getSummits(), getHills()]);
        const r = id ? await getRoute(id) : blankRoute();
        r.tags ??= []; r.hills ??= []; r.photos ??= []; r.links ??= [];
        r.timetable ??= { start: '07:00', stages: [] };
        r.timetable.stages ??= [];
        tagsText = r.tags.join(', ');
        parkingText = r.parking ? `${r.parking.lat}, ${r.parking.lon}` : '';
        if (id && r.gpx) lines = parseGpx(await getGpxText(id, r.gpx));
        route = r;
      } catch (e) {
        error = `Couldn't load: ${e.message}`;
        return;
      }

      // All summits and other hills, faint, so you can click to add them.
      const background = L.layerGroup();
      for (const s of summitsData.summits) {
        background.addLayer(summitMarker(s).setStyle({ fillOpacity: 0.55 })
          .bindTooltip(`${s.ref} ${s.name} · click to add`).on('click', () => toggleSummit(s.ref)));
      }
      for (const h of hillsData.hills) {
        if (h.sota) continue;
        background.addLayer(hillMarker(h).bindTooltip(`${h.name} (${h.type}) · click to add`)
          .on('click', () => toggleHill(h.id)));
      }
      background.addTo(map);
      created.control.addOverlay(background, 'All summits and hills');
      overlay.bringToFront?.();
      setTimeout(fitAll, 0);
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
  {#if !route}
    {#if error}<p class="error">{error}</p>{:else}<p class="muted">Loading…</p>{/if}
  {/if}

  <div class="layout" class:hidden={!route}>
    <div class="form">
      {#if route}
        <div class="row head">
          <h1>{id ? 'Edit route' : 'New route'}</h1>
          <span class="spacer"></span>
          <button onclick={cancel}>Cancel</button>
          <button class="primary" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
        {#if error}<p class="error">{error}</p>{/if}

        <section class="card">
          <label for="name">Name</label>
          <input id="name" class="wide" bind:value={route.name} placeholder="e.g. Ben Lui from Dalrigh by bike" />
          <label for="tags" class="gap">Tags <span class="muted">(comma separated)</span></label>
          <input id="tags" class="wide" bind:value={tagsText} placeholder="winter, bike, long day" />
        </section>

        <section class="card">
          <h2>Summits and hills</h2>
          <SummitPicker summits={summitsData.summits} hills={hillsData.hills} onpick={pick} />
          <p class="muted small">Or click markers on the map to add or remove them.</p>
          <div class="chips">
            {#each selectedSummits as s}
              <span class="chip summit"><span class="ref">{s.ref}</span> {s.name}
                <button class="small icon" onclick={() => toggleSummit(s.ref)} aria-label="Remove">✕</button></span>
            {/each}
            {#each selectedHills as h}
              <span class="chip hill">{h.name} <span class="muted">{h.type}</span>
                <button class="small icon" onclick={() => toggleHill(h.id)} aria-label="Remove">✕</button></span>
            {/each}
          </div>
          {#if suggestions.length}
            <div class="suggest small">
              <span class="muted">On the GPX track:</span>
              {#each suggestions as sg}
                <button class="small" onclick={() => pick(sg.kind, sg.item)}>
                  + {sg.kind === 'summit' ? sg.item.ref + ' ' : ''}{sg.item.name}{sg.kind === 'hill' ? ` (${sg.item.type})` : ''}
                </button>
              {/each}
            </div>
          {/if}
        </section>

        <section class="card">
          <h2>GPX route</h2>
          {#if lines.length && stats}
            <p class="tabular">{stats.distanceKm} km · {stats.ascentM} m ascent · high point {stats.maxEleM ?? '?'} m</p>
          {:else}
            <p class="muted">No GPX yet. Export one from plotaroute and drop it here.</p>
          {/if}
          <div class="row">
            <label class="button file">
              {lines.length ? 'Replace GPX…' : 'Choose GPX…'}
              <input type="file" accept=".gpx,application/gpx+xml" onchange={(e) => loadGpxFile(e.currentTarget.files[0])} />
            </label>
            {#if lines.length}<button class="danger" onclick={removeGpx}>Remove GPX</button>{/if}
          </div>
        </section>

        <section class="card">
          <h2>Parking</h2>
          <label for="plabel">Description</label>
          <input id="plabel" class="wide" placeholder="e.g. Layby on A82 north of Tyndrum, room for 4 cars"
                 value={route.parking?.label ?? ''}
                 oninput={(e) => { route.parking ? (route.parking.label = e.currentTarget.value) : null; }}
                 disabled={!route.parking} />
          <label for="pcoords" class="gap">Coordinates <span class="muted">(paste "lat, lon" or a Google Maps link)</span></label>
          <div class="row">
            <input id="pcoords" class="grow tabular" bind:value={parkingText} onchange={parkingFromText} placeholder="56.4321, -4.7123" />
            <button class:primary={pickParking} onclick={() => (pickParking = !pickParking)}>
              {pickParking ? 'Click the map…' : 'Pick on map'}
            </button>
            {#if lines.length}<button onclick={parkingFromGpx}>Use GPX start</button>{/if}
            {#if route.parking}<button class="danger" onclick={() => { route.parking = null; parkingText = ''; }}>Clear</button>{/if}
          </div>
        </section>

        <section class="card">
          <h2>Timetable</h2>
          <TimetableEditor timetable={route.timetable} summits={selectedSummits} {stats} parking={route.parking} />
          {#if route.timetable.stages.length}
            <details>
              <summary class="small">Preview</summary>
              <Timetable timetable={route.timetable} summitsByRef={summitsData.byRef} adjustable={false} />
            </details>
          {/if}
        </section>

        <section class="card">
          <h2>Notes</h2>
          <textarea rows="6" bind:value={route.notes} placeholder="Access, river crossings, bike parking, where to set up…"></textarea>
        </section>

        <section class="card">
          <h2>Links</h2>
          {#each route.links as link, i}
            <div class="row link">
              <input placeholder="Label" bind:value={link.label} />
              <input class="grow" placeholder="https://www.plotaroute.com/route/…" bind:value={link.url} />
              <button class="small icon danger" onclick={() => route.links.splice(i, 1)} aria-label="Remove link">✕</button>
            </div>
          {/each}
          <button class="small" onclick={() => route.links.push({ label: '', url: '' })}>+ Add link</button>
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
                <input placeholder="Caption" bind:value={route.photos[i].caption} />
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
          {#if id}<button class="danger" onclick={remove}>Delete route</button>{/if}
          <span class="spacer"></span>
          <button onclick={cancel}>Cancel</button>
          <button class="primary" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      {/if}
    </div>

    <div class="side">
      <div class="map" bind:this={mapEl}></div>
      {#if pickParking}<p class="small">Click the map to set the parking spot.</p>{/if}
    </div>
  </div>
</div>

<style>
  .page { padding: 1rem; max-width: 1500px; margin: 0 auto; min-height: 100%; }
  .page.dragging { outline: 3px dashed var(--accent); outline-offset: -6px; }
  .layout { display: grid; grid-template-columns: minmax(380px, 1fr) minmax(0, 1fr); gap: 1.2rem; align-items: start; }
  .layout.hidden { visibility: hidden; }
  .form { display: flex; flex-direction: column; gap: 0.8rem; }
  .head h1 { margin: 0; }
  .side { position: sticky; top: 0; }
  .map { height: calc(100vh - 7rem); min-height: 360px; border-radius: var(--radius); border: 1px solid var(--line); }
  .wide { width: 100%; }
  .grow { flex: 1; }
  .gap { margin-top: 0.6rem; }
  .spacer { flex: 1; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chip button { border: 0; background: none; padding: 0 0.2em; }
  .suggest { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; margin-top: 0.6rem; }
  .file input { display: none; }
  .link { margin-bottom: 0.35rem; }
  .photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.6rem; margin-top: 0.6rem; }
  .photo { display: flex; flex-direction: column; gap: 0.3rem; }
  .photo img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; }
  details { margin-top: 0.8rem; }
  summary { cursor: pointer; color: var(--muted); margin-bottom: 0.5rem; }
  .foot { padding-bottom: 2rem; }
  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
    .side { position: static; order: -1; }
    .map { height: 50vh; }
  }
</style>
