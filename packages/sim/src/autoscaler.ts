import type { DesignDoc } from '@syslab/types';
import { SIZES } from './catalog';
import { cacheConfig } from './factory';
import { CACHE_HIT, QUEUE_MAX, lagKey, type Runtime, type SimResult } from './simulate';

export interface ScaleEvent { id: string; at: number; up: boolean; text: string }

const LETTERS = 'ABCDEFGH';

/** Ticks a replica spends draining before it is removed. */
export const DRAIN_TICKS = 2;

/**
 * One autoscaler tick. Moves replica counts / sizes one step toward what the
 * simulation wants. Returns null when nothing changed, so callers can skip a render.
 */
export function stepAutoscaler(
  doc: DesignDoc,
  sim: SimResult,
  rt: Runtime,
  now: number,
): { runtime: Runtime; events: ScaleEvent[] } | null {
  const autoRep = { ...rt.autoRep }, drain = { ...rt.drain }, autoSize = { ...rt.autoSize };
  const events: ScaleEvent[] = [];
  let changed = false;
  const log = (up: boolean, text: string) => events.push({ id: `${now}-${events.length}`, at: now, up, text });

  for (const n of doc.nodes) {
    const want = sim.desiredReps[n.id];
    if (want != null) {
      const cur = sim.reps[n.id];
      if (want > cur) {
        const next = cur + (want - cur > 4 ? 2 : 1);
        autoRep[n.id] = next;
        delete drain[n.id];
        changed = true;
        log(true, `${n.label} scaled out ${cur} → ${next}`);
      } else if (want < cur) {
        const ticks = drain[n.id] ?? 0;
        if (ticks >= DRAIN_TICKS) {
          autoRep[n.id] = cur - 1;
          delete drain[n.id];
          log(false, `${n.label} scaled in ${cur} → ${cur - 1}`);
        } else {
          drain[n.id] = ticks + 1;
          if (!ticks) log(false, `Draining ${n.label} ${LETTERS.charAt(Math.min(cur, 8) - 1)}`);
        }
        changed = true;
      } else if (drain[n.id]) {
        delete drain[n.id];
        changed = true;
      }
    }

    const wantSize = sim.desiredSize[n.id];
    if (wantSize != null) {
      const cur = sim.sizeIdx[n.id];
      if (wantSize !== cur) {
        const next = wantSize > cur ? cur + 1 : cur - 1;
        autoSize[n.id] = next;
        changed = true;
        log(next > cur, `${n.label} resized ${next > cur ? 'up' : 'down'} ${SIZES[cur].cpu} → ${SIZES[next].cpu} vCPU`);
      }
    }
  }

  return changed ? { runtime: { ...rt, autoRep, drain, autoSize }, events } : null;
}

/**
 * One second of queue time: every queue grows or drains by its net rate; a pub/sub queue moves
 * each subscriber's own backlog. Null when nothing moved.
 */
export function stepQueues(doc: DesignDoc, sim: SimResult, rt: Runtime): Record<string, number> | null {
  const next: Record<string, number> = {};
  let changed = false;
  const move = (key: string, growth: number) => {
    const cur = rt.qDepth?.[key] ?? 0;
    const d = Math.max(0, Math.min(QUEUE_MAX, cur + growth));
    if (d > 0.5) next[key] = d;
    if (Math.abs(d - cur) > 0.5) changed = true;
  };
  for (const n of doc.nodes) {
    if (n.kind !== 'queue') continue;
    const q = sim.queue[n.id];
    if (q?.mode === 'pubsub') { for (const s of q.subscribers) move(lagKey(n.id, s.edgeId), s.growth); continue; }
    const cur = rt.qDepth?.[n.id] ?? 0;
    const d = q ? Math.max(0, Math.min(QUEUE_MAX, cur + q.growth)) : 0;
    if (d > 0.5) next[n.id] = d;
    if (Math.abs(d - cur) > 0.5) changed = true;
  }
  if (Object.keys(rt.qDepth ?? {}).some((id) => !(id in next) && (rt.qDepth[id] ?? 0) > 0.5)) changed = true;
  return changed ? next : null;
}

