import { describe, expect, it } from 'vitest';
import { blankDoc, makeNode, simulate } from '@syslab/sim';
import { buildCanvasView, type CanvasUi } from '@/lib/canvas/buildCanvasView';

const UI: CanvasUi = {
  sel: null, pending: null, tool: 'select', recording: null, flowPlay: null, running: true, drain: {}, isLesson: false, rewire: null,
};

/** Bugs found while writing the coverage tests; each one stays fixed. */
describe('regressions', () => {
  it('a flow hop between two members of one collapsed group draws nothing', () => {
    const doc = blankDoc({
      nodes: [makeNode('a', 'app', 50, 50, 'A'), makeNode('b', 'app', 100, 100, 'B')],
      groups: [{ id: 'g', label: 'G', x: 0, y: 0, w: 300, h: 300, color: 'blue', collapsed: true }],
      flows: [{ id: 'f', name: 'F', steps: ['a', 'b'] }],
    });
    for (const route of ['elbow', 'straight'] as const) {
      const v = buildCanvasView(doc, simulate(doc), { ...UI, recording: 'f', view: { edges: 'smart', route, notes: 'icons' } });
      expect(v.flow).toEqual([]);
    }
  });
});
