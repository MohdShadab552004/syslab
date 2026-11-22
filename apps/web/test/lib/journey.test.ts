import { describe, expect, it } from 'vitest';
import type { DesignDoc } from '@syslab/types';
import { blankDoc, makeEdge, makeNode, simulate } from '@syslab/sim';
import { buildCanvasView, type CanvasUi } from '@/lib/canvas/buildCanvasView';
import { traceJourney } from '@/lib/canvas/trace';

const N = makeNode, E = makeEdge;
const UI: CanvasUi = {
  sel: null, pending: null, tool: 'select', recording: null, flowPlay: null, running: true, drain: {}, isLesson: false, rewire: null,
};

/** Users → Gateway → API (and an unrelated Admin) → cache + db + queue → two workers → S3. */
function streaming(queueMode: 'pubsub' | 'work' = 'pubsub'): DesignDoc {
  return blankDoc({
    users: 12000,
    nodes: [
      N('u', 'users', 0, 300, 'Users'), N('g', 'gateway', 300, 300, 'Gateway'),
      N('api', 'app', 600, 200, 'API'), N('adm', 'app', 600, 500, 'Admin'),
      N('c', 'cache', 900, 100, 'Redis'), N('db', 'db', 900, 300, 'DB'),
      N('q', 'queue', 900, 500, 'Bus', { queuec: { mode: queueMode } }),
      N('w1', 'worker', 1200, 400, 'Encoder'), N('w2', 'worker', 1200, 600, 'Mailer'), N('s3', 'store', 1500, 400, 'S3'),
    ],
    edges: [
      E('ug', 'u', 'g'), E('gapi', 'g', 'api'), E('gadm', 'g', 'adm'),
      E('ac', 'api', 'c'), E('adb', 'api', 'db'), E('aq', 'api', 'q', { mode: 'async' }),
      E('qw1', 'q', 'w1', { mode: 'async' }), E('qw2', 'q', 'w2', { mode: 'async' }),
      E('w1s3', 'w1', 's3'), E('w1db', 'w1', 'db'), E('admdb', 'adm', 'db'),
    ],
  });
}

describe('traceJourney', () => {
  it('follows the request from the users through the focus to everything it calls', () => {
    const j = traceJourney(streaming(), null, 'api')!;
    expect(Object.fromEntries(j.nodeStep)).toEqual({ u: 1, g: 2, api: 3, c: 4, db: 4, q: 4, w1: 5, w2: 5, s3: 6 });
    // Admin is a sibling, not on this journey; neither is its connection to the db
    expect(j.nodeStep.has('adm')).toBe(false);
    expect(j.edgeStep.has('admdb')).toBe(false);
    expect(j.edgeStep.get('w1db')).toBe(5); // a worker writes to a db the request reached earlier
    expect(j.steps).toBe(6);
  });

  it('captions each step, with async hops and pub/sub delivery spelled out', () => {
    const j = traceJourney(streaming(), simulate(streaming()), 'api')!;
    expect(j.captions[0]).toMatch(/^Users → Gateway · [\d.]+k?\/s$/);
    expect(j.captions[2]).toContain('API → Bus (async: the request does not wait)');
    expect(j.captions[3]).toBe('Bus gives every message to all 2 subscribers (Encoder, Mailer), each at its own pace');
    expect(j.captions[5]).toBe('Journey complete: every component this request reaches has been visited.');
  });

  it('a work queue hands each message to one worker', () => {
    const j = traceJourney(streaming('work'), null, 'api')!;
    expect(j.captions[3]).toBe('Bus hands each message to one of 2 workers (Encoder, Mailer)');
    const one = traceJourney(blankDoc({
      nodes: [N('q', 'queue', 0, 0, 'Q', { queuec: { mode: 'work' } }), N('w', 'worker', 0, 0, 'W'), N('p', 'queue', 0, 0, 'P', { queuec: { mode: 'pubsub' } })],
      edges: [E('qw', 'q', 'w'), E('pw', 'p', 'w')],
    }), null, 'w')!;
    expect(one.captions[0]).toBe('Q hands each message to one of 1 worker (W). P gives every message to all 1 subscriber (W), each at its own pace');
  });

  it('no captions numbers without a simulation, and none for an idle line', () => {
    expect(traceJourney(streaming(), null, 'api')!.captions[0]).toBe('Users → Gateway');
    const idle = streaming();
    idle.users = 0;
    expect(traceJourney(idle, simulate(idle), 'api')!.captions[0]).toBe('Users → Gateway');
  });

  it('works without a users node and through loops', () => {
    const doc = blankDoc({
      nodes: [N('a', 'app', 0, 0, 'A'), N('b', 'app', 0, 0, 'B'), N('c', 'app', 0, 0, 'C')],
      edges: [E('ab', 'a', 'b'), E('bc', 'b', 'c'), E('ca', 'c', 'a'), E('self', 'b', 'b')],
    });
    const j = traceJourney(doc, null, 'b')!;
    expect(j.nodeStep.get('b')).toBe(1); // everything is in a loop: start from the focus
    expect(j.nodeStep.get('c')).toBe(2);
    expect(j.nodeStep.get('a')).toBe(3);
    expect(j.edgeStep.has('self')).toBe(false);
  });

  it('callers stuck in a loop of their own still get a step', () => {
    // X ⇄ Y both call the focus F; nothing starts the journey, and F cannot reach them
    const doc = blankDoc({
      nodes: [N('x', 'app', 0, 0, 'X'), N('y', 'app', 0, 0, 'Y'), N('f', 'app', 0, 0, 'F'), N('d', 'db', 0, 0, 'D')],
      edges: [E('xy', 'x', 'y'), E('yx', 'y', 'x'), E('yf', 'y', 'f'), E('fd', 'f', 'd')],
    });
    const j = traceJourney(doc, null, 'f')!;
    expect(Object.fromEntries(j.nodeStep)).toEqual({ f: 1, d: 2, x: 1, y: 1 });
  });

  it('a line missing from the simulation gets no number in its caption', () => {
    const d = streaming();
    const sim = simulate(d);
    delete sim.edgeRps.ug;
    expect(traceJourney(d, sim, 'api')!.captions[0]).toBe('Users → Gateway');
  });

  it('a lone node is a one-step journey; an unknown id has none', () => {
    const doc = blankDoc({ nodes: [N('a', 'app', 0, 0, 'A')], edges: [E('x', 'a', 'ghost')] });
    const j = traceJourney(doc, null, 'a')!;
    expect(j.steps).toBe(1);
    expect(j.captions).toEqual(['Journey complete: every component this request reaches has been visited.']);
    expect(traceJourney(doc, null, 'nope')).toBeNull();
  });
});

