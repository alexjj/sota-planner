<script>
  import { onMount } from 'svelte';
  import L from 'leaflet';
  import { createMap, summitMarker, hillMarker, parkingMarker, trackLayer, esc, summitLinks } from '../lib/map.js';
  import { getSummits, getHills, getRoute, getGpxText, photoUrl, googleMapsUrl } from '../lib/store.js';
  import { parseGpx, naismithMinutes } from '../lib/gpx.js';
  import { fmtDuration } from '../lib/time.js';
  import Timetable from '../components/Timetable.svelte';
  import Photos from '../components/Photos.svelte';
  import ElevationProfile from '../components/ElevationProfile.svelte';

  let { id, edit = false } = $props();

  let mapEl;
  let route = $state(null);
  let summitsData = $state(null);
  let hillsData = $state(null);
  let lines = $state([]);
  let error = $state('');
  let copied = $state(false);

  const summits = $derived((route?.summits ?? []).map((ref) => summitsData?.byRef.get(ref) ?? { ref, name: '?' }));
  const hills = $derived((route?.hills ?? []).map((hid) => hillsData?.byId.get(hid)).filter(Boolean));
  const photos = $derived((route?.photos ?? []).map((p) => ({ src: photoUrl(id, p.file), caption: p.caption })));

  async function copyParking() {
    const p = route.parking;
    await navigator.clipboard.writeText(`${p.lat}, ${p.lon}`);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  onMount(() => {
    const { map } = createMap(mapEl);
    (async () => {
      try {
        [route, summitsData, hillsData] = await Promise.all([getRoute(id), getSummits(), getHills()]);
        if (route.gpx) lines = parseGpx(await getGpxText(id, route.gpx));
      } catch (e) {
        error = `Couldn't load this route (${e.message}).`;
        return;
      }
      const bounds = L.latLngBounds([]);
      if (lines.length) {
        const t = trackLayer(lines).addTo(map);
        bounds.extend(t.getBounds());
      }
      for (const s of summits) {
        if (s.lat == null) continue;
        const links = summitLinks(s.ref);
        summitMarker(s, { selected: true }).addTo(map)
          .bindTooltip(`${s.ref} ${s.name}`, { permanent: true, direction: 'right', offset: [8, 0] })
          .bindPopup(`<h4><span class="ref">${esc(s.ref)}</span> ${esc(s.name)}</h4>
            <div class="muted">${s.alt} m · ${s.points} pts</div>
            <a href="${links.sotlas}" target="_blank" rel="noopener">SOTLAS</a>`);
        bounds.extend([s.lat, s.lon]);
      }
      for (const h of hills) {
        hillMarker(h, { selected: true }).addTo(map).bindTooltip(`${h.name} (${h.type})`);
        bounds.extend([h.lat, h.lon]);
      }
      if (route.parking) {
        parkingMarker(route.parking).addTo(map).bindTooltip(route.parking.label || 'Parking');
        bounds.extend([route.parking.lat, route.parking.lon]);
      }
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    })();
    return () => map.remove();
  });
</script>

<div class="page">
  {#if error}
    <p class="error">{error} <a href="#/">Back to the map</a></p>
  {:else if !route}
    <p class="muted">Loading…</p>
  {/if}

  <div class="layout" class:hidden={!route}>
    <div class="info">
      {#if route}
        <div class="title row">
          <h1>{route.name}</h1>
          <span class="spacer"></span>
          {#if edit}<a class="button" href="#/route/{encodeURIComponent(id)}/edit">Edit</a>{/if}
        </div>
        {#if route.tags?.length}
          <div class="row">{#each route.tags as t}<span class="chip">{t}</span>{/each}</div>
        {/if}

        <section>
          <h3>Summits</h3>
          <ul class="plain">
            {#each summits as s}
              <li>
                <span class="chip summit"><span class="ref">{s.ref}</span></span>
                {s.name}
                <span class="muted small">{s.alt ?? '?'} m · {s.points ?? '?'} pts</span>
                <a class="small" href={summitLinks(s.ref).sotlas} target="_blank" rel="noopener">SOTLAS</a>
              </li>
            {/each}
            {#each hills as h}
              <li>
                <span class="chip hill">{h.type}</span>
                {h.name}
                <span class="muted small">{Math.round(h.alt)} m{h.sota ? ` · SOTA ${h.sota}` : ''}</span>
              </li>
            {/each}
          </ul>
        </section>

        {#if route.stats}
          <section class="stats">
            <div><span class="muted small">Distance</span><strong>{route.stats.distanceKm} km</strong></div>
            <div><span class="muted small">Ascent</span><strong>{route.stats.ascentM} m</strong></div>
            {#if route.stats.maxEleM != null}
              <div><span class="muted small">High point</span><strong>{route.stats.maxEleM} m</strong></div>
            {/if}
            <div><span class="muted small">Naismith</span><strong>{fmtDuration(naismithMinutes(route.stats.distanceKm, route.stats.ascentM))}</strong></div>
          </section>
          <ElevationProfile {lines} />
          <a class="small" href="data/routes/{encodeURIComponent(id)}/{route.gpx}" download="{id}.gpx">Download GPX</a>
        {/if}

        {#if route.parking}
          <section>
            <h3>Parking</h3>
            {#if route.parking.label}<p class="park-label">{route.parking.label}</p>{/if}
            <div class="row">
              <code class="tabular">{route.parking.lat}, {route.parking.lon}</code>
              <button class="small" onclick={copyParking}>{copied ? 'Copied ✓' : 'Copy'}</button>
              <a class="button small" href={googleMapsUrl(route.parking)} target="_blank" rel="noopener">Directions in Google Maps</a>
            </div>
          </section>
        {/if}

        <section>
          <h3>Timetable</h3>
          <Timetable timetable={route.timetable} summitsByRef={summitsData?.byRef} />
        </section>

        {#if route.notes}
          <section>
            <h3>Notes</h3>
            <p class="notes">{route.notes}</p>
          </section>
        {/if}

        {#if route.links?.length}
          <section>
            <h3>Links</h3>
            <ul class="plain">
              {#each route.links as l}
                <li><a href={l.url} target="_blank" rel="noopener">{l.label || l.url}</a></li>
              {/each}
            </ul>
          </section>
        {/if}
      {/if}
    </div>

    <div class="side">
      <div class="map" bind:this={mapEl}></div>
      {#if photos.length}
        <section>
          <h3>Photos</h3>
          <Photos {photos} />
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .page { padding: 1rem; max-width: 1500px; margin: 0 auto; }
  .layout { display: grid; grid-template-columns: minmax(340px, 1fr) minmax(0, 1.3fr); gap: 1.2rem; align-items: start; }
  .layout.hidden { visibility: hidden; }
  .info { display: flex; flex-direction: column; gap: 1rem; }
  .side { display: flex; flex-direction: column; gap: 1rem; position: sticky; top: 0; }
  .map { height: 60vh; min-height: 340px; border-radius: var(--radius); border: 1px solid var(--line); }
  .title h1 { margin: 0; }
  section h3 { margin-bottom: 0.4rem; }
  .plain { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .stats { display: flex; gap: 1.5rem; flex-wrap: wrap; }
  .stats div { display: flex; flex-direction: column; }
  .stats strong { font-size: 1.15rem; }
  .park-label { margin: 0 0 0.3rem; }
  .notes { white-space: pre-wrap; margin: 0; }
  .spacer { flex: 1; }
  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
    .side { position: static; order: -1; }
  }
</style>
