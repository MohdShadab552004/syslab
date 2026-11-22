// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Design, DesignDoc } from '@syslab/types';
import { blankDoc, makeEdge, makeNode } from '@syslab/sim';
import { useEditorActions, useEditorStore } from '@/hooks/editor/editor.store';
import { useInspector } from '@/hooks/editor/useInspector';

const N = makeNode, E = makeEdge;
const S = () => useEditorStore.getState();
const A = () => S().actions;

function baseDoc(): DesignDoc {
  return blankDoc({
    users: 12000,
    nodes: [N('u', 'users', 0, 0, 'Users'), N('a', 'app', 300, 0, 'A'), N('b', 'app', 300, 200, 'B'), N('d', 'db', 700, 0, 'DB')],
    edges: [E('ua', 'u', 'a'), E('ab', 'a', 'b'), E('ad', 'a', 'd'), E('ghost', 'a', 'zzz')],
    groups: [
      { id: 'g1', label: 'G1', x: 250, y: -50, w: 200, h: 400, color: 'blue' },
      { id: 'g2', label: 'Inner', x: 260, y: 300, w: 20, h: 20, color: 'green' },
    ],
    notes: [{ id: 't1', text: 'n', x: 310, y: 10 }],
  });
}
const design = (doc: DesignDoc): Design => ({
  id: 'd1', name: 'D', doc, revision: 1, shareEnabled: false, shareToken: null, createdAt: '', updatedAt: '',
});

beforeEach(() => { act(() => A().load(design(baseDoc()))); });
afterEach(() => { cleanup(); });

function view() {
  const hook = renderHook(() => useInspector());
  return { get: () => hook.result.current!, hook };
}

