<script>
  import Home from './pages/Home.svelte';
  import RouteView from './pages/RouteView.svelte';
  import RouteEdit from './pages/RouteEdit.svelte';
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

  // #/route/<id>, #/route/<id>/edit, #/new?summit=GM/CS-001
  const page = $derived.by(() => {
    const [pathPart, queryPart] = hash.replace(/^#/, '').split('?');
    const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    const query = new URLSearchParams(queryPart ?? '');
    if (parts[0] === 'route' && parts[1] && parts[2] === 'edit') return { name: 'edit', id: parts[1] };
    if (parts[0] === 'route' && parts[1]) return { name: 'view', id: parts[1] };
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
      <a class="button primary" href="#/new">+ New route</a>
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
        <RouteView id={page.id} edit={status.edit} />
      {:else if page.name === 'edit'}
        <RouteEdit id={page.id} />
      {:else if page.name === 'new'}
        <RouteEdit summit={page.summit} />
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
