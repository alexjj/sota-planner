// Ground heights from open terrain tiles (no key): each pixel's colour encodes
// a height in metres (Terrarium encoding). Browser only (decodes images).
//  - AWS Terrain Tiles: Mapzen's blend of open DEMs (SRTM and others), about
//    30 m detail in Scotland. Fills in heights on GPX tracks.
//  - Mapterhorn: Copernicus GLO-30 and others, about 10 m pixels here. Much
//    closer on summits (tops a median 5 m low, against 15 m), so activation
//    zones use it.
import { densify } from './gpx.js';
import { zoneFromGrid, ZONE_DROP, ZONE_VERSION } from './zones.js';

const AWS = { name: 'aws', zoom: 13, size: 256, url: (x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/${x}/${y}.png` };
const MAPTERHORN = { name: 'mapterhorn', zoom: 12, size: 512, url: (x, y) => `https://tiles.mapterhorn.com/12/${x}/${y}.webp` };

export const ELEVATION_SOURCE = 'Heights from AWS Terrain Tiles (open DEM data, ~30 m)';
export const ZONE_SOURCE = 'Mapterhorn terrain (Copernicus GLO-30 and others)';

const tiles = new Map(); // "source/x/y" -> Promise<Float32Array of heights>

function tile(src, x, y) {
  const key = `${src.name}/${x}/${y}`;
  if (!tiles.has(key)) {
    const p = loadTile(src, x, y);
    p.catch(() => tiles.delete(key));
    tiles.set(key, p);
  }
  return tiles.get(key);
}

async function loadTile(src, x, y) {
  const res = await fetch(src.url(x, y));
  if (!res.ok) throw new Error(`Terrain tile ${src.zoom}/${x}/${y}: ${res.status}`);
  // No colour management or premultiplying: the pixel values are data, not colours.
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const { size } = src;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  return out;
}

/** Web Mercator pixel position of a point (fractional). */
function pixel(src, lat, lon) {
  const n = 2 ** src.zoom * src.size;
  const r = lat * Math.PI / 180;
  return {
    x: (lon + 180) / 360 * n,
    y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n,
  };
}

/** Latitude and longitude of a Web Mercator pixel position. */
function latLon(src, x, y) {
  const n = 2 ** src.zoom * src.size;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  return [lat, x / n * 360 - 180];
}

/** Ground size of one pixel at a latitude, in metres. */
const pixelMetres = (src, lat) => 40075016.686 * Math.cos(lat * Math.PI / 180) / (2 ** src.zoom * src.size);

/** Height at one point, interpolated between the four nearest pixels. */
async function heightAt(lat, lon, src = AWS) {
  const { size } = src;
  const { x, y } = pixel(src, lat, lon);
  const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  const at = async (px, py) => {
    const t = await tile(src, Math.floor(px / size), Math.floor(py / size));
    return t[(py % size) * size + (px % size)];
  };
  const [a, b, c, d] = await Promise.all([at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)]);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/**
 * Heights in a square around a point, one per pixel (cell centres at whole
 * numbers in the returned grid's coordinates).
 */
async function heightGrid(src, lat, lon, halfMetres) {
  const { size } = src;
  const c = pixel(src, lat, lon);
  const metres = pixelMetres(src, lat);
  const half = Math.ceil(halfMetres / metres);
  const x0 = Math.floor(c.x) - half, y0 = Math.floor(c.y) - half;
  const w = 2 * half + 1, h = 2 * half + 1;
  const loads = new Map();
  for (let ty = Math.floor(y0 / size); ty <= Math.floor((y0 + h - 1) / size); ty++) {
    for (let tx = Math.floor(x0 / size); tx <= Math.floor((x0 + w - 1) / size); tx++) loads.set(`${tx}/${ty}`, tile(src, tx, ty));
  }
  const got = new Map(await Promise.all([...loads].map(async ([k, p]) => [k, await p])));
  const z = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const py = y0 + y, ty = Math.floor(py / size);
    for (let x = 0; x < w; x++) {
      const px = x0 + x, tx = Math.floor(px / size);
      z[y * w + x] = got.get(`${tx}/${ty}`)[(py - ty * size) * size + (px - tx * size)];
    }
  }
  return {
    w, h, z, metres,
    centre: half * w + half, // the cell holding the point
    toLatLon: (x, y) => latLon(src, x0 + x + 0.5, y0 + y + 0.5),
  };
}

/**
 * A summit's activation zone: the top is the highest ground within 100 m of
 * the summit's position, and the zone is everything joined to it no lower than
 * 25 m below that. The drop is measured within the terrain data, not from the
 * SOTA height, since the data rounds off tops a little (a few metres, more on
 * sharp ones) and 25 m below the official height would cut the zone short.
 * The search area grows until the zone fits, up to 6.4 km either way.
 * @param summit { lat, lon }
 * @returns { v, top, threshold, ring: [[lat, lon], ...], truncated? }
 */
export async function activationZone(summit) {
  let half = 800;
  for (;;) {
    const grid = await heightGrid(MAPTERHORN, summit.lat, summit.lon, half);
    const r = Math.ceil(100 / grid.metres);
    const cx = grid.centre % grid.w, cy = (grid.centre - cx) / grid.w;
    let top = grid.centre;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        const i = y * grid.w + x;
        if (grid.z[i] > grid.z[top]) top = i;
      }
    }
    const peak = grid.z[top];
    const threshold = peak - ZONE_DROP;
    const zone = zoneFromGrid(grid, top, threshold);
    if (!zone) throw new Error('No ground near the summit is high enough');
    if (!zone.touchesEdge || half >= 6400) {
      return {
        v: ZONE_VERSION, top: Math.round(peak * 10) / 10, threshold: Math.round(threshold * 10) / 10,
        ring: zone.ring, ...(zone.touchesEdge ? { truncated: true } : {}),
      };
    }
    half *= 2;
  }
}

/**
 * Heights for every point that lacks one, after adding points every ~25 m so
 * climbs between widely spaced route points count. Returns new lines.
 * @param {import('./gpx.js').Point[][]} lines
 */
export async function addElevation(lines) {
  const dense = densify(lines, 25);
  return Promise.all(dense.map((pts) => Promise.all(pts.map(async (p) =>
    (p.ele != null ? p : { ...p, ele: Math.round(await heightAt(p.lat, p.lon) * 10) / 10 })))));
}
