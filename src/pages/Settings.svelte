<script>
  // Settings: home location and drive-time padding (this browser only), and
  // walking pace learnt from GPX recordings (saved to data/pace.json in the repo).
  import { onMount } from 'svelte';
  import { getPace, savePace, getStatus, parseLatLon, googleMapsPlaceUrl } from '../lib/store.js';
  import { loadHome, saveHome, clearHome, loadDrivePad, saveDrivePad, DEFAULT_DRIVE_PAD } from '../lib/home.js';
  import { parseGpx, gpxName } from '../lib/gpx.js';
  import { learnWalk, combineWalks, walkMinutes, TERRAINS, DEFAULT_TERRAIN, NAISMITH } from '../lib/pace.js';
  import { newId } from '../lib/trip.js';
  import { fmtDuration } from '../lib/time.js';
  import { showFlash } from '../lib/flash.svelte.js';

  // ---- home (local only)
  const savedHome = loadHome();
  let home = $state(savedHome);
  let homeText = $state(savedHome ? `${savedHome.lat}, ${savedHome.lon}` : '');
  let homeError = $state('');
  let locating = $state(false);
  let pad = $state(loadDrivePad());

  function setHome() {
    homeError = '';
    const p = parseLatLon(homeText);
    if (!p) { homeError = 'Couldn\'t read that. Paste "lat, lon" or a Google Maps link.'; return; }
    saveHome(p);
    home = p;
    homeText = `${p.lat}, ${p.lon}`;
  }

  function useMyLocation() {
    homeError = '';
    locating = true;
    navigator.geolocation.getCurrentPosition((pos) => {
      locating = false;
      homeText = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      setHome();
    }, (err) => {
      locating = false;
      homeError = `Couldn't get your location: ${err.message}`;
    }, { timeout: 15000 });
  }

  function forgetHome() {
    clearHome();
    home = null;
    homeText = '';
  }

  $effect(() => {
    const v = Number(pad);
    if (Number.isFinite(v) && v >= 0 && v <= 100) saveDrivePad(v);
  });

  // ---- walking pace (in the repo)
  let status = $state(null);
  let pace = $state({ walks: [] });
  let loaded = $state(false);
  let dirty = $state(false);
  let saving = $state(false);
  let messages = $state([]);
  let dragging = $state(false);

  onMount(async () => {
    status = await getStatus();
    try {
      const p = await getPace();
      pace = { walks: p.walks ?? [] };
    } catch (e) {
      messages = [`Couldn't load walking pace: ${e.message}`];
    }
    loaded = true;
  });

  async function addFiles(files) {
    const out = [];
    for (const f of files) {
      if (!/\.gpx$/i.test(f.name)) continue;
      try {
        const text = await f.text();
        const rec = learnWalk(parseGpx(text));
        const dupe = pace.walks.find((w) => w.date === rec.date && Math.abs(w.distanceKm - rec.distanceKm) < 0.05);
        if (dupe) { out.push(`${f.name}: already added as "${dupe.name}".`); continue; }
        pace.walks.push({ id: newId('w'), name: gpxName(text) || f.name.replace(/\.gpx$/i, ''), terrain: DEFAULT_TERRAIN, ...rec });
        dirty = true;
        out.push(`${f.name}: added. Set its terrain below.`);
      } catch (e) {
        out.push(`${f.name}: can't learn from this file because ${e.message}`);
      }
    }
    pace.walks.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    messages = out;
  }

  function onDrop(e) {
    e.preventDefault();
    dragging = false;
    addFiles([...(e.dataTransfer?.files ?? [])]);
  }

  function remove(w) {
    pace.walks = pace.walks.filter((x) => x !== w);
    dirty = true;
  }

  async function save() {
    saving = true;
    try {
      const saved = await savePace($state.snapshot(pace));
      pace = { walks: saved.walks };
      dirty = false;
      showFlash(status.mode === 'github' ? 'Walking pace saved to GitHub.' : 'Walking pace saved to data/pace.json.');
    } catch (e) {
      messages = [`Couldn't save: ${e.message}`];
    } finally {
      saving = false;
    }
  }

  // Summary rows: each terrain, all walks, and Naismith for comparison.
  const summary = $derived.by(() => {
    const rows = Object.entries(TERRAINS).map(([key, label]) => {
      const walks = pace.walks.filter((w) => w.terrain === key);
      return { key, label, count: walks.length, params: walks.length ? combineWalks(walks) : null };
    });
    rows.push({ key: 'all', label: 'All walks', count: pace.walks.length, params: pace.walks.length ? combineWalks(pace.walks) : null });
    rows.push({ key: 'naismith', label: "Naismith's rule", count: null, params: NAISMITH });
    return rows;
  });

  const example = { distanceKm: 10, upM: 800, downM: 800 };
  const kmh = (flat) => (60 / flat).toFixed(1);
  const pct = (r) => `${Math.round((r ?? 0) * 100)}%`;