describe('journey on the canvas', () => {
  const build = (doc: DesignDoc, ui: Partial<CanvasUi> = {}) => buildCanvasView(doc, simulate(doc), { ...UI, ...ui });
  const sel = { type: 'node' as const, id: 'api' };

  it('selecting a node numbers its journey and dims the rest', () => {
    const v = build(streaming(), { sel });
    const badge = (id: string) => v.nodes.find((n) => n.id === id)!.badge;
    expect(['u', 'g', 'api', 'q', 'w1', 's3'].map(badge)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(v.nodes.find((n) => n.id === 'adm')!.dim).toBe(true);
    expect(v.edges.find((e) => e.id === 'qw2')!.hl).toBe(true);
    expect(v.journey).toEqual({ focus: 'api', label: 'API', steps: 6, idx: null, playing: false, caption: '6 steps from the users to everything it calls' });
  });

  it('playing lights the steps reached so far and marks the current hop', () => {
    const v = build(streaming(), { sel, journeyPlay: { focus: 'api', idx: 2, playing: true } });
    const node = (id: string) => v.nodes.find((n) => n.id === id)!;
    const edge = (id: string) => v.edges.find((e) => e.id === id)!;
    expect(node('api').dim).toBe(false);
    expect(node('api').tcur).toBe(true);
    expect(node('q').dim).toBe(true); // step 4: not reached yet
    expect(edge('aq').tcur).toBe(true);
    expect(edge('ug').tcur).toBe(false);
    expect(edge('qw1').dim).toBe(true);
    expect(v.journey).toMatchObject({ idx: 2, playing: true });
    expect(v.journey!.caption).toContain('API → Redis');
  });

  it('a playback for another component is ignored; a one-step journey reads "1 step"', () => {
    const v = build(streaming(), { sel, journeyPlay: { focus: 'g', idx: 5, playing: true } });
    expect(v.journey!.idx).toBeNull();
    expect(v.nodes.every((n) => !n.tcur)).toBe(true);
    const lone = blankDoc({ nodes: [N('a', 'app', 0, 0, 'A')] });
    expect(build(lone, { sel: { type: 'node', id: 'a' } }).journey!.caption).toBe('1 step from the users to everything it calls');
    const past = build(streaming(), { sel, journeyPlay: { focus: 'api', idx: 99, playing: false } });
    expect(past.journey!.caption).toBe('');
  });

  it('no journey for several selected items, an edge, or while a flow plays', () => {
    expect(build(streaming(), { sel: null, multi: [{ type: 'node', id: 'api' }, { type: 'node', id: 'g' }] }).journey).toBeNull();
    expect(build(streaming(), { sel: { type: 'edge', id: 'ug' } }).journey).toBeNull();
    const d = streaming();
    d.flows.push({ id: 'f', name: 'F', steps: ['u', 'g', 'api'] });
    expect(build(d, { sel, flowPlay: { id: 'f', idx: 0, playing: true } }).journey).toBeNull();
  });
});
