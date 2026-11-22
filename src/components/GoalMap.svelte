<script>
  // Map of one goal's summits: activated (faded, dark outline), planned (ringed)
  // and still to do (points colour), with popups linking to SOTLAS and new trips.
  import { onMount } from 'svelte';
  import L from 'leaflet';
  import { createMap, summitMarker, sizeSummitsOnZoom, summitLinks, esc } from '../lib/map.js';

  let { summits, activated, planned, edit = false } = $props();
  let el;

  onMount(() => {
    const map = createMap(el).map;
    sizeSummitsOnZoom(map);
    const layer = L.featureGroup().addTo(map);
    for (const s of summits) {
      const done = activated?.get(s.ref);
      const m = summitMarker(s, { planned: !done && planned?.has(s.ref) });
      if (done) m.setStyle({ fillOpacity: 0.35, color: '#222' });
      const l = summitLinks(s.ref, s.name);
      m.bindTooltip(`${s.ref} ${s.name}${done ? ' ✓' : ''}`).bindPopup(`
        <h4><span class="ref">${esc(s.ref)}</span> ${esc(s.name)}</h4>
        <div class="muted">${s.alt} m · ${s.points} pts${done ? ` · activated ${done.count === 1 ? 'once' : `${done.count} times`}, last ${esc(done.last)}` : ''}</div>
        <div class="row small">
          <a href="${l.sotlas}" target="_blank" rel="noopener">SOTLAS</a>
          <a href="${l.walkhighlands}" target="_blank" rel="noopener">Search WH</a>
          ${edit ? `<a href="#/new?summit=${encodeURIComponent(s.ref)}">+ New trip</a>` : ''}
        </div>`);
      layer.addLayer(m);
    }
    if (summits.length) map.fitBounds(layer.getBounds(), { padding: [20, 20] });
    setTimeout(() => { map.invalidateSize(); if (summits.length) map.fitBounds(layer.getBounds(), { padding: [20, 20] }); }, 50);
    return () => map.remove();
  });
</script>

<div class="goal-map" bind:this={el}></div>

<style>
  .goal-map { height: 320px; border-radius: var(--radius); border: 1px solid var(--line); }
</style>
