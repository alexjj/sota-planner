import L from 'leaflet';

const BASE_KEY = 'sota-trip-base-layer';

/** A Leaflet map with OpenTopoMap and a couple of alternative base layers. */
export function createMap(el, { view } = {}) {
  const bases = {
    OpenTopoMap: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc', maxNativeZoom: 17, maxZoom: 18,
      attribution: 'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    }),
    OpenStreetMap: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
    Satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    }),
  };
  let baseName = 'OpenTopoMap';
  try { baseName = localStorage.getItem(BASE_KEY) ?? baseName; } catch {}
  const map = L.map(el, {
    preferCanvas: true,
    layers: [bases[baseName] ?? bases.OpenTopoMap],
  });
  if (view) map.setView(view.center, view.zoom);
  else map.setView([56.9, -4.6], 7);
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

/** Resize points-coloured summit markers (made with `byPoints`) for the map's zoom. */
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

/**
 * `byPoints` fills the dot with its points colour; `planned` (with byPoints)
 * then marks summits that are in a trip with a ring in the route colour.
 */
export function summitMarker(s, { planned = false, selected = false, byPoints = false } = {}) {
  if (byPoints) {
    return L.circleMarker([s.lat, s.lon], {
      radius: 5, planned, // sizeSummitMarker sets the size for the zoom
      color: planned ? COLORS.route : '#fff', weight: planned ? 3 : 1,
      fillColor: pointsColor(s.points), fillOpacity: 1,
    });
  }
  return L.circleMarker([s.lat, s.lon], {
    radius: selected ? 8 : planned ? 7 : 5,
    color: '#fff', weight: 1.5,
    fillColor: selected ? COLORS.selected : planned ? COLORS.planned : COLORS.summit,
    fillOpacity: 0.95,
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

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Search Walkhighlands for a hill by name, via DuckDuckGo. */
export function walkhighlandsSearch(name) {
  const q = `${name.toLowerCase()} site:www.walkhighlands.co.uk`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(q).replace(/%20/g, '+')}`;
}

export function summitLinks(ref, name = '') {
  return {
    sotlas: `https://sotl.as/summits/${ref}`,
    walkhighlands: walkhighlandsSearch(name),
  };
}
