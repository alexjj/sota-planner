// Timetable maths. Times are minutes since midnight of the start day, so an
// overnight trip just runs past 1440.

export const STAGE_TYPES = {
  drive: { label: 'Drive', icon: '🚗', minutes: 60 },
  cycle: { label: 'Cycle', icon: '🚲', minutes: 45 },
  walk: { label: 'Walk', icon: '🥾', minutes: 120 },
  activate: { label: 'Activate', icon: '📻', minutes: 40 },
  break: { label: 'Break', icon: '☕', minutes: 15 },
  camp: { label: 'Camp', icon: '⛺', minutes: 600 },
  other: { label: 'Other', icon: '•', minutes: 30 },
};

export function typeInfo(type) {
  return STAGE_TYPES[type] ?? STAGE_TYPES.other;
}

/** "07:30" -> 450. Returns null if it can't be read. */
export function parseClock(s) {
  const m = /^\s*(\d{1,2})[:.h]?(\d{2})\s*$/.exec(s ?? '');
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** 450 -> "07:30"; past midnight adds the day, e.g. "06:00 +1". */
export function fmtClock(mins, withDay = true) {
  const day = Math.floor(mins / 1440);
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  const s = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return withDay && day > 0 ? `${s} +${day}` : s;
}

/** 95 -> "1h 35m" */
export function fmtDuration(mins) {
  if (mins == null || Number.isNaN(mins)) return '–';
  mins = Math.round(mins);
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}

/** Accepts "90", "1:30", "1h30", "1h 30m", "1.5h", "45m". Returns minutes or null. */
export function parseDuration(s) {
  s = String(s ?? '').trim().toLowerCase();
  if (!s) return null;
  let m;
  if ((m = /^(\d+):(\d{1,2})$/.exec(s))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = /^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/.exec(s))) {
    return Math.round(Number(m[1]) * 60 + Number(m[2] ?? 0));
  }
  if ((m = /^(\d+)\s*(?:m|mins?|minutes?)?$/.exec(s))) return Number(m[1]);
  return null;
}

/** Duration string as you'd type it back into the editor. */
export function durationInput(mins) {
  if (mins == null) return '';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}` : String(m);
}

/**
 * Work out clock times for each stage. A stage with `until` (e.g. "06:00")
 * lasts until the next time the clock shows that time, which is how an
 * overnight camp is entered.
 */
export function schedule(startClock, stages) {
  let t = parseClock(startClock) ?? 7 * 60;
  const start = t;
  const rows = (stages ?? []).map((stage) => {
    let minutes = stage.minutes ?? 0;
    const until = parseClock(stage.until);
    if (until != null) {
      const dayStart = Math.floor(t / 1440) * 1440;
      let end = dayStart + until;
      if (end <= t) end += 1440;
      minutes = end - t;
    }
    const row = { ...stage, start: t, end: t + minutes, minutes };
    t += minutes;
    return row;
  });
  const totals = {};
  for (const r of rows) totals[r.type] = (totals[r.type] ?? 0) + r.minutes;
  return { start, end: t, total: t - start, rows, totals };
}
