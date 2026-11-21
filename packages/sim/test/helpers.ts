


/** The engine, from source. */
import * as engine from '../src/index';
export const S: any = engine;

/**
 * Small design builder:
 *   design({ users, read }, ['u', 'users'], ['api', 'app', { size: 2 }]).edge('u', 'api')
 */
export function design(opts = {}, ...nodes) {
  const doc = S.blankDoc({
    users: opts.users ?? 12000,
    requirements: { ...S.DEFAULT_REQUIREMENTS, read: opts.read ?? 90, slo: opts.slo ?? 200 },
  });
  for (const [id, kind, over = {}] of nodes) doc.nodes.push(S.makeNode(id, kind, 0, 0, over.label ?? id, over));
  let i = 0;
  const api = {
    doc,
    edge(from, to, over = {}) { doc.edges.push(S.makeEdge(`e${++i}`, from, to, over)); return api; },
    node(id) { return doc.nodes.find((n) => n.id === id); },
    set(id, patch) { Object.assign(api.node(id), patch); return api; },
  };
  return api;
}

/** Run the runtime clock for `seconds` ticks and return the final simulation + runtime. */
export function run(doc, seconds, rt = { ...S.EMPTY_RUNTIME }) {
  let sim = S.simulate(doc, rt);
  for (let t = 0; t < seconds; t++) {
    const step = S.stepRuntime(doc, sim, rt, t * 1000);
    if (step) rt = step.runtime;
    sim = S.simulate(doc, rt);
  }
  return { sim, rt };
}