describe('useInspector', () => {
  it('is null without a doc', () => {
    act(() => A().reset());
    expect(renderHook(() => useInspector()).result.current).toBeNull();
  });

  it('nothing selected: requirements and traffic', () => {
    const { get } = view();
    const v = get();
    if (v.kind !== 'none') throw new Error('expected none');
    expect(v.lesson).toBe(false);
    expect(v.requirements).toMatchObject({ dau: 120000, read: 90, readText: '90% reads · 10% writes', slo: 200 });
    expect(v.requirements.peaks.find((p) => p.active)!.key).toBe('10');
    expect(v.traffic.slider).toBe(22);
    expect(v.traffic.presets.some((p) => p.active)).toBe(false);

    act(() => v.requirements.onGoal('fast'));
    expect(S().doc!.requirements.goal).toBe('fast');
    act(() => v.requirements.onDau(NaN));
    expect(S().doc!.requirements.dau).toBe(0);
    act(() => v.requirements.onDau(5000));
    expect(S().doc!.requirements.dau).toBe(5000);
    act(() => v.requirements.peaks[3].onSelect());
    expect(S().doc!.requirements.peak).toBe(50);
    act(() => v.requirements.onRead(70));
    expect(S().doc!.requirements.read).toBe(70);
    act(() => v.requirements.onSlo(0));
    expect(S().doc!.requirements.slo).toBe(1);
    act(() => v.requirements.onSlo(300));
    expect(S().doc!.requirements.slo).toBe(300);
    act(() => v.requirements.onDataNote('1 TB'));
    expect(S().doc!.requirements.dataNote).toBe('1 TB');
    act(() => v.traffic.onSlider(40));
    expect(S().doc!.users).toBe(100000);
    act(() => v.traffic.onSlider(13));
    expect(S().doc!.users).toBe(4500);
    act(() => v.traffic.presets[1].onSelect());
    expect(S().doc!.users).toBe(40000);
    const after = get();
    if (after.kind !== 'none') throw new Error('expected none');
    expect(after.traffic.presets[1].active).toBe(true);
  });

  it('lesson flag and slider clamps', () => {
    act(() => A().load(design(blankDoc({ users: 0, lesson: { id: 'x', step: 1 } }))));
    const v = view().get();
    if (v.kind !== 'none') throw new Error('expected none');
    expect(v.lesson).toBe(true);
    expect(v.traffic.slider).toBe(0);
    act(() => A().setUsers(1e9));
    const w = view().get();
    if (w.kind !== 'none') throw new Error('expected none');
    expect(w.traffic.slider).toBe(80);
  });

  it('node, edge, group, note views follow the selection', () => {
    const { get } = view();
    act(() => A().select({ type: 'node', id: 'a' }));
    expect(get().kind).toBe('node');
    act(() => A().select({ type: 'edge', id: 'ab' }));
    const e = get();
    if (e.kind !== 'edge') throw new Error('expected edge');
    expect(e.edge.title).toBe('A → B');
    act(() => A().select({ type: 'note', id: 't1' }));
    const t = get();
    if (t.kind !== 'note') throw new Error('expected note');
    act(() => t.onDelete());
    expect(S().doc!.notes).toEqual([]);
    expect(get().kind).toBe('none');
  });

  it('selections that point at nothing fall back to the requirements', () => {
    const { get } = view();
    for (const sel of [
      { type: 'node', id: 'zzz' }, { type: 'edge', id: 'zzz' }, { type: 'edge', id: 'ghost' },
      { type: 'group', id: 'zzz' }, { type: 'note', id: 'zzz' },
    ] as const) {
      act(() => A().select(sel));
      expect(get().kind).toBe('none');
    }
  });

  it('group view and its callbacks', () => {
    const { get } = view();
    act(() => A().select({ type: 'group', id: 'g1' }));
    const v = get();
    if (v.kind !== 'group') throw new Error('expected group');
    expect(v.group).toMatchObject({ label: 'G1', collapsed: false, contents: '2 components · 1 note · 1 group' });
    expect(v.group.colors.map((c) => c.key)).toEqual(['blue', 'green', 'orange', 'gray']);
    expect(v.group.colors[0].active).toBe(true);
    act(() => v.group.onRename('VPC'));
    act(() => v.group.colors[2].onSelect());
    expect(S().doc!.groups[0]).toMatchObject({ label: 'VPC', color: 'orange' });
    act(() => v.group.onToggleCollapse());
    const c = get();
    if (c.kind !== 'group') throw new Error('expected group');
    expect(c.group.collapsed).toBe(true);
    act(() => A().select({ type: 'group', id: 'g2' }));
    const g2 = get();
    if (g2.kind !== 'group') throw new Error('expected group');
    expect(g2.group.contents).toBe('0 components · 0 notes');
    act(() => g2.group.onDelete());
    expect(S().doc!.groups.map((g) => g.id)).toEqual(['g1']);
  });

  it('multi view and its callbacks', () => {
    const { get } = view();
    act(() => A().selectMany([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }, { type: 'group', id: 'g2' }, { type: 'note', id: 't1' }]));
    const v = get();
    if (v.kind !== 'multi') throw new Error('expected multi');
    expect(v.multi).toMatchObject({ title: '4 items selected', parts: '2 components · 1 group · 1 note', links: 1 });
    act(() => v.multi.onCopy());
    expect(S().ui.toast?.text).toBe('Copied 4 items + 1 connection');
    act(() => v.multi.onDuplicate());
    expect(S().doc!.nodes).toHaveLength(6);
    act(() => v.multi.onDelete());
    expect(S().doc!.nodes).toHaveLength(4);
    act(() => A().selectMany([{ type: 'note', id: 't1' }, { type: 'group', id: 'g1' }, { type: 'group', id: 'g2' }]));
    const w = get();
    if (w.kind !== 'multi') throw new Error('expected multi');
    expect(w.multi).toMatchObject({ parts: '2 groups · 1 note', links: 0 });
  });

  it('useEditorActions returns the stable actions object', () => {
    const { result } = renderHook(() => useEditorActions());
    expect(result.current).toBe(S().actions);
  });
});
