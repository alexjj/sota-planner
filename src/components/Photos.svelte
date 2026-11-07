<script>
  // Thumbnail strip with a click-to-enlarge viewer.
  let { photos = [] } = $props(); // [{ src, caption }]
  let open = $state(-1);

  function key(e) {
    if (open < 0) return;
    if (e.key === 'Escape') open = -1;
    if (e.key === 'ArrowRight') open = (open + 1) % photos.length;
    if (e.key === 'ArrowLeft') open = (open - 1 + photos.length) % photos.length;
  }
</script>

<svelte:window onkeydown={key} />

<div class="grid">
  {#each photos as p, i}
    <button class="thumb" onclick={() => (open = i)}>
      <img src={p.src} alt={p.caption ?? ''} loading="lazy" />
      {#if p.caption}<span>{p.caption}</span>{/if}
    </button>
  {/each}
</div>

{#if open >= 0 && photos[open]}
  <div class="viewer" role="dialog" aria-modal="true" tabindex="-1"
       onclick={(e) => { if (e.target === e.currentTarget) open = -1; }}
       onkeydown={key}>
    <img src={photos[open].src} alt={photos[open].caption ?? ''} />
    <div class="bar">
      <span>{photos[open].caption ?? ''}</span>
      <span class="spacer"></span>
      <span class="small">{open + 1} / {photos.length}</span>
      <a class="button small" href={photos[open].src} target="_blank" rel="noopener">Full size</a>
      <button class="small" onclick={() => (open = -1)}>Close</button>
    </div>
  </div>
{/if}

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.5rem; }
  .thumb {
    padding: 0; border-radius: var(--radius); overflow: hidden;
    display: flex; flex-direction: column; align-items: stretch;
    background: var(--panel); white-space: normal; text-align: left;
  }
  .thumb img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }
  .thumb span { padding: 0.25rem 0.4rem; font-size: 0.8rem; color: var(--muted); }
  .viewer {
    position: fixed; inset: 0; z-index: 2000;
    background: rgba(0, 0, 0, 0.88);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 1rem;
  }
  .viewer img { max-width: 100%; max-height: calc(100% - 3rem); object-fit: contain; }
  .bar { display: flex; align-items: center; gap: 0.6rem; color: #fff; width: 100%; max-width: 1200px; padding-top: 0.6rem; }
  .spacer { flex: 1; }
</style>
