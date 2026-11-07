// GPX parsing and route statistics. Plain string parsing so the same code runs
// in the browser (editor preview) and in Node (edit server, building the index).

/** @typedef {{lat:number, lon:number, ele:number|null}} Point */

/**
 * Extract track points from a GPX document. Track segments, routes and
 * waypoint-only files are all handled; each segment becomes its own line.
 * @param {string} text
 * @returns {Point[][]}
 */
export function parseGpx(text) {
  const lines = [];
  const pointRe = /<(trkpt|rtept)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  const groupRe = /<(trkseg|rte)\b[^>]*>([\s\S]*?)<\/\1>/g;
  for (const group of text.matchAll(groupRe)) {
    const pts = [];
    for (const m of group[2].matchAll(pointRe)) {
      const lat = attr(m[2], 'lat'), lon = attr(m[2], 'lon');
      if (lat == null || lon == null) continue;
      const eleMatch = m[4] && /<ele>\s*([-\d.eE+]+)\s*<\/ele>/.exec(m[4]);
      pts.push({ lat, lon, ele: eleMatch ? Number(eleMatch[1]) : null });
    }
    if (pts.length > 1) lines.push(pts);
  }
  return lines;
}

function attr(attrs, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([-\\d.eE+]+)["']`).exec(attrs);
  return m ? Number(m[1]) : null;
}

/** Great-circle distance in metres. */
export function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Distance, ascent and descent. Elevation changes smaller than `threshold`
 * metres are ignored so GPS/DEM noise doesn't inflate the ascent.
 * @param {Point[][]} lines
 */
export function gpxStats(lines, threshold = 5) {
  let distance = 0, ascent = 0, descent = 0, maxEle = null;
  for (const pts of lines) {
    let ref = null;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) distance += distanceM(pts[i - 1], pts[i]);
      const e = pts[i].ele;
      if (e == null) continue;
      if (maxEle == null || e > maxEle) maxEle = e;
      if (ref == null) { ref = e; continue; }
      if (e - ref >= threshold) { ascent += e - ref; ref = e; }
      else if (ref - e >= threshold) { descent += ref - e; ref = e; }
    }
  }
  const start = lines[0]?.[0];
  return {
    distanceKm: round(distance / 1000, 2),
    ascentM: Math.round(ascent),
    descentM: Math.round(descent),
    maxEleM: maxEle == null ? null : Math.round(maxEle),
    start: start ? { lat: round(start.lat, 6), lon: round(start.lon, 6) } : null,
  };
}

/**
 * Naismith's rule: 5 km/h plus 10 minutes per 100 m of ascent.
 * `pace` scales the result (1.0 = Naismith, 0.8 = 20% faster).
 */
export function naismithMinutes(distanceKm, ascentM, pace = 1) {
  return Math.round(((distanceKm / 5) * 60 + (ascentM / 100) * 10) * pace);
}

/** Thin a line to points at least `minM` metres apart, for overview maps. */
export function simplify(lines, minM = 80) {
  return lines.map((pts) => {
    const out = [pts[0]];
    for (const p of pts.slice(1, -1)) {
      if (distanceM(out[out.length - 1], p) >= minM) out.push(p);
    }
    out.push(pts[pts.length - 1]);
    return out.map((p) => [round(p.lat, 5), round(p.lon, 5)]);
  });
}

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
