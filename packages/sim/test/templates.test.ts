import { describe, expect, test } from 'vitest';
import { S, run } from './helpers';

/** every edge, flow step and group refers to real nodes; ids are unique */
function expectWellFormed(doc) {
  const ids = doc.nodes.map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  const edgeIds = doc.edges.map((e) => e.id);
  expect(new Set(edgeIds).size).toBe(edgeIds.length);
  for (const e of doc.edges) {
    expect(ids).toContain(e.from);
    expect(ids).toContain(e.to);
  }
  for (const f of doc.flows) for (const s of f.steps) expect(ids).toContain(s);
  for (const n of doc.nodes) expect(S.TECHS[n.kind]).toContain(n.tech);
}

describe('buildTemplate', () => {
  test('every listed template builds a well-formed doc', () => {
    expect(S.TEMPLATES.map((t) => t.key)).toEqual(['blank', 'url', 'chat', 'ecom', 'lesson']);
    for (const t of S.TEMPLATES) {
      const { name, doc } = S.buildTemplate(t.key);
      expect(name).toBeTruthy();
      expectWellFormed(doc);
      // the lesson preview shows where the lesson ends up, not step 1
      if (t.key !== 'lesson') for (const k of t.previewKinds) expect(doc.nodes.map((n) => n.kind)).toContain(k);
    }
  });

  test('names and sizes', () => {
    const names = Object.fromEntries(S.TEMPLATES.map((t) => [t.key, S.buildTemplate(t.key).name]));
    expect(names).toEqual({
      blank: 'Untitled design', url: 'URL Shortener', chat: 'Chat App', ecom: 'E-commerce checkout', lesson: 'Lesson: Horizontal Scaling',
    });
    expect(S.buildTemplate('url').doc.nodes).toHaveLength(6);
    expect(S.buildTemplate('chat').doc.nodes).toHaveLength(8);
    expect(S.buildTemplate('ecom').doc.groups[0].color).toBe('blue');
  });

  test('an unknown key falls back to the blank canvas', () => {
    const { name, doc } = S.buildTemplate('nope');
    expect(name).toBe('Untitled design');
    expect(doc.nodes.map((n) => n.kind)).toEqual(['users']);
    expect(doc.lesson).toBeNull();
  });

  test('the lesson template starts at step 1', () => {
    const { doc } = S.buildTemplate('lesson');
    expect(doc.lesson).toEqual({ id: 'horizontal-scaling', step: 1 });
    expect(doc.users).toBe(1000);
    expect(doc.requirements.slo).toBe(300);
  });

  test('every template runs healthy at its default traffic', () => {
    for (const t of S.TEMPLATES) {
      const { doc } = S.buildTemplate(t.key);
      const { sim } = run(doc, 30);
      expect(sim.errorRate, t.key).toBe(0);
      expect(Number.isFinite(sim.p99), t.key).toBe(true);
    }
  });
});

describe('lessonStep', () => {
  const at = (step) => ({ ...S.blankDoc(), ...S.lessonStep(step) });

  test('eight captioned steps', () => {
    expect(S.HORIZONTAL_SCALING_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((s) => S.lessonStep(s).users)).toEqual([1000, 100000, 500000, 500000, 40000, 500000, 500000, 2000000]);
    for (let s = 1; s <= 8; s++) expectWellFormed({ flows: [], ...at(s) });
  });

  test('steps 1-3: one server that gets bigger', () => {
    expect([1, 2, 3].map((s) => S.lessonStep(s).nodes.find((n) => n.id === 'a').size)).toEqual([1, 3, 4]);
    for (const s of [1, 2, 3]) expect(S.lessonStep(s).nodes).toHaveLength(2);
  });

  test('step 1 has headroom; step 2 still fits; step 3 hits the ceiling and fails requests', () => {
    const s1 = S.simulate(at(1)), s2 = S.simulate(at(2)), s3 = S.simulate(at(3));
    expect(s1.load.a).toBeCloseTo(60 / 1200, 9);
    expect(s1.errorRate).toBe(0);
    expect(s2.load.a).toBeCloseTo(6000 / 9600, 9);
    expect(s2.errorRate).toBe(0);
    // 30k rps on the biggest box (192 vCPU × 150 = 28.8k rps)
    expect(s3.load.a).toBeCloseTo(30000 / 28800, 9);
    expect(s3.errorRate).toBeCloseTo(1 - 28800 / 30000, 9);
  });

  test('step 4: four servers behind a load balancer, nobody maxed out; step 5 pays the same at night', () => {
    const s4 = S.simulate(at(4)), s5 = S.simulate(at(5));
    expect(S.lessonStep(4).nodes.filter((n) => n.kind === 'app')).toHaveLength(4);
    for (const id of ['a', 'b', 'c', 'd']) expect(s4.load[id]).toBeCloseTo(7500 / 9600, 9);
    expect(s4.errorRate).toBe(0);
    for (const id of ['a', 'b', 'c', 'd']) expect(s5.load[id]).toBeCloseTo(600 / 9600, 9);
    expect(s5.cost).toBe(s4.cost);
  });

  test('step 6: the autoscaling group grows until the errors stop', () => {
    const doc = at(6);
    expect(S.simulate(doc).reps.a).toBe(2);
    expect(S.simulate(doc).errorRate).toBeGreaterThan(0);
    const { sim } = run(doc, 15);
    expect(sim.reps.a).toBe(6); // ceil(30000 / (9600 × 60%))
    expect(sim.errorRate).toBe(0);
  });

  test('steps 7-8 add a cache in front of the database', () => {
    const s7 = S.lessonStep(7);
    expect(s7.nodes.map((n) => n.kind)).toEqual(['users', 'lb', 'app', 'cache', 'db']);
    const sim = S.simulate(at(7));
    // read-through: 90% reads × 10% misses + 10% writes reach the db
    expect(sim.inflow.db / sim.inflow.k).toBeCloseTo(0.9 * 0.1 + 0.1, 9);
  });

  test('step 8: the servers scale out to their max, so something else becomes the bottleneck', () => {
    const doc = at(8);
    const { sim } = run(doc, 30);
    expect(sim.reps.a).toBe(20);
    expect(S.bottleneck(doc, sim).node.id).not.toBe('a');
  });

  test('steps past the end reuse the full graph with the default traffic', () => {
    const s = S.lessonStep(9);
    expect(s.users).toBe(1000);
    expect(s.nodes.map((n) => n.id)).toEqual(['u', 'lb', 'a', 'k', 'db']);
  });
});
