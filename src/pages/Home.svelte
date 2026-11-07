<script>
  import { onMount } from 'svelte';
  import L from 'leaflet';
  import { createMap, summitMarker, hillMarker, parkingMarker, trackLayer, esc, summitLinks, COLORS } from '../lib/map.js';
  import { getSummits, getHills, getIndex } from '../lib/store.js';
  import { fmtDuration } from '../lib/time.js';

  let { edit = false } = $props();

  const VIEW_KEY = 'sota-trip-home-view';
  let mapEl;
  let map;
  let routes = $state([]);
  let summitsData = $state(null);
  let hillsData = $state(null);
  let query = $state('');
  let summitFilter = $state(null);
  let loading = $state(true);
  let error = $state('');
  let highlighted = $state(null);
  const trackLayers = new Map();

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return routes.filter((r) => {
      if (summitFilter && !r.summits.includes(summitFilter)) return false;
      if (!q) return true;
      const words = [r.name, ...r.summits, ...(r.tags ?? [])];
      for (const ref of r.summits) words.push(summitsData?.byRef.get(ref)?.name ?? '');
      for (const id of r.hills) words.push(hillsData?.byId.get(id)?.name ?? '');
      return words.join(' ').toLowerCase().includes(q);
    });
  });

  function routesFor(ref) {
    return routes.filter((r) => r.summits.includes(ref));
  }

  function summitPopup(s) {
    const links = summitLinks(s.ref);
    const rs = routesFor(s.ref);
    const routeList = rs.length
      ? `<ul>${rs.map((r) => `<li><a href="#/route/${encodeURIComponent(r.id)}">${esc(r.name)}</a></li>`).join('')}</ul>`
      : '<div class="muted">No routes yet</div>';
    return `<h4><span class="ref">${esc(s.ref)}</span> ${esc(s.name)}</h4>
      <div class="muted">${s.alt} m · ${s.points} pts${s.bonus ? ` (+${s.bonus} winter)` : ''} · ${s.activations} activations</div>
      ${routeList}
      <div class="row small">
        <a href="${links.sotlas}" target="_blank" rel="noopener">SOTLAS</a>
        <a href="${links.sotadata}" target="_blank" rel="noopener">SOTA database</a>
        ${edit ? `<a href="#/new?summit=${encodeURIComponent(s.ref)}">+ New route</a>` : ''}
      </div>`;
  }

  function hillPopup(h) {
    const inRoutes = routes.filter((r) => r.hills.includes(h.id));
    return `<h4>${esc(h.name)}</h4>
      <div class="muted">${h.type} · ${Math.round(h.alt)} m${h.sota ? ` · SOTA ${esc(h.sota)}` : ' · not a SOTA summit'}</div>
      ${inRoutes.length ? `<ul>${inRoutes.map((r) => `<li><a href="#/route/${encodeURIComponent(r.id)}">${esc(r.name)}</a></li>`).join('')}</ul>` : ''}
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
        [summitsData, hillsData, routes] = await Promise.all([getSummits(), getHills(), getIndex()]);
      } catch (e) {
        error = e.message;
        loading = false;
        return;
      }
      loading = false;
      const planned = new Set(routes.flatMap((r) => r.summits));

      const routeGroup = L.layerGroup();
      for (const r of routes) {
        if (r.track?.length) {
          const layer = trackLayer(r.track).bindTooltip(r.name, { sticky: true });
          layer.on('click', () => (location.hash = `#/route/${encodeURIComponent(r.id)}`));
          layer.on('mouseover', () => highlight(r.id));
          layer.on('mouseout', () => highlight(null));
          trackLayers.set(r.id, layer);
          routeGroup.addLayer(layer);
        }
        if (r.parking) {
          routeGroup.addLayer(parkingMarker(r.parking).bindPopup(
            `<h4>Parking</h4><a href="#/route/${encodeURIComponent(r.id)}">${esc(r.name)}</a>`));
        }
      }

      const hillGroup = L.layerGroup();
      for (const h of hillsData.hills) {
        if (h.sota) continue; // shown as a SOTA summit already
        hillGroup.addLayer(hillMarker(h).bindPopup(() => hillPopup(h)).bindTooltip(`${h.name} (${h.type})`));
      }

      const summitGroup = L.layerGroup();
      for (const s of summitsData.summits) {
        summitGroup.addLayer(summitMarker(s, { planned: planned.has(s.ref) })
          .bindPopup(() => summitPopup(s))
          .bindTooltip(`${s.ref} ${s.name}`));
      }

      hillGroup.addTo(map);
      summitGroup.addTo(map);
      routeGroup.addTo(map);
      created.control.addOverlay(summitGroup, `<span style="color:${COLORS.summit}">●</span> SOTA summits`);
      created.control.addOverlay(hillGroup, `<span style="color:${COLORS.hill}">●</span> Other Munros, tops, Corbetts, Grahams`);
      created.control.addOverlay(routeGroup, `<span style="color:${COLORS.route}">━</span> Routes & parking`);
    })();

    return () => map.remove();
  });

  function zoomTo(r) {
    const layer = trackLayers.get(r.id);
    if (layer) map.fitBounds(layer.getBounds(), { padding: [30, 30] });
    else if (r.parking) map.setView([r.parking.lat, r.parking.lon], 13);
  }
