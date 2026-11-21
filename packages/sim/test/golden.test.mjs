/**
 * Golden numbers: every template, at several traffic levels and after 30 s of runtime, must keep
 * producing the same results. A physics change that moves them shows up here as a diff.
 * When the change is intended, regenerate:  UPDATE_GOLDEN=1 pnpm --filter @syslab/sim test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { S, run } from './helpers.mjs';

const FILE = fileURLToPath(new URL('./golden.json', import.meta.url));
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : String(x));

function snapshot() {
  const out = {};
  for (const t of S.TEMPLATES) {
    if (t.key === 'blank') continue;
    const base = S.buildTemplate(t.key).doc;
    for (const mult of [0.5, 1, 3]) {
      const doc = { ...base, users: Math.round(base.users * mult) };
      const { sim } = run(doc, 30);
      out[`${t.key}@${mult}x`] = {
        rps: r3(sim.rps), mean: r3(sim.meanLatency), p95: r3(sim.p95), p99: r3(sim.p99),
        errorRate: r3(sim.errorRate), cost: r3(sim.cost),
        load: Object.fromEntries(doc.nodes.filter((n) => n.kind !== 'users').map((n) => [n.label, r3(sim.load[n.id] ?? 0)])),
      };
    }
  }
  return out;
}

test('golden numbers for every template', () => {
  const now = snapshot();
  if (process.env.UPDATE_GOLDEN || !fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify(now, null, 2) + '\n');
    return;
  }
  const want = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  assert.deepEqual(Object.keys(now).sort(), Object.keys(want).sort());
  const close = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 0.005 * Math.max(1, Math.abs(b)) : a === b);
  const diffs = [];
  for (const [k, v] of Object.entries(want)) {
    for (const [f, x] of Object.entries(v)) {
      if (f === 'load') { for (const [n, l] of Object.entries(x)) if (!close(now[k].load[n], l)) diffs.push(`${k} load ${n}: ${l} → ${now[k].load[n]}`); }
      else if (!close(now[k][f], x)) diffs.push(`${k} ${f}: ${x} → ${now[k][f]}`);
    }
  }
  assert.deepEqual(diffs, [], 'numbers moved; if intended run UPDATE_GOLDEN=1');
});
