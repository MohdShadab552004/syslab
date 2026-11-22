import { describe, expect, it } from 'vitest';
import { blankDoc, makeEdge, makeNode } from '@syslab/sim';
import {
  DEFAULT_VIEW, HUB_MIN_CALLERS, elbowRoute, findHubs, focusSet, loadViewPrefs, pointAlong, saveViewPrefs,
} from '@/lib/canvas/readability';
import { GROUP_CARD, cardCenter, cardLeft, collapsedOwners, groupMembers } from '@/lib/canvas/groups';

describe('view prefs', () => {
  const store = (raw: string | null) => ({ getItem: () => raw });

  it('falls back to defaults when nothing is stored or storage is missing', () => {
    expect(loadViewPrefs(store(null))).toBe(DEFAULT_VIEW);
    expect(loadViewPrefs(undefined)).toBe(DEFAULT_VIEW);
  });

  it('parses stored prefs and sanitises unknown values', () => {
    expect(loadViewPrefs(store(JSON.stringify({ edges: 'all', route: 'straight', notes: 'open' }))))
      .toEqual({ edges: 'all', route: 'straight', notes: 'open' });
    expect(loadViewPrefs(store(JSON.stringify({ edges: 'x', route: 1 })))).toEqual(DEFAULT_VIEW);
  });

  it('returns defaults on bad json or a throwing storage', () => {
    expect(loadViewPrefs(store('{bad'))).toBe(DEFAULT_VIEW);
    expect(loadViewPrefs({ getItem: () => { throw new Error('denied'); } })).toBe(DEFAULT_VIEW);
  });

  it('uses globalThis.localStorage by default', () => {
    // node has no localStorage here (or an empty one): either way the defaults come back
    expect(loadViewPrefs()).toEqual(DEFAULT_VIEW);
    expect(() => saveViewPrefs(DEFAULT_VIEW)).not.toThrow();
  });

  it('saves json and swallows storage errors', () => {
    const saved: Record<string, string> = {};
    saveViewPrefs({ edges: 'all', route: 'elbow', notes: 'icons' }, { setItem: (k, v) => { saved[k] = v; } });
    expect(JSON.parse(saved['syslab.view.v2'])).toEqual({ edges: 'all', route: 'elbow', notes: 'icons' });
    expect(() => saveViewPrefs(DEFAULT_VIEW, { setItem: () => { throw new Error('quota'); } })).not.toThrow();
    expect(() => saveViewPrefs(DEFAULT_VIEW, undefined)).not.toThrow();
  });
});

describe('findHubs', () => {
  const doc = blankDoc({
    nodes: [
      ...['a', 'b', 'c', 'd'].map((id) => makeNode(id, 'app', 0, 0, id)),
      makeNode('r', 'cache', 0, 0, 'Redis'),
      makeNode('db', 'db', 0, 0, 'DB'),
      makeNode('w', 'app', 0, 0, 'W'),
    ],
    edges: [
      ...['a', 'b', 'c', 'd'].map((f) => makeEdge(`e${f}`, f, 'r')),
      makeEdge('dup', 'a', 'r'),
      makeEdge('ghost', 'missing', 'r'),
      makeEdge('adb', 'a', 'db'),
      makeEdge('bdb', 'b', 'db'),
      ...['a', 'b', 'c', 'd'].map((f) => makeEdge(`w${f}`, f, 'w')),
    ],
  });

  it('marks shared infra with enough distinct callers', () => {
    expect(HUB_MIN_CALLERS).toBe(4);
    expect([...findHubs(doc)]).toEqual(['r']);
  });

  it('respects minCallers', () => {
    expect([...findHubs(doc, 2)].sort()).toEqual(['db', 'r']);
  });
});

describe('focusSet', () => {
  const doc = { edges: [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c'), makeEdge('e3', 'x', 'y')] };
  it('is empty without ids', () => {
    const f = focusSet(doc, []);
    expect(f.nodes.size).toBe(0);
    expect(f.edges.size).toBe(0);
  });
  it('includes neighbours and connecting edges', () => {
    const f = focusSet(doc, ['b']);
    expect([...f.nodes].sort()).toEqual(['a', 'b', 'c']);
    expect([...f.edges].sort()).toEqual(['e1', 'e2']);
  });
});

describe('elbowRoute', () => {
  it('straight when aligned', () => {
    const r = elbowRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    expect(r.pts).toEqual([{ x: 0, y: 0 }, { x: 90, y: 0 }]);
    expect(r.len).toBe(90);
    expect(r.d).toBe('M0 0 L90 0');
    expect(r.arrow).toEqual({ x: 90, y: 0, ang: 0 });
  });

  it('horizontal-vertical-horizontal for mostly horizontal targets', () => {
    const r = elbowRoute({ x: 0, y: 0 }, { x: 200, y: 100 }, 10);
    expect(r.pts).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 190, y: 100 }]);
    expect(r.arrow.ang).toBe(0);
  });

  it('vertical version for mostly vertical targets', () => {
    const r = elbowRoute({ x: 0, y: 0 }, { x: 50, y: 300 }, 0);
    expect(r.pts).toEqual([{ x: 0, y: 0 }, { x: 0, y: 150 }, { x: 50, y: 150 }, { x: 50, y: 300 }]);
    expect(r.arrow.ang).toBe(90);
  });

  it('does not cut past the leg and handles a zero-length leg', () => {
    const r = elbowRoute({ x: 0, y: 0 }, { x: 0, y: 3 }, 50);
    expect(r.pts[1]).toEqual({ x: 0, y: 3 });
    const z = elbowRoute({ x: 5, y: 5 }, { x: 5, y: 5 }, -3);
    expect(z.len).toBe(0);
    expect(z.arrow.ang).toBe(0);
  });
});

