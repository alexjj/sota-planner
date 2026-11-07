<script>
  // Simple SVG elevation profile from GPX lines.
  import { distanceM } from '../lib/gpx.js';

  let { lines = [] } = $props();

  const W = 600, H = 140, PAD_L = 36, PAD_B = 18;

  const data = $derived.by(() => {
    const pts = [];
    let d = 0, prev = null;
    for (const line of lines) {
      for (const p of line) {
        if (prev) d += distanceM(prev, p);
        prev = p;
        if (p.ele != null) pts.push([d / 1000, p.ele]);
      }
    }
    if (pts.length < 2) return null;
    const maxD = pts[pts.length - 1][0];
    let minE = Infinity, maxE = -Infinity;
    for (const [, e] of pts) { minE = Math.min(minE, e); maxE = Math.max(maxE, e); }
    minE = Math.floor(minE / 100) * 100;
    maxE = Math.ceil(maxE / 100) * 100;
    const x = (v) => PAD_L + (v / maxD) * (W - PAD_L - 4);
    const y = (v) => 4 + (1 - (v - minE) / (maxE - minE || 1)) * (H - PAD_B - 4);
    const path = pts.map(([dd, e], i) => `${i ? 'L' : 'M'}${x(dd).toFixed(1)},${y(e).toFixed(1)}`).join('');
    const area = `${path}L${x(maxD)},${H - PAD_B}L${x(0)},${H - PAD_B}Z`;
    const step = maxE - minE > 800 ? 400 : maxE - minE > 400 ? 200 : 100;
    const yTicks = [];
    for (let e = minE; e <= maxE; e += step) yTicks.push({ e, y: y(e) });
    const kmStep = maxD > 30 ? 10 : maxD > 12 ? 5 : maxD > 5 ? 2 : 1;
    const xTicks = [];
    for (let k = 0; k <= maxD; k += kmStep) xTicks.push({ k, x: x(k) });
    return { path, area, yTicks, xTicks };
  });
</script>

{#if data}
  <svg viewBox="0 0 {W} {H}" role="img" aria-label="Elevation profile">
    {#each data.yTicks as t}
      <line x1={PAD_L} x2={W} y1={t.y} y2={t.y} class="grid" />
      <text x={PAD_L - 4} y={t.y + 3} text-anchor="end">{t.e}</text>
    {/each}
    {#each data.xTicks as t}
      <text x={t.x} y={H - 4} text-anchor="middle">{t.k} km</text>
    {/each}
    <path d={data.area} class="area" />
    <path d={data.path} class="line" />
  </svg>
{/if}

<style>
  svg { width: 100%; height: auto; display: block; }
  .grid { stroke: var(--line); stroke-width: 1; }
  text { font-size: 10px; fill: var(--muted); }
  .area { fill: color-mix(in srgb, #1c7ed6 18%, transparent); }
  .line { fill: none; stroke: #1c7ed6; stroke-width: 1.8; }
</style>
