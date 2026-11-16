// Downloads your SOTA activator log and writes data/activations.json: for each
// summit you've activated, how many times and the latest date. The home map
// uses it to mark (and let you hide) summits you've already done.
//
//   npm run import-activations
//
// Your SOTA database user id comes from SOTA_USER_ID in the environment or in
// .env (the number in https://api-db2.sota.org.uk/logs/activator/<id>/9999/1).
// A GitHub Action runs this nightly; see .github/workflows/update-activations.yml.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'data', 'activations.json');

async function userId() {
  if (process.env.SOTA_USER_ID) return process.env.SOTA_USER_ID.trim();
  const env = await readFile(path.join(root, '.env'), 'utf8').catch(() => '');
  return /^\s*SOTA_USER_ID\s*=\s*(\S*)/m.exec(env)?.[1] ?? '';
}

const id = await userId();
if (!/^\d+$/.test(id)) {
  console.error('Set SOTA_USER_ID (in .env or the environment) to your SOTA database user id.');
  process.exit(1);
}

// 9999 = your whole log (0 would be only the last 12 months).
const res = await fetch(`https://api-db2.sota.org.uk/logs/activator/${id}/9999/1`);
if (!res.ok) throw new Error(`SOTA activator log answered ${res.status}`);
const rows = await res.json();
if (!Array.isArray(rows)) throw new Error(`Unexpected answer from the activator log: ${JSON.stringify(rows).slice(0, 200)}`);

const summits = {};
for (const a of rows) {
  if (!a.SummitCode) continue;
  const s = (summits[a.SummitCode] ??= { count: 0, last: '' });
  s.count++;
  if ((a.ActivationDate ?? '') > s.last) s.last = a.ActivationDate;
}
// Sorted, with no download date, so the file only changes when the log does.
// One summit per line keeps the nightly diffs readable.
const refs = Object.keys(summits).sort();
const body = refs.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(summits[k])}`).join(',\n');
await writeFile(out, `{\n "source": "SOTA activator log, sota.org.uk",\n "summits": {\n${body}\n }\n}\n`);
console.log(`Wrote data/activations.json: ${refs.length} summits from ${rows.length} activations`);
