// Cloudflare Worker that relays the trip planner's GitHub requests, for
// networks that block api.github.com (but allow Cloudflare). Setup steps are
// in README.md under "Relay for networks that block GitHub".
//
//   https://<worker>/repos/<owner>/<repo>/...      -> https://api.github.com/repos/<owner>/<repo>/...
//   https://<worker>/raw/<owner>/<repo>/<branch>/… -> https://raw.githubusercontent.com/<owner>/<repo>/<branch>/…
//
// It also serves Ordnance Survey Leisure map tiles (1:25k/1:50k) with the OS API key
// added here, so the key never appears in the public site:
//
//   https://<worker>/os/<z>/<x>/<y>.png             -> https://api.os.uk/maps/raster/v1/zxy/Leisure_27700/<z>/<x>/<y>.png
//
// Variables (Worker settings → Variables and Secrets):
//   ALLOWED_REPOS    comma-separated "owner/repo" list, e.g. "alexjj/sota-planner"
//   ALLOWED_ORIGINS  comma-separated site origins, e.g. "https://alexjj.github.io,http://localhost:5173"
//   OS_API_KEY       (Secret) OS Data Hub project key with the OS Maps API; only needed for /os/
//
// It keeps nothing: your token travels with each request, as it would to GitHub.
// Only requests for the allowed repos are passed on, so it isn't an open proxy.
// Map tiles are only served to pages on ALLOWED_ORIGINS (checked from the Referer
// browsers send with tile images). That stops other sites using your OS key, though
// not someone who fakes the header on purpose.

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

const OS_TILES = 'https://api.os.uk/maps/raster/v1/zxy/Leisure_27700';
const OS_MAX_ZOOM = 9; // deepest Leisure_27700 level

async function osTile(request, env, origins, path) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return reply(405, 'Tiles are GET only.');
  const m = /^\/os\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(path);
  if (!m || Number(m[1]) > OS_MAX_ZOOM) return reply(404, 'Not a map tile.');
  if (!env.OS_API_KEY) return reply(500, 'Relay not set up for OS maps: set OS_API_KEY.');
  // Tile <img> requests don't send Origin, but browsers send the page's origin as Referer.
  let from = request.headers.get('Origin');
  if (!from) {
    try { from = new URL(request.headers.get('Referer')).origin; } catch { from = null; }
  }
  if (!from || !origins.includes(from)) return reply(403, 'Map tiles are only served to the trip planner.');

  const upstream = await fetch(`${OS_TILES}/${m[1]}/${m[2]}/${m[3]}.png?key=${encodeURIComponent(env.OS_API_KEY)}`);
  const out = new Headers({ 'Content-Type': upstream.headers.get('content-type') ?? 'image/png' });
  // Let browsers keep tiles for a week: each tile they fetch again counts against the OS allowance.
  out.set('Cache-Control', upstream.ok ? 'public, max-age=604800' : 'no-store');
  out.set('Access-Control-Allow-Origin', from);
  out.set('Vary', 'Origin, Referer');
  return new Response(upstream.ok ? upstream.body : null, { status: upstream.status, headers: out });
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

    if (url.pathname.startsWith('/os/')) return osTile(request, env, origins, url.pathname);
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
