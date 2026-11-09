// Cloudflare Worker that relays the trip planner's GitHub requests, for
// networks that block api.github.com (but allow Cloudflare). Setup steps are
// in README.md under "Relay for networks that block GitHub".
//
//   https://<worker>/repos/<owner>/<repo>/...      -> https://api.github.com/repos/<owner>/<repo>/...
//   https://<worker>/raw/<owner>/<repo>/<branch>/… -> https://raw.githubusercontent.com/<owner>/<repo>/<branch>/…
//
// Variables (Worker settings → Variables and Secrets):
//   ALLOWED_REPOS    comma-separated "owner/repo" list, e.g. "alexjj/sota-planner"
//   ALLOWED_ORIGINS  comma-separated site origins, e.g. "https://alexjj.github.io,http://localhost:5173"
//
// It keeps nothing: your token travels with each request, as it would to GitHub.
// Only requests for the allowed repos are passed on, so it isn't an open proxy.

const PASS_HEADERS = ['authorization', 'accept', 'content-type', 'x-github-api-version'];

const list = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type, X-GitHub-Api-Version',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function reply(status, message, headers = {}) {
  return new Response(JSON.stringify({ message }), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const origins = list(env.ALLOWED_ORIGINS);
    const repos = list(env.ALLOWED_REPOS).map((r) => r.toLowerCase());

    if (!repos.length) return reply(500, 'Relay not set up: set ALLOWED_REPOS.');
    // Browsers send Origin on these cross-site requests; <img> loads of photos don't, so allow those.
    if (origin && !origins.includes(origin)) return reply(403, `Origin ${origin} is not in ALLOWED_ORIGINS.`);
    const corsHeaders = origin ? cors(origin) : {};
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    let target, raw = false;
    let m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(url.pathname);
    if (m) {
      target = `https://api.github.com${url.pathname}${url.search}`;
    } else if ((m = /^\/raw\/([^/]+\/[^/]+)\/.+$/.exec(url.pathname)) && request.method === 'GET') {
      target = `https://raw.githubusercontent.com${url.pathname.slice(4)}`;
      raw = true;
    } else {
      return reply(404, 'Not a relayed path.', corsHeaders);
    }
    if (!repos.includes(decodeURIComponent(m[1]).toLowerCase())) {
      return reply(403, `${m[1]} is not in ALLOWED_REPOS.`, corsHeaders);
    }

    const headers = new Headers({ 'User-Agent': 'sota-trip-planner-relay' });
    if (!raw) {
      for (const h of PASS_HEADERS) {
        const v = request.headers.get(h);
        if (v) headers.set(h, v);
      }
    }
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    });

    const out = new Headers();
    for (const h of ['content-type', 'etag', 'last-modified']) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    out.set('Cache-Control', 'no-store');
    for (const [k, v] of Object.entries(corsHeaders)) out.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
