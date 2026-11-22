import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Design, DesignDoc } from '@syslab/types';
import { EMPTY_RUNTIME, blankDoc, makeEdge, makeNode } from '@syslab/sim';
import {
  canRewire, clamp, groupContents, selectedPicks, useEditorStore,
} from '@/hooks/editor/editor.store';

const S = () => useEditorStore.getState();
const A = () => S().actions;
const doc = () => S().doc!;
const N = makeNode, E = makeEdge;

function baseDoc(): DesignDoc {
  return blankDoc({
    nodes: [
      N('u', 'users', 0, 0, 'Users'),
      N('a', 'app', 300, 0, 'A'),
      N('b', 'app', 300, 300, 'B'),
      N('db', 'db', 700, 0, 'DB'),
    ],
    edges: [E('ua', 'u', 'a'), E('ab', 'a', 'b', { proto: 'gRPC' }), E('adb', 'a', 'db')],
    groups: [
      { id: 'g1', label: 'G1', x: 250, y: -50, w: 200, h: 500, color: 'blue' },
      { id: 'g2', label: 'Empty', x: 2000, y: 2000, w: 50, h: 50, color: 'green' },
    ],
    notes: [{ id: 't1', text: 'inside', x: 310, y: 10 }, { id: 't2', text: 'far', x: 1500, y: 0 }],
    flows: [{ id: 'f1', name: 'Flow 1', steps: ['u', 'a', 'db'] }],
  });
}

const design = (d: DesignDoc = baseDoc(), over: Partial<Design> = {}): Design => ({
  id: 'd1', name: 'Design', doc: d, revision: 3, shareEnabled: false, shareToken: null, createdAt: '', updatedAt: '', ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  A().load(design());
});
afterEach(() => {
  // keep consecutive tests from merging into one undo step
  vi.advanceTimersByTime(10_000);
  A().setDragging(false);
  vi.useRealTimers();
});

describe('clipboard before anything was copied', () => {
  it('paste does nothing', () => {
    expect(A().paste()).toBe(false);
  });
});

