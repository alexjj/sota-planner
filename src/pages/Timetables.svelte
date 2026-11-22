<script>
  // Every planned trip (not marked done) as a row of timetable bars, all leaving
  // home at the same time, shortest day first, so you can see at a glance what
  // fits in the time you have. The start and "back by" times are remembered in
  // this browser only.
  import { onMount } from 'svelte';
  import { getIndex, getTrip, getSummits } from '../lib/store.js';
  import { schedule, parseClock, fmtClock, fmtDuration, typeInfo } from '../lib/time.js';
  import { CYCLE_COLOR } from '../lib/map.js';

  const KEY = 'sota-timetables';
  const COLORS = {
    drive: '#868e96', cycle: CYCLE_COLOR, walk: '#2f9e44', activate: '#c2255c',
    break: '#f59f00', camp: '#7048e8', other: '#adb5bd',
  };
  const color = (type) => COLORS[type] ?? COLORS.other;

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
  }
  const prefs = loadPrefs();
  let start = $state(prefs.start ?? '07:00');
  let backBy = $state(prefs.backBy ?? '');
  $effect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ start, backBy })); } catch {}
  });

  let trips = $state.raw([]);
  let byRef = $state.raw(new Map());
  let loading = $state(true);
  let error = $state('');

  onMount(async () => {
    try {
      const [index, summits] = await Promise.all([getIndex(), getSummits()]);
      byRef = summits.byRef;
      trips = await Promise.all(index.filter((e) => !e.done).map((e) => getTrip(e.id)));
    } catch (e) {
      error = `Couldn't load your trips (${e.message}).`;
    } finally {
      loading = false;
    }
  });

  const startMin = $derived(parseClock(start) ?? 7 * 60);

  // Each trip's day from the shared start time, shortest first.
  const rows = $derived(trips
    .filter((t) => t.timetable?.stages?.length)
    .map((t) => ({ trip: t, day: schedule(fmtClock(startMin, false), t.timetable.stages) }))
    .sort((a, b) => a.day.total - b.day.total || a.trip.name.localeCompare(b.trip.name)));
  const noTimetable = $derived(trips.filter((t) => !t.timetable?.stages?.length));

  // "Back by" as minutes from the start day: a time earlier than the start is the next day.
  const backMin = $derived.by(() => {
    const b = parseClock(backBy);
    if (b == null) return null;
    return b <= startMin ? b + 1440 : b;
  });

  // The hours along the top: from the start's hour to the latest finish.
  const axis = $derived.by(() => {
    const from = Math.floor(startMin / 60) * 60;
    const latest = Math.max(startMin + 4 * 60, ...rows.map((r) => r.day.end), backMin ?? 0);
    const to = Math.ceil(latest / 60) * 60;
    const span = to - from;
    const step = span > 30 * 60 ? 180 : span > 16 * 60 ? 120 : 60;
    const ticks = [];
    for (let t = from; t <= to; t += step) ticks.push(t);
    return { from, to, span, ticks };
  });
  const pct = (t) => `${((t - axis.from) / axis.span) * 100}%`;
  const width = (m) => `${(m / axis.span) * 100}%`;

  function stageText(r) {
    const info = typeInfo(r.type);
    const s = r.summit ? byRef.get(r.summit) : null;
    const what = r.label || info.label;
    const where = s ? ` ${s.name} (${s.ref})` : '';
    return `${info.icon} ${what}${where}: ${fmtClock(r.start)}–${fmtClock(r.end)} (${fmtDuration(r.minutes)})`;
  }

  const fits = (row) => backMin == null || row.day.end <= backMin;
  const used = $derived([...new Set(rows.flatMap((r) => r.day.rows.map((s) => (COLORS[s.type] ? s.type : 'other'))))]);
</script>

