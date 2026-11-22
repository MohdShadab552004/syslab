import { describe, expect, it } from 'vitest';
import { blankDoc, makeEdge, makeNode, simulate } from '@syslab/sim';
import type { DesignDoc } from '@syslab/types';
import { buildCanvasView, type CanvasUi } from '@/lib/canvas/buildCanvasView';
import { DEFAULT_VIEW, curveRoute, loadViewPrefs, portOffsets, type ViewPrefs } from '@/lib/canvas/readability';

const UI: CanvasUi = {
  sel: null, pending: null, tool: 'select', recording: null, flowPlay: null, running: true, drain: {}, isLesson: false, rewire: null,
};
const view = (route: ViewPrefs['route']): ViewPrefs => ({ edges: 'all', route, notes: 'icons' });
const build = (doc: DesignDoc, ui: Partial<CanvasUi> = {}) => buildCanvasView(doc, simulate(doc), { ...UI, ...ui });

describe('curveRoute', () => {
  it('leaves the side facing the target and enters the side facing the source', () => {
    const r = curveRoute({ x: 0, y: 0 }, { x: 400, y: 100 }, { fromR: 50, toR: 40, fromPort: 6, toPort: -4 });
    expect(r.pts[0]).toEqual({ x: 50, y: 6 });
    expect(r.arrow).toMatchObject({ x: 360, y: 96, ang: 0 });
    expect(r.d.startsWith('M50 6 C')).toBe(true);
    expect(r.pts).toHaveLength(17);
    expect(r.len).toBeGreaterThan(310);
  });

  it('flips for a target on the left', () => {
    const r = curveRoute({ x: 400, y: 0 }, { x: 0, y: 0 }, { fromR: 50, toR: 40 });
    expect(r.pts[0]).toEqual({ x: 350, y: 0 });
    expect(r.arrow).toMatchObject({ x: 40, y: 0, ang: 180 });
  });

  it('bends vertically for a node straight below or above', () => {
    const down = curveRoute({ x: 0, y: 0 }, { x: 10, y: 300 }, { fromR: 50, toR: 40, fromPort: 3, toPort: 2 });
    expect(down.pts[0]).toEqual({ x: 3, y: 50 });
    expect(down.arrow).toMatchObject({ x: 12, y: 260, ang: 90 });
    const up = curveRoute({ x: 0, y: 300 }, { x: 0, y: 0 }, { fromR: 50, toR: 40 });
    expect(up.arrow).toMatchObject({ x: 0, y: 40, ang: -90 });
  });

  it('keeps a minimum bend for very close nodes', () => {
    const r = curveRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, { fromR: 40, toR: 40 });
    expect(r.d).toBe('M40 0 C80 0 20 0 60 0');
  });
});

describe('portOffsets', () => {
  it('spreads lines evenly around the centre', () => {
    expect(portOffsets(0)).toEqual([]);
    expect(portOffsets(1)).toEqual([0]);
    expect(portOffsets(3)).toEqual([-9, 0, 9]);
  });
  it('squeezes the gap so many lines stay within the span', () => {
    const o = portOffsets(15);
    expect(o[0]).toBe(-28);
    expect(o[14]).toBe(28);
  });
});

describe('view prefs v2', () => {
  it('defaults to curves and keeps a saved elbow or straight choice', () => {
    expect(DEFAULT_VIEW.route).toBe('curve');
    expect(loadViewPrefs({ getItem: () => JSON.stringify({ route: 'elbow' }) }).route).toBe('elbow');
    expect(loadViewPrefs({ getItem: () => JSON.stringify({ route: 'curve' }) }).route).toBe('curve');
  });
});

