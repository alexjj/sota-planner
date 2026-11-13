<script>
  // Edit a trip's stages. `timetable` is the parent's state object and is
  // changed in place. With more than one route, each stage can be linked to
  // a route; activation stages follow the route that holds their summit.
  import { STAGE_TYPES, typeInfo, parseDuration, durationInput, fmtDuration } from '../lib/time.js';
  import { googleMapsUrl } from '../lib/store.js';
  import { newId, stageRouteId } from '../lib/trip.js';

  // routes: Map from routeInfo(); statsFor(route) gives current GPX stats;
  // estimateFor(route) gives { minutes, basis } from your walking pace;
  // onfill() fills in an empty timetable from the routes.
  let { timetable, trip, routes, summitsByRef, statsFor = (r) => r.stats, estimateFor = () => null, onfill, planning = false } = $props();

  const multi = $derived(trip.routes.length > 1);
  const summitName = (ref) => summitsByRef?.get(ref)?.name ?? ref;

  // Drive-time links: to the first parking, then between parkings.
  const driveLinks = $derived.by(() => {
    const out = [];
    let prev = null;
    for (const r of trip.routes) {
      if (!r.parking) continue;
      const n = routes.get(r.id)?.number;
      out.push({ label: prev ? `P${prev.n} → P${n}` : multi ? `To P${n}` : 'To parking', url: googleMapsUrl(r.parking, prev?.parking) });
      prev = { n, parking: r.parking };
    }
    return out;
  });

  function add(type) {
    const stage = { id: newId(), type, label: '', minutes: STAGE_TYPES[type].minutes };
    const last = timetable.stages.at(-1);
    const lastRoute = last ? stageRouteId(last, trip) : trip.routes[0]?.id;
    if (type === 'activate') {
      const used = new Set(timetable.stages.filter((s) => s.type === 'activate').map((s) => s.summit));
      const all = trip.routes.flatMap((r) => r.summits);
      stage.summit = all.find((ref) => !used.has(ref)) ?? all[0] ?? null;
    } else if (multi && lastRoute && type !== 'drive') {
      stage.route = lastRoute;
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

  function setRoute(stage, value) {
    if (value) stage.route = value;
    else delete stage.route;
  }

  function toggleUntil(stage) {
    if (stage.until) delete stage.until;
    else stage.until = '06:00';
  }

</script>

<div class="row start">
  <label for="tte-start">Default start</label>
  <input id="tte-start" type="time" bind:value={timetable.start} />
  <span class="spacer"></span>
  {#if !timetable.stages.length}
    <button class="small" onclick={onfill} disabled={planning}
            title="Drive there, walk in, activate, walk out and drive home, for each route">{planning ? 'Working it out…' : 'Fill in a typical day'}</button>
  {/if}
</div>

<div class="hints small">
  {#each trip.routes as r (r.id)}
    {@const st = statsFor(r)}
    {#if st}
      {@const ri = routes.get(r.id)}
      {@const est = estimateFor(r)}
      <span class="row hint">
        {#if multi}<span class="route-badge" style="background:{ri.color}">{ri.number}</span>{/if}
        GPX {st.distanceKm} km, {st.ascentM} m up{#if est} · walking about <strong>{fmtDuration(est.minutes)}</strong> <span class="muted">({est.basis})</span>{/if}
      </span>
    {/if}
  {/each}
  {#if trip.routes.some((r) => statsFor(r))}
    <span class="muted">Walking pace and home location: <a href="#/settings">Settings</a></span>
  {/if}
  {#if driveLinks.length}
    <span class="row">Drive times in Google Maps:
      {#each driveLinks as l}<a href={l.url} target="_blank" rel="noopener">{l.label}</a>{/each}
    </span>
  {/if}
</div>

<div class="stages">
  {#each timetable.stages as stage, i (stage.id ?? i)}
    {@const rid = stageRouteId(stage, trip)}
    {@const ri = rid ? routes.get(rid) : null}
    <div class="stage {stage.type}" style={multi && ri ? `--route: ${ri.color}` : ''} class:linked={multi && ri}>
      <select bind:value={stage.type} aria-label="Stage type">
        {#each Object.entries(STAGE_TYPES) as [key, t]}
          <option value={key}>{t.icon} {t.label}</option>
        {/each}
      </select>
      {#if stage.type === 'activate'}
        <select bind:value={stage.summit} aria-label="Summit">
          <option value={null}>–</option>
          {#each trip.routes as r (r.id)}
            <optgroup label={multi ? `${routes.get(r.id).number}. ${routes.get(r.id).label}` : 'Summits'}>
              {#each r.summits as ref}<option value={ref}>{ref} {summitName(ref)}</option>{/each}
            </optgroup>
          {/each}
        </select>
      {:else if multi}
        <select value={stage.route ?? ''} onchange={(e) => setRoute(stage, e.currentTarget.value)}
                aria-label="Route" title="Which route this stage belongs to">
          <option value="">{stage.type === 'drive' ? 'Drive home / other' : 'No route'}</option>
          {#each trip.routes as r (r.id)}
            {@const info = routes.get(r.id)}
            <option value={r.id}>{stage.type === 'drive' ? `To P${info.number}: ` : `${info.number}. `}{info.label}</option>
          {/each}
        </select>
      {/if}
      <input class="label" placeholder={typeInfo(stage.type).label} bind:value={stage.label} aria-label="Description" />
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
  {#if timetable.stages.length}
    <span class="spacer"></span>
    <button class="small danger" onclick={() => { if (confirm('Clear all timetable stages?')) timetable.stages = []; }}>Clear all</button>
  {/if}
</div>

<style>
  .start label { margin: 0; }
  .spacer { flex: 1; }
  .hints { display: flex; flex-direction: column; gap: 0.3rem; margin: 0.6rem 0; color: var(--muted); }
  .hint { gap: 0.4em; }
  .stages { display: flex; flex-direction: column; gap: 0.35rem; margin: 0.6rem 0; }
  .stage {
    display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;
    padding: 0.35rem; border-radius: 6px; border: 1px solid var(--line);
  }
  .stage.linked { border-left: 5px solid var(--route); }
  .stage.activate { background: color-mix(in srgb, var(--summit) 8%, transparent); }
  .stage.camp { background: color-mix(in srgb, var(--hill) 8%, transparent); }
  .stage select { max-width: 14em; }
  .label { flex: 1; min-width: 8em; }
  input.dur { width: 5.5em; text-align: right; }
  span.dur { display: inline-flex; gap: 0.3em; align-items: center; font-size: 0.85rem; color: var(--muted); }
  .tools { display: inline-flex; gap: 0.2rem; margin-left: auto; }
  .add { gap: 0.3rem; }
</style>
