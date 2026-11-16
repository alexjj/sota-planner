// Ground heights from AWS Terrain Tiles (Terrarium PNGs, open data, no key):
// each pixel's colour encodes a height in metres. Browser only (decodes PNGs).
// Mapzen's blend of open DEMs (SRTM and others), about 30 m detail in Scotland.
import { densify } from './gpx.js';

const TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const ZOOM = 13; // ~10 m pixels at Scottish latitudes, finer than the source data
const SIZE = 256;

export const ELEVATION_SOURCE = 'Heights from AWS Terrain Tiles (open DEM data, ~30 m)';

const tiles = new Map(); // "x/y" -> Promise<Float32Array of heights>

function tile(x, y) {
  const key = `${x}/${y}`;
  if (!tiles.has(key)) {
    const p = loadTile(x, y);
    p.catch(() => tiles.delete(key));
    tiles.set(key, p);
  }
  return tiles.get(key);
}

async function loadTile(x, y) {
  const res = await fetch(`${TILES}/${ZOOM}/${x}/${y}.png`);
  if (!res.ok) throw new Error(`Terrain tile ${ZOOM}/${x}/${y}: ${res.status}`);
  // No colour management or premultiplying: the pixel values are data, not colours.
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const out = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  return out;
}

/** Web Mercator pixel position of a point at ZOOM (fractional). */
function pixel(lat, lon) {
  const n = 2 ** ZOOM * SIZE;
  const r = lat * Math.PI / 180;
  return {
    x: (lon + 180) / 360 * n,
    y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n,
  };
}

/** Height at one point, interpolated between the four nearest pixels. */
async function heightAt(lat, lon) {
  const { x, y } = pixel(lat, lon);
  const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  const at = async (px, py) => {
    const t = await tile(Math.floor(px / SIZE), Math.floor(py / SIZE));
    return t[(py % SIZE) * SIZE + (px % SIZE)];
  };
  const [a, b, c, d] = await Promise.all([at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)]);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
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
