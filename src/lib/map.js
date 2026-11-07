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
  return { map, control };
}

export const COLORS = {
  summit: '#d9480f',
  planned: '#2b8a3e',
  hill: '#7048e8',
  route: '#1c7ed6',
  selected: '#e8590c',
};

export function summitMarker(s, { planned = false, selected = false } = {}) {
  return L.circleMarker([s.lat, s.lon], {
    radius: selected ? 8 : planned ? 7 : 5,
    color: '#fff', weight: 1.5,
    fillColor: selected ? COLORS.selected : planned ? COLORS.planned : COLORS.summit,
    fillOpacity: 0.95,
  });
}

export function hillMarker(h, { selected = false } = {}) {
  return L.circleMarker([h.lat, h.lon], {
    radius: selected ? 6 : 4, color: '#fff', weight: 1,
    fillColor: COLORS.hill, fillOpacity: selected ? 0.95 : 0.75,
  });
}

export function parkingMarker(p, opts = {}) {
  return L.marker([p.lat, p.lon], {
    icon: L.divIcon({ className: 'parking-icon', html: 'P', iconSize: [22, 22] }),
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

export function summitLinks(ref) {
  return {
    sotlas: `https://sotl.as/summits/${ref}`,
    sotadata: `https://www.sotadata.org.uk/en/summit/${ref}`,
  };
}
