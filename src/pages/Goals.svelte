<script>
  // Goals: groups of summits (a region, the SOTA Munros, a hand-picked list) with
  // progress from your activator log (data/activations.json) and planned trips.
  // Saved to data/goals.json; until there is one, a starting set is shown.
  import { onMount } from 'svelte';
  import { getSummits, getHills, getIndex, getActivations, getGoals, saveGoals, getStatus } from '../lib/store.js';
  import {
    HILL_TYPES, POINTS, regionNames, hillTypesByRef, goalSummits, uncategorised, progress,
    defaultGoals, describeGoal, isEverything, goalId, isHillGoal, goalHills, hillDone, hillProgress,
  } from '../lib/goals.js';
  import { summitLinks, hillLinks, pointsColor, COLORS } from '../lib/map.js';
  import { distanceM } from '../lib/gpx.js';
  import { loadHome } from '../lib/home.js';
  import { showFlash } from '../lib/flash.svelte.js';
  import GoalMap from '../components/GoalMap.svelte';
  import SummitPicker from '../components/SummitPicker.svelte';

  let status = $state(null);
  let summits = $state.raw([]);
  let byRef = $state.raw(new Map());
  let hills = $state.raw([]);
  let types = $state.raw(new Map());
  let activated = $state.raw(null);
  let planned = $state.raw(new Set());
  let plannedTrips = $state.raw(new Map()); // ref -> trips planning it
  let plannedHills = $state.raw(new Set());  // hill ids in trips not done
  let hillTrips = $state.raw(new Map());     // hill id -> trips planning it
  let ticks = $state({});                    // hill id -> date ticked off by hand
  let savedTicks = '';
  let showDone = $state({});                 // goal id -> list the hills already done
  let goals = $state([]);
  let fromFile = $state(false); // goals came from data/goals.json (not the starting set)
  let loading = $state(true);
  let error = $state('');
  let editing = $state(false);
  let saved = '';                // goals as last loaded or saved, for Cancel
  let saving = $state(false);
  let open = $state({});        // goal id -> expanded
  let showAll = $state({});     // goal id -> list every remaining summit
  const home = loadHome();
  let sortBy = $state(home ? 'near' : 'points');

  const regions = $derived(regionNames(summits));
  const munrosNotSota = $derived(hills.filter((h) => h.type === 'Munro' && !h.sota).length);

  onMount(async () => {
    try {
      let saved0, index;
      [status, { summits }, { hills }, index, activated, saved0] = await Promise.all([
        getStatus(), getSummits(), getHills(), getIndex(), getActivations(), getGoals(),
      ]);
      byRef = new Map(summits.map((s) => [s.ref, s]));
      types = hillTypesByRef(hills);
      const pt = new Map(), ht = new Map();
      for (const t of index) {
        if (t.done) continue;
        for (const ref of t.summits) pt.set(ref, [...(pt.get(ref) ?? []), t]);
        for (const id of t.hills ?? []) ht.set(id, [...(ht.get(id) ?? []), t]);
      }
      plannedTrips = pt;
      planned = new Set(pt.keys());
      hillTrips = ht;
      plannedHills = new Set(ht.keys());
      fromFile = !!saved0?.goals;
      goals = saved0?.goals ?? defaultGoals(summits);
      saved = JSON.stringify(goals);
      ticks = saved0?.ticks ?? {};
      savedTicks = JSON.stringify(ticks);
    } catch (e) {
      error = `Couldn't load: ${e.message}`;
    }
    loading = false;
  });

  /** Each goal with its summits and progress; then Uncategorised. */
  const cards = $derived.by(() => {
    if (!summits.length) return [];
    const out = goals.map((g) => {
      if (isHillGoal(g)) {
        const list = goalHills(g, hills);
        return { goal: g, list, hill: true, p: hillProgress(list, activated, ticks, planned, plannedHills) };
      }
      const list = goalSummits(g, summits, types);
      return { goal: g, list, p: progress(list, activated, planned) };
    });
    const rest = uncategorised(goals, summits, types);
    out.push({ goal: { id: 'uncategorised', name: 'Uncategorised', rule: null, refs: [] }, list: rest, p: progress(rest, activated, planned), other: true });
    return out;
  });

  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const kmFromHome = (s) => (home ? distanceM(home, s) / 1000 : null);

  function remaining(list) {
    const left = list.filter((s) => !activated?.has(s.ref));
    if (sortBy === 'near' && home) return left.sort((a, b) => kmFromHome(a) - kmFromHome(b));
    if (sortBy === 'points') return left.sort((a, b) => b.points - a.points || a.ref.localeCompare(b.ref));
    return left.sort((a, b) => a.ref.localeCompare(b.ref));
  }

  /** A hill goal's hills, left to do or already done, in the chosen order. */
  function hillsLeft(list, done) {
    const out = list.filter((h) => !!hillDone(h, activated, ticks) === done);
    if (sortBy === 'near' && home) return out.sort((a, b) => kmFromHome(a) - kmFromHome(b));
    if (sortBy === 'points') return out.sort((a, b) => b.alt - a.alt); // highest first
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---- ticking hills off by hand
  const ticksDirty = $derived(JSON.stringify(ticks) !== savedTicks);
  const ticksChanged = $derived.by(() => {
    const before = JSON.parse(savedTicks || '{}');
    const keys = new Set([...Object.keys(before), ...Object.keys(ticks)]);
    return [...keys].filter((k) => !!before[k] !== !!ticks[k]).length;
  });
  function tick(h, on) {
    if (on) ticks[h.id] = new Date().toISOString().slice(0, 10);
    else delete ticks[h.id];
  }
  function discardTicks() {
    ticks = JSON.parse(savedTicks || '{}');
  }

  // ---- editing
  const dirty = $derived(editing && JSON.stringify(goals) !== saved);

  function addGoal() {
    const g = { id: goalId(), name: 'New goal', rule: { regions: [], hills: [], minPoints: 0 }, refs: [] };
    goals.push(g);
    open[g.id] = false;
  }
  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= goals.length) return;
    [goals[i], goals[j]] = [goals[j], goals[i]];
  }
  function remove(i) {
    if (confirm(`Delete the goal "${goals[i].name}"?`)) goals.splice(i, 1);
  }
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  function useRule(g, on) {
    g.rule = on ? { regions: [], hills: [], minPoints: 0 } : null;
  }
  function pick(g, item) {
    if (item.ref && !g.refs.includes(item.ref)) g.refs.push(item.ref);
  }
  function setType(g, type) {
    if (type) { g.hillList = type; g.rule = null; g.refs = []; }
    else { delete g.hillList; g.rule = { regions: [], hills: [], minPoints: 0 }; }
  }
  function cancel() {
    goals = JSON.parse(saved);
    editing = false;
  }
  /** Save goals and ticks together (ticks live in data/goals.json too). */
  async function save() {
    saving = true;
    try {
      const out = await saveGoals({ goals: $state.snapshot(goals), ticks: $state.snapshot(ticks) });
      goals = out.goals;
      ticks = out.ticks ?? {};
      saved = JSON.stringify(goals);
      savedTicks = JSON.stringify(ticks);
      fromFile = true;
      editing = false;
      showFlash(status.mode === 'github' ? 'Goals saved to GitHub.' : 'Goals saved to data/goals.json.');
    } catch (e) {
      error = `Couldn't save: ${e.message}`;
    } finally {
      saving = false;
    }
  }