</script>

<div class="page" role="presentation"
     ondragover={(e) => { e.preventDefault(); dragging = true; }} ondragleave={() => (dragging = false)} ondrop={onDrop}
     class:dragging>
  <h1>Settings</h1>

  <section class="card">
    <h2>Home</h2>
    <p class="muted small">
      Where trips start and end, for working out drive times. Kept only in this browser, not on GitHub.
      To work out drive times it's sent, with the parking spot, to the free
      <a href="https://project-osrm.org" target="_blank" rel="noopener">OSRM</a> router.
    </p>
    <div class="row">
      <input class="grow tabular" bind:value={homeText} placeholder='"lat, lon" or a Google Maps link' aria-label="Home location"
             onkeydown={(e) => e.key === 'Enter' && setHome()} />
      <button class="primary" onclick={setHome}>Save</button>
      {#if 'geolocation' in navigator}
        <button onclick={useMyLocation} disabled={locating}>{locating ? 'Locating…' : 'Use my location'}</button>
      {/if}
      {#if home}
        <a class="button" href={googleMapsPlaceUrl(home)} target="_blank" rel="noopener">Google Maps</a>
        <button class="danger" onclick={forgetHome}>Forget</button>
      {/if}
    </div>
    {#if homeError}<p class="error small">{homeError}</p>{/if}
    <p class="small">{home ? `Saved: ${home.lat}, ${home.lon}` : 'Not set: drives to and from home will be left at 1 hour.'}</p>

    <label for="pad" class="gap">Add to routed drive times</label>
    <div class="row">
      <input id="pad" class="pad" type="number" min="0" max="100" step="5" bind:value={pad} /> %
      <span class="muted small">The router is often quick on Highland roads. Default {DEFAULT_DRIVE_PAD}%.</span>
    </div>
  </section>

  <section class="card">
    <h2>Walking pace</h2>
    <p class="muted small">
      Add GPX recordings of walks you've done (from a watch, phone or GPS: they need timestamps).
      The planner works out your speed on the flat, the extra time per 100 m up and down, and how much
      you rest along the way. Stops of 20 minutes or more, like activations and lunch, are left out.
      Mark each walk's terrain, and new routes use the walks that match. Only these numbers are saved
      to GitHub (<code>data/pace.json</code>), not the tracks.
    </p>

    {#if loaded}
      <table class="summary tabular">
        <thead>
          <tr><th></th><th>Walks</th><th>Flat</th><th>Per 100 m up</th><th>Per 100 m down</th><th>Rests</th>
            <th title="10 km with 800 m up and 800 m down">10 km, 800 m up</th></tr>
        </thead>
        <tbody>
          {#each summary as r (r.key)}
            <tr class:naismith={r.key === 'naismith'}>
              <th>{r.label}</th>
              <td>{r.count ?? ''}</td>
              {#if r.params}
                <td>{r.params.flat.toFixed(1)} min/km <span class="muted">({kmh(r.params.flat)} km/h)</span></td>
                <td>+{r.params.up.toFixed(1)} min</td>
                <td>{r.params.down >= 0 ? '+' : ''}{r.params.down.toFixed(1)} min</td>
                <td>{pct(r.params.rest)}</td>
                <td><strong>{fmtDuration(walkMinutes(example, r.params))}</strong></td>
              {:else}
                <td colspan="5" class="muted">No walks yet{r.key !== 'all' && pace.walks.length ? ': uses all your walks' : ': uses Naismith'}</td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>

      {#if status?.edit}
        <div class="row add">
          <label class="button">
            Add GPX recordings…
            <input type="file" accept=".gpx" multiple hidden onchange={(e) => { addFiles([...e.currentTarget.files]); e.currentTarget.value = ''; }} />
          </label>
          <span class="muted small">or drop them anywhere on this page</span>
          <span class="spacer"></span>
          {#if dirty}<span class="small">Not saved yet</span>{/if}
          <button class="primary" onclick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      {:else}
        <p class="muted small">Read-only here. Use <b>Edit</b> at the top right (GitHub) to add walks.</p>
      {/if}
      {#each messages as m}<p class="small msg">{m}</p>{/each}

      {#if pace.walks.length}
        <table class="walks tabular">
          <thead>
            <tr><th>Walk</th><th>Date</th><th>Terrain</th><th>Distance</th><th>Up</th><th>Moving</th><th>Rests</th>
              <th title="Minutes per km on the flat / per 100 m up / per 100 m down">Fit (flat / up / down)</th><th></th></tr>
          </thead>
          <tbody>
            {#each pace.walks as w (w.id)}
              <tr>
                <td>
                  {#if status?.edit}<input class="name" bind:value={w.name} oninput={() => (dirty = true)} aria-label="Walk name" />
                  {:else}{w.name}{/if}
                </td>
                <td>{w.date ?? ''}</td>
                <td>
                  {#if status?.edit}
                    <select bind:value={w.terrain} onchange={() => (dirty = true)} aria-label="Terrain">
                      {#each Object.entries(TERRAINS) as [key, label]}<option value={key}>{label}</option>{/each}
                    </select>
                  {:else}{TERRAINS[w.terrain] ?? w.terrain}{/if}
                </td>
                <td>{w.distanceKm.toFixed(1)} km</td>
                <td>{w.ascentM} m</td>
                <td>{fmtDuration(w.movingMin)}</td>
                <td>{fmtDuration(w.restMin)}</td>
                <td>{w.fit.flat.toFixed(1)} / {w.fit.up.toFixed(1)} / {w.fit.down.toFixed(1)}</td>
                <td>{#if status?.edit}<button class="small icon danger" onclick={() => remove(w)} aria-label="Remove walk">✕</button>{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else}
      <p class="muted">Loading…</p>
    {/if}
  </section>
</div>

<style>
  .page { padding: 1rem; max-width: 1100px; margin: 0 auto; min-height: 100%; display: flex; flex-direction: column; gap: 1rem; }
  .page.dragging { outline: 3px dashed var(--accent); outline-offset: -6px; }
  h1 { margin: 0; }
  section p { margin: 0 0 0.6rem; }
  .grow { flex: 1; min-width: 14em; }
  .gap { margin-top: 0.8rem; }
  .pad { width: 5em; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 0.4rem 0 0.8rem; }
  th, td { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--line); vertical-align: middle; }
  thead th { font-weight: 600; color: var(--muted); font-size: 0.8rem; }
  tbody th { font-weight: 600; }
  tr.naismith { color: var(--muted); }
  .walks input.name { width: 100%; min-width: 10em; }
  .add { margin: 0.4rem 0; }
  label.button { display: inline-flex; color: var(--text); font-size: inherit; margin: 0; cursor: pointer; }
  .msg { margin: 0.2rem 0; }
  section { overflow-x: auto; }
</style>
