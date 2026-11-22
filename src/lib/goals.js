// Goals: groups of SOTA summits to work through (a region, the SOTA Munros, a
// hand-picked list), with progress from your activations and planned trips.
// Saved in data/goals.json. Shared by the browser and the edit server, so no
// browser- or Node-only APIs here.

export const HILL_TYPES = ['Munro', 'Corbett', 'Graham'];
export const POINTS = [1, 2, 4, 6, 8, 10];

/** "GM/CS-001" -> "CS". */
export const regionCode = (ref) => ref.split('/')[1]?.split('-')[0] ?? '';

/** Region code -> name, e.g. { CS: 'Central Scotland' }, in code order. */
export function regionNames(summits) {
  const out = {};
  for (const s of summits) out[regionCode(s.ref)] ??= s.region;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** SOTA ref -> set of hill types (Munro, Corbett, Graham) it also is, from the hill list. */
export function hillTypesByRef(hills) {
  const out = new Map();
  for (const h of hills) {
    if (!h.sota || !HILL_TYPES.includes(h.type)) continue;
    if (!out.has(h.sota)) out.set(h.sota, new Set());
    out.get(h.sota).add(h.type);
  }
  return out;
}

const emptyRule = (r) => !r.regions?.length && !r.hills?.length && !(r.minPoints > 0);

/** A goal that is every GM summit (a rule with nothing narrowing it). */
export const isEverything = (goal) => !!goal.rule && emptyRule(goal.rule);

/**
 * Does a summit belong to a goal? A goal has a rule (all of: in one of these
 * regions, one of these hill types, at least this many points; an empty part
 * matches anything) and/or a hand-picked list of refs.
 */
export function inGoal(goal, s, types) {
  if (goal.refs?.includes(s.ref)) return true;
  const r = goal.rule;
  if (!r) return false;
  if (r.regions?.length && !r.regions.includes(regionCode(s.ref))) return false;
  if (r.hills?.length && !r.hills.some((t) => types.get(s.ref)?.has(t))) return false;
  if (r.minPoints > 0 && s.points < r.minPoints) return false;
  return true;
}

/** The summits in a goal. */
export function goalSummits(goal, summits, types) {
  return summits.filter((s) => inGoal(goal, s, types));
}

/** Summits in no goal, not counting goals that are every summit. */
export function uncategorised(goals, summits, types) {
  const real = goals.filter((g) => !isEverything(g));
  return summits.filter((s) => !real.some((g) => inGoal(g, s, types)));
}

/**
 * Progress through a list of summits.
 * @param activated Map ref -> { count, last } (or null)
 * @param planned   Set of refs in trips not yet done
 */
export function progress(list, activated, planned) {
  let done = 0, plannedCount = 0, points = 0, pointsDone = 0;
  for (const s of list) {
    points += s.points;
    if (activated?.has(s.ref)) { done++; pointsDone += s.points; } else if (planned?.has(s.ref)) plannedCount++;
  }
  return { total: list.length, done, planned: plannedCount, points, pointsDone };
}

let seq = 0;
export const goalId = () => `g${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Goals to start with: all of GM, the SOTA Munros, and each region. */
export function defaultGoals(summits) {
  return [
    { id: 'all', name: 'All GM summits', rule: { regions: [], hills: [], minPoints: 0 }, refs: [] },
    { id: 'munros', name: 'SOTA Munros', rule: { regions: [], hills: ['Munro'], minPoints: 0 }, refs: [] },
    ...Object.entries(regionNames(summits)).map(([code, name]) => (
      { id: `region-${code}`, name: `GM/${code} ${name}`, rule: { regions: [code], hills: [], minPoints: 0 }, refs: [] })),
  ];
}

/** A short description of a goal's rule, e.g. "Munros in CS, WS · 6+ points · 3 picked". */
export function describeGoal(goal) {
  const parts = [];
  const r = goal.rule;
  if (r) {
    if (emptyRule(r)) parts.push('Every GM summit');
    else {
      const what = r.hills?.length ? r.hills.map((t) => `${t}s`).join(' or ') : 'Summits';
      parts.push(`${what}${r.regions?.length ? ` in ${r.regions.map((c) => `GM/${c}`).join(', ')}` : ''}`);
      if (r.minPoints > 0) parts.push(`${r.minPoints}+ points`);
    }
  }
  if (goal.refs?.length) parts.push(`${goal.refs.length} picked`);
  return parts.join(' · ') || 'Empty: add a rule or pick summits';
}

/** Keep only known fields with sensible values, for saving data/goals.json. */
export function cleanGoals(body) {
  const list = Array.isArray(body?.goals) ? body.goals : [];
  const str = (v, n) => String(v ?? '').slice(0, n);
  const ref = /^[A-Z0-9]+\/[A-Z]{2}-\d{3}$/;
  return {
    goals: list.slice(0, 100).map((g) => ({
      id: str(g.id, 40).replace(/[^\w-]/g, '') || goalId(),
      name: str(g.name, 80).trim() || 'Goal',
      rule: g.rule ? {
        regions: (Array.isArray(g.rule.regions) ? g.rule.regions : []).map((c) => str(c, 4).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
        hills: (Array.isArray(g.rule.hills) ? g.rule.hills : []).filter((t) => HILL_TYPES.includes(t)),
        minPoints: POINTS.includes(Number(g.rule.minPoints)) ? Number(g.rule.minPoints) : 0,
      } : null,
      refs: [...new Set((Array.isArray(g.refs) ? g.refs : []).map((r) => str(r, 20)).filter((r) => ref.test(r)))],
    })),
  };
}
