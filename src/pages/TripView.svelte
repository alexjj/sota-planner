<script>
  import { onMount } from 'svelte';
  import L from 'leaflet';
  import { createMap, summitMarker, hillMarker, parkingMarker, trackLayer, esc, summitLinks, sizeSummitsOnZoom } from '../lib/map.js';
  import { getSummits, getHills, getTrip, getGpxText, gpxUrl, photoUrl, googleMapsUrl, getPace } from '../lib/store.js';
  import { paceFor, statsMinutes, round5, TERRAINS } from '../lib/pace.js';
  import { parseGpx } from '../lib/gpx.js';
  import { fmtDuration } from '../lib/time.js';
  import { routeInfo, tripStats } from '../lib/trip.js';
  import Timetable from '../components/Timetable.svelte';
  import Photos from '../components/Photos.svelte';
  import ElevationProfile from '../components/ElevationProfile.svelte';

  let { id, edit = false } = $props();

  let mapEl;
  let map;
  let trip = $state(null);
  let summitsData = $state(null);
  let hillsData = $state(null);
  let lines = $state({}); // route id -> GPX lines
  let error = $state('');
  let copied = $state(null);
  const trackLayers = new Map();

  const info = $derived(trip && summitsData ? routeInfo(trip, summitsData.byRef) : new Map());
  const multi = $derived((trip?.routes.length ?? 0) > 1);
  const totals = $derived(trip ? tripStats(trip.routes) : null);
  const photos = $derived((trip?.photos ?? []).map((p) => ({ src: photoUrl(id, p.file), caption: p.caption })));

  const summit = (ref) => summitsData?.byRef.get(ref) ?? { ref, name: '?' };
  const hill = (hid) => hillsData?.byId.get(hid);

  // Where you'd drive from to reach route i: the previous route's parking.
  function previousParking(i) {
    for (let j = i - 1; j >= 0; j--) if (trip.routes[j].parking) return trip.routes[j].parking;
    return null;
  }

  async function copyParking(r) {
    await navigator.clipboard.writeText(`${r.parking.lat}, ${r.parking.lon}`);
    copied = r.id;
    setTimeout(() => (copied = null), 1500);
  }

  function focusRoute(rid) {
    const layer = trackLayers.get(rid);
    const r = trip.routes.find((x) => x.id === rid);
    if (layer) map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 14 });
    else if (r?.parking) map.setView([r.parking.lat, r.parking.lon], 13);
  }

  function highlight(rid) {
    for (const [k, layer] of trackLayers) {
      layer.setStyle({ weight: k === rid ? 6 : 4, opacity: rid && k !== rid ? 0.35 : 0.9 });
    }
  }

  let pace = $state.raw({ walks: [] });
  const walkEstimate = (r) => {
    const p = paceFor(pace, r.terrain);
    return { minutes: round5(statsMinutes(r.stats, p.params)), basis: p.basis, terrain: TERRAINS[r.terrain ?? 'moderate'] };
  };

  onMount(() => {
    map = createMap(mapEl).map;
    sizeSummitsOnZoom(map);
    (async () => {
      try {
        [trip, summitsData, hillsData, pace] = await Promise.all([
          getTrip(id), getSummits(), getHills(), getPace().catch(() => ({ walks: [] })),
        ]);
        const loaded = {};
        await Promise.all(trip.routes.filter((r) => r.gpx).map(async (r) => {
          loaded[r.id] = parseGpx(await getGpxText(id, r.gpx));
        }));
        lines = loaded;
      } catch (e) {
        error = `Couldn't load this trip (${e.message}).`;
        return;
      }
      const bounds = L.latLngBounds([]);
      const routes = routeInfo(trip, summitsData.byRef);
      for (const r of trip.routes) {
        const ri = routes.get(r.id);
        if (lines[r.id]?.length) {
          const t = trackLayer(lines[r.id], { color: ri.color, opacity: 0.9 })
            .bindTooltip(multi ? `${ri.number}. ${ri.label}` : ri.label, { sticky: true })
            .addTo(map);
          trackLayers.set(r.id, t);
          bounds.extend(t.getBounds());
        }
        if (r.parking) {
          parkingMarker(r.parking, { label: multi ? `P${ri.number}` : 'P', color: multi ? ri.color : null })
            .bindTooltip(`${multi ? `${ri.number}. ` : ''}${r.parking.label || 'Parking'}`)
            .addTo(map);
          bounds.extend([r.parking.lat, r.parking.lon]);
        }
        for (const ref of r.summits) {
          const s = summit(ref);
          if (s.lat == null) continue;
          summitMarker(s, { planned: true, ring: ri.color }).addTo(map)
            .bindTooltip(`${s.ref} ${s.name}`, { permanent: true, direction: 'right', offset: [8, 0] })
            .bindPopup(`<h4><span class="ref">${esc(s.ref)}</span> ${esc(s.name)}</h4>
              <div class="muted">${s.alt} m · ${s.points} pts</div>
              <div class="row small">
                <a href="${summitLinks(s.ref).sotlas}" target="_blank" rel="noopener">SOTLAS</a>
                <a href="${summitLinks(s.ref, s.name).walkhighlands}" target="_blank" rel="noopener">Search WH</a>
              </div>`);
          bounds.extend([s.lat, s.lon]);
        }
        for (const hid of r.hills) {
          const h = hill(hid);
          if (!h) continue;
          hillMarker(h, { selected: true }).addTo(map).bindTooltip(`${h.name} (${h.type})`);
          bounds.extend([h.lat, h.lon]);
        }
      }
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    })();
    return () => map.remove();
  });
