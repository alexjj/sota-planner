<script>
  // Map of one goal: its SOTA summits (activated faded with a dark outline, planned
  // ringed, still to do in points colour), or for a hill goal its hills (done faded,
  // planned ringed, still to do in the hill colour). Popups link out and to new trips.
  import { onMount } from 'svelte';
  import L from 'leaflet';
  import { createMap, summitMarker, hillMarker, sizeSummitsOnZoom, summitLinks, hillLinks, esc, COLORS } from '../lib/map.js';
  import { hillDone } from '../lib/goals.js';

  let { summits = [], hills = null, activated, planned, plannedHills = null, ticks = {}, edit = false } = $props();
  let el;
  let map;
  let layer;

  function summitLayer(s) {
    const done = activated?.get(s.ref);
    const m = summitMarker(s, { planned: !done && planned?.has(s.ref) });
    if (done) m.setStyle({ fillOpacity: 0.35, color: '#222' });
    const l = summitLinks(s.ref, s.name);
    return m.bindTooltip(`${s.ref} ${s.name}${done ? ' ✓' : ''}`).bindPopup(`
      <h4><span class="ref">${esc(s.ref)}</span> ${esc(s.name)}</h4>
      <div class="muted">${s.alt} m · ${s.points} pts${done ? ` · activated ${done.count === 1 ? 'once' : `${done.count} times`}, last ${esc(done.last)}` : ''}</div>
      <div class="row small">
        <a href="${l.sotlas}" target="_blank" rel="noopener">SOTLAS</a>
        <a href="${l.walkhighlands}" target="_blank" rel="noopener">Search WH</a>
        ${edit ? `<a href="#/new?summit=${encodeURIComponent(s.ref)}">+ New trip</a>` : ''}
      </div>`);
  }

  function hillLayer(h) {
    const how = hillDone(h, activated, ticks);
    const isPlanned = !how && (plannedHills?.has(h.id) || (h.sota && planned?.has(h.sota)));
    const m = hillMarker(h, { selected: true, color: COLORS.hill });
    m.setRadius(6);
    if (how) m.setStyle({ fillOpacity: 0.3, color: '#222', weight: 1.5 });
    else if (isPlanned) m.setStyle({ color: COLORS.route, weight: 3 });
    const l = hillLinks(h);
    const what = how === 'ticked' ? ` · ticked off ${esc(ticks[h.id])}` : how === 'activated' ? ' · activated on SOTA' : '';
    return m.bindTooltip(`${h.name}${how ? ' ✓' : ''}`).bindPopup(`
      <h4>${esc(h.name)}</h4>
      <div class="muted">${h.type} · ${Math.round(h.alt)} m${h.sota ? ` · SOTA ${esc(h.sota)}` : ' · not a SOTA summit'}${what}</div>
      <div class="row small">
        <a href="${l.hillBagging}" target="_blank" rel="noopener">Hill Bagging</a>
        <a href="${l.walkhighlands}" target="_blank" rel="noopener">Search WH</a>
        ${edit && h.sota ? `<a href="#/new?summit=${encodeURIComponent(h.sota)}">+ New trip</a>` : ''}
      </div>`);
  }

  onMount(() => {
    map = createMap(el).map;
    sizeSummitsOnZoom(map);
    layer = L.featureGroup().addTo(map);
    draw();
    const fit = () => { if (layer.getLayers().length) map.fitBounds(layer.getBounds(), { padding: [20, 20] }); };
    fit();
    setTimeout(() => { map.invalidateSize(); fit(); }, 50);
    return () => map.remove();
  });

  function draw() {
    layer.clearLayers();
    for (const x of hills ?? summits) layer.addLayer(hills ? hillLayer(x) : summitLayer(x));
  }

  // Redraw when ticks change, so ticking in the list shows on the map.
  $effect(() => {
    JSON.stringify(ticks);
    if (layer) draw();
  });
</script>

<div class="goal-map" bind:this={el}></div>

<style>
  .goal-map { height: 320px; border-radius: var(--radius); border: 1px solid var(--line); }
</style>
