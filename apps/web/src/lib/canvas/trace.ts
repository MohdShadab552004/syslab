import type { DesignDoc, DesignEdge } from '@syslab/types';
import { fmtCompact, queueConfig, type SimResult } from '@syslab/sim';

/**
 * The journey of a request through one component: everything upstream from the users to it,
 * and everything it calls downstream (through queues to their subscribers and on to the data).
 * Each node gets a step number (users = 1) so the canvas can number the hops and play the
 * journey one step at a time. Pure; uses only the design (the simulation adds numbers to captions).
 */
export interface Journey {
  focus: string;
  /** step of every node on the journey (users = 1) */
  nodeStep: Map<string, number>;
  /** step at which each connection is travelled (= its source's step) */
  edgeStep: Map<string, number>;
  /** number of steps (levels) */
  steps: number;
  /** captions[i]: what happens going from step i + 1 to step i + 2; the last one closes the journey */
  captions: string[];
}

export function traceJourney(doc: Pick<DesignDoc, 'nodes' | 'edges'>, sim: SimResult | null, focus: string): Journey | null {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  if (!byId.has(focus)) return null;
  const edges = doc.edges.filter((e) => e.from !== e.to && byId.has(e.from) && byId.has(e.to));
  const out = new Map<string, DesignEdge[]>(), inc = new Map<string, DesignEdge[]>();
  for (const e of edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
    inc.set(e.to, [...(inc.get(e.to) ?? []), e]);
  }
  const walk = (start: string, next: (id: string) => string[]) => {
    const seen = new Set([start]), stack = [start];
    while (stack.length) for (const x of next(stack.pop()!)) if (!seen.has(x)) { seen.add(x); stack.push(x); }
    return seen;
  };

  // upstream: whatever can reach the focus, trimmed to what the users can reach
  const ancestors = walk(focus, (id) => (inc.get(id) ?? []).map((e) => e.from));
  const roots = [...ancestors].filter((id) => byId.get(id)!.kind === 'users');
  const fromRoots = new Set(roots.flatMap((r) => [...walk(r, (id) => (out.get(id) ?? []).map((e) => e.to))]));
  const up = roots.length ? new Set([...ancestors].filter((id) => fromRoots.has(id))) : ancestors;
  // downstream: everything the focus calls, directly or through others
  const down = walk(focus, (id) => (out.get(id) ?? []).map((e) => e.to));

  const onPath = edges.filter((e) => (up.has(e.from) && up.has(e.to)) || (down.has(e.from) && down.has(e.to)));
  const members = new Set([...up, ...down]);

  // steps: when the request first reaches each node (fewest hops from where it starts), so a
  // database called directly by the focus is step 4 even if a worker also writes to it later
  const hasIn = new Set(onPath.map((e) => e.to));
  const starts = [...members].filter((id) => !hasIn.has(id));
  const step = new Map((starts.length ? starts : [focus]).map((id) => [id, 1]));
  for (let frontier = [...step.keys()]; frontier.length;) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of onPath) {
        if (e.from !== id || step.has(e.to)) continue;
        step.set(e.to, step.get(id)! + 1);
        next.push(e.to);
      }
    }
    frontier = next;
  }
  for (const id of members) if (!step.has(id)) step.set(id, 1);
  const edgeStep = new Map(onPath.map((e) => [e.id, step.get(e.from)!]));
  const steps = Math.max(...step.values());

  const label = (id: string) => byId.get(id)!.label;
  const rps = (e: DesignEdge) => (sim && (sim.edgeRps[e.id] ?? 0) > 0 ? ` · ${fmtCompact(sim.edgeRps[e.id])}/s` : '');
  const captions = Array.from({ length: steps }, (_, i) => {
    const hops = onPath.filter((e) => edgeStep.get(e.id) === i + 1);
    if (!hops.length) return i === steps - 1 ? 'Journey complete: every component this request reaches has been visited.' : '';
    const bySource = new Map<string, DesignEdge[]>();
    for (const e of hops) bySource.set(e.from, [...(bySource.get(e.from) ?? []), e]);
    return [...bySource].map(([src, es]) => {
      const n = byId.get(src)!;
      if (n.kind === 'queue') {
        const names = es.map((e) => label(e.to)).join(', ');
        return queueConfig(n).mode === 'pubsub'
          ? `${n.label} gives every message to all ${es.length} subscriber${es.length === 1 ? '' : 's'} (${names}), each at its own pace`
          : `${n.label} hands each message to one of ${es.length} worker${es.length === 1 ? '' : 's'} (${names})`;
      }
      return es.map((e) => `${n.label} → ${label(e.to)}${e.mode === 'async' ? ' (async: the request does not wait)' : ''}${rps(e)}`).join('; ');
    }).join('. ');
  });
  return { focus, nodeStep: step, edgeStep, steps, captions };
}
