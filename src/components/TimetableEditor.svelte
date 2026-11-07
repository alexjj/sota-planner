<script>
  // Edit a route's stages. `timetable` is the parent's state object and is
  // changed in place.
  import { STAGE_TYPES, typeInfo, parseDuration, durationInput, fmtDuration } from '../lib/time.js';
  import { naismithMinutes } from '../lib/gpx.js';
  import { googleMapsUrl } from '../lib/store.js';

  let { timetable, summits = [], stats = null, parking = null } = $props();

  let pace = $state(1);
  const naismith = $derived(stats ? naismithMinutes(stats.distanceKm, stats.ascentM, pace) : null);

  const newId = () => Math.random().toString(36).slice(2, 10);

  function add(type) {
    const stage = { id: newId(), type, label: '', minutes: STAGE_TYPES[type].minutes };
    if (type === 'activate') {
      const used = new Set(timetable.stages.filter((s) => s.type === 'activate').map((s) => s.summit));
      stage.summit = summits.find((s) => !used.has(s.ref))?.ref ?? summits[0]?.ref ?? null;
    }
    if (type === 'camp') stage.until = '06:00';
    timetable.stages.push(stage);
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= timetable.stages.length) return;
    const [s] = timetable.stages.splice(i, 1);
    timetable.stages.splice(j, 0, s);
  }

  function setDuration(stage, e) {
    const m = parseDuration(e.currentTarget.value);
    if (m != null) stage.minutes = m;
    e.currentTarget.value = durationInput(stage.minutes);
  }

  function toggleUntil(stage) {
    if (stage.until) delete stage.until;
    else stage.until = '06:00';
  }

  function typicalDay() {
    const s = [{ id: newId(), type: 'drive', label: 'Drive to parking', minutes: 60 }];
    const half = naismith ? Math.round(naismith * 0.55) : 120;
    s.push({ id: newId(), type: 'walk', label: 'Walk in', minutes: half });
    summits.forEach((sm, i) => {
      if (i > 0) s.push({ id: newId(), type: 'walk', label: `Walk to ${sm.name}`, minutes: 60 });
      s.push({ id: newId(), type: 'activate', label: '', minutes: 40, summit: sm.ref });
    });
    s.push({ id: newId(), type: 'walk', label: 'Walk out', minutes: naismith ? naismith - half : 90 });
    s.push({ id: newId(), type: 'drive', label: 'Drive home', minutes: 60 });
    timetable.stages = s;
  }
</script>

<div class="row start">
  <label for="tte-start">Default start</label>
  <input id="tte-start" type="time" bind:value={timetable.start} />
  <span class="spacer"></span>
  {#if !timetable.stages.length}
    <button class="small" onclick={typicalDay}>Fill in a typical day</button>
  {/if}
</div>

{#if stats || parking}
  <div class="hints small">
    {#if stats}
      <span>
        GPX: {stats.distanceKm} km, {stats.ascentM} m up. Naismith for the whole route
        <strong>{fmtDuration(naismith)}</strong> at pace
        <input class="pace" type="number" min="0.5" max="2" step="0.05" bind:value={pace} title="1 = Naismith, 0.8 = 20% faster" />
      </span>
    {/if}
    {#if parking}
      <a href={googleMapsUrl(parking)} target="_blank" rel="noopener">Check drive time in Google Maps</a>
    {/if}
  </div>
{/if}

<div class="stages">
  {#each timetable.stages as stage, i (stage.id ?? i)}
    <div class="stage {stage.type}">
      <select bind:value={stage.type} aria-label="Stage type">
        {#each Object.entries(STAGE_TYPES) as [key, t]}
          <option value={key}>{t.icon} {t.label}</option>
        {/each}
      </select>
      <input class="label" placeholder={typeInfo(stage.type).label} bind:value={stage.label} aria-label="Description" />
      {#if stage.type === 'activate'}
        <select bind:value={stage.summit} aria-label="Summit">
          <option value={null}>–</option>
          {#each summits as s}<option value={s.ref}>{s.ref} {s.name}</option>{/each}
        </select>
      {/if}
      {#if stage.until}
        <span class="dur">until <input type="time" bind:value={stage.until} aria-label="Until" /></span>
      {:else}
        <input class="dur" value={durationInput(stage.minutes)} onchange={(e) => setDuration(stage, e)}
               title="Minutes, or h:mm, e.g. 90 or 1:30" aria-label="Duration" />
      {/if}
      <span class="tools">
        <button class="small icon" title={stage.until ? 'Use a duration' : 'Run until a clock time (e.g. overnight camp)'}
                onclick={() => toggleUntil(stage)}>{stage.until ? '⏱' : '🕕'}</button>
        <button class="small icon" title="Move up" onclick={() => move(i, -1)} disabled={i === 0}>↑</button>
        <button class="small icon" title="Move down" onclick={() => move(i, 1)} disabled={i === timetable.stages.length - 1}>↓</button>
        <button class="small icon danger" title="Remove" onclick={() => timetable.stages.splice(i, 1)}>✕</button>
      </span>
    </div>
  {/each}
</div>

<div class="row add">
  <span class="muted small">Add:</span>
  {#each Object.entries(STAGE_TYPES) as [key, t]}
    <button class="small" onclick={() => add(key)}>{t.icon} {t.label}</button>
  {/each}
</div>

<style>
  .start label { margin: 0; }
  .spacer { flex: 1; }
  .hints { display: flex; flex-direction: column; gap: 0.2rem; margin: 0.6rem 0; color: var(--muted); }
  .pace { width: 4.5em; padding: 0.05em 0.3em; }
  .stages { display: flex; flex-direction: column; gap: 0.35rem; margin: 0.6rem 0; }
  .stage {
    display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;
    padding: 0.35rem; border-radius: 6px; border: 1px solid var(--line);
  }
  .stage.activate { background: color-mix(in srgb, var(--summit) 8%, transparent); }
  .stage.camp { background: color-mix(in srgb, var(--hill) 8%, transparent); }
  .label { flex: 1; min-width: 8em; }
  input.dur { width: 5.5em; text-align: right; }
  span.dur { display: inline-flex; gap: 0.3em; align-items: center; font-size: 0.85rem; color: var(--muted); }
  .tools { display: inline-flex; gap: 0.2rem; }
  .add { gap: 0.3rem; }
</style>
