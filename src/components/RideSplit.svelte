<script>
  // Map of a recording split into cycling and walking, for checking the split
  // before it's added. Click the track to move the bike drop.
  import { onMount } from 'svelte';
  import L from 'leaflet';
  import { createMap } from '../lib/map.js';
  import { splitRanges } from '../lib/pace.js';

  let { pts, split, onpick } = $props();

  const COLORS = { walk: '#1c7ed6', cycle: '#e8590c' };
  let el;
  let map = $state.raw(null);
  let layer;

  onMount(() => {
    map = createMap(el).map;
    layer = L.layerGroup().addTo(map);
    const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lon]));
    map.fitBounds(bounds, { padding: [20, 20] });
    // The card may still be laying out: fit again once it has its real size.
    setTimeout(() => { map.invalidateSize(); map.fitBounds(bounds, { padding: [20, 20] }); }, 50);
    map.on('click', (e) => onpick?.({ lat: e.latlng.lat, lon: e.latlng.lng }));
    return () => map.remove();
  });

  $effect(() => {
    if (!map) return;
    layer.clearLayers();
    for (const [mode, ranges] of Object.entries(splitRanges(pts, split))) {
      for (const [from, to] of ranges) {
        L.polyline(pts.slice(from, to + 1).map((p) => [p.lat, p.lon]), { color: COLORS[mode], weight: 4, opacity: 0.9, interactive: false })
          .addTo(layer);
      }
    }
    if (split.kind === 'mixed') {
      const p = pts[split.a];
      L.circleMarker([p.lat, p.lon], { radius: 7, color: '#222', weight: 2, fillColor: '#fff', fillOpacity: 1 })
        .bindTooltip('Bike drop', { direction: 'top', offset: [0, -8] })
        .addTo(layer);
    }
  });
</script>

<div class="ride-map" bind:this={el}></div>
<div class="key small">
  <span><i style="background:{COLORS.cycle}"></i>Cycling</span>
  <span><i style="background:{COLORS.walk}"></i>Walking</span>
  <span class="muted">Click the track where you left the bike to move the drop.</span>
</div>

<style>
  .ride-map { height: 260px; border-radius: var(--radius); border: 1px solid var(--line); cursor: crosshair; }
  .key { display: flex; flex-wrap: wrap; gap: 0.8rem; margin: 0.3rem 0; align-items: center; }
  .key i { display: inline-block; width: 1.4em; height: 4px; border-radius: 2px; vertical-align: middle; margin-right: 0.3em; }
</style>
