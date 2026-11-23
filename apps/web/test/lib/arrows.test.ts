import { describe, expect, it, vi, type Mock } from 'vitest';
import type { DesignDoc, DesignEdge } from '@syslab/types';
import { blankDoc, makeEdge, makeNode, simulate } from '@syslab/sim';
import { buildCanvasView, type CanvasUi } from '@/lib/canvas/buildCanvasView';
import { curveRoute, elbowRoute, type ViewPrefs } from '@/lib/canvas/readability';
import type { EditorActions } from '@/hooks/editor/editor.store';
import { ARROW_HEADS, edgeView } from '@/hooks/editor/useInspector';

const UI: CanvasUi = {
  sel: null, pending: null, tool: 'select', recording: null, flowPlay: null, running: true, drain: {}, isLesson: false, rewire: null,
};
const doc = (edge: Partial<DesignEdge> = {}): DesignDoc => blankDoc({
  nodes: [makeNode('a', 'app', 0, 0, 'A'), makeNode('b', 'app', 400, 0, 'B')],
  edges: [makeEdge('ab', 'a', 'b', edge)],
});
const build = (d: DesignDoc, route: ViewPrefs['route'] = 'curve') =>
  buildCanvasView(d, simulate(d), { ...UI, view: { edges: 'smart', route, notes: 'icons' } } as CanvasUi);

describe('routes know their start', () => {
  it('a curve starts on the source rim, pointing back into it', () => {
    const r = curveRoute({ x: 0, y: 0 }, { x: 400, y: 0 }, { fromR: 30, toR: 30 });
    expect(r.start).toEqual({ x: 30, y: 0, ang: 180 });
    expect(r.arrow).toMatchObject({ x: 370, y: 0, ang: 0 });
    // vertical neighbours leave downwards
    const v = curveRoute({ x: 0, y: 0 }, { x: 0, y: 400 }, { fromR: 20, toR: 20 });
    expect(v.start).toEqual({ x: 0, y: 20, ang: -90 });
  });

  it('an elbow line starts under the source but its visible start is on the rim', () => {
    const r = elbowRoute({ x: 0, y: 0 }, { x: 400, y: 200 }, 30, 25);
    expect(r.pts[0]).toEqual({ x: 0, y: 0 });
    expect(r.start).toEqual({ x: 25, y: 0, ang: 180 });
    // a radius longer than the first leg stops just short of the corner
    expect(elbowRoute({ x: 0, y: 0 }, { x: 20, y: 200 }, 0, 500).start.y).toBe(96);
    // without a radius the start is the anchor
    expect(elbowRoute({ x: 0, y: 0 }, { x: 400, y: 0 }, 0).start).toEqual({ x: 0, y: 0, ang: 180 });
    // a zero-length first leg has no direction
    expect(elbowRoute({ x: 5, y: 5 }, { x: 5, y: 5 }, 0, 10).start).toMatchObject({ x: 5, y: 5 });
  });
});

describe('line ends on the canvas', () => {
  it('default: triangle at the target, nothing at the source', () => {
    const e = build(doc()).edges[0];
    expect(e).toMatchObject({ head: 'triangle', tail: 'none' });
    expect(e.lines[0].path?.start).toBeDefined();
  });

  it('custom ends are carried to every line, curved, elbow or straight', () => {
    for (const route of ['curve', 'elbow', 'straight'] as const) {
      const e = build(doc({ head: 'diamond', tail: 'circle' }), route).edges[0];
      expect(e).toMatchObject({ head: 'diamond', tail: 'circle' });
    }
    const straight = build(doc(), 'straight').edges[0].lines[0];
    expect(straight.path).toBeUndefined();
    // the tail of a straight line sits on the source rim
    expect(straight.tailX).toBeGreaterThan(0);
    expect(straight.tailX).toBeLessThan(straight.arrowX);
  });
});

type Actions = EditorActions & Record<string, Mock>;
const mockActions = (): Actions => {
  const fns: Record<string, Mock> = {};
  return new Proxy(fns, { get: (t, k: string) => (t[k] ??= vi.fn()) }) as unknown as Actions;
};

describe('line end picker', () => {
  it('lists Figma\'s six ends for each side and marks the current ones', () => {
    const d = doc();
    const v = edgeView(d.edges[0], d, simulate(d), mockActions()).arrows;
    expect(v.start.map((o) => o.key)).toEqual(ARROW_HEADS.map(([k]) => k));
    expect(v.start.find((o) => o.active)!.key).toBe('none');
    expect(v.end.find((o) => o.active)!.key).toBe('triangle');
  });

  it('sets either end, and swap trades them without reversing the connection', () => {
    const d = doc({ head: 'line', tail: 'diamond' });
    const a = mockActions();
    const v = edgeView(d.edges[0], d, simulate(d), a).arrows;
    v.start[4].onSelect();
    expect(a.updateEdge).toHaveBeenLastCalledWith('ab', { tail: 'circle' });
    v.end[0].onSelect();
    expect(a.updateEdge).toHaveBeenLastCalledWith('ab', { head: 'none' });
    v.onSwap();
    expect(a.updateEdge).toHaveBeenLastCalledWith('ab', { head: 'diamond', tail: 'line' });
    expect(a.reverseEdge).not.toHaveBeenCalled();
  });
});
