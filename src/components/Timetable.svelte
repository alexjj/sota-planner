<script>
  // Shows a route's stages with clock times. The start time can be nudged
  // here to see when you'd be on the summit or home, without saving it.
  import { schedule, fmtClock, fmtDuration, typeInfo, parseClock } from '../lib/time.js';

  let { timetable, summitsByRef = new Map(), adjustable = true } = $props();

  // A start time typed here overrides the saved one until reset.
  let override = $state(null);
  const saved = $derived(timetable?.start ?? '07:00');
  const start = $derived(adjustable && override ? override : saved);

  const plan = $derived(schedule(start, timetable?.stages ?? []));
  const activations = $derived(plan.rows.filter((r) => r.type === 'activate'));

  function nudge(mins) {
    const t = parseClock(start) ?? 420;
    override = fmtClock((t + mins + 1440) % 1440, false);
  }
</script>

{#if !timetable?.stages?.length}
  <p class="muted">No timetable yet.</p>
{:else}
  {#if adjustable}
    <div class="row start">
      <label for="tt-start">Leave at</label>
      <button class="small" onclick={() => nudge(-30)}>−30</button>
      <input id="tt-start" type="time" value={start} oninput={(e) => (override = e.currentTarget.value || null)} />
      <button class="small" onclick={() => nudge(30)}>+30</button>
      {#if start !== saved}
        <button class="small" onclick={() => (override = null)}>Reset to {saved}</button>
      {/if}
    </div>
  {/if}

  <div class="summary">
    {#each activations as a}
      <div class="key">
        <span class="muted">On {a.summit ?? 'summit'}</span>
        <strong class="tabular">{fmtClock(a.start)}–{fmtClock(a.end)}</strong>
      </div>
    {/each}
    <div class="key">
      <span class="muted">Finish</span>
      <strong class="tabular">{fmtClock(plan.end)}</strong>
    </div>
    <div class="key">
      <span class="muted">Total</span>
      <strong class="tabular">{fmtDuration(plan.total)}</strong>
    </div>
  </div>

  <table>
    <tbody>
      {#each plan.rows as r, i (r.id ?? i)}
        <tr class={r.type}>
          <td class="time tabular">{fmtClock(r.start)}</td>
          <td class="icon" title={typeInfo(r.type).label}>{typeInfo(r.type).icon}</td>
          <td class="what">
            {r.label || typeInfo(r.type).label}
            {#if r.type === 'activate' && r.summit}
              <span class="muted small">{summitsByRef.get(r.summit)?.name ?? ''}</span>
            {/if}
            {#if r.until}<span class="muted small">until {r.until}</span>{/if}
          </td>
          <td class="dur tabular muted">{fmtDuration(r.minutes)}</td>
        </tr>
      {/each}
      <tr class="end">
        <td class="time tabular">{fmtClock(plan.end)}</td>
        <td class="icon">🏁</td>
        <td class="what">Finish</td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <div class="totals muted small">
    {#each Object.entries(plan.totals) as [type, mins]}
      <span>{typeInfo(type).icon} {fmtDuration(mins)}</span>
    {/each}
  </div>
{/if}

<style>
  .start { margin-bottom: 0.8rem; }
  .start label { margin: 0; font-size: 0.9rem; }
  .summary { display: flex; flex-wrap: wrap; gap: 0.5rem 1.2rem; margin-bottom: 0.8rem; }
  .key { display: flex; flex-direction: column; }
  .key strong { font-size: 1.15rem; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0.3rem 0.4rem; border-top: 1px solid var(--line); vertical-align: top; }
  .time { width: 5.2em; font-weight: 600; white-space: nowrap; }
  .icon { width: 1.8em; text-align: center; }
  .dur { text-align: right; white-space: nowrap; width: 5em; }
  tr.activate { background: color-mix(in srgb, var(--summit) 10%, transparent); }
  tr.camp { background: color-mix(in srgb, var(--hill) 10%, transparent); }
  tr.end td { font-weight: 600; }
  .totals { display: flex; flex-wrap: wrap; gap: 0.3rem 1rem; margin-top: 0.5rem; }
</style>