describe('pointAlong', () => {
  it('handles empty and single-point lines', () => {
    expect(pointAlong([], 0.5)).toEqual({ x: 0, y: 0 });
    expect(pointAlong([{ x: 3, y: 4 }], 0.5)).toEqual({ x: 3, y: 4 });
  });
  it('walks along segments and clamps t', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(pointAlong(pts, 0.75)).toEqual({ x: 10, y: 5 });
    expect(pointAlong(pts, 0.25)).toEqual({ x: 5, y: 0 });
    expect(pointAlong(pts, 2)).toEqual({ x: 10, y: 10 });
    expect(pointAlong(pts, -1)).toEqual({ x: 0, y: 0 });
  });
  it('copes with zero-length segments', () => {
    expect(pointAlong([{ x: 1, y: 1 }, { x: 1, y: 1 }], 0.5)).toEqual({ x: 1, y: 1 });
  });
});

describe('groups', () => {
  const doc = blankDoc({
    nodes: [makeNode('in', 'app', 50, 50, 'In'), makeNode('out', 'app', 500, 500, 'Out'), makeNode('deep', 'app', 20, 20, 'Deep')],
    notes: [{ id: 't1', text: 'x', x: 60, y: 60 }, { id: 't2', text: 'y', x: 900, y: 900 }],
    groups: [
      { id: 'big', label: 'Big', x: 0, y: 0, w: 300, h: 300, color: 'blue', collapsed: true },
      { id: 'small', label: 'Small', x: 10, y: 10, w: 100, h: 100, color: 'green', collapsed: true },
      { id: 'half', label: 'Half', x: 250, y: 250, w: 400, h: 400, color: 'gray' },
      { id: 'lone', label: 'Lone', x: 1000, y: 1000, w: 100, h: 100, color: 'orange', collapsed: true },
    ],
  });

  it('groupMembers lists anchors inside the box and child groups fully inside', () => {
    const m = groupMembers(doc, doc.groups[0]);
    expect(m.nodes.sort()).toEqual(['deep', 'in']);
    expect(m.notes).toEqual(['t1']);
    expect(m.groups).toEqual(['small']);
  });

  it('collapsedOwners maps hidden items to the outermost collapsed group', () => {
    const o = collapsedOwners(doc);
    expect(o.get('node:in')).toBe('big');
    expect(o.get('node:deep')).toBe('big');
    expect(o.get('note:t1')).toBe('big');
    expect(o.get('group:small')).toBe('big');
    expect(o.has('node:out')).toBe(false);
    expect(o.has('group:lone')).toBe(false);
  });

  it('a collapsed group overlapping an earlier one does not steal its members', () => {
    const d = blankDoc({
      nodes: [makeNode('n', 'app', 50, 50, 'N')],
      notes: [{ id: 't', text: '', x: 50, y: 50 }],
      groups: [
        { id: 'a', label: 'A', x: 0, y: 0, w: 200, h: 200, color: 'blue', collapsed: true },
        { id: 'b', label: 'B', x: 40, y: 40, w: 300, h: 100, color: 'blue', collapsed: true },
        { id: 'c', label: 'C', x: 45, y: 45, w: 10, h: 10, color: 'blue' },
      ],
    });
    const o = collapsedOwners(d);
    // sorted by area: a (40000) claims everything first, b only finds owned members
    expect(o.get('node:n')).toBe('a');
    expect(o.get('note:t')).toBe('a');
    expect(o.get('group:c')).toBe('a');
  });

  it('a collapsed group processed later reuses already-owned members', () => {
    const d = blankDoc({
      nodes: [makeNode('n', 'app', 50, 50, 'N')],
      notes: [{ id: 't', text: '', x: 50, y: 50 }],
      groups: [
        { id: 'a', label: 'A', x: 0, y: 0, w: 400, h: 100, color: 'blue', collapsed: true },
        { id: 'b', label: 'B', x: 40, y: 0, w: 100, h: 200, color: 'blue', collapsed: true },
        { id: 'c', label: 'C', x: 45, y: 45, w: 10, h: 10, color: 'blue' },
      ],
    });
    const o = collapsedOwners(d);
    expect(o.get('node:n')).toBe('a');
    expect(o.get('note:t')).toBe('a');
    expect(o.get('group:c')).toBe('a');
  });

  it('card geometry is centred on the group', () => {
    const g = { id: 'g', label: '', x: 100, y: 50, w: 400, h: 300, color: 'blue' as const };
    expect(cardLeft(g)).toBe(100 + (400 - GROUP_CARD.w) / 2);
    expect(cardCenter(g)).toEqual({ x: cardLeft(g) + GROUP_CARD.w / 2, y: 50 + GROUP_CARD.h / 2 });
  });
});
