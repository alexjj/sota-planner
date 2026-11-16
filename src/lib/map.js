import L from 'leaflet';
import proj4 from 'proj4';
import { trackModes } from './plan.js';

const BASE_KEY = 'sota-trip-base-layer';

// Ordnance Survey Leisure maps (Landranger 1:50k / Explorer 1:25k), served through
// the relay Worker (relay/worker.js), which adds the OS API key. Set VITE_OS_TILES
// in .env to the Worker address to turn the layer on.
const OS_TILES = (import.meta.env.VITE_OS_TILES ?? '').trim().replace(/\/+$/, '');
const OS_NAME = 'OS Leisure (1:25k/1:50k)';

// OS tiles only come in British National Grid (EPSG:27700), so the map switches
// CRS when that layer is picked. Grid from the OS Maps API docs.
proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 '
  + '+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');
const toBng = proj4('EPSG:4326', 'EPSG:27700');
const OS_RES0 = 896; // metres per pixel at zoom 0, halving each level
const OS_ORIGIN = [-238375, 1376256];
export const OSGB = L.extend({}, L.CRS.Earth, {
  code: 'EPSG:27700',
  projection: {
    bounds: L.bounds([-238375, 0], [900000, 1376256]),
    project: (ll) => L.point(toBng.forward([ll.lng, ll.lat])),
    unproject: (p) => { const [lng, lat] = toBng.inverse([p.x, p.y]); return L.latLng(lat, lng); },
  },
  transformation: new L.Transformation(1, -OS_ORIGIN[0], -1, OS_ORIGIN[1]),
  scale: (z) => 2 ** z / OS_RES0,
  zoom: (s) => Math.log2(s * OS_RES0),
  wrapLng: undefined,
  infinite: false,
});

/** Web Mercator zoom minus this map CRS's zoom for the same ground scale at `lat`. */
function zoomShift(crs, lat) {
  if (crs !== OSGB) return 0;
  return Math.log2((2 * Math.PI * 6378137 * Math.cos(lat * Math.PI / 180)) / 256 / OS_RES0);
}

/** The map's zoom as a Web Mercator (OpenTopoMap) zoom, whichever base layer is showing. */
export function webZoom(map, zoom = map.getZoom()) {
  return zoom + zoomShift(map.options.crs, map.getCenter().lat);
}

/** A Web Mercator zoom (like 13) as a zoom for this map's current CRS. */
export function mapZoom(map, zoom, lat = map.getCenter().lat) {
  return Math.round(zoom - zoomShift(map.options.crs, lat));
}

/** Switch the map to `crs` (when a base layer needs it), keeping the same place and scale. */
function useCrs(map, crs, layer) {
  if (map.options.crs === crs) return;
  // A layer's own maxZoom has to suit every CRS, or the layer menu greys it out at
  // zooms that only make sense in another one, so the limit for this CRS goes on the map.
  const setCrs = () => { map.options.crs = crs; map.options.maxZoom = layer.options.crsMaxZoom; };
  if (!map._loaded) { setCrs(); return; }
  // Finish any zoom or pan animation first, or it lands in the new CRS at the old zoom.
  // (Not map.stop(): that can start a zoom of its own.)
  if (map._animatingZoom) map._onZoomTransitionEnd();
  map._stop();
  const center = map.getCenter();
  const zoom = webZoom(map);
  setCrs();
  const max = layer.options.crsMaxZoom ?? layer.options.maxZoom;
  const z = Math.min(Math.max(mapZoom(map, zoom, center.lat), layer.options.minZoom ?? 0), max);
  map._resetView(center, z);
  map.fire('zoomlevelschange');
  map.fire('zoomend'); // re-size summit dots even if the zoom number didn't change
}

/** A tile layer that puts the map into `crs` before it's added. */
function baseLayer(crs, url, options) {
  const layer = L.tileLayer(url, options);
  const own = layer.beforeAdd; // GridLayer's: registers the layer's zoom limits
  layer.beforeAdd = function (map) {
    useCrs(map, crs, layer);
    return own.call(this, map);
  };
  return layer;
}

