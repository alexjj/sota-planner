// Shrink photos in the browser before upload so the repo stays small.

const MAX_SIDE = 1600;
const QUALITY = 0.82;

/** @returns {Promise<string>} JPEG data URL */
export async function resizeImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // PNG screenshots with transparency
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', QUALITY);
}

export function photoFileName(hint) {
  const base = String(hint ?? 'photo').toLowerCase().replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'photo';
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${base}.jpg`;
}