/** share of the gap to a warm cache that refills each second while traffic flows */
export const CACHE_WARMUP = 0.25;

/**
 * Cache contents over time, one second per call:
 * - offline: memory is lost, so it comes back cold (every read misses, the db takes the stampede);
 * - every db behind it offline: nothing can refill, keys expire over one TTL until every read fails;
 * - otherwise: misses refill the cache and the hit ratio climbs back to normal.
 */
export function stepCaches(doc: DesignDoc, sim: SimResult, rt: Runtime): Record<string, number> | null {
  const next: Record<string, number> = {};
  let changed = false;
  for (const n of doc.nodes) {
    if (n.kind !== 'cache') continue;
    const cur = rt.cacheHit?.[n.id] ?? CACHE_HIT;
    let h = cur;
    if (n.down) h = 0;
    else if (sim.cacheRefill[n.id] === false) h = Math.max(0, cur - CACHE_HIT / Math.max(1, cacheConfig(n).ttl));
    else if ((sim.inflow[n.id] ?? 0) > 0) { h = cur + (CACHE_HIT - cur) * CACHE_WARMUP; if (CACHE_HIT - h < 0.005) h = CACHE_HIT; }
    if (h < CACHE_HIT) next[n.id] = h;
    if (Math.abs(h - cur) > 1e-6) changed = true;
  }
  return changed ? next : null;
}

/**
 * What each node dropped this second, remembered for the next one: callers with retries send
 * more attempts to a node that is failing, which is how a retry storm builds up.
 */
export function stepFailures(doc: DesignDoc, sim: SimResult, rt: Runtime): Record<string, number> | null {
  const next: Record<string, number> = {};
  let changed = false;
  for (const n of doc.nodes) {
    const f = sim.dropFrac[n.id] ?? 0, cur = rt.fail?.[n.id] ?? 0;
    if (f > 0.001) next[n.id] = f;
    if (Math.abs(f - cur) > 0.002) changed = true;
  }
  return changed ? next : null;
}

/** seconds a tripped circuit breaker stays open before it lets calls through again */
export const BREAKER_OPEN_S = 10;
/** a breaker trips when its target drops more than this share of requests */
export const BREAKER_TRIP = 0.5;

/** Circuit breakers: trip when the target fails, stay open for a while, then try again. */
export function stepBreakers(doc: DesignDoc, sim: SimResult, rt: Runtime): Record<string, number> | null {
  const next: Record<string, number> = {};
  let changed = false;
  for (const e of doc.edges) {
    if (!e.breaker) continue;
    const cur = rt.breaker?.[e.id] ?? 0;
    const v = cur > 0 ? cur - 1 : (sim.dropFrac[e.to] ?? 0) > BREAKER_TRIP && (sim.edgeRps[e.id] ?? 0) > 0 ? BREAKER_OPEN_S : 0;
    if (v > 0) next[e.id] = v;
    if (v !== cur) changed = true;
  }
  return changed ? next : null;
}

/** Everything that changes with time, in one tick: autoscaling, queues, caches, retries, breakers. */
export function stepRuntime(doc: DesignDoc, sim: SimResult, rt: Runtime, now: number): { runtime: Runtime; events: ScaleEvent[] } | null {
  const auto = stepAutoscaler(doc, sim, rt, now);
  const q = stepQueues(doc, sim, rt);
  const c = stepCaches(doc, sim, rt);
  const f = stepFailures(doc, sim, rt);
  const b = stepBreakers(doc, sim, rt);
  if (!auto && !q && !c && !f && !b) return null;
  let runtime = auto ? auto.runtime : rt;
  if (q) runtime = { ...runtime, qDepth: q };
  if (c) runtime = { ...runtime, cacheHit: c };
  if (f) runtime = { ...runtime, fail: f };
  if (b) runtime = { ...runtime, breaker: b };
  return { runtime, events: auto?.events ?? [] };
}