</script>

<div class="page">
  <div class="row head">
    <h1>Goals</h1>
    <span class="spacer"></span>
    {#if !loading && !editing}
      <label class="small sort">Remaining, sorted by
        <select bind:value={sortBy}>
          {#if home}<option value="near">nearest to home</option>{/if}
          <option value="points">points (hills: height)</option>
          <option value="ref">reference (hills: name)</option>
        </select>
      </label>
    {/if}
    {#if status?.edit && !loading}
      {#if editing}
        <button onclick={cancel}>Cancel</button>
        <button class="primary" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save goals'}</button>
      {:else}
        <button onclick={() => (editing = true)}>Edit goals</button>
      {/if}
    {/if}
  </div>
  {#if error}<p class="error">{error}</p>{/if}
  {#if loading}
    <p class="muted">Loading…</p>
  {:else}
    {#if !activated}
      <p class="muted small">No activator log yet (<code>data/activations.json</code>), so nothing shows as activated.</p>
    {/if}
    {#if !fromFile && !editing}
      <p class="muted small">These are starting goals. {status?.edit ? 'Use Edit goals to change them and save your own.' : ''}</p>
    {/if}
    {#if editing && dirty}<p class="small">Not saved yet.</p>{/if}
    {#if !editing && ticksDirty}
      <div class="row tick-bar">
        <span>{ticksChanged === 1 ? '1 hill' : `${ticksChanged} hills`} ticked or unticked, not saved yet.</span>
        <span class="spacer"></span>
        <button onclick={discardTicks}>Discard</button>
        <button class="primary" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save ticks'}</button>
      </div>
    {/if}

    <div class="cards">
      {#each cards as c, i (c.goal.id)}
        {@const g = c.goal}
        <section class="card goal" class:other={c.other}>
          {#if editing && !c.other}
            <div class="row">
              <input class="grow name" bind:value={goals[i].name} aria-label="Goal name" />
              <button class="small icon" onclick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
              <button class="small icon" onclick={() => move(i, 1)} disabled={i === goals.length - 1} title="Move down">↓</button>
              <button class="small danger" onclick={() => remove(i)}>Delete</button>
            </div>
            <label class="small inline-check">Goal is
              <select value={g.hillList ?? ''} onchange={(e) => setType(goals[i], e.currentTarget.value)}>
                <option value="">SOTA summits (by rule or picked)</option>
                {#each HILL_TYPES as t}<option value={t}>every {t}, ticked off by hand or activated</option>{/each}
              </select></label>
            {#if !g.hillList}
            <label class="small inline-check"><input type="checkbox" checked={!!g.rule} onchange={(e) => useRule(goals[i], e.currentTarget.checked)} />
              Include summits by rule</label>
            {/if}
            {#if g.rule && !g.hillList}
              <div class="rule small">
                <div class="row"><span class="muted">Regions</span>
                  {#each Object.entries(regions) as [code, name]}
                    <button class="small" class:primary={g.rule.regions.includes(code)} title={name}
                            onclick={() => (goals[i].rule.regions = toggle(g.rule.regions, code))}>GM/{code}</button>
                  {/each}
                  <span class="muted">{g.rule.regions.length ? '' : '(any)'}</span>
                </div>
                <div class="row"><span class="muted">Also a</span>
                  {#each HILL_TYPES as t}
                    <button class="small" class:primary={g.rule.hills.includes(t)} onclick={() => (goals[i].rule.hills = toggle(g.rule.hills, t))}>{t}</button>
                  {/each}
                  <span class="muted">{g.rule.hills.length ? '' : '(any)'}</span>
                </div>
                <div class="row"><span class="muted">Points</span>
                  <select bind:value={goals[i].rule.minPoints} aria-label="Minimum points">
                    <option value={0}>any</option>
                    {#each POINTS.slice(1) as n}<option value={n}>{n} or more</option>{/each}
                  </select>
                </div>
              </div>
            {/if}
            {#if !g.hillList}
            <div class="small picked">
              <span class="muted">Hand-picked summits:</span>
              <SummitPicker summits={summits} hills={[]} onpick={(kind, item) => pick(goals[i], item)} />
              <div class="chips">
                {#each g.refs as ref}
                  <span class="chip summit"><span class="ref">{ref}</span> {byRef.get(ref)?.name ?? ''}
                    <button class="small icon" onclick={() => (goals[i].refs = g.refs.filter((x) => x !== ref))} aria-label="Remove">✕</button></span>
                {/each}
              </div>
            </div>
            {/if}
          {:else}
            <div class="row">
              <h2>{g.name}</h2>
              <span class="spacer"></span>
              <span class="muted small">{c.other ? 'GM summits in no goal' : describeGoal(g)}{!c.other && isEverything(g) ? '' : ''}</span>
            </div>
          {/if}

          <div class="bar" title="{c.p.done} activated, {c.p.planned} planned, of {c.p.total}">
            <div class="done" style="width:{pct(c.p.done, c.p.total)}%"></div>
            <div class="planned" style="width:{pct(c.p.planned, c.p.total)}%"></div>
          </div>
          {#if c.hill}
            <p class="stats tabular">
              <strong>{c.p.done} / {c.p.total}</strong> done ({pct(c.p.done, c.p.total)}%):
              {c.p.activated} activated on SOTA, {c.p.ticked} ticked off
              {#if c.p.planned} · <span class="planned-text">{c.p.planned} planned</span>{/if}
              {#if c.p.total && c.p.done === c.p.total} · <strong class="complete">Complete</strong>{/if}
            </p>
            <p class="muted small">{c.list.filter((h) => !h.sota).length} of these aren't SOTA summits{status?.edit ? ': tick them off in the list when you climb them' : ''}.</p>
          {:else}
          <p class="stats tabular">
            <strong>{c.p.done} / {c.p.total}</strong> activated ({pct(c.p.done, c.p.total)}%)
            {#if c.p.planned} · <span class="planned-text">{c.p.planned} planned</span>{/if}
            · {c.p.pointsDone} / {c.p.points} points
            {#if c.p.total && c.p.done === c.p.total} · <strong class="complete">Complete</strong>{/if}
          </p>
          {/if}
          {#if !c.other && g.rule?.hills?.length === 1 && g.rule.hills[0] === 'Munro' && munrosNotSota}
            <p class="muted small">{munrosNotSota} Munros aren't SOTA summits, so they're not in this goal.</p>
          {/if}
          {#if c.other && !c.list.length}
            <p class="muted small">Every GM summit is in one of your goals.</p>
          {/if}

          {#if c.list.length && !editing}
            <details bind:open={open[g.id]}>
              <summary>Map and remaining summits</summary>
              {#if open[g.id] && c.hill}
                <GoalMap hills={c.list} {activated} {planned} {plannedHills} {ticks} edit={status?.edit} />
                {@const left = hillsLeft(c.list, false)}
                {@const done = hillsLeft(c.list, true)}
                {#snippet hillRow(h)}
                  {@const how = hillDone(h, activated, ticks)}
                  {@const hl = hillLinks(h)}
                  <tr class:done-row={how}>
                    <td>
                      {#if how === 'activated'}<span class="act" title="Activated on SOTA">✓</span>
                      {:else if status?.edit}<input type="checkbox" checked={how === 'ticked'} onchange={(e) => tick(h, e.currentTarget.checked)}
                               aria-label="Ticked off {h.name}" title={how ? `Ticked ${ticks[h.id]}` : 'Tick off'} />
                      {:else if how}✓{/if}
                    </td>
                    <td>{h.name}</td>
                    <td>{Math.round(h.alt)} m</td>
                    <td>{#if h.sota}<span class="ref">{h.sota}</span>{:else}<span class="muted">not SOTA</span>{/if}</td>
                    <td>{how === 'ticked' ? `ticked ${ticks[h.id]}` : how === 'activated' ? 'activated' : home ? `${Math.round(kmFromHome(h))} km` : ''}</td>
                    <td class="links">
                      {#each hillTrips.get(h.id) ?? plannedTrips.get(h.sota) ?? [] as t}<a href="#/trip/{encodeURIComponent(t.id)}" class="planned-text" title="Planned in this trip">{t.name}</a>{/each}
                      <a href={hl.hillBagging} target="_blank" rel="noopener">Hill Bagging</a>
                      <a href={hl.walkhighlands} target="_blank" rel="noopener">WH</a>
                      {#if h.sota && status?.edit && !how && !plannedTrips.has(h.sota)}<a href="#/new?summit={encodeURIComponent(h.sota)}">+ New trip</a>{/if}
                    </td>
                  </tr>
                {/snippet}
                {#if left.length}
                  <table class="left small tabular"><tbody>
                    {#each showAll[g.id] ? left : left.slice(0, 25) as h (h.id)}{@render hillRow(h)}{/each}
                  </tbody></table>
                  {#if left.length > 25 && !showAll[g.id]}
                    <button class="small" onclick={() => (showAll[g.id] = true)}>Show all {left.length} left</button>
                  {/if}
                {/if}
                {#if done.length}
                  <button class="small done-toggle" onclick={() => (showDone[g.id] = !showDone[g.id])}>
                    {showDone[g.id] ? 'Hide' : 'Show'} the {done.length} done</button>
                  {#if showDone[g.id]}
                    <table class="left small tabular"><tbody>
                      {#each done as h (h.id)}{@render hillRow(h)}{/each}
                    </tbody></table>
                  {/if}
                {/if}
              {:else if open[g.id]}
                <GoalMap summits={c.list} {activated} {planned} edit={status?.edit} />
                {@const left = remaining(c.list)}
                {#if left.length}
                  <table class="left small tabular">
                    <tbody>
                      {#each showAll[g.id] ? left : left.slice(0, 25) as s (s.ref)}
                        {@const l = summitLinks(s.ref, s.name)}
                        <tr>
                          <td><span class="dot" style="background:{pointsColor(s.points)}"></span><span class="ref">{s.ref}</span></td>
                          <td>{s.name}</td>
                          <td>{s.alt} m</td>
                          <td>{s.points} pts{s.bonus ? ` (+${s.bonus})` : ''}</td>
                          <td>{home ? `${Math.round(kmFromHome(s))} km` : ''}</td>
                          <td class="links">
                            {#each plannedTrips.get(s.ref) ?? [] as t}<a href="#/trip/{encodeURIComponent(t.id)}" class="planned-text" title="Planned in this trip">{t.name}</a>{/each}
                            <a href={l.sotlas} target="_blank" rel="noopener">SOTLAS</a>
                            <a href={l.walkhighlands} target="_blank" rel="noopener">WH</a>
                            {#if status?.edit && !plannedTrips.has(s.ref)}<a href="#/new?summit={encodeURIComponent(s.ref)}">+ New trip</a>{/if}
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                  {#if left.length > 25 && !showAll[g.id]}
                    <button class="small" onclick={() => (showAll[g.id] = true)}>Show all {left.length} remaining</button>
                  {/if}
                {/if}
              {/if}
            </details>
          {/if}
        </section>
      {/each}
    </div>
    {#if editing}
      <button onclick={addGoal}>+ New goal</button>
    {/if}
  {/if}
</div>

<style>
  .page { padding: 1rem; max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 0.8rem; }
  .head h1 { margin: 0; }
  .sort { display: inline-flex; gap: 0.4rem; align-items: center; margin: 0; font-weight: normal; }
  .cards { display: flex; flex-direction: column; gap: 0.8rem; }
  .goal h2 { margin: 0; font-size: 1.1rem; }
  .goal.other { border-style: dashed; }
  .goal p { margin: 0.3rem 0 0; }
  .bar { display: flex; height: 12px; border-radius: 6px; background: var(--line); overflow: hidden; margin-top: 0.6rem; }
  .bar .done { background: #2b8a3e; }
  .bar .planned { background: #74c0fc; }
  .planned-text { color: #1971c2; }
  .complete { color: #2b8a3e; }
  details { margin-top: 0.6rem; }
  summary { cursor: pointer; font-size: 0.9rem; }
  details[open] summary { margin-bottom: 0.5rem; }
  table.left { width: 100%; border-collapse: collapse; margin-top: 0.6rem; }
  table.left td { padding: 0.25rem 0.4rem; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .links { display: flex; flex-wrap: wrap; gap: 0.6rem; justify-content: flex-end; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 0.4rem; vertical-align: middle; }
  .name { font-weight: 600; }
  .rule { display: flex; flex-direction: column; gap: 0.3rem; margin: 0.4rem 0; }
  .rule .row { align-items: center; flex-wrap: wrap; gap: 0.3rem; }
  .inline-check { display: inline-flex; align-items: center; gap: 0.4rem; margin: 0.4rem 0 0; font-weight: normal; }
  .picked { margin-top: 0.4rem; display: flex; flex-direction: column; gap: 0.3rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .tick-bar { position: sticky; top: 0; z-index: 500; background: var(--card, #fff); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 0.4rem 0.6rem; align-items: center; }
  .done-row td { color: var(--muted); }
  .act { color: #2b8a3e; font-weight: 600; }
  .done-toggle { margin-top: 0.5rem; }
</style>
