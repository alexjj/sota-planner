<script>
  import { onMount } from 'svelte';
  import L from 'leaflet';
  import { createMap, summitMarker, hillMarker, parkingMarker, trackLayer, esc, summitLinks, COLORS, POINTS_COLORS } from '../lib/map.js';
  import { getSummits, getHills, getIndex, getTrip, saveTrip } from '../lib/store.js';
  import { showFlash } from '../lib/flash.svelte.js';
  import { fmtDuration } from '../lib/time.js';

  let { edit = false } = $props();

  const VIEW_KEY = 'sota-trip-home-view';
  let mapEl;
  let map;
  let trips = $state([]);
  let summitsData = $state(null);
  let hillsData = $state(null);
  let query = $state('');
  let summitFilter = $state(null);
  let loading = $state(true);
  let error = $state('');
  let highlighted = $state(null);
  let archiveOpen = $state(false);
  let saving = $state(new Set()); // trip ids being marked done / not done
  let routeGroup = $state.raw(null);
  const trackLayers = new Map();
  const tripGroups = new Map(); // trip id -> its lines and parking on the map

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return trips.filter((r) => {
      if (summitFilter && !r.summits.includes(summitFilter)) return false;
      if (!q) return true;
      const words = [r.name, ...r.summits, ...(r.tags ?? [])];
      for (const ref of r.summits) words.push(summitsData?.byRef.get(ref)?.name ?? '');
      for (const id of r.hills) words.push(hillsData?.byId.get(id)?.name ?? '');
      return words.join(' ').toLowerCase().includes(q);
    });
  });
  const active = $derived(filtered.filter((t) => !t.done));
  const archived = $derived(filtered.filter((t) => t.done));
  const activeTotal = $derived(trips.filter((t) => !t.done).length);

  // Done trips stay off the map unless the Done list is open.
  $effect(() => {
    if (!routeGroup) return;
    for (const t of trips) {
      const group = tripGroups.get(t.id);
      if (!group) continue;
      if (!t.done || archiveOpen) routeGroup.addLayer(group);
      else routeGroup.removeLayer(group);
    }
  });

  async function setDone(t, done) {
    saving = new Set(saving).add(t.id);
    try {
      const trip = await getTrip(t.id);
      await saveTrip(t.id, { trip: { ...trip, done: done || undefined }, gpx: {}, newPhotos: [] });
      trips = trips.map((x) => (x.id === t.id ? { ...x, done } : x));
    } catch (e) {
      showFlash(`Couldn't update "${t.name}": ${e.message}`);
    } finally {
      const next = new Set(saving);
      next.delete(t.id);
      saving = next;
    }
  }

  const tripLink = (t) => `<li><a href="#/trip/${encodeURIComponent(t.id)}">${esc(t.name)}</a>${t.done ? ' <span class="muted">(done)</span>' : ''}</li>`;

  function summitPopup(s) {
    const links = summitLinks(s.ref, s.name);
    const ts = trips.filter((t) => t.summits.includes(s.ref));
    const tripList = ts.length ? `<ul>${ts.map(tripLink).join('')}</ul>` : '<div class="muted">No trips yet</div>';
    return `<h4><span class="ref">${esc(s.ref)}</span> ${esc(s.name)}</h4>
      <div class="muted">${s.alt} m · ${s.points} pts${s.bonus ? ` (+${s.bonus} winter)` : ''} · ${s.activations} activations</div>
      ${tripList}
      <div class="row small">
        <a href="${links.sotlas}" target="_blank" rel="noopener">SOTLAS</a>
        <a href="${links.walkhighlands}" target="_blank" rel="noopener">Search WH</a>
        ${edit ? `<a href="#/new?summit=${encodeURIComponent(s.ref)}">+ New trip</a>` : ''}
      </div>`;
  }

  function hillPopup(h) {
    const inTrips = trips.filter((t) => t.hills.includes(h.id));
    return `<h4>${esc(h.name)}</h4>
      <div class="muted">${h.type} · ${Math.round(h.alt)} m${h.sota ? ` · SOTA ${esc(h.sota)}` : ' · not a SOTA summit'}</div>
      ${inTrips.length ? `<ul>${inTrips.map(tripLink).join('')}</ul>` : ''}
      <a class="small" href="https://www.hill-bagging.co.uk/hill-view/?qu=S&rf=${h.id}" target="_blank" rel="noopener">Hill Bagging</a>`;
  }

  function highlight(id) {
    highlighted = id;
    for (const [rid, layer] of trackLayers) {
      layer.setStyle({ weight: rid === id ? 6 : 4, opacity: id && rid !== id ? 0.45 : 0.85 });
      if (rid === id) layer.bringToFront();
    }
  }

  onMount(() => {
    let view;
    try { view = JSON.parse(sessionStorage.getItem(VIEW_KEY)); } catch {}
    const created = createMap(mapEl, { view });
    map = created.map;
    map.on('moveend', () => {
      const c = map.getCenter();
      try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ center: [c.lat, c.lng], zoom: map.getZoom() })); } catch {}
    });

    (async () => {
      try {
        [summitsData, hillsData, trips] = await Promise.all([getSummits(), getHills(), getIndex()]);
      } catch (e) {
        error = e.message;
        loading = false;
        return;
      }
      loading = false;
      const planned = new Set(trips.flatMap((t) => t.summits));

      // One layer per trip holding all its routes' lines, so hovering a trip
      // highlights every route in it.
      const routes = L.layerGroup();
      for (const t of trips) {
        const group = L.featureGroup();
        const lines = L.featureGroup();
        for (const r of t.routes) {
          if (r.track?.length) lines.addLayer(trackLayer(r.track));
          if (r.parking) {
            group.addLayer(parkingMarker(r.parking).bindPopup(
              `<h4>Parking</h4>${esc(r.parking.label ?? '')}<ul>${tripLink(t)}</ul>`));
          }
        }
        tripGroups.set(t.id, group);
        if (!lines.getLayers().length) continue;
        lines.bindTooltip(t.name, { sticky: true });
        lines.on('click', () => (location.hash = `#/trip/${encodeURIComponent(t.id)}`));
        lines.on('mouseover', () => highlight(t.id));
        lines.on('mouseout', () => highlight(null));
        trackLayers.set(t.id, lines);
        group.addLayer(lines);
      }
      routeGroup = routes; // the effect above adds each trip's group

      // Munros: all of them, so they still show with SOTA summits switched off.
      // A Munro that is also a SOTA summit is drawn as a ring around the SOTA dot.
      const munroGroup = L.layerGroup();
      // Other tops: Munro Tops, Corbetts and Grahams that aren't SOTA summits.
      const topGroup = L.layerGroup();
      for (const h of hillsData.hills) {
        if (h.type === 'Munro') {
          munroGroup.addLayer(hillMarker(h, { ring: !!h.sota })
            .bindPopup(() => hillPopup(h)).bindTooltip(`${h.name} (Munro)`));
        } else if (!h.sota) {
          topGroup.addLayer(hillMarker(h, { color: COLORS.top })
            .bindPopup(() => hillPopup(h)).bindTooltip(`${h.name} (${h.type})`));
        }
      }

      const summitGroup = L.layerGroup();
      for (const s of summitsData.summits) {
        summitGroup.addLayer(summitMarker(s, { planned: planned.has(s.ref), byPoints: true })
          .bindPopup(() => summitPopup(s))
          .bindTooltip(`${s.ref} ${s.name}`));
      }

      // Key to the summit colours, shown while SOTA summits are on.
      const legend = L.control({ position: 'topleft' });
      legend.onAdd = () => {
        const div = L.DomUtil.create('div', 'points-legend');
        div.innerHTML = `<b>Points</b>${Object.entries(POINTS_COLORS).map(([p, c]) =>
          `<span><i style="background:${c}"></i>${p}</span>`).join('')}
          <span><i class="ring" style="border-color:${COLORS.route}"></i>in a trip</span>`;
        return div;
      };
      legend.addTo(map);
      map.on('overlayadd overlayremove', (e) => {
        if (e.layer !== summitGroup) return;
        if (map.hasLayer(summitGroup)) legend.addTo(map); else legend.remove();
      });

      munroGroup.addTo(map);
      summitGroup.addTo(map);
      routes.addTo(map);
      created.control.addOverlay(summitGroup, `<span style="color:${POINTS_COLORS[6]}">●</span> SOTA summits`);
      created.control.addOverlay(munroGroup, `<span style="color:${COLORS.hill}">●</span> Munros`);
      created.control.addOverlay(topGroup, `<span style="color:${COLORS.top}">●</span> Other tops`);
      created.control.addOverlay(routes, `<span style="color:${COLORS.route}">━</span> Routes & parking`);
      // Toggling a layer back on draws it on top, so keep summits and routes above the hills.
      map.on('overlayadd', () => {
        if (map.hasLayer(summitGroup)) summitGroup.eachLayer((l) => l.bringToFront());
        if (map.hasLayer(routes)) routes.eachLayer((l) => l.bringToFront?.());
      });
    })();

    return () => map.remove();
  });

  function zoomTo(r) {
    if (r.done) archiveOpen = true;
    const layer = trackLayers.get(r.id);
    if (layer) map.fitBounds(layer.getBounds(), { padding: [30, 30] });
    else {
      const p = r.routes.find((x) => x.parking)?.parking;
      if (p) map.setView([p.lat, p.lon], 13);
    }
  }
