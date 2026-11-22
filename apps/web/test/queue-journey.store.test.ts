import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Design } from '@syslab/types';
import { EMPTY_RUNTIME, blankDoc, makeEdge, makeNode, simulate } from '@syslab/sim';
import { useEditorStore, type EditorActions } from '@/hooks/editor/editor.store';
import { nodeView } from '@/hooks/editor/useInspector';

const S = () => useEditorStore.getState();
const A = () => S().actions;
const N = makeNode, E = makeEdge;

const doc = () => blankDoc({
  users: 20000,
  nodes: [N('u', 'users', 0, 0, 'U'), N('a', 'app', 300, 0, 'A', { size: 4 }), N('q', 'queue', 600, 0, 'Bus'), N('w1', 'worker', 900, 0, 'Fast', { size: 4 }), N('w2', 'worker', 900, 300, 'Slow', { size: 0 })],
  edges: [E('ua', 'u', 'a'), E('aq', 'a', 'q', { mode: 'async' }), E('q1', 'q', 'w1', { mode: 'async' }), E('q2', 'q', 'w2', { mode: 'async' })],
});
const design = (): Design => ({ id: 'd1', name: 'D', doc: doc(), revision: 1, shareEnabled: false, shareToken: null, createdAt: '', updatedAt: '' });

beforeEach(() => { A().load(design()); });

describe('journey playback state', () => {
  it('play, step and stop', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    A().select({ type: 'node', id: 'a' });
    A().playJourney('a');
    expect(S().ui.journeyPlay).toEqual({ focus: 'a', idx: 0, playing: true, at: 1000 });
    A().setJourneyPlay({ focus: 'a', idx: 2, playing: false });
    expect(S().ui.journeyPlay).toMatchObject({ idx: 2, playing: false });
    // selecting the same component keeps it, another one (or nothing) ends it
    A().select({ type: 'node', id: 'a' });
    expect(S().ui.journeyPlay).not.toBeNull();
    A().select({ type: 'node', id: 'q' });
    expect(S().ui.journeyPlay).toBeNull();
    A().playJourney('q');
    A().select(null);
    expect(S().ui.journeyPlay).toBeNull();
    A().playJourney('q');
    A().select({ type: 'edge', id: 'aq' });
    expect(S().ui.journeyPlay).toBeNull();
    A().select(null);
    expect(S().ui.journeyPlay).toBeNull();
    vi.restoreAllMocks();
  });

  it('starting a journey stops a playing flow and any recording', () => {
    A().setFlowPlay({ id: 'f', idx: 0, playing: true });
    A().playJourney('a');
    expect(S().ui.flowPlay).toBeNull();
    expect(S().ui.recording).toBeNull();
  });
});

describe('queue settings', () => {
  it('switches the delivery mode with undo', () => {
    A().updateQueue('q', { mode: 'work' });
    expect(S().doc!.nodes.find((n) => n.id === 'q')!.queuec).toEqual({ mode: 'work' });
    A().undo();
    expect(S().doc!.nodes.find((n) => n.id === 'q')!.queuec).toBeUndefined();
    A().updateQueue('missing', { mode: 'work' });
  });

  it('purging clears every subscriber backlog of that queue only', () => {
    A().applyRuntime({ ...S().runtime, qDepth: { q: 5, 'q>q1': 10, 'q>q2': 20, other: 7, 'other>x': 1 } }, []);
    A().purgeQueue('q');
    expect(S().runtime.qDepth).toEqual({ other: 7, 'other>x': 1 });
    expect(S().ui.toast?.text).toBe('Queue purged');
  });
});

describe('inspector: pub/sub queue', () => {
  const actions = () => {
    const fns: Record<string, Mock> = {};
    return new Proxy(fns, { get: (t, k: string) => (t[k] ??= vi.fn()) }) as unknown as EditorActions & Record<string, Mock>;
  };

  it('shows the mode, every subscriber and how far each is behind', () => {
    const d = doc();
    const rt = { ...EMPTY_RUNTIME, qDepth: { 'q>q2': 4000 } };
    const a = actions();
    const v = nodeView(d.nodes.find((n) => n.id === 'q')!, d, simulate(d, rt), a).queue!;
    expect(v.modes.map((o) => [o.key, o.active])).toEqual([['pubsub', true], ['work', false]]);
    expect(v.modeHint).toMatch(/^Like a Kafka topic/);
    expect(v.subscribers).toEqual([
      { key: 'q1', label: 'Fast', behind: 'keeping up', rate: '1.2k msg/s', bad: false },
      { key: 'q2', label: 'Slow', behind: '4.0k behind · +1.1k/s', rate: '120 msg/s', bad: true },
    ]);
    v.modes[1].onSelect();
    expect(a.updateQueue).toHaveBeenCalledWith('q', { mode: 'work' });
  });

  it('a subscriber catching up says so; a work queue lists no subscribers', () => {
    const d = doc();
    d.users = 1000;
    const v = nodeView(d.nodes.find((n) => n.id === 'q')!, d, simulate(d, { ...EMPTY_RUNTIME, qDepth: { 'q>q2': 500 } }), actions()).queue!;
    expect(v.subscribers[1].behind).toBe('500 behind · catching up');
    expect(v.subscribers[1].bad).toBe(false);
    const steady = nodeView(d.nodes.find((n) => n.id === 'q')!, d, simulate(d, { ...EMPTY_RUNTIME, qDepth: { 'q>q2': 100 } }), actions()).queue!;
    expect(steady.subscribers[1].behind).toMatch(/^100 behind/);
    d.nodes[2].queuec = { mode: 'work' };
    const w = nodeView(d.nodes[2], d, simulate(d), actions()).queue!;
    expect(w.subscribers).toEqual([]);
    expect(w.modeHint).toMatch(/^Like SQS/);
  });

  it('a subscriber that is full and not growing is still flagged', () => {
    const d = doc();
    const sim = simulate(d);
    sim.queue.q.subscribers[0] = { ...sim.queue.q.subscribers[0], lag: 0, growth: 0, full: true };
    sim.queue.q.subscribers[1] = { ...sim.queue.q.subscribers[1], nodeId: 'ghost' };
    const v = nodeView(d.nodes.find((n) => n.id === 'q')!, d, sim, actions()).queue!;
    expect(v.subscribers[0]).toMatchObject({ behind: 'keeping up', bad: true });
    expect(v.subscribers[1].label).toBe('ghost');
  });
});