</script>

<div class="page">
  {#if error}
    <p class="error">{error} <a href="#/">Back to the map</a></p>
  {:else if !trip}
    <p class="muted">Loading…</p>
  {/if}

  <div class="layout" class:hidden={!trip}>
    <div class="info">
      {#if trip && summitsData}
        <div class="title row">
          <h1>{trip.name}</h1>
          <span class="spacer"></span>
          {#if edit}<a class="button" href="#/trip/{encodeURIComponent(id)}/edit">Edit</a>{/if}
        </div>
        {#if trip.tags?.length}
          <div class="row">{#each trip.tags as t}<span class="chip">{t}</span>{/each}</div>
        {/if}
        {#if multi && totals}
          <p class="muted tabular">
            {trip.routes.length} routes · {totals.distanceKm} km · {totals.ascentM} m ascent in total
          </p>
        {/if}

        {#each trip.routes as r, i (r.id)}
          {@const ri = info.get(r.id)}
          <section class="route card" style="--route: {ri.color}" role="group"
                   onmouseenter={() => highlight(r.id)} onmouseleave={() => highlight(null)}>
            <div class="route-head row">
              {#if multi}<span class="route-badge" style="background:{ri.color}">{ri.number}</span>{/if}
              <h2>{multi ? ri.label : 'Route'}</h2>
              <span class="spacer"></span>
              <button class="small" onclick={() => focusRoute(r.id)}>Show on map</button>
            </div>

            <ul class="plain">
              {#each r.summits as ref}
                {@const s = summit(ref)}
                <li>
                  <span class="chip summit"><span class="ref">{s.ref}</span></span>
                  {s.name}
                  <span class="muted small">{s.alt ?? '?'} m · {s.points ?? '?'} pts</span>
                  <a class="small" href={summitLinks(s.ref).sotlas} target="_blank" rel="noopener">SOTLAS</a>
                  <a class="small" href={summitLinks(s.ref, s.name).walkhighlands} target="_blank" rel="noopener">Search WH</a>
                </li>
              {/each}
              {#each r.hills as hid}
                {@const h = hill(hid)}
                {#if h}
                  <li>
                    <span class="chip hill">{h.type}</span>
                    {h.name}
                    <span class="muted small">{Math.round(h.alt)} m{h.sota ? ` · SOTA ${h.sota}` : ''}</span>
                  </li>
                {/if}
              {/each}
            </ul>

            {#if r.stats}
              {@const est = walkEstimate(r)}
              <div class="stats">
                <div><span class="muted small">Distance</span><strong>{r.stats.distanceKm} km</strong></div>
                <div><span class="muted small">Ascent</span><strong>{r.stats.ascentM} m</strong></div>
                {#if r.stats.maxEleM != null}
                  <div><span class="muted small">High point</span><strong>{r.stats.maxEleM} m</strong></div>
                {/if}
                <div title="{est.terrain}. Based on {est.basis}."><span class="muted small">{est.basis === 'Naismith' ? 'Naismith' : 'Walking'}</span><strong>{fmtDuration(est.minutes)}</strong></div>
              </div>
              {#if lines[r.id]}<ElevationProfile lines={lines[r.id]} color={ri.color} />{/if}
              <a class="small" href={gpxUrl(id, r.gpx)} download="{id}-{i + 1}.gpx">Download GPX</a>
            {/if}

            {#if r.parking}
              {@const from = previousParking(i)}
              <div class="parking">
                <h3>{multi ? `Parking P${ri.number}` : 'Parking'}</h3>
                {#if r.parking.label}<p class="park-label">{r.parking.label}</p>{/if}
                <div class="row">
                  <code class="tabular">{r.parking.lat}, {r.parking.lon}</code>
                  <button class="small" onclick={() => copyParking(r)}>{copied === r.id ? 'Copied ✓' : 'Copy'}</button>
                  <a class="button small" href={googleMapsUrl(r.parking)} target="_blank" rel="noopener">Directions</a>
                  {#if from}
                    <a class="button small" href={googleMapsUrl(r.parking, from)} target="_blank" rel="noopener">
                      Drive from P{info.get(trip.routes.find((x) => x.parking === from).id).number}
                    </a>
                  {/if}
                </div>
              </div>
            {/if}
          </section>
        {/each}

        <section>
          <h3>Timetable</h3>
          <Timetable timetable={trip.timetable} summitsByRef={summitsData.byRef} {trip} routes={info} />
        </section>

        {#if trip.notes}
          <section>
            <h3>Notes</h3>
            <p class="notes">{trip.notes}</p>
          </section>
        {/if}

        {#if trip.links?.length}
          <section>
            <h3>Links</h3>
            <ul class="plain">
              {#each trip.links as l}
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
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 1.2rem; align-items: start; }
  .layout.hidden { visibility: hidden; }
  .info { display: flex; flex-direction: column; gap: 1rem; }
  .side { display: flex; flex-direction: column; gap: 1rem; position: sticky; top: 0; }
  .map { height: 60vh; min-height: 340px; border-radius: var(--radius); border: 1px solid var(--line); }
  .title h1 { margin: 0; }
  .route { border-left: 5px solid var(--route); display: flex; flex-direction: column; gap: 0.6rem; }
  .route-head h2 { margin: 0; }
  section h3 { margin-bottom: 0.4rem; }
  .plain { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .plain a { white-space: nowrap; }
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
