'use client';

import { useCallback, useMemo, useRef } from 'react';
import type { NodeKind } from '@syslab/types';
import type { PresetKey } from '@syslab/sim';
import { canRewire, groupContents, selectedPicks, useEditorStore, type EdgeEnd, type Pick } from './editor.store';

type DragKind = 'node' | 'group' | 'resize' | 'note' | 'many';
type Start = { type: Pick['type']; id: string; x: number; y: number };
interface DragState {
  kind: DragKind;
  id: string;
  originX: number;
  originY: number;
  startA: number;
  startB: number;
  /** node kind of the dragged node */
  nodeKind?: NodeKind;
  /** multi-drag: every selected item and where it started */
  many?: Start[];
  last?: string;
  frame?: number;
}

/** Box select in progress. */
interface MarqueeState { pointerId: number; sx: number; sy: number; wx: number; wy: number; additive: boolean; base: Pick[]; active: boolean }

const same = (a: Pick, b: Pick) => a.type === b.type && a.id === b.id;
const overlaps = (a: DOMRect, b: { l: number; t: number; r: number; b: number }) => a.right >= b.l && a.left <= b.r && a.bottom >= b.t && a.top <= b.b;
const inside = (a: DOMRect, b: { l: number; t: number; r: number; b: number }) => a.left >= b.l && a.right <= b.r && a.top >= b.t && a.bottom <= b.b;

/**
 * Items touched by a screen rectangle, like a file-explorer lasso: components and notes count
 * when the box touches them, groups only when the box covers the whole group.
 */
function picksInBox(world: HTMLElement, box: { l: number; t: number; r: number; b: number }): Pick[] {
  const out: Pick[] = [];
  world.querySelectorAll<HTMLElement>('[data-node]').forEach((el) => {
    const bodies = el.querySelectorAll<HTMLElement>('.body:not(.ghost)');
    if ([...bodies].some((b) => overlaps(b.getBoundingClientRect(), box))) out.push({ type: 'node', id: el.dataset.node! });
  });
  world.querySelectorAll<HTMLElement>('[data-note]').forEach((el) => { if (overlaps(el.getBoundingClientRect(), box)) out.push({ type: 'note', id: el.dataset.note! }); });
  world.querySelectorAll<HTMLElement>('[data-group]').forEach((el) => { if (inside(el.getBoundingClientRect(), box)) out.push({ type: 'group', id: el.dataset.group! }); });
  return out;
}

export type PaletteDragItem = { type: 'kind'; kind: NodeKind } | { type: 'preset'; key: PresetKey };

const SNAP = 10;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

/** The transformed world element, given the stage (or the world itself). */
function worldOf(el: HTMLElement): HTMLElement {
  return el.closest<HTMLElement>('.world') ?? el.querySelector<HTMLElement>('.world') ?? el;
}

/** Node id under a screen point (the ghost line and dot ignore the pointer). */
function nodeAt(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  return el?.closest<HTMLElement>('[data-node]')?.dataset.node ?? null;
}

/** Current camera zoom of the world, read from its rendered size. */
function worldScale(world: HTMLElement) {
  return world.getBoundingClientRect().width / world.offsetWidth || 1;
}

/** Screen point -> world coordinates, accounting for camera pan and zoom. */
function toWorld(world: HTMLElement, clientX: number, clientY: number) {
  const r = world.getBoundingClientRect(), s = worldScale(world);
  return { x: (clientX - r.left) / s, y: (clientY - r.top) / s };
}

/**
 * Every pointer gesture on the canvas: drag nodes/groups/notes, resize groups,
 * connect, record flows, drop from the palette. Moves are batched per animation frame.
 */
