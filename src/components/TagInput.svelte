<script>
  // Comma-separated tags with suggestions from tags already used on other trips.
  // A typed tag that matches an existing one apart from capitals or a plural
  // "s" is saved with the existing spelling, so tags stay consistent.
  let { tags = $bindable([]), known = [], id } = $props();

  // Set once when the editor opens; after that the text box is the source.
  // svelte-ignore state_referenced_locally
  let text = $state(tags.join(', '));
  let focused = $state(false);
  let active = $state(0);
  let input;

  const byKey = $derived(new Map(known.map((k) => [k.tag.toLowerCase(), k.tag])));
  // "bike" ~ "bikes", "munro" ~ "munros", "bus" ~ "buses"
  const plural = (a, b) => a.length > 2 && (b === a + 's' || b === a + 'es');

  /** The existing spelling of a tag, if there is one. */
  function canonical(tag) {
    const lower = tag.toLowerCase();
    if (byKey.has(lower)) return byKey.get(lower);
    for (const k of known) {
      const kl = k.tag.toLowerCase();
      if (plural(kl, lower) || plural(lower, kl)) return k.tag;
    }
    return tag;
  }

  function parse(t) {
    const out = [];
    for (const raw of t.split(',')) {
      const tag = canonical(raw.trim());
      if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
    }
    return out;
  }

  $effect(() => { tags = parse(text); });

  // The tag being typed: whatever follows the last comma.
  const current = $derived(text.slice(text.lastIndexOf(',') + 1).trim().toLowerCase());
  const done = $derived(new Set(text.split(',').slice(0, -1).map((t) => t.trim().toLowerCase())));
  const matches = $derived(!current ? [] : known
    .filter((k) => !done.has(k.tag.toLowerCase()) && k.tag.toLowerCase().includes(current)
      && k.tag.toLowerCase() !== current)
    .sort((a, b) => Number(b.tag.toLowerCase().startsWith(current)) - Number(a.tag.toLowerCase().startsWith(current)))
    .slice(0, 8));
  const unused = $derived(known.filter((k) => !tags.some((t) => t.toLowerCase() === k.tag.toLowerCase())).slice(0, 20));

  $effect(() => { matches; active = 0; });

  function choose(tag) {
    const head = text.slice(0, text.lastIndexOf(',') + 1);
    text = `${head}${head ? ' ' : ''}${tag}, `;
    input?.focus();
  }

  function add(tag) {
    const list = parse(text);
    list.push(tag);
    text = list.join(', ') + ', ';
  }

  function key(e) {
    if (!matches.length) return;
    if (e.key === 'ArrowDown') { active = (active + 1) % matches.length; e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = (active - 1 + matches.length) % matches.length; e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { choose(matches[active].tag); e.preventDefault(); }
    else if (e.key === 'Escape') { focused = false; }
  }

  function blur() {
    focused = false;
    text = parse(text).join(', '); // show the tidied spelling
  }
</script>

<div class="tags">
  <input {id} bind:this={input} bind:value={text} placeholder="winter, bike, long day" autocomplete="off"
         onfocus={() => (focused = true)} onblur={blur} oninput={() => (focused = true)} onkeydown={key} />
  {#if focused && matches.length}
    <ul>
      {#each matches as m, i}
        <li>
          <button type="button" class:active={i === active} onmousedown={(e) => { e.preventDefault(); choose(m.tag); }}
                  onmouseenter={() => (active = i)}>
            <span class="label">{m.tag}</span><span class="muted small">{m.count} trip{m.count === 1 ? '' : 's'}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if unused.length}
    <div class="known small">
      <span class="muted">Used before:</span>
      {#each unused as k}
        <button type="button" class="small tag" onclick={() => add(k.tag)} title="Add this tag">+ {k.tag}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tags { position: relative; }
  input { width: 100%; }
  ul {
    position: absolute; z-index: 1000; left: 0; right: 0; top: 2.2em;
    list-style: none; margin: 2px 0 0; padding: 0.25rem;
    background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    max-height: 260px; overflow: auto;
  }
  ul button { width: 100%; border: 0; justify-content: flex-start; text-align: left; }
  ul button.active { background: var(--soft); }
  .label { flex: 1; }
  .known { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; margin-top: 0.35rem; }
  .tag { padding: 0.05rem 0.45rem; }
</style>