</script>

{#snippet card(r)}
  <li class:active={highlighted === r.id} class:done={r.done} role="group"
      onmouseenter={() => highlight(r.id)} onmouseleave={() => highlight(null)}>
    <div class="title">
      <a class="name" href="#/trip/{encodeURIComponent(r.id)}">{r.name}</a>
      {#if edit}
        <label class="done-box small muted" title={r.done ? 'Move back to the trip list' : 'Mark as done and move to the Done list'}>
          <input type="checkbox" checked={!!r.done} disabled={saving.has(r.id)}
                 onchange={(e) => setDone(r, e.currentTarget.checked)} />
          {saving.has(r.id) ? 'Saving…' : 'Done'}
        </label>
      {/if}
    </div>
    <div class="chips">
      {#each r.summits as ref}
        <button class="chip summit" onclick={() => (summitFilter = ref)} title="Show trips for {ref}">
          <span class="ref">{ref}</span> {summitsData?.byRef.get(ref)?.name ?? ''}
        </button>
      {/each}
      {#each r.hills as id}
        <span class="chip hill">{hillsData?.byId.get(id)?.name ?? id}</span>
      {/each}
    </div>
    <div class="stats muted small tabular">
      {#if r.routes.length > 1}{r.routes.length} routes · {/if}
      {#if r.stats}{r.stats.distanceKm} km · {r.stats.ascentM} m ascent{/if}
      {#if r.totalMinutes}{r.stats ? ' · ' : ''}{fmtDuration(r.totalMinutes)} door to door{/if}
      <span class="spacer"></span>
      <button class="small" onclick={() => zoomTo(r)}>Show on map</button>
    </div>
  </li>
{/snippet}

<div class="home">
  <aside>
    <input type="search" placeholder="Search trips, summits, tags…" bind:value={query} />
    {#if summitFilter}
      <div class="chip summit filter">
        Trips for <span class="ref">{summitFilter}</span>
        <button class="small icon" onclick={() => (summitFilter = null)} aria-label="Clear filter">✕</button>
      </div>
    {/if}

    {#if loading}
      <p class="muted">Loading…</p>
    {:else if error}
      <p class="error">Couldn't load data: {error}</p>
    {:else if !trips.length}
      <div class="empty">
        <p>No trips yet.</p>
        {#if edit}
          <p class="muted small">Click a summit on the map and choose <b>+ New trip</b>, or use the button at the top.</p>
        {:else}
          <p class="muted small">To add trips, use <b>Edit</b> at the top right (saves to GitHub) or run <code>npm run edit</code>.</p>
        {/if}
      </div>
    {:else}
      <p class="muted small count">{active.length} of {activeTotal} trips</p>
      <ul class="routes">
        {#each active as r (r.id)}{@render card(r)}{/each}
      </ul>
      {#if trips.some((t) => t.done)}
        <details class="archive" bind:open={archiveOpen}>
          <summary>Done <span class="muted">({archived.length})</span></summary>
          <ul class="routes">
            {#each archived as r (r.id)}{@render card(r)}{/each}
          </ul>
          {#if !archived.length}<p class="muted small">No done trips match.</p>{/if}
        </details>
      {/if}
    {/if}
    <p class="attrib muted small">
      Summits: SOTA ({summitsData?.updated ?? '…'}). Hills: Database of British and Irish Hills (CC BY 4.0).
    </p>
  </aside>
  <div class="map" bind:this={mapEl}></div>
</div>

<style>
  .home { display: flex; height: 100%; }
  aside {
    width: 360px; flex-shrink: 0;
    display: flex; flex-direction: column; gap: 0.6rem;
    padding: 0.8rem; overflow: auto;
    border-right: 1px solid var(--line);
    background: var(--panel);
  }
  .map { flex: 1; min-width: 0; }
  input[type=search] { width: 100%; }
  .filter { align-self: flex-start; }
  .count { margin: 0; }
  .routes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .routes li {
    border: 1px solid var(--line); border-radius: var(--radius);
    padding: 0.6rem 0.7rem; display: flex; flex-direction: column; gap: 0.35rem;
  }
  .routes li.active { border-color: var(--accent); }
  .routes li.done { opacity: 0.8; }
  .title { display: flex; align-items: baseline; gap: 0.5rem; }
  .done-box { margin-left: auto; display: flex; align-items: center; gap: 0.25rem; cursor: pointer; white-space: nowrap; }
  .done-box input { margin: 0; }
  .archive summary { cursor: pointer; font-weight: 600; padding: 0.2rem 0; }
  .archive .routes { margin-top: 0.5rem; }
  .name { font-weight: 600; color: var(--text); text-decoration: none; }
  .name:hover { color: var(--accent); }
  .chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  button.chip { cursor: pointer; }
  .stats { display: flex; align-items: center; gap: 0.3rem; }
  .spacer { flex: 1; }
  .empty { padding: 1rem 0; }
  .attrib { margin-top: auto; }
  .map :global(.points-legend) {
    background: rgba(255, 255, 255, 0.9); color: #222; border-radius: 4px;
    padding: 4px 8px; font-size: 12px; line-height: 1.5;
    display: flex; flex-direction: column; gap: 1px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  .map :global(.points-legend span) { display: inline-flex; align-items: center; gap: 3px; }
  .map :global(.points-legend i) {
    display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 1px solid #fff;
  }
  .map :global(.points-legend i.ring) { background: #ddd; border-width: 2.5px; width: 8px; height: 8px; }
  @media (max-width: 800px) {
    .home { flex-direction: column-reverse; }
    aside { width: auto; max-height: 45%; border-right: 0; border-top: 1px solid var(--line); }
  }
</style>
