<script>
  import Home from './pages/Home.svelte';
  import TripView from './pages/TripView.svelte';
  import TripEdit from './pages/TripEdit.svelte';
  import { getStatus, publish } from './lib/store.js';

  let hash = $state(location.hash);
  let status = $state({ edit: false });
  let publishing = $state(false);
  let publishLog = $state('');

  getStatus().then((s) => (status = s));

  $effect(() => {
    const onHash = () => (hash = location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });

  // #/trip/<id>, #/trip/<id>/edit, #/new?summit=GM/CS-001
  // (#/route/... is the old address, still accepted.)
  const page = $derived.by(() => {
    const [pathPart, queryPart] = hash.replace(/^#/, '').split('?');
    const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    const query = new URLSearchParams(queryPart ?? '');
    const isTrip = parts[0] === 'trip' || parts[0] === 'route';
    if (isTrip && parts[1] && parts[2] === 'edit') return { name: 'edit', id: parts[1] };
    if (isTrip && parts[1]) return { name: 'view', id: parts[1] };
    if (parts[0] === 'new') return { name: 'new', summit: query.get('summit') };
    return { name: 'home' };
  });

  async function doPublish() {
    publishing = true;
    publishLog = '';
    try {
      publishLog = (await publish()).log;
    } catch (e) {
      publishLog = `Publish failed:\n${e.message}`;
    } finally {
      publishing = false;
    }
  }
</script>

<div class="shell">
  <header>
    <a class="brand" href="#/">
      <img src="favicon.svg" alt="" width="22" height="22" />
      SOTA Trip Planner
    </a>
    <span class="spacer"></span>
    {#if status.edit}
      <a class="button primary" href="#/new">+ New trip</a>
      {#if status.git}
        <button onclick={doPublish} disabled={publishing} title="Commit data/ and push to GitHub">
          {publishing ? 'Publishing…' : 'Publish'}
        </button>
      {/if}
    {/if}
  </header>

  {#if publishLog}
    <div class="publish-log">
      <pre>{publishLog}</pre>
      <button class="small" onclick={() => (publishLog = '')}>Close</button>
    </div>
  {/if}

  <main>
    {#key page.name + (page.id ?? '')}
      {#if page.name === 'view'}
        <TripView id={page.id} edit={status.edit} />
      {:else if page.name === 'edit'}
        <TripEdit id={page.id} />
      {:else if page.name === 'new'}
        <TripEdit summit={page.summit} />
      {:else}
        <Home edit={status.edit} />
      {/if}
    {/key}
  </main>
</div>

<style>
  .shell { display: flex; flex-direction: column; height: 100%; }
  header {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.5rem 1rem;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .brand {
    display: flex; align-items: center; gap: 0.5rem;
    font-weight: 700; font-size: 1.05rem;
    color: var(--text); text-decoration: none;
  }
  .spacer { flex: 1; }
  main { flex: 1; min-height: 0; overflow: auto; }
  .publish-log {
    display: flex; gap: 1rem; align-items: flex-start;
    padding: 0.5rem 1rem; background: var(--soft); border-bottom: 1px solid var(--line);
  }
  .publish-log pre { flex: 1; margin: 0; font-size: 0.8rem; white-space: pre-wrap; max-height: 12rem; overflow: auto; }
</style>
