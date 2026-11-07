<script>
  // Search box for adding SOTA summits and other hills to a route.
  let { summits = [], hills = [], onpick } = $props();

  let query = $state('');
  let active = $state(0);

  const results = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [];
    for (const s of summits) {
      if (s.ref.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) {
        out.push({ kind: 'summit', item: s, label: `${s.ref} ${s.name}`, meta: `${s.alt} m · ${s.points} pts` });
      }
      if (out.length >= 15) break;
    }
    for (const h of hills) {
      if (out.length >= 25) break;
      if (h.sota) continue;
      if (h.name.toLowerCase().includes(q)) {
        out.push({ kind: 'hill', item: h, label: h.name, meta: `${h.type} · ${Math.round(h.alt)} m` });
      }
    }
    return out;
  });

  $effect(() => { results; active = 0; });

  function pick(r) {
    onpick?.(r.kind, r.item);
    query = '';
  }

  function key(e) {
    if (!results.length) return;
    if (e.key === 'ArrowDown') { active = (active + 1) % results.length; e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = (active - 1 + results.length) % results.length; e.preventDefault(); }
    if (e.key === 'Enter') { pick(results[active]); e.preventDefault(); }
    if (e.key === 'Escape') query = '';
  }
</script>

<div class="picker">
  <input type="search" placeholder="Add summit: ref (CS-012) or name…" bind:value={query} onkeydown={key} />
  {#if results.length}
    <ul>
      {#each results as r, i}
        <li>
          <button class:active={i === active} onclick={() => pick(r)} onmouseenter={() => (active = i)}>
            <span class="chip {r.kind}">{r.kind === 'summit' ? 'SOTA' : r.item.type}</span>
            <span class="label">{r.label}</span>
            <span class="muted small">{r.meta}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .picker { position: relative; }
  input { width: 100%; }
  ul {
    position: absolute; z-index: 1000; left: 0; right: 0; top: 100%;
    list-style: none; margin: 2px 0 0; padding: 0.25rem;
    background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    max-height: 320px; overflow: auto;
  }
  button { width: 100%; border: 0; justify-content: flex-start; white-space: normal; text-align: left; }
  button.active { background: var(--soft); }
  .label { flex: 1; }
</style>
