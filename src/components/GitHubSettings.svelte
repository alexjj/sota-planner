<script>
  // Paste a GitHub token to edit trips straight from the public site.
  import { loadSettings, saveSettings, clearSettings, guessRepo, checkAccess, normalizeRelay } from '../lib/github.js';

  let { onclose } = $props();

  const current = loadSettings();
  let repo = $state(current?.repo ?? guessRepo());
  let branch = $state(current?.branch ?? '');
  let relay = $state(current?.relay ?? '');
  let token = $state('');
  let checking = $state(false);
  let error = $state('');
  let dialog;

  $effect(() => { dialog.showModal(); });

  async function save(e) {
    e.preventDefault();
    error = '';
    const r = repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(r)) { error = 'Enter the repository as owner/name.'; return; }
    const t = token.trim() || current?.token;
    if (!t) { error = 'Paste a token first.'; return; }
    checking = true;
    try {
      const rl = normalizeRelay(relay);
      const info = await checkAccess({ token: t, repo: r, relay: rl });
      saveSettings({ token: t, repo: r, branch: branch.trim() || info.defaultBranch, ...(rl ? { relay: rl } : {}) });
      location.reload();
    } catch (err) {
      error = err.message;
    } finally {
      checking = false;
    }
  }

  function signOut() {
    clearSettings();
    location.reload();
  }
</script>

<dialog bind:this={dialog} onclose={onclose}>
  <form onsubmit={save}>
    <h2>Edit with GitHub</h2>
    <p class="small">
      Saving creates a commit in your repository, and the site updates a minute or two later.
      You need a <b>fine-grained personal access token</b> limited to this repository, with
      <b>Contents: Read and write</b>.
      <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create one on GitHub</a>.
    </p>

    <label for="gh-repo">Repository</label>
    <input id="gh-repo" bind:value={repo} placeholder="owner/repo" autocomplete="off" spellcheck="false" />

    <label for="gh-token">Token</label>
    <input id="gh-token" type="password" bind:value={token} autocomplete="off" spellcheck="false"
           placeholder={current ? 'Saved. Paste a new one to replace it.' : 'github_pat_…'} />

    <label for="gh-branch">Branch <span class="muted">(leave blank for the default branch)</span></label>
    <input id="gh-branch" bind:value={branch} placeholder="main" autocomplete="off" spellcheck="false" />

    <label for="gh-relay">Relay address <span class="muted">(optional)</span></label>
    <input id="gh-relay" bind:value={relay} placeholder="https://sota-relay.you.workers.dev" autocomplete="off" spellcheck="false" />
    <p class="muted small">Only needed on networks that block GitHub, such as at work: requests go through
      your own Cloudflare Worker instead (see <code>relay/</code> in the repository). Leave blank otherwise.</p>

    <p class="muted small">The token is stored only in this browser. Remove it here when you're done on a shared computer.</p>
    {#if error}<p class="error small">{error}</p>{/if}

    <div class="row">
      {#if current}<button type="button" class="danger" onclick={signOut}>Remove token</button>{/if}
      <span class="spacer"></span>
      <button type="button" onclick={() => dialog.close()}>Cancel</button>
      <button type="submit" class="primary" disabled={checking}>{checking ? 'Checking…' : 'Check and save'}</button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    border: 1px solid var(--line); border-radius: var(--radius);
    background: var(--panel); color: var(--text);
    padding: 1.2rem; width: min(520px, calc(100vw - 32px));
  }
  dialog::backdrop { background: rgba(0, 0, 0, 0.4); }
  form { display: flex; flex-direction: column; gap: 0.3rem; }
  input { width: 100%; margin-bottom: 0.4rem; }
  h2 { margin: 0 0 0.3rem; }
  p { margin: 0 0 0.5rem; }
  .spacer { flex: 1; }
</style>