</script>

<div class="home">
  <aside>
    <input type="search" placeholder="Search routes, summits, tags…" bind:value={query} />
    {#if summitFilter}
      <div class="chip summit filter">
        Routes for <span class="ref">{summitFilter}</span>
        <button class="small icon" onclick={() => (summitFilter = null)} aria-label="Clear filter">✕</button>
      </div>
    {/if}

    {#if loading}
      <p class="muted">Loading…</p>
    {:else if error}
      <p class="error">Couldn't load data: {error}</p>
    {:else if !routes.length}
      <div class="empty">
        <p>No routes yet.</p>
        {#if edit}
          <p class="muted small">Click a summit on the map and choose <b>+ New route</b>, or use the button at the top.</p>
        {:else}
          <p class="muted small">Routes are added in edit mode (<code>npm run edit</code>).</p>
        {/if}
      </div>
    {:else}
      <p class="muted small count">{filtered.length} of {routes.length} routes</p>
      <ul class="routes">
        {#each filtered as r (r.id)}
          <li class:active={highlighted === r.id}
              onmouseenter={() => highlight(r.id)} onmouseleave={() => highlight(null)}>
            <a class="name" href="#/route/{encodeURIComponent(r.id)}">{r.name}</a>
            <div class="chips">
              {#each r.summits as ref}
                <button class="chip summit" onclick={() => (summitFilter = ref)} title="Show routes for {ref}">
                  <span class="ref">{ref}</span> {summitsData?.byRef.get(ref)?.name ?? ''}
                </button>
              {/each}
              {#each r.hills as id}
                <span class="chip hill">{hillsData?.byId.get(id)?.name ?? id}</span>
              {/each}
            </div>
            <div class="stats muted small tabular">
              {#if r.stats}{r.stats.distanceKm} km · {r.stats.ascentM} m ascent{/if}
              {#if r.totalMinutes}{r.stats ? ' · ' : ''}{fmtDuration(r.totalMinutes)} door to door{/if}
              <span class="spacer"></span>
              <button class="small" onclick={() => zoomTo(r)}>Show on map</button>
            </div>
          </li>
        {/each}
      </ul>
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
  .name { font-weight: 600; color: var(--text); text-decoration: none; }
  .name:hover { color: var(--accent); }
  .chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  button.chip { cursor: pointer; }
  .stats { display: flex; align-items: center; gap: 0.3rem; }
  .spacer { flex: 1; }
  .empty { padding: 1rem 0; }
  .attrib { margin-top: auto; }
  @media (max-width: 800px) {
    .home { flex-direction: column-reverse; }
    aside { width: auto; max-height: 45%; border-right: 0; border-top: 1px solid var(--line); }
  }
</style>
