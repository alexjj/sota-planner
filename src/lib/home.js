// Your home location, for working out drive times. Kept only in this
// browser's local storage (like the GitHub token), never in the repo.

const HOME_KEY = 'sota-trip-home';
const PAD_KEY = 'sota-trip-drive-pad';
/** Router times tend to be quick for Highland roads: add this % by default. */
export const DEFAULT_DRIVE_PAD = 15;

/** @returns {{ lat: number, lon: number } | null} */
export function loadHome() {
  try {
    const h = JSON.parse(localStorage.getItem(HOME_KEY));
    return Number.isFinite(h?.lat) && Number.isFinite(h?.lon) ? h : null;
  } catch { return null; }
}

export function saveHome(home) {
  localStorage.setItem(HOME_KEY, JSON.stringify({ lat: home.lat, lon: home.lon }));
}

export function clearHome() {
  try { localStorage.removeItem(HOME_KEY); } catch {}
}

/** Percentage added to routed drive times. */
export function loadDrivePad() {
  try {
    const v = Number(localStorage.getItem(PAD_KEY));
    return localStorage.getItem(PAD_KEY) != null && Number.isFinite(v) ? v : DEFAULT_DRIVE_PAD;
  } catch { return DEFAULT_DRIVE_PAD; }
}

export function saveDrivePad(pct) {
  try { localStorage.setItem(PAD_KEY, String(pct)); } catch {}
}