describe('pure helpers', () => {
  it('selectedPicks', () => {
    expect(selectedPicks({ sel: null, multi: [] })).toEqual([]);
    expect(selectedPicks({ sel: { type: 'edge', id: 'e' }, multi: [] })).toEqual([]);
    expect(selectedPicks({ sel: { type: 'node', id: 'a' }, multi: [] })).toEqual([{ type: 'node', id: 'a' }]);
    const multi = [{ type: 'node' as const, id: 'a' }, { type: 'note' as const, id: 't' }];
    expect(selectedPicks({ sel: null, multi })).toBe(multi);
  });

  it('groupContents', () => {
    expect(groupContents(baseDoc(), 'nope')).toEqual([]);
    expect(groupContents(baseDoc(), 'g1')).toEqual([
      { type: 'group', id: 'g1' }, { type: 'node', id: 'a' }, { type: 'node', id: 'b' }, { type: 'note', id: 't1' },
    ]);
    const d = baseDoc();
    d.groups.push({ id: 'g3', label: 'in', x: 260, y: 400, w: 10, h: 10, color: 'blue' });
    expect(groupContents(d, 'g1')).toContainEqual({ type: 'group', id: 'g3' });
  });

  it('canRewire', () => {
    const d = baseDoc();
    expect(canRewire(d, 'nope', 'to', 'b')).toBe(false);
    expect(canRewire(d, 'ua', 'to', 'zzz')).toBe(false);
    expect(canRewire(d, 'ua', 'to', 'u')).toBe(false); // self loop
    expect(canRewire(d, 'ab', 'from', 'b')).toBe(false); // self loop from the other end
    expect(canRewire(d, 'adb', 'to', 'b')).toBe(false); // a→b already exists
    expect(canRewire(d, 'ua', 'to', 'a')).toBe(true); // no-op
    expect(canRewire(d, 'ua', 'from', 'b')).toBe(true);
  });

  it('clamp', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});

describe('lifecycle', () => {
  it('load sets everything fresh', () => {
    const s = S();
    expect(s.designId).toBe('d1');
    expect(s.name).toBe('Design');
    expect(s.revision).toBe(3);
    expect(s.saveState).toBe('idle');
    expect(s.past).toEqual([]);
    expect(s.ui.tool).toBe('select');
    expect(s.ui.running).toBe(true);
    expect(s.runtime.spike).toBe(1);
  });

  it('reset clears the doc; edits without a doc do nothing', () => {
    A().reset();
    expect(S().doc).toBeNull();
    expect(S().designId).toBeNull();
    A().moveNode('a', 1, 1);
    expect(S().editSeq).toBe(0);
    A().undo();
    A().redo();
    A().selectAll();
    A().selectGroupContents('g1');
    expect(A().nudgeSelection(1, 1)).toBe(false);
    A().setAllGroupsCollapsed(true);
    A().autoLayout();
    A().connectClick('a');
    expect(A().rewireEdge('ua', 'to', 'b')).toBe(false);
    A().toggleGroupCollapsed('g1');
    expect(A().copySelection()).toBe(false);
    A().playFlow('f1');
    expect(S().ui.toast?.text).toBe('A flow needs at least two steps');
    A().finishRecording();
    expect(S().ui.toast?.text).toBe('Add at least two steps to play it');
  });

  it('save state, share, rename', () => {
    A().setSaveState('saving');
    expect(S().saveState).toBe('saving');
    A().rename('New');
    expect(S().name).toBe('New');
    expect(S().saveState).toBe('dirty');
    const seq = S().editSeq;
    A().markSaved(4, seq);
    expect(S()).toMatchObject({ revision: 4, saveState: 'saved' });
    A().markSaved(5, seq - 1);
    expect(S()).toMatchObject({ revision: 5, saveState: 'dirty' });
    A().setShare(true, 'tok');
    expect(S()).toMatchObject({ shareEnabled: true, shareToken: 'tok' });
  });

  it('replaceFromServer swaps the doc and clears history', () => {
    A().moveNode('a', 1, 1);
    A().select({ type: 'node', id: 'a' });
    A().replaceFromServer(design(blankDoc(), { revision: 9 }));
    expect(S()).toMatchObject({ revision: 9, saveState: 'saved', past: [], future: [] });
    expect(S().doc!.nodes).toEqual([]);
    expect(S().ui.sel).toBeNull();
  });
});

describe('ui', () => {
  it('tools, selection and simple setters', () => {
    A().newFlow();
    expect(S().ui.recording).not.toBeNull();
    A().setTool('connect');
    expect(S().ui).toMatchObject({ tool: 'connect', recording: null, pending: null });
    A().newFlow();
    A().setTool('select');
    expect(S().ui.recording).not.toBeNull();
    A().setTab('flows');
    A().select({ type: 'node', id: 'a' });
    expect(S().ui).toMatchObject({ sel: { type: 'node', id: 'a' }, tab: 'inspect' });
    A().setTab('versions');
    A().select(null);
    expect(S().ui.tab).toBe('versions');
    A().setQuery('q');
    A().setShareOpen(true);
    A().setRewire({ edgeId: 'ua', end: 'to', x: 0, y: 0, over: null });
    A().setMarquee({ x1: 0, y1: 0, x2: 1, y2: 1 });
    A().toggleRunning();
    A().setSpike(10);
    expect(S().ui).toMatchObject({ query: 'q', shareOpen: true, running: false, marquee: { x2: 1 } });
    expect(S().ui.rewire?.edgeId).toBe('ua');
    expect(S().runtime.spike).toBe(10);
  });

  it('clearSelection only writes when something is selected', () => {
    const before = S().ui;
    A().clearSelection();
    expect(S().ui).toBe(before);
    A().select({ type: 'node', id: 'a' });
    A().clearSelection();
    expect(S().ui.sel).toBeNull();
    A().connectClick('a');
    A().clearSelection();
    expect(S().ui.pending).toBeNull();
    A().selectMany([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    A().clearSelection();
    expect(S().ui.multi).toEqual([]);
  });

  it('hover and view prefs', () => {
    A().setHover('a');
    const ui = S().ui;
    A().setHover('a');
    expect(S().ui).toBe(ui);
    A().setHover(null);
    expect(S().ui.hover).toBeNull();
    A().setView({ edges: 'all' });
    expect(S().ui.view).toMatchObject({ edges: 'all', route: 'curve' });
    A().setHoverEdge('e1');
    const ui2 = S().ui;
    A().setHoverEdge('e1');
    expect(S().ui).toBe(ui2);
    expect(S().ui.hoverEdge).toBe('e1');
    A().setHoverEdge(null);
    expect(S().ui.hoverEdge).toBeNull();
  });

  it('toasts', () => {
    A().toast('hi');
    expect(S().ui.toast).toMatchObject({ text: 'hi' });
    A().clearToast();
    expect(S().ui.toast).toBeNull();
  });

  it('runtime and events', () => {
    const rt = { ...EMPTY_RUNTIME, autoRep: { a: 3 } };
    A().applyRuntime(rt, []);
    expect(S().runtime.autoRep).toEqual({ a: 3 });
    expect(S().events).toEqual([]);
    const ev = (id: string, at: number) => ({ id, at, up: true, text: id });
    A().applyRuntime(rt, [ev('1', 0), ev('2', 0)]);
    A().applyRuntime(rt, [ev('3', 5000), ev('4', 5000)]);
    expect(S().events.map((e) => e.id)).toEqual(['3', '4', '1']);
    A().expireEvents(5000);
    expect(S().events).toHaveLength(3);
    A().expireEvents(8000);
    expect(S().events.map((e) => e.id)).toEqual(['3', '4']);
    A().expireEvents(20000);
    A().expireEvents(20000);
    A().expireEvents(20000);
    expect(S().events).toEqual([]);
  });

  it('purgeQueue drops the backlog', () => {
    A().applyRuntime({ ...EMPTY_RUNTIME, qDepth: { q: 50, r: 2 } }, []);
    A().purgeQueue('q');
    expect(S().runtime.qDepth).toEqual({ r: 2 });
    expect(S().ui.toast?.text).toBe('Queue purged');
  });
});

describe('multi-selection', () => {
  it('selectMany dedups and picks none / one / many', () => {
    A().selectMany([]);
    expect(S().ui.sel).toBeNull();
    A().selectMany([{ type: 'node', id: 'a' }, { type: 'node', id: 'a' }]);
    expect(S().ui.sel).toEqual({ type: 'node', id: 'a' });
    expect(S().ui.multi).toEqual([]);
    A().selectMany([{ type: 'node', id: 'a' }, { type: 'note', id: 't1' }]);
    expect(S().ui.sel).toBeNull();
    expect(S().ui.multi).toHaveLength(2);
  });

  it('togglePick adds and removes', () => {
    A().togglePick({ type: 'node', id: 'a' });
    expect(S().ui.sel).toEqual({ type: 'node', id: 'a' });
    A().togglePick({ type: 'node', id: 'b' });
    expect(S().ui.multi).toHaveLength(2);
    A().togglePick({ type: 'node', id: 'a' });
    expect(S().ui.sel).toEqual({ type: 'node', id: 'b' });
  });

  it('selectAll and selectGroupContents', () => {
    A().selectAll();
    expect(S().ui.multi).toHaveLength(2 + 4 + 2);
    A().selectGroupContents('g1');
    expect(S().ui.multi).toHaveLength(4);
    expect(S().ui.toast?.text).toBe('Selected 4 items in this group');
    A().clearToast();
    A().selectGroupContents('g2');
    expect(S().ui.sel).toEqual({ type: 'group', id: 'g2' });
    expect(S().ui.toast).toBeNull();
    A().selectGroupContents('nope');
    expect(S().ui.sel).toBeNull();
  });

  it('moveItems and nudgeSelection', () => {
    A().moveItems([]);
    expect(S().past).toHaveLength(0);
    A().moveItems([
      { type: 'node', id: 'a', x: 1, y: 2 }, { type: 'group', id: 'g1', x: 3, y: 4 },
      { type: 'note', id: 't1', x: 5, y: 6 }, { type: 'node', id: 'zzz', x: 0, y: 0 },
    ]);
    expect(doc().nodes[1]).toMatchObject({ x: 1, y: 2 });
    expect(doc().groups[0]).toMatchObject({ x: 3, y: 4 });
    expect(doc().notes[0]).toMatchObject({ x: 5, y: 6 });
    expect(A().nudgeSelection(10, 0)).toBe(false);
    A().selectMany([{ type: 'node', id: 'a' }, { type: 'group', id: 'g1' }, { type: 'note', id: 't1' }, { type: 'node', id: 'gone' }]);
    expect(A().nudgeSelection(10, -10)).toBe(true);
    expect(doc().nodes[1]).toMatchObject({ x: 11, y: -8 });
    expect(doc().groups[0]).toMatchObject({ x: 13, y: -6 });
    expect(doc().notes[0]).toMatchObject({ x: 15, y: -4 });
    // repeated nudges of the same set merge into one undo step
    A().nudgeSelection(10, 0);
    expect(S().past).toHaveLength(2);
  });

  it('deleteSelection removes items, connections, flow steps and runtime', () => {
    expect(A().deleteSelection()).toBe(0);
    A().applyRuntime({ ...EMPTY_RUNTIME, autoRep: { a: 2 }, drain: { a: 1 }, autoSize: { a: 1 } }, []);
    A().select({ type: 'node', id: 'a' });
    expect(A().deleteSelection()).toBe(1);
    expect(doc().nodes.map((n) => n.id)).toEqual(['u', 'b', 'db']);
    expect(doc().edges).toEqual([]);
    expect(doc().flows[0].steps).toEqual(['u', 'db']);
    expect(S().runtime.autoRep).toEqual({});
    expect(S().ui.toast).toBeNull();
    A().selectMany([{ type: 'group', id: 'g1' }, { type: 'note', id: 't2' }]);
    expect(A().deleteSelection()).toBe(2);
    expect(doc().groups.map((g) => g.id)).toEqual(['g2']);
    expect(doc().notes.map((t) => t.id)).toEqual(['t1']);
    expect(S().ui.toast?.text).toBe('Deleted 2 items · Ctrl+Z to undo');
  });
});

describe('history', () => {
  it('undo / redo with nothing to do', () => {
    A().undo();
    A().redo();
    expect(S().editSeq).toBe(0);
  });

  it('merges continuous edits of the same key, not discrete ones', () => {
    A().moveNode('a', 1, 1);
    vi.advanceTimersByTime(100);
    A().moveNode('a', 2, 2);
    expect(S().past).toHaveLength(1);
    vi.advanceTimersByTime(600);
    A().moveNode('a', 3, 3);
    expect(S().past).toHaveLength(2);
    A().moveNode('b', 3, 3);
    expect(S().past).toHaveLength(3);
    A().toggleDown('a');
    A().toggleDown('a');
    expect(S().past).toHaveLength(5);
    expect(S().saveState).toBe('dirty');
  });

  it('a drag is one step however long it pauses; a new drag starts a new step', () => {
    A().setDragging(true);
    A().moveNode('a', 1, 1);
    vi.advanceTimersByTime(5000);
    A().moveNode('a', 2, 2);
    expect(S().past).toHaveLength(1);
    A().setDragging(false);
    A().setDragging(true);
    A().moveNode('a', 3, 3);
    expect(S().past).toHaveLength(2);
  });

  it('undo / redo restore docs and drop selections that no longer exist', () => {
    A().addNode('cache', 0, 0);
    const id = S().ui.sel!.id;
    A().undo();
    expect(doc().nodes.some((n) => n.id === id)).toBe(false);
    expect(S().ui.sel).toBeNull();
    expect(S().future).toHaveLength(1);
    A().redo();
    expect(doc().nodes.some((n) => n.id === id)).toBe(true);
    // every selection kind is checked
    A().addGroup();
    A().undo();
    expect(S().ui.sel).toBeNull();
    A().addNote();
    A().undo();
    expect(S().ui.sel).toBeNull();
    A().connectClick('b');
    A().connectClick('db');
    const e = doc().edges.at(-1)!;
    A().select({ type: 'edge', id: e.id });
    A().undo();
    expect(S().ui.sel).toBeNull();
    // still existing selection stays
    A().select({ type: 'node', id: 'a' });
    A().moveNode('a', 9, 9);
    A().undo();
    expect(S().ui.sel).toEqual({ type: 'node', id: 'a' });
  });

  it('undo prunes a multi-selection, keeping what still exists', () => {
    A().addNode('cache', 0, 0);
    const id = S().ui.sel!.id;
    A().selectMany([{ type: 'node', id }, { type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    A().undo();
    expect(S().ui.multi).toEqual([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    A().redo();
    A().selectMany([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    A().undo();
    expect(S().ui.multi).toHaveLength(2);
  });

  it('keeps at most 100 undo steps', () => {
    for (let i = 0; i < 105; i++) A().toggleDown('a');
    expect(S().past).toHaveLength(100);
  });
});

describe('groups', () => {
  it('setAllGroupsCollapsed hides selected members, keeps edges selected', () => {
    A().setAllGroupsCollapsed(false); // nothing to change
    expect(S().past).toHaveLength(0);
    A().select({ type: 'node', id: 'a' });
    A().setAllGroupsCollapsed(true);
    expect(doc().groups.every((g) => g.collapsed)).toBe(true);
    expect(S().ui.sel).toBeNull();
    A().setAllGroupsCollapsed(false);
    A().select({ type: 'edge', id: 'ua' });
    A().setAllGroupsCollapsed(true);
    expect(S().ui.sel).toEqual({ type: 'edge', id: 'ua' });
    A().setAllGroupsCollapsed(false);
    A().select({ type: 'node', id: 'u' });
    A().setAllGroupsCollapsed(true);
    expect(S().ui.sel).toEqual({ type: 'node', id: 'u' });
    A().setAllGroupsCollapsed(false);
    expect(doc().groups.every((g) => !g.collapsed)).toBe(true);
    A().selectMany([{ type: 'node', id: 'a' }, { type: 'node', id: 'u' }, { type: 'group', id: 'g1' }]);
    A().setAllGroupsCollapsed(true);
    expect(S().ui.multi).toEqual([{ type: 'node', id: 'u' }, { type: 'group', id: 'g1' }]);
  });

  it('toggleGroupCollapsed', () => {
    A().toggleGroupCollapsed('nope');
    expect(S().past).toHaveLength(0);
    A().select({ type: 'node', id: 'a' });
    A().toggleGroupCollapsed('g1');
    expect(doc().groups[0].collapsed).toBe(true);
    expect(S().ui.sel).toEqual({ type: 'group', id: 'g1' });
    A().toggleGroupCollapsed('g1');
    expect(doc().groups[0].collapsed).toBe(false);
    A().select({ type: 'edge', id: 'ua' });
    A().toggleGroupCollapsed('g1');
    expect(S().ui.sel).toEqual({ type: 'group', id: 'g1' });
    A().toggleGroupCollapsed('g1');
    A().selectMany([{ type: 'node', id: 'a' }, { type: 'node', id: 'u' }]);
    A().toggleGroupCollapsed('g1');
    expect(S().ui.multi).toEqual([{ type: 'node', id: 'u' }]);
    A().toggleGroupCollapsed('g1');
    A().select({ type: 'node', id: 'u' });
    A().toggleGroupCollapsed('g1');
    expect(S().ui.sel).toEqual({ type: 'group', id: 'g1' });
  });

  it('add, update, colour, delete groups', () => {
    A().addGroup();
    const id = S().ui.sel!.id;
    const g = doc().groups.find((x) => x.id === id)!;
    expect(g).toMatchObject({ x: 360, y: 290, label: 'VPC · Region' });
    A().updateGroup(id, { label: 'X' });
    A().updateGroup('nope', { label: 'Y' });
    A().setGroupColor(id, 'orange');
    expect(doc().groups.find((x) => x.id === id)).toMatchObject({ label: 'X', color: 'orange' });
    A().deleteGroup(id);
    expect(doc().groups).toHaveLength(2);
    expect(S().ui.sel).toBeNull();
  });
});

describe('autoLayout', () => {
  it('does nothing without nodes', () => {
    A().load(design(blankDoc()));
    A().autoLayout();
    expect(S().past).toHaveLength(0);
  });

  it('lays nodes out, refits groups with members and keeps notes next to their node', () => {
    const before = structuredClone(doc());
    A().autoLayout();
    const after = doc();
    expect(S().past).toHaveLength(1);
    expect(after.nodes.some((n, i) => n.x !== before.nodes[i].x || n.y !== before.nodes[i].y)).toBe(true);
    const a = after.nodes.find((n) => n.id === 'a')!;
    expect(after.notes[0].x - a.x).toBe(10);
    expect(after.notes[0].y - a.y).toBe(10);
    expect(after.groups[1]).toEqual(before.groups[1]); // empty group untouched
    expect(S().ui.toast?.text).toBe('Laid out left to right · Ctrl+Z to undo');
  });
});

describe('requirements and users', () => {
  it('setRequirements recomputes users only for dau / peak', () => {
    A().setRequirements({ goal: 'g' });
    expect(doc().users).toBe(12000);
    A().setRequirements({ dau: 1000 });
    expect(doc().users).toBe(100);
    A().setRequirements({ peak: 50 });
    expect(doc().users).toBe(500);
  });

  it('setUsers clamps and rounds', () => {
    A().setUsers(12.6);
    expect(doc().users).toBe(13);
    A().setUsers(-5);
    expect(doc().users).toBe(0);
    A().setUsers(NaN);
    expect(doc().users).toBe(0);
  });
});

describe('nodes', () => {
  it('addNode names repeats', () => {
    A().addNode('cache', 1, 2);
    A().addNode('cache', 1, 2);
    A().addNode('app', 1, 2);
    expect(doc().nodes.slice(-3).map((n) => n.label)).toEqual(['Cache', 'Cache 2', 'App Server 3']);
    expect(S().ui.tab).toBe('inspect');
  });

  it('addPreset: horizontal with free users, vertical without', () => {
    A().load(design(blankDoc({ nodes: [N('u', 'users', 0, 0, 'U')] })));
    A().addPreset('asgH', 500, 500);
    expect(doc().nodes.map((n) => n.kind)).toEqual(['users', 'lb', 'app']);
    expect(doc().edges).toHaveLength(2);
    expect(S().ui.toast?.text).toMatch(/^Autoscaling group added/);
    A().addPreset('asgV', 500, 500);
    expect(doc().nodes).toHaveLength(4);
    expect(doc().edges).toHaveLength(2); // users already connected
    expect(S().ui.toast?.text).toMatch(/^Vertical autoscaler/);
    A().load(design(blankDoc({ nodes: [N('u', 'users', 0, 0, 'U')] })));
    A().addPreset('asgV', 0, 0);
    expect(doc().edges).toHaveLength(1);
    A().load(design(blankDoc()));
    A().addPreset('asgH', 0, 0);
    expect(doc().edges).toHaveLength(1);
  });

  it('update helpers ignore unknown ids and merge configs', () => {
    A().updateNode('a', { label: 'API' });
    A().updateNode('zzz', { label: 'nope' });
    A().updateAutoscale('a', { on: true });
    A().updateAutoscale('zzz', { on: true });
    A().updateDb('db', { replicas: 2 });
    A().updateDb('db', { sync: true });
    A().updateDb('zzz', { sync: true });
    A().updateLb('a', { algo: 'lc' });
    A().updateLb('a', { vnodes: 5 });
    A().updateLb('zzz', { vnodes: 5 });
    A().updateCache('a', { ttl: 10 });
    A().updateCache('a', { ttl: 30 });
    A().updateCache('zzz', { ttl: 30 });
    A().toggleDown('zzz');
    A().moveNode('zzz', 1, 1);
    const a = doc().nodes.find((n) => n.id === 'a')!;
    expect(a).toMatchObject({ label: 'API', lbc: { algo: 'lc', vnodes: 5 }, cachec: { ttl: 30 } });
    expect(a.autoscale.on).toBe(true);
    expect(doc().nodes.find((n) => n.id === 'db')!.dbc).toEqual({ replicas: 2, sync: true });
  });

  it('updateAutoscale can reset runtime', () => {
    A().applyRuntime({ ...EMPTY_RUNTIME, autoRep: { a: 4 }, drain: { a: 1 }, autoSize: { a: 2 } }, []);
    A().updateAutoscale('a', { min: 3 });
    expect(S().runtime.autoRep).toEqual({ a: 4 });
    A().updateAutoscale('a', { mode: 'v' }, true);
    expect(S().runtime).toMatchObject({ autoRep: {}, drain: {}, autoSize: {} });
  });

  it('deleteNode removes edges and flow steps', () => {
    A().select({ type: 'node', id: 'a' });
    A().deleteNode('a');
    expect(doc().edges).toEqual([]);
    expect(doc().flows[0].steps).toEqual(['u', 'db']);
    expect(S().ui.sel).toBeNull();
  });

  it('addLoadBalancer between a node and its non-balancer parents', () => {
    A().addLoadBalancer('zzz');
    expect(doc().nodes).toHaveLength(4);
    // b has one incoming edge (a→b, gRPC); add a second from u and one from an LB
    A().connectClick('u');
    A().connectClick('b');
    A().addNode('lb', 0, 600);
    const lbOld = S().ui.sel!.id;
    A().connectClick(lbOld);
    A().connectClick('b');
    A().addLoadBalancer('b');
    const lb = doc().nodes.at(-1)!;
    expect(lb.kind).toBe('lb');
    const b = doc().nodes.find((n) => n.id === 'b')!;
    expect(b.x).toBe(720);
    expect(lb.x).toBe(510);
    const intoLb = doc().edges.filter((e) => e.to === lb.id).map((e) => e.from).sort();
    expect(intoLb).toEqual(['a', 'u']);
    const lbToB = doc().edges.find((e) => e.from === lb.id && e.to === 'b')!;
    expect(lbToB.proto).toBe('gRPC');
    expect(doc().edges.some((e) => e.from === lbOld && e.to === 'b')).toBe(true);
    expect(S().ui.toast?.text).toMatch(/^Load balancer added/);
  });

  it('addLoadBalancer with no parents', () => {
    A().load(design(blankDoc({ nodes: [N('x', 'app', 500, 100, 'X')] })));
    A().addLoadBalancer('x');
    const [x, lb] = doc().nodes;
    expect(x.x).toBe(500);
    expect(lb.x).toBe(290);
    expect(doc().edges[0]).toMatchObject({ from: lb.id, to: 'x', proto: 'REST' });
  });

  it('addLoadBalancer dedups parents with several connections', () => {
    const d = blankDoc({ nodes: [N('p', 'app', 0, 0, 'P'), N('x', 'app', 400, 0, 'X')], edges: [E('e1', 'p', 'x'), E('e2', 'p', 'x', { op: 'read' })] });
    A().load(design(d));
    A().addLoadBalancer('x');
    expect(doc().edges.filter((e) => e.from === 'p')).toHaveLength(1);
  });
});

describe('edges', () => {
  it('connectClick: pick source, toggle off, connect, skip duplicates', () => {
    A().connectClick('b');
    expect(S().ui.pending).toBe('b');
    A().connectClick('b');
    expect(S().ui.pending).toBeNull();
    A().connectClick('b');
    A().connectClick('db');
    expect(doc().edges.at(-1)).toMatchObject({ from: 'b', to: 'db' });
    expect(S().ui.sel).toEqual({ type: 'node', id: 'db' });
    const n = doc().edges.length;
    A().connectClick('a');
    A().connectClick('b');
    expect(doc().edges).toHaveLength(n);
  });

  it('updateEdge, reverseEdge, deleteEdge', () => {
    A().updateEdge('ua', { proto: 'gRPC' });
    A().updateEdge('zzz', { proto: 'gRPC' });
    A().reverseEdge('ua');
    A().reverseEdge('zzz');
    expect(doc().edges[0]).toMatchObject({ from: 'a', to: 'u', proto: 'gRPC' });
    A().select({ type: 'node', id: 'a' });
    A().deleteEdge('ab');
    expect(S().ui.sel).toEqual({ type: 'node', id: 'a' });
    A().select({ type: 'edge', id: 'adb' });
    A().deleteEdge('adb');
    expect(S().ui.sel).toBeNull();
    expect(doc().edges.map((e) => e.id)).toEqual(['ua']);
  });

  it('rewireEdge', () => {
    expect(A().rewireEdge('ua', 'to', 'u')).toBe(false);
    expect(A().rewireEdge('ua', 'to', 'a')).toBe(true);
    expect(S().past).toHaveLength(0);
    expect(A().rewireEdge('ua', 'to', 'b')).toBe(true);
    expect(doc().edges[0].to).toBe('b');
    expect(S().ui.sel).toEqual({ type: 'edge', id: 'ua' });
    expect(S().ui.toast?.text).toBe('Connection now goes to B');
    expect(A().rewireEdge('ua', 'from', 'db')).toBe(true);
    expect(S().ui.toast?.text).toBe('Connection now starts at DB');
  });
});

describe('notes and canvas', () => {
  it('add, update, delete notes', () => {
    A().addNote();
    const id = S().ui.sel!.id;
    expect(doc().notes.at(-1)).toMatchObject({ id, x: 940, y: 320 });
    A().updateNote(id, { text: 'x' });
    A().updateNote('zzz', { text: 'y' });
    expect(doc().notes.at(-1)!.text).toBe('x');
    A().deleteNote(id);
    expect(doc().notes).toHaveLength(2);
  });

  it('clearCanvas empties everything but keeps the spike', () => {
    A().setSpike(50);
    A().clearCanvas();
    expect(doc()).toMatchObject({ nodes: [], edges: [], groups: [], notes: [], flows: [] });
    expect(S().runtime.spike).toBe(50);
  });
});

describe('flows', () => {
  it('record, undo step, finish, rename, re-record, play, delete', () => {
    A().newFlow();
    const id = S().ui.recording!;
    expect(S().ui.tab).toBe('flows');
    expect(doc().flows.at(-1)!.name).toBe('Flow 2');
    A().recordStep('u');
    A().recordStep('u');
    A().recordStep('a');
    expect(doc().flows.at(-1)!.steps).toEqual(['u', 'a']);
    A().undoStep();
    expect(doc().flows.at(-1)!.steps).toEqual(['u']);
    A().finishRecording();
    expect(S().ui.toast?.text).toBe('Add at least two steps to play it');
    A().recordStep('b'); // not recording: ignored
    A().undoStep();
    expect(doc().flows.at(-1)!.steps).toEqual(['u']);
    A().playFlow(id);
    expect(S().ui.flowPlay).toBeNull();
    A().playFlow('nope');
    A().playFlow('f1');
    expect(S().ui.flowPlay).toEqual({ id: 'f1', idx: 0, playing: true });
    A().setFlowPlay({ id: 'f1', idx: 1, playing: false });
    expect(S().ui.flowPlay?.idx).toBe(1);
    A().renameFlow('f1', 'Login');
    A().renameFlow('zzz', 'x');
    expect(doc().flows[0].name).toBe('Login');
    A().rerecordFlow('f1');
    expect(doc().flows[0].steps).toEqual([]);
    expect(S().ui).toMatchObject({ recording: 'f1', flowPlay: null });
    A().recordStep('u');
    A().recordStep('a');
    A().finishRecording();
    expect(S().ui.toast?.text).toBe('Flow saved · press Play below');
    A().rerecordFlow('zzz');
    expect(S().ui.recording).toBe('zzz');
    A().playFlow('f1');
    A().deleteFlow(id);
    expect(S().ui.flowPlay?.id).toBe('f1');
    A().deleteFlow('f1');
    expect(S().ui.flowPlay).toBeNull();
    A().newFlow();
    const r = S().ui.recording!;
    A().deleteFlow(r);
    expect(S().ui.recording).toBeNull();
  });
});

describe('lesson', () => {
  it('loads a step with the default lesson id, then keeps the id', () => {
    A().setSpike(2);
    A().select({ type: 'node', id: 'a' });
    A().loadLessonStep(1);
    expect(doc().lesson).toEqual({ id: 'horizontal-scaling', step: 1 });
    expect(doc().users).toBe(1000);
    expect(S().ui.sel).toBeNull();
    expect(S().runtime.spike).toBe(2);
    A().load(design(blankDoc({ lesson: { id: 'custom', step: 1 } })));
    A().loadLessonStep(4);
    expect(doc().lesson).toEqual({ id: 'custom', step: 4 });
  });
});

describe('clipboard', () => {
  it('copy needs a selection of existing items', () => {
    expect(A().copySelection()).toBe(false);
    A().select({ type: 'node', id: 'gone' });
    expect(A().copySelection()).toBe(false);
    expect(A().cutSelection()).toBe(false);
    expect(A().duplicateSelection()).toBe(false);
  });

  it('copy one item: no toast; paste offsets further each time', () => {
    A().select({ type: 'note', id: 't2' });
    expect(A().copySelection()).toBe(true);
    expect(S().ui.toast).toBeNull();
    expect(A().paste()).toBe(true);
    expect(doc().notes.at(-1)).toMatchObject({ x: 1530, y: 30, text: 'far' });
    expect(S().ui.sel).toEqual({ type: 'note', id: doc().notes.at(-1)!.id });
    A().paste();
    expect(doc().notes.at(-1)).toMatchObject({ x: 1560, y: 60 });
  });

  it('copy many with connections; edges to outside nodes are dropped', () => {
    A().selectMany([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }, { type: 'group', id: 'g1' }]);
    A().copySelection();
    expect(S().ui.toast?.text).toBe('Copied 3 items + 1 connection');
    A().paste();
    expect(doc().nodes).toHaveLength(6);
    expect(doc().groups).toHaveLength(3);
    const [na, nb] = doc().nodes.slice(-2);
    expect(doc().edges.at(-1)).toMatchObject({ from: na.id, to: nb.id, proto: 'gRPC' });
    expect(S().ui.multi).toHaveLength(3);
  });

  it('copy many without connections', () => {
    A().selectMany([{ type: 'node', id: 'u' }, { type: 'note', id: 't1' }]);
    A().copySelection();
    expect(S().ui.toast?.text).toBe('Copied 2 items');
  });

  it('duplicate copies only connections inside the selection', () => {
    // only the connection between the two duplicated nodes is copied (a→db), not a→b or u→a
    A().selectMany([{ type: 'node', id: 'a' }, { type: 'node', id: 'db' }]);
    expect(A().duplicateSelection()).toBe(true);
    expect(doc().nodes).toHaveLength(6);
    expect(doc().edges.filter((e) => e.from === doc().nodes[4].id)).toHaveLength(1);
  });

  it('cut removes and toasts; paste brings it back', () => {
    A().select({ type: 'node', id: 'b' });
    expect(A().cutSelection()).toBe(true);
    expect(doc().nodes.some((n) => n.id === 'b')).toBe(false);
    expect(S().ui.toast?.text).toBe('Cut · press Ctrl+V to paste');
    A().paste();
    expect(doc().nodes.at(-1)).toMatchObject({ label: 'B', x: 330, y: 330 });
  });
});