export function useCanvasInteractions() {
  const actions = useEditorStore((s) => s.actions);
  const drag = useRef<DragState | null>(null);
  const paletteItem = useRef<PaletteDragItem | null>(null);

  const begin = useCallback((e: React.PointerEvent, state: Omit<DragState, 'originX' | 'originY'>) => {
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* pointer already released */ }
    drag.current = { ...state, originX: e.clientX, originY: e.clientY };
    actions.setDragging(true);
  }, [actions]);

  /**
   * Shared click logic for nodes, groups and notes. Shift+click toggles the item in the selection;
   * pressing an item that is part of a multi-selection drags the whole selection.
   * Returns true when it handled the press.
   */
  const pickDown = useCallback((e: React.PointerEvent, p: Pick): boolean => {
    const { ui, doc } = useEditorStore.getState();
    if (!doc) return true;
    if (e.shiftKey) { e.stopPropagation(); actions.togglePick(p); return true; }
    const cur = selectedPicks(ui);
    if (cur.length > 1 && cur.some((x) => same(x, p))) {
      // a selected group drags everything inside it too
      const all = [...cur];
      for (const x of cur) if (x.type === 'group') groupContents(doc, x.id).forEach((c) => { if (!all.some((y) => same(y, c))) all.push(c); });
      const many: Start[] = all.map((x) => {
        const it = (x.type === 'node' ? doc.nodes : x.type === 'group' ? doc.groups : doc.notes).find((y) => y.id === x.id);
        return it ? { ...x, x: it.x, y: it.y } : null;
      }).filter((x): x is Start => !!x);
      begin(e, { kind: 'many', id: '', startA: 0, startB: 0, many });
      return true;
    }
    return false;
  }, [actions, begin]);

  const onNodeHover = useCallback((id: string | null) => actions.setHover(id), [actions]);

  const onNodePointerDown = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const { ui, doc } = useEditorStore.getState();
    if (ui.recording) return actions.recordStep(id);
    if (ui.tool === 'connect') return actions.connectClick(id);
    const n = doc?.nodes.find((x) => x.id === id);
    if (!n) return;
    if (pickDown(e, { type: 'node', id })) return;
    actions.select({ type: 'node', id });
    begin(e, { kind: 'node', id, startA: n.x, startB: n.y, nodeKind: n.kind });
  }, [actions, begin, pickDown]);

  const onGroupPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    const doc = useEditorStore.getState().doc;
    const g = doc?.groups.find((x) => x.id === id);
    if (!doc || !g) return;
    if (pickDown(e, { type: 'group', id })) return;
    actions.select({ type: 'group', id });
    // like a frame: moving a group moves what is inside it (resize the corner to re-frame)
    const many: Start[] = groupContents(doc, id).map((x) => {
      const it = (x.type === 'node' ? doc.nodes : x.type === 'group' ? doc.groups : doc.notes).find((y) => y.id === x.id);
      return it ? { ...x, x: it.x, y: it.y } : null;
    }).filter((x): x is Start => !!x);
    begin(e, { kind: 'many', id, startA: 0, startB: 0, many });
  }, [actions, begin, pickDown]);

  const onGroupToggle = useCallback((e: React.SyntheticEvent, id: string) => {
    e.stopPropagation();
    actions.toggleGroupCollapsed(id);
  }, [actions]);

  const onGroupResizeDown = useCallback((e: React.PointerEvent, id: string) => {
    const g = useEditorStore.getState().doc?.groups.find((x) => x.id === id);
    if (!g) return;
    actions.select({ type: 'group', id });
    begin(e, { kind: 'resize', id, startA: g.w, startB: g.h });
  }, [actions, begin]);

  const onNotePointerDown = useCallback((e: React.PointerEvent, id: string) => {
    const t = useEditorStore.getState().doc?.notes.find((x) => x.id === id);
    if (!t) return;
    if (pickDown(e, { type: 'note', id })) return;
    actions.select({ type: 'note', id });
    begin(e, { kind: 'note', id, startA: t.x, startB: t.y });
  }, [actions, begin, pickDown]);

  const onNoteFocus = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    actions.select({ type: 'note', id });
  }, [actions]);

  const onEdgePick = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    actions.select({ type: 'edge', id });
  }, [actions]);

  /** Press on empty canvas: start a selection box (a plain click clears the selection on release). */
  const marquee = useRef<MarqueeState | null>(null);
  const onWorldPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const { ui } = useEditorStore.getState();
    if (ui.tool === 'connect' || ui.recording) { actions.clearSelection(); return; }
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    const p = toWorld(worldOf(e.currentTarget), e.clientX, e.clientY);
    marquee.current = {
      pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, wx: p.x, wy: p.y,
      additive: e.shiftKey, base: e.shiftKey ? selectedPicks(ui) : [], active: false,
    };
  }, [actions]);

  /** Double-click a group (its label or anywhere inside it) to select everything in it. */
  const onWorldDoubleClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-node], [data-note], .hud > *')) return;
    const doc = useEditorStore.getState().doc;
    if (!doc) return;
    const gid = t.closest<HTMLElement>('[data-group]')?.dataset.group;
    if (gid) {
      // a collapsed card opens on double-click; an open group selects its contents
      if (doc.groups.find((g) => g.id === gid)?.collapsed) actions.toggleGroupCollapsed(gid);
      else actions.selectGroupContents(gid);
      return;
    }
    const p = toWorld(worldOf(e.currentTarget), e.clientX, e.clientY);
    const hit = doc.groups
      .filter((g) => !g.collapsed && p.x >= g.x && p.x <= g.x + g.w && p.y >= g.y && p.y <= g.y + g.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (hit) actions.selectGroupContents(hit.id);
  }, [actions]);

  /** Grab one end of the selected connection to drag it onto another node. */
  const rewiring = useRef<{ pointerId: number; frame?: number } | null>(null);
  const onEdgeHandleDown = useCallback((e: React.PointerEvent<HTMLElement>, edgeId: string, end: EdgeEnd) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    const p = toWorld(worldOf(e.currentTarget), e.clientX, e.clientY);
    rewiring.current = { pointerId: e.pointerId };
    actions.setDragging(true);
    actions.setRewire({ edgeId, end, x: p.x, y: p.y, over: null });
  }, [actions]);

  const onWorldPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const m = marquee.current;
    if (m && m.pointerId === e.pointerId) {
      if (!m.active && Math.hypot(e.clientX - m.sx, e.clientY - m.sy) < 4) return;
      m.active = true;
      const world = worldOf(e.currentTarget);
      const p = toWorld(world, e.clientX, e.clientY);
      actions.setMarquee({ x1: m.wx, y1: m.wy, x2: p.x, y2: p.y });
      const box = { l: Math.min(m.sx, e.clientX), t: Math.min(m.sy, e.clientY), r: Math.max(m.sx, e.clientX), b: Math.max(m.sy, e.clientY) };
      const hits = picksInBox(world, box);
      actions.selectMany(m.additive ? [...m.base, ...hits.filter((h) => !m.base.some((b) => same(b, h)))] : hits);
      return;
    }
    const rw = rewiring.current;
    if (rw) {
      const cur = useEditorStore.getState().ui.rewire;
      if (!cur) return;
      const p = toWorld(worldOf(e.currentTarget), e.clientX, e.clientY);
      const over = nodeAt(e.clientX, e.clientY);
      if (rw.frame) cancelAnimationFrame(rw.frame);
      rw.frame = requestAnimationFrame(() => actions.setRewire({ ...cur, x: p.x, y: p.y, over }));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const s = worldScale(worldOf(e.currentTarget));
    const dx = (e.clientX - d.originX) / s, dy = (e.clientY - d.originY) / s;
    // Infinite canvas: positions are unbounded; only group sizes have a minimum.
    if (d.kind === 'many') {
      const sdx = snap(dx), sdy = snap(dy), k = `${sdx},${sdy}`;
      if (k === d.last) return;
      d.last = k;
      if (d.frame) cancelAnimationFrame(d.frame);
      const moves = d.many!.map((s0) => ({ ...s0, x: s0.x + sdx, y: s0.y + sdy }));
      d.frame = requestAnimationFrame(() => actions.moveItems(moves));
      return;
    }
    let a = snap(d.startA + dx), b = snap(d.startB + dy);
    if (d.kind === 'resize') { a = Math.max(160, a); b = Math.max(120, b); }
    const key = `${a},${b}`;
    if (key === d.last) return;
    d.last = key;
    // One store write per frame, however fast the pointer moves.
    if (d.frame) cancelAnimationFrame(d.frame);
    d.frame = requestAnimationFrame(() => {
      if (d.kind === 'node') actions.moveNode(d.id, a, b);
      else if (d.kind === 'group') actions.updateGroup(d.id, { x: a, y: b });
      else if (d.kind === 'resize') actions.updateGroup(d.id, { w: a, h: b });
      else actions.updateNote(d.id, { x: a, y: b });
    });
  }, [actions]);

  const onWorldPointerUp = useCallback((e?: React.PointerEvent<HTMLElement>) => {
    const m = marquee.current;
    if (m && (!e || m.pointerId === e.pointerId)) {
      marquee.current = null;
      if (m.active) actions.setMarquee(null);
      else if (!m.additive) actions.clearSelection();
      return;
    }
    const rw = rewiring.current;
    if (rw) {
      if (rw.frame) cancelAnimationFrame(rw.frame);
      rewiring.current = null;
      const { ui, doc } = useEditorStore.getState();
      const cur = ui.rewire;
      // drop target from the release point (the last move may still be waiting for a frame)
      const over = e ? nodeAt(e.clientX, e.clientY) : cur?.over ?? null;
      actions.setRewire(null);
      actions.setDragging(false);
      if (cur && over && doc && canRewire(doc, cur.edgeId, cur.end, over)) actions.rewireEdge(cur.edgeId, cur.end, over);
      return;
    }
    if (!drag.current) return;
    drag.current = null;
    actions.setDragging(false);
  }, [actions]);

  const onPaletteDragStart = useCallback((e: React.DragEvent, item: PaletteDragItem) => {
    paletteItem.current = item;
    e.dataTransfer.setData('text/plain', item.type === 'kind' ? item.kind : item.key);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const place = useCallback((item: PaletteDragItem, x: number, y: number) => {
    if (item.type === 'preset') actions.addPreset(item.key, x, y);
    else actions.addNode(item.kind, x, y);
  }, [actions]);

  const onDrop = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    const item = paletteItem.current;
    paletteItem.current = null;
    if (!item) return;
    const p = toWorld(worldOf(e.currentTarget), e.clientX, e.clientY);
    place(item, snap(p.x), snap(p.y));
  }, [place]);

  /** Click (not drag) on a palette item drops it in the middle of the visible canvas, staggered. */
  const stagger = useRef(0);
  const onPaletteClick = useCallback((item: PaletteDragItem) => {
    const j = (stagger.current++ % 6) * 22;
    const world = document.querySelector<HTMLElement>('.stage .world');
    const stage = world?.parentElement;
    if (!world || !stage) return place(item, 520 + j, 380 + j);
    const r = stage.getBoundingClientRect();
    const p = toWorld(world, r.left + r.width / 2, r.top + r.height / 2 + 40);
    place(item, snap(p.x + j), snap(p.y + j));
  }, [place]);

  return useMemo(() => ({
    onNodePointerDown, onNodeHover, onGroupPointerDown, onGroupResizeDown, onGroupToggle, onNotePointerDown, onNoteFocus, onEdgePick, onEdgeHandleDown,
    onWorldPointerDown, onWorldPointerMove, onWorldPointerUp, onWorldDoubleClick, onDragOver, onDrop, onPaletteDragStart, onPaletteClick,
  }), [onNodePointerDown, onNodeHover, onGroupPointerDown, onGroupResizeDown, onGroupToggle, onNotePointerDown, onNoteFocus, onEdgePick, onEdgeHandleDown,
    onWorldPointerDown, onWorldPointerMove, onWorldPointerUp, onWorldDoubleClick, onDragOver, onDrop, onPaletteDragStart, onPaletteClick]);
}

export type CanvasHandlers = ReturnType<typeof useCanvasInteractions>;