/** A Leaflet map with OpenTopoMap and a couple of alternative base layers. */
export function createMap(el, { view } = {}) {
  const web = L.CRS.EPSG3857;
  const bases = {
    OpenTopoMap: baseLayer(web, 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc', maxNativeZoom: 17, maxZoom: 18,
      attribution: 'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    }),
    OpenStreetMap: baseLayer(web, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
    Satellite: baseLayer(web, 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    }),
  };
  if (OS_TILES) {
    bases[OS_NAME] = baseLayer(OSGB, `${OS_TILES}/os/{z}/{x}/{y}.png`, {
      minZoom: 0, maxNativeZoom: 9, maxZoom: 19, crsMaxZoom: 11,
      bounds: [[49.5, -9], [61.2, 2.5]],
      attribution: 'Contains OS data © Crown copyright and database rights ' + new Date().getFullYear(),
    });
  }
  let baseName = 'OpenTopoMap';
  try { baseName = localStorage.getItem(BASE_KEY) ?? baseName; } catch {}
  const base = bases[baseName] ?? bases.OpenTopoMap;
  const crs = base === bases[OS_NAME] ? OSGB : web;
  const map = L.map(el, { preferCanvas: true, crs, maxZoom: base.options.crsMaxZoom, layers: [base] });
  // Views are kept as Web Mercator zooms, so they mean the same on every base layer.
  const [center, zoom] = view ? [view.center, view.zoom] : [[56.9, -4.6], 7];
  map.setView(center, mapZoom(map, zoom, L.latLng(center).lat));
  const control = L.control.layers(bases, {}, { collapsed: true }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  map.on('baselayerchange', (e) => {
    try { localStorage.setItem(BASE_KEY, e.name); } catch {}
  });
  // The page layout can settle after the map is created; keep Leaflet's idea
  // of the map size current so fitting to a route uses the real width.
  let alive = true;
  const resize = new ResizeObserver(() => { if (alive) map.invalidateSize(); });
  resize.observe(el);
  map.on('unload', () => { alive = false; resize.disconnect(); });
  return { map, control };
}

export const COLORS = {
  summit: '#d9480f',
  planned: '#2b8a3e',
  hill: '#7048e8',
  top: '#0c8599',
  route: '#1c7ed6',
  selected: '#e8590c',
};

/** SOTA points -> colour, as on sotl.as (green for 1 point through to red for 10). */
export const POINTS_COLORS = {
  1: '#4d7a20', 2: '#6da536', 4: '#aea727', 6: '#efa818', 8: '#dc5d04', 10: '#c8101e',
};

export function pointsColor(points) {
  return POINTS_COLORS[points] ?? '#000';
}

/** Linear interpolation through [zoom, value] stops, like a Mapbox "stops" function. */
function stops(list, z) {
  if (z <= list[0][0]) return list[0][1];
  for (let i = 1; i < list.length; i++) {
    const [z1, v1] = list[i];
    if (z <= z1) {
      const [z0, v0] = list[i - 1];
      return v0 + (v1 - v0) * (z - z0) / (z1 - z0);
    }
  }
  return list[list.length - 1][1];
}

/**
 * Summit dot size at a Leaflet zoom, matching sotl.as. SOTLAS uses Mapbox GL,
 * whose zoom levels are one lower than Leaflet's for the same map scale.
 */
export function summitSize(zoom) {
  const z = zoom - 1;
  return { radius: stops([[0, 0.1], [10, 8], [22, 20]], z), stroke: stops([[4, 0], [15, 2]], z) };
}

/** Resize a summit dot (from summitMarker) for the map's zoom. */
export function sizeSummitMarker(marker, zoom) {
  const { radius, stroke } = summitSize(zoom);
  const planned = marker.options.planned;
  marker.setRadius(radius + (planned ? 1.5 : 0));
  marker.setStyle({ weight: planned ? 3 : stroke });
}

/** Keep a Munro ring (hillMarker with `ring`) just outside the summit dot it surrounds. */
export function sizeHillRing(marker, zoom) {
  if (marker.options.ring) marker.setRadius(Math.max(8, summitSize(zoom).radius + 4));
}

/** Size summit dots and Munro rings on this map for its zoom, now and as it changes. */
export function sizeSummitsOnZoom(map) {
  const size = (l, z) => {
    if (l.options?.summitDot) sizeSummitMarker(l, z);
    else if (l.options?.ring) sizeHillRing(l, z);
  };
  map.on('layeradd', (e) => size(e.layer, webZoom(map)));
  map.on('zoomend', () => {
    const z = webZoom(map);
    map.eachLayer((l) => size(l, z));
  });
}

/**
 * A SOTA summit dot in its points colour, sized by zoom (see sizeSummitsOnZoom).
 * `planned` (a summit in a trip) adds a ring, in `ring` colour or the route blue.
 */
export function summitMarker(s, { planned = false, ring = COLORS.route } = {}) {
  return L.circleMarker([s.lat, s.lon], {
    radius: 5, summitDot: true, planned,
    color: planned ? ring : '#fff', weight: planned ? 3 : 1,
    fillColor: pointsColor(s.points), fillOpacity: 1,
  });
}

/** `ring` draws an outline only, for a hill that sits under a SOTA summit dot. */
export function hillMarker(h, { selected = false, color = COLORS.hill, ring = false } = {}) {
  if (ring) {
    return L.circleMarker([h.lat, h.lon], {
      radius: 8, ring: true, color, weight: 2.5, fill: true, fillOpacity: 0,
    });
  }
  return L.circleMarker([h.lat, h.lon], {
    radius: selected ? 6 : 4, color: '#fff', weight: 1,
    fillColor: color, fillOpacity: selected ? 0.95 : 0.75,
  });
}

/** `label` like "P2" and `color` tie a parking spot to its route. */
export function parkingMarker(p, { label = 'P', color = null, ...opts } = {}) {
  const style = color ? ` style="background:${color}"` : '';
  return L.marker([p.lat, p.lon], {
    icon: L.divIcon({
      className: 'parking-wrap',
      html: `<div class="parking-icon"${style}>${esc(label)}</div>`,
      iconSize: [label.length > 1 ? 28 : 22, 22],
    }),
    ...opts,
  });
}

/** GPX lines (arrays of {lat,lon}) or simplified [[lat,lon]] arrays. */
export function trackLayer(lines, style = {}) {
  const latlngs = lines.map((pts) => pts.map((p) => (Array.isArray(p) ? p : [p.lat, p.lon])));
  return L.polyline(latlngs, { color: COLORS.route, weight: 4, opacity: 0.85, ...style });
}

/** Cycling stretches of a route with bike drops (the same orange as the Settings split map). */
export const CYCLE_COLOR = '#e8590c';

/**
 * A route's track, with the cycling stretches (before and after each bike drop)
 * in CYCLE_COLOR so you can see where the bike is left. Without bike drops it's
 * a plain trackLayer.
 */
export function routeTrack(lines, drops, style = {}) {
  if (!drops?.length) return trackLayer(lines, style);
  const pts = lines.map((l) => l.map((p) => (Array.isArray(p) ? { lat: p[0], lon: p[1] } : p)));
  const parts = trackModes(pts, drops);
  if (!parts.some((p) => p.mode === 'cycle')) return trackLayer(lines, style);
  // A route that is itself orange gets dark cycling stretches instead.
  const cycle = (style.color ?? COLORS.route).toLowerCase() === CYCLE_COLOR ? '#343a40' : CYCLE_COLOR;
  return L.featureGroup(parts.map((p) => trackLayer([p.pts], { ...style, ...(p.mode === 'cycle' ? { color: cycle } : {}) })));
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Search Walkhighlands for a hill by name, via DuckDuckGo. */
export function walkhighlandsSearch(name) {
  const q = `${name.toLowerCase()} site:www.walkhighlands.co.uk`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(q).replace(/%20/g, '+')}`;
}

/** Links for a DoBIH hill: Hill Bagging page and a Walkhighlands search. */
export function hillLinks(h) {
  return {
    hillBagging: `https://www.hill-bagging.co.uk/hill-view/?qu=S&rf=${h.id}`,
    walkhighlands: walkhighlandsSearch(h.name),
  };
}

export function summitLinks(ref, name = '') {
  return {
    sotlas: `https://sotl.as/summits/${ref}`,
    walkhighlands: walkhighlandsSearch(name),
  };
}