describe('curved lines on the canvas', () => {
  // a gateway fanning out to three services stacked top to bottom
  const fan = () => blankDoc({
    users: 30000,
    nodes: [
      makeNode('u', 'users', 0, 300, 'Users'), makeNode('g', 'gateway', 300, 300, 'Gateway'),
      makeNode('a', 'app', 700, 100, 'A'), makeNode('b', 'app', 700, 300, 'B'), makeNode('c', 'app', 700, 500, 'C', { size: 0 }),
    ],
    edges: [makeEdge('ug', 'u', 'g'), makeEdge('gc', 'g', 'c', { weight: 4 }), makeEdge('ga', 'g', 'a'), makeEdge('gb', 'g', 'b')],
  });

  it('draws every line as its own curve with ports ordered by target height', () => {
    const v = build(fan(), { view: view('curve') });
    const start = (id: string) => Number(v.edges.find((e) => e.id === id)!.lines[0].path!.d.split(' ')[1]);
    // leaving the gateway: the line to the top service starts highest
    expect(start('ga')).toBeLessThan(start('gb'));
    expect(start('gb')).toBeLessThan(start('gc'));
    expect(v.edges.every((e) => e.lines.every((l) => l.path?.d.includes(' C')))).toBe(true);
  });

  it('thickness follows traffic and colour follows the target', () => {
    const v = build(fan(), { view: view('curve') });
    const e = (id: string) => v.edges.find((x) => x.id === id)!;
    expect(e('ug').weight).toBeCloseTo(3.6, 5);
    expect(e('gc').weight).toBeGreaterThan(e('ga').weight);
    // c is a small server getting 4/6 of the traffic: overloaded
    expect(e('gc').tone).toBe('fail');
    expect(e('ga').tone).toBe('ok');
  });

  it('a busy target colours its line amber', () => {
    const doc = blankDoc({
      users: 4000,
      nodes: [makeNode('u', 'users', 0, 0, 'U'), makeNode('a', 'app', 400, 0, 'A', { size: 0 })],
      edges: [makeEdge('ua', 'u', 'a')],
    });
    // 240 rps on a 300 rps server: 80%
    expect(build(doc, { view: view('curve') }).edges[0].tone).toBe('busy');
  });

  it('hovering a line shows its numbers and fades the others', () => {
    const v = build(fan(), { view: view('curve'), hoverEdge: 'ga' });
    const ga = v.edges.find((e) => e.id === 'ga')!;
    expect(ga.tip).toMatch(/^Gateway → A · \d+(\.\d)?k? rps · \d+ ms$/);
    expect(ga.hl).toBe(true);
    expect(v.edges.filter((e) => e.id !== 'ga').every((e) => e.dim && !e.tip)).toBe(true);
    const failing = build(fan(), { view: view('curve'), hoverEdge: 'gc' }).edges.find((e) => e.id === 'gc')!;
    expect(failing.tip).toMatch(/ · failing$/);
    const busyDoc = blankDoc({ users: 4000, nodes: [makeNode('u', 'users', 0, 0, 'U'), makeNode('a', 'app', 400, 0, 'A', { size: 0 })], edges: [makeEdge('ua', 'u', 'a')] });
    expect(build(busyDoc, { view: view('curve'), hoverEdge: 'ua' }).edges[0].tip).toMatch(/ · busy$/);
  });

  it('ignores a hovered id that is not drawn', () => {
    const v = build(fan(), { view: view('curve'), hoverEdge: 'nope' });
    expect(v.edges.some((e) => e.dim || e.tip)).toBe(false);
  });

  it('merged group lines show a count in their tooltip', () => {
    const doc = fan();
    doc.groups.push({ id: 'g1', label: 'Svc', x: 600, y: 0, w: 300, h: 600, color: 'blue', collapsed: true });
    const v = build(doc, { view: view('curve'), hoverEdge: 'gc' });
    const merged = v.edges.find((e) => e.label === '3 connections')!;
    expect(merged.id).toBe('gc');
    expect(merged.tip).toMatch(/^3 connections · [\d.]+k? rps/);
  });

  it('selected line handles sit on the curve ends', () => {
    const v = build(fan(), { view: view('curve'), sel: { type: 'edge', id: 'ga' } });
    const ga = v.edges.find((e) => e.id === 'ga')!;
    const start = ga.lines[0].path!.d.match(/^M([\d.-]+) ([\d.-]+)/)!;
    expect(ga.handles!.from).toEqual({ x: Math.round(Number(start[1])), y: Math.round(Number(start[2])) });
    expect(ga.handles!.to).toEqual({ x: Math.round(ga.lines[0].path!.arrow.x), y: Math.round(ga.lines[0].path!.arrow.y) });
  });

  it('straight mode draws plain lines but still weights them', () => {
    const v = build(fan(), { view: view('straight') });
    expect(v.edges.every((e) => e.lines.every((l) => !l.path))).toBe(true);
    expect(v.edges.find((e) => e.id === 'ug')!.weight).toBeCloseTo(3.6, 5);
  });

  it('a recorded flow follows the curves', () => {
    const doc = fan();
    doc.flows.push({ id: 'f', name: 'F', steps: ['u', 'g', 'a'] });
    const curved = build(doc, { view: view('curve'), recording: 'f' }).flow;
    const straight = build(doc, { view: view('straight'), recording: 'f' }).flow;
    expect(straight).toHaveLength(2);
    expect(curved.length).toBeGreaterThan(10);
  });

  it('with no traffic every line is the thinnest', () => {
    const doc = fan();
    doc.users = 0;
    expect(build(doc, { view: view('curve') }).edges.every((e) => e.weight === 1)).toBe(true);
  });
});