<div class="page">
  <div class="head row">
    <h1>Timetables</h1>
    <span class="spacer"></span>
    <label class="row">Leave home at <input type="time" bind:value={start} /></label>
    <label class="row" title="Trips that finish later are faded">Back by <input type="time" bind:value={backBy} /></label>
    {#if backBy}<button class="small" onclick={() => (backBy = '')}>Clear</button>{/if}
  </div>
  <p class="muted small intro">
    Every trip not marked done, leaving home at the same time, shortest day first. Bars are the stages from each
    trip's timetable; hover over one for its times. Overnight camps that run "until" a time still end then.
  </p>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if !rows.length}
    <p class="muted">No planned trips with a timetable yet.</p>
  {:else}
    <div class="legend row small">
      {#each used as type}
        <span class="key"><span class="swatch" style="background:{color(type)}"></span>{typeInfo(type).label}</span>
      {/each}
    </div>

    <div class="scroll">
      <div class="chart">
        <div class="axis-row">
          <div class="label"></div>
          <div class="track axis">
            {#each axis.ticks as t}
              <span class="tick" class:last={t === axis.to} style="left:{pct(t)}">{fmtClock(t)}</span>
            {/each}
          </div>
        </div>

        {#each rows as row (row.trip.id)}
          <div class="trip-row" class:late={!fits(row)}>
            <div class="label">
              <a href="#/trip/{encodeURIComponent(row.trip.id)}">{row.trip.name}</a>
              <span class="muted small tabular">
                {fmtDuration(row.day.total)} · home {fmtClock(row.day.end)}
              </span>
            </div>
            <div class="track">
              {#each axis.ticks as t}<span class="grid" style="left:{pct(t)}"></span>{/each}
              {#if backMin != null}<span class="back" style="left:{pct(backMin)}"></span>{/if}
              {#each row.day.rows as s (s.id ?? s.start)}
                {#if s.minutes > 0}
                  <span class="bar" style="left:{pct(s.start)}; width:{width(s.minutes)}; background:{color(s.type)}"
                        title={stageText(s)}>
                    {#if s.minutes / axis.span > 0.035}{typeInfo(s.type).icon}{/if}
                  </span>
                {/if}
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>

    {#if backMin != null}
      <p class="muted small">
        {rows.filter(fits).length} of {rows.length} trips get you home by {fmtClock(backMin)}.
      </p>
    {/if}
  {/if}

  {#if noTimetable.length}
    <p class="muted small">
      No timetable yet:
      {#each noTimetable as t, i}{i ? ', ' : ''}<a href="#/trip/{encodeURIComponent(t.id)}">{t.name}</a>{/each}
    </p>
  {/if}
</div>

<style>
  .page { padding: 1rem; max-width: 1500px; margin: 0 auto; }
  .head { flex-wrap: wrap; gap: 0.8rem; }
  .head h1 { margin: 0; }
  .head label { gap: 0.4rem; }
  .intro { margin: 0.3rem 0 0.8rem; }
  .spacer { flex: 1; }
  .legend { gap: 1rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
  .key { display: inline-flex; align-items: center; gap: 0.35rem; }
  .swatch { width: 0.9rem; height: 0.9rem; border-radius: 3px; display: inline-block; }
  .scroll { overflow-x: auto; }
  .chart { min-width: 720px; padding-right: 2px; } /* room for the last hour's grid line */
  .axis-row, .trip-row { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 0.8rem; align-items: center; }
  .trip-row { padding: 0.35rem 0; border-top: 1px solid var(--line); }
  .trip-row.late { opacity: 0.4; }
  .label { display: flex; flex-direction: column; min-width: 0; }
  .label a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .track { position: relative; height: 1.9rem; }
  .axis { height: 1.4rem; }
  .tick { position: absolute; transform: translateX(-50%); font-size: 0.75rem; color: var(--muted); white-space: nowrap; }
  .tick.last { transform: translateX(-100%); }
  .grid { position: absolute; top: 0; bottom: 0; border-left: 1px dashed var(--line); }
  .back { position: absolute; top: -0.35rem; bottom: -0.35rem; border-left: 2px solid #e03131; z-index: 1; }
  @media (max-width: 700px) {
    .axis-row, .trip-row { grid-template-columns: 130px minmax(0, 1fr); gap: 0.5rem; }
    .chart { min-width: 620px; }
  }
  .bar {
    position: absolute; top: 0.2rem; bottom: 0.2rem; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.8rem; overflow: hidden; box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.6);
  }
</style>
