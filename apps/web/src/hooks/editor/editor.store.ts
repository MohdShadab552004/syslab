'use client';

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  Design, DesignDoc, DesignEdge, DesignGroup, DesignNode, DesignNote, GroupColor, NodeKind, Requirements,
} from '@syslab/types';
import {
  EMPTY_RUNTIME, KINDS, autoH, autoV, isBalancer, lessonStep, makeEdge, makeNode, uid, usersFromRequirements,
  type PresetKey, type Runtime, type ScaleEvent,
} from '@syslab/sim';

/* ------------------------------------------------------------------ */
/*  State shape                                                        */
/* ------------------------------------------------------------------ */

import type { FlowPlayback, InspectorTab, Marquee, Pick, SaveState, Selection, Toast, Tool } from '@/types/editor';
import { groupMembers } from '@/lib/canvas/groups';
import { loadViewPrefs, saveViewPrefs, type ViewPrefs } from '@/lib/canvas/readability';
import { layout } from '@syslab/spec';
export type { FlowPlayback, InspectorTab, Marquee, Pick, SaveState, Selection, Toast, Tool };

interface UiState {
  tool: Tool;
  sel: Selection;
  pending: string | null;
  dragging: boolean;
  recording: string | null;
  flowPlay: FlowPlayback | null;
  tab: InspectorTab;
  shareOpen: boolean;
  toast: Toast | null;
  query: string;
  running: boolean;
  /** an edge end being dragged to another node */
  rewire: Rewire | null;
  /** two or more selected items (then `sel` is null) */
  multi: Pick[];
  /** box-select rectangle while dragging on empty canvas */
  marquee: Marquee | null;
  /** node under the pointer */
  hover: string | null;
  /** how the canvas draws the design (per browser) */
  view: ViewPrefs;
}

export type EdgeEnd = 'from' | 'to';
export interface Rewire { edgeId: string; end: EdgeEnd; x: number; y: number; over: string | null }

export interface EditorState {
  designId: string | null;
  name: string;
  revision: number;
  shareEnabled: boolean;
  shareToken: string | null;
  doc: DesignDoc | null;
  /** bumps on every doc/name change; autosave watches it */
  editSeq: number;
  saveState: SaveState;
  ui: UiState;
  runtime: Runtime;
  events: ScaleEvent[];
  /** undo / redo stacks of whole-doc snapshots (immutable, so cheap to keep) */
  past: DesignDoc[];
  future: DesignDoc[];
  actions: EditorActions;
}

/** What Ctrl+C holds: one node, group or note. */
/** What Ctrl+C holds: the selected items plus the connections between them. */
interface ClipBundle { nodes: DesignNode[]; groups: DesignGroup[]; notes: DesignNote[]; edges: DesignEdge[] }

const initialUi: UiState = {
  tool: 'select', sel: null, pending: null, dragging: false, recording: null, flowPlay: null,
  tab: 'inspect', shareOpen: false, toast: null, query: '', running: true, rewire: null, multi: [], marquee: null,
  hover: null, view: loadViewPrefs(),
};

/** Everything selected right now, as picks (a selected connection is not included). */
export function selectedPicks(ui: { sel: Selection; multi: Pick[] }): Pick[] {
  if (ui.multi.length) return ui.multi;
  return ui.sel && ui.sel.type !== 'edge' ? [{ type: ui.sel.type, id: ui.sel.id }] : [];
}

/** Put a list of picks into the ui: none, one (normal selection) or many. */
function applyPicks(s: EditorState, items: Pick[]) {
  const seen = new Set<string>();
  const list = items.filter((p) => { const k = p.type + ':' + p.id; if (seen.has(k)) return false; seen.add(k); return true; });
  s.ui.pending = null;
  if (list.length === 0) { s.ui.sel = null; s.ui.multi = []; return; }
  if (list.length === 1) { s.ui.sel = { ...list[0] }; s.ui.multi = []; }
  else { s.ui.sel = null; s.ui.multi = list; }
  s.ui.tab = 'inspect';
}

/** A group plus the nodes, notes and groups that sit inside its box. */
export function groupContents(doc: DesignDoc, gid: string): Pick[] {
  const g = doc.groups.find((x) => x.id === gid);
  if (!g) return [];
  const m = groupMembers(doc, g);
  return [
    { type: 'group', id: g.id },
    ...m.groups.map((id) => ({ type: 'group' as const, id })),
    ...m.nodes.map((id) => ({ type: 'node' as const, id })),
    ...m.notes.map((id) => ({ type: 'note' as const, id })),
  ];
}

/**
 * Can `end` of an edge be moved onto `nodeId`? Not onto its other end (self-loop),
 * and not if an identical connection already exists. Moving onto its current node is a no-op (valid).
 */
export function canRewire(doc: DesignDoc, edgeId: string, end: EdgeEnd, nodeId: string): boolean {
  const e = doc.edges.find((x) => x.id === edgeId);
  if (!e || !doc.nodes.some((n) => n.id === nodeId)) return false;
  const from = end === 'from' ? nodeId : e.from, to = end === 'to' ? nodeId : e.to;
  if (from === to) return false;
  return !doc.edges.some((x) => x.id !== edgeId && x.from === from && x.to === to);
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

type Set = (fn: (s: EditorState) => void) => void;
type Get = () => EditorState;

const HISTORY_LIMIT = 100;
/**
 * Continuous edits of the same thing (same merge key) closer together than this become one
 * undo step: a drag, typing in a field, repeated nudges. Discrete actions never merge.
 */
const MERGE_MS = 500;
const keysOf = (o: object) => Object.keys(o).sort().join(',');

/**
 * Mutate the doc and mark it for autosave. All doc writes go through here,
 * which is also where undo history is recorded.
 */
const editDoc = (set: Set, get: Get) => {
  let lastEditAt = 0;
  let lastKey: string | undefined;
  const edit = (fn: (doc: DesignDoc, s: EditorState) => void, mergeKey?: string) => {
    const prev = get().doc;
    const now = Date.now();
    // a pointer drag is one step however long the user pauses mid-drag
    const merge = !!mergeKey && mergeKey === lastKey && (now - lastEditAt < MERGE_MS || get().ui.dragging);
    lastEditAt = now;
    lastKey = mergeKey;
    set((s) => {
      if (!s.doc || !prev) return;
      if (!merge) {
        s.past.push(prev);
        if (s.past.length > HISTORY_LIMIT) s.past.shift();
      }
      s.future = [];
      fn(s.doc, s);
      s.editSeq++;
      s.saveState = 'dirty';
    });
  };
  /** Start a fresh undo step on the next edit (e.g. a new drag of the same node). */
  const breakMerge = () => { lastKey = undefined; };
  return { edit, breakMerge };
};

/** After undo/redo, drop a selection that no longer exists. */
function keepValidSelection(s: EditorState) {
  const sel = s.ui.sel, doc = s.doc;
  if (!doc) return;
  const exists = (type: string, id: string) =>
    (type === 'node' ? doc.nodes : type === 'edge' ? doc.edges : type === 'group' ? doc.groups : doc.notes).some((x) => x.id === id);
  if (sel && !exists(sel.type, sel.id)) s.ui.sel = null;
  if (s.ui.multi.length) {
    const left = s.ui.multi.filter((p) => exists(p.type, p.id));
    if (left.length !== s.ui.multi.length) applyPicks(s, left);
  }
}

const findNode = (doc: DesignDoc, id: string) => doc.nodes.find((n) => n.id === id);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function createActions(set: Set, get: Get) {
  const { edit, breakMerge } = editDoc(set, get);
  let clipboard: ClipBundle | null = null;
  let pasteCount = 0;

  /** Copy of everything selected plus the connections between those nodes, or null. */
  const snapshotSelection = (): ClipBundle | null => {
    const { doc, ui } = get();
    const picks = selectedPicks(ui);
    if (!doc || !picks.length) return null;
    const ids = (t: Pick['type']) => new Set(picks.filter((p) => p.type === t).map((p) => p.id));
    const nIds = ids('node'), gIds = ids('group'), tIds = ids('note');
    const bundle: ClipBundle = {
      nodes: structuredClone(doc.nodes.filter((n) => nIds.has(n.id))),
      groups: structuredClone(doc.groups.filter((g) => gIds.has(g.id))),
      notes: structuredClone(doc.notes.filter((t) => tIds.has(t.id))),
      edges: structuredClone(doc.edges.filter((e) => nIds.has(e.from) && nIds.has(e.to))),
    };
    return bundle.nodes.length + bundle.groups.length + bundle.notes.length ? bundle : null;
  };

  /** Insert a bundle with fresh ids, offset from the original, and select what was inserted. */
  const insertClip = (clip: ClipBundle, offset: number) => {
    const map = new Map<string, string>();
    const picks: Pick[] = [];
    edit((doc, s) => {
      for (const n of clip.nodes) {
        const id = uid('n'); map.set(n.id, id);
        doc.nodes.push({ ...structuredClone(n), id, x: n.x + offset, y: n.y + offset });
        picks.push({ type: 'node', id });
      }
      for (const e of clip.edges) {
        const from = map.get(e.from), to = map.get(e.to);
        if (from && to) doc.edges.push({ ...structuredClone(e), id: uid('e'), from, to });
      }
      for (const g of clip.groups) {
        const id = uid('g');
        doc.groups.push({ ...structuredClone(g), id, x: g.x + offset, y: g.y + offset });
        picks.push({ type: 'group', id });
      }
      for (const t of clip.notes) {
        const id = uid('t');
        doc.notes.push({ ...structuredClone(t), id, x: t.x + offset, y: t.y + offset });
        picks.push({ type: 'note', id });
      }
      applyPicks(s, picks);
    });
    return picks.length;
  };
  const toast = (text: string) => set((s) => { s.ui.toast = { text, at: Date.now() }; });
  const resetRuntimeFor = (s: EditorState, id: string) => {
    delete s.runtime.autoRep[id]; delete s.runtime.drain[id]; delete s.runtime.autoSize[id];
  };

  return {
    /* ---------- lifecycle ---------- */
    load(design: Design) {
      set((s) => {
        s.designId = design.id;
        s.name = design.name;
        s.revision = design.revision;
        s.shareEnabled = design.shareEnabled;
        s.shareToken = design.shareToken;
        s.doc = design.doc;
        s.past = []; s.future = [];
        s.editSeq = 0;
        s.saveState = 'idle';
        s.ui = { ...initialUi };
        s.runtime = { ...EMPTY_RUNTIME, autoRep: {}, drain: {}, autoSize: {}, qDepth: {} };
        s.events = [];
      });
    },
    reset() { set((s) => { s.designId = null; s.doc = null; }); },
    setSaveState(state: SaveState) { set((s) => { s.saveState = state; }); },
    markSaved(revision: number, seqAtSave: number) {
      set((s) => {
        s.revision = revision;
        s.saveState = s.editSeq === seqAtSave ? 'saved' : 'dirty';
      });
    },
    setShare(enabled: boolean, token: string | null) { set((s) => { s.shareEnabled = enabled; s.shareToken = token; }); },
    rename(name: string) { set((s) => { s.name = name; s.editSeq++; s.saveState = 'dirty'; }); },

    /* ---------- ui ---------- */
    setTool(tool: Tool) { set((s) => { s.ui.tool = tool; s.ui.pending = null; if (tool === 'connect') s.ui.recording = null; }); },
    select(sel: Selection) { set((s) => { s.ui.sel = sel; s.ui.multi = []; if (sel) s.ui.tab = 'inspect'; }); },
    clearSelection() { set((s) => { if (s.ui.sel || s.ui.pending || s.ui.multi.length) { s.ui.sel = null; s.ui.pending = null; s.ui.multi = []; } }); },

    /* ---------- multi-selection ---------- */
    selectMany(items: Pick[]) { set((s) => { applyPicks(s, items); }); },
    /** Shift+click: add an item to the selection, or take it out. */
    togglePick(p: Pick) {
      const cur = selectedPicks(get().ui);
      const has = cur.some((x) => x.type === p.type && x.id === p.id);
      set((s) => { applyPicks(s, has ? cur.filter((x) => !(x.type === p.type && x.id === p.id)) : [...cur, p]); });
    },
    selectAll() {
      const doc = get().doc;
      if (!doc) return;
      set((s) => {
        applyPicks(s, [
          ...doc.groups.map((g) => ({ type: 'group' as const, id: g.id })),
          ...doc.nodes.map((n) => ({ type: 'node' as const, id: n.id })),
          ...doc.notes.map((t) => ({ type: 'note' as const, id: t.id })),
        ]);
      });
    },
    /** Double-click a group: select it and everything inside its box. */
    selectGroupContents(gid: string) {
      const doc = get().doc;
      if (!doc) return;
      const picks = groupContents(doc, gid);
      set((s) => { applyPicks(s, picks); });
      if (picks.length > 1) toast(`Selected ${picks.length} items in this group`);
    },
    setMarquee(m: Marquee | null) { set((s) => { s.ui.marquee = m; }); },
    /** Set positions of several items at once (multi-drag). One undo step per drag. */
    moveItems(moves: { type: Pick['type']; id: string; x: number; y: number }[]) {
      if (!moves.length) return;
      edit((doc) => {
        for (const m of moves) {
          const list: { id: string; x: number; y: number }[] = m.type === 'node' ? doc.nodes : m.type === 'group' ? doc.groups : doc.notes;
          const it = list.find((x) => x.id === m.id);
          if (it) { it.x = m.x; it.y = m.y; }
        }
      }, `many:${moves.map((m) => m.id).join(',')}`);
    },
    /** Arrow keys: shift every selected item. */
    nudgeSelection(dx: number, dy: number) {
      const { doc, ui } = get();
      if (!doc) return false;
      const picks = selectedPicks(ui);
      if (!picks.length) return false;
      const moves = picks.map((p) => {
        const it = (p.type === 'node' ? doc.nodes : p.type === 'group' ? doc.groups : doc.notes).find((x) => x.id === p.id);
        return it ? { ...p, x: it.x + dx, y: it.y + dy } : null;
      }).filter((m): m is { type: Pick['type']; id: string; x: number; y: number } => !!m);
      get().actions.moveItems(moves);
      return true;
    },
    /** Delete everything selected (nodes take their connections with them). Returns how many. */
    deleteSelection() {
      const picks = selectedPicks(get().ui);
      if (!picks.length) return 0;
      const nIds = new Set(picks.filter((p) => p.type === 'node').map((p) => p.id));
      const gIds = new Set(picks.filter((p) => p.type === 'group').map((p) => p.id));
      const tIds = new Set(picks.filter((p) => p.type === 'note').map((p) => p.id));
      edit((doc, s) => {
        doc.nodes = doc.nodes.filter((n) => !nIds.has(n.id));
        doc.edges = doc.edges.filter((e) => !nIds.has(e.from) && !nIds.has(e.to));
        doc.groups = doc.groups.filter((g) => !gIds.has(g.id));
        doc.notes = doc.notes.filter((t) => !tIds.has(t.id));
        for (const f of doc.flows) f.steps = f.steps.filter((x) => !nIds.has(x));
        nIds.forEach((id) => resetRuntimeFor(s, id));
        s.ui.sel = null; s.ui.multi = []; s.ui.pending = null;
      });
      if (picks.length > 1) toast(`Deleted ${picks.length} items · Ctrl+Z to undo`);
      return picks.length;
    },
    setTab(tab: InspectorTab) { set((s) => { s.ui.tab = tab; }); },
    setQuery(q: string) { set((s) => { s.ui.query = q; }); },
    setShareOpen(open: boolean) { set((s) => { s.ui.shareOpen = open; }); },
    setRewire(r: Rewire | null) { set((s) => { s.ui.rewire = r; }); },
    setDragging(dragging: boolean) { if (dragging) breakMerge(); set((s) => { s.ui.dragging = dragging; }); },
    toggleRunning() { set((s) => { s.ui.running = !s.ui.running; }); },
    setHover(id: string | null) { if (get().ui.hover !== id) set((s) => { s.ui.hover = id; }); },
    setView(patch: Partial<ViewPrefs>) {
      set((s) => { s.ui.view = { ...s.ui.view, ...patch }; });
      saveViewPrefs(get().ui.view);
    },
    /** Collapse (or expand) every group at once. */
    setAllGroupsCollapsed(collapsed: boolean) {
      const doc = get().doc;
      if (!doc || !doc.groups.some((g) => !!g.collapsed !== collapsed)) return;
      edit((d, s) => {
        for (const g of d.groups) g.collapsed = collapsed;
        if (collapsed) {
          // members of collapsed groups are hidden, so they cannot stay selected
          const hidden = new Set(d.groups.flatMap((g) => groupContents(d, g.id).filter((p) => p.type !== 'group' || p.id !== g.id)).map((p) => `${p.type}:${p.id}`));
          if (s.ui.sel && s.ui.sel.type !== 'edge' && hidden.has(`${s.ui.sel.type}:${s.ui.sel.id}`)) s.ui.sel = null;
          s.ui.multi = s.ui.multi.filter((p) => !hidden.has(`${p.type}:${p.id}`));
        }
      });
    },
    /**
     * Re-arrange everything left to right in layers (users → edge → services → data), with each
     * group in its own band, so lines cross less. Notes keep their place next to their nearest node.
     */
    autoLayout() {
      const doc = get().doc;
      if (!doc || !doc.nodes.length) return;
      const members = doc.groups.map((g) => groupMembers(doc, g).nodes);
      const L = layout(doc.nodes, doc.edges, members);
      edit((d) => {
        const anchor = d.notes.map((t) => {
          let best: DesignNode | null = null, dist = Infinity;
          for (const n of d.nodes) { const k = Math.hypot(n.x - t.x, n.y - t.y); if (k < dist) { dist = k; best = n; } }
          return best ? { id: best.id, dx: t.x - best.x, dy: t.y - best.y } : null;
        });
        for (const n of d.nodes) { const p = L.nodes.get(n.id); if (p) { n.x = p.x; n.y = p.y; } }
        d.groups.forEach((g, i) => { if (members[i].length) Object.assign(g, L.groupBox(members[i])); });
        d.notes.forEach((t, i) => {
          const a = anchor[i], n = a && d.nodes.find((x) => x.id === a.id);
          if (a && n) { t.x = n.x + a.dx; t.y = n.y + a.dy; }
        });
      });
      get().actions.toast('Laid out left to right · Ctrl+Z to undo');
    },
    /** Throw away every message waiting in a queue. */
    purgeQueue(id: string) { set((s) => { s.runtime.qDepth = { ...s.runtime.qDepth }; delete s.runtime.qDepth[id]; }); toast('Queue purged'); },
    setSpike(spike: number) { set((s) => { s.runtime.spike = spike; }); },
    toast,
    clearToast() { set((s) => { s.ui.toast = null; }); },

    /* ---------- runtime (driven by the ticker) ---------- */
    applyRuntime(runtime: Runtime, events: ScaleEvent[]) {
      set((s) => {
        s.runtime = runtime;
        if (events.length) s.events = [...events, ...s.events].slice(0, 3);
      });
    },
    expireEvents(now: number) {
      set((s) => {
        const last = s.events[s.events.length - 1];
        if (last && now - last.at > 7000) s.events.pop();
      });
    },

    /* ---------- requirements & traffic ---------- */
    setRequirements(patch: Partial<Requirements>) {
      edit((doc) => {
        Object.assign(doc.requirements, patch);
        if (patch.dau !== undefined || patch.peak !== undefined) doc.users = usersFromRequirements(doc.requirements);
      }, `req:${keysOf(patch)}`);
    },
    setUsers(users: number) { edit((doc) => { doc.users = Math.max(0, Math.round(users || 0)); }, 'users'); },

    /* ---------- nodes ---------- */
    addNode(kind: NodeKind, x: number, y: number) {
      const id = uid('n');
      edit((doc) => {
        const same = doc.nodes.filter((n) => n.kind === kind).length;
        doc.nodes.push(makeNode(id, kind, x, y, KINDS[kind].name + (same ? ` ${same + 1}` : '')));
      });
      set((s) => { s.ui.sel = { type: 'node', id }; s.ui.tab = 'inspect'; });
    },
    addPreset(key: PresetKey, x: number, y: number) {
      const appId = uid('n');
      edit((doc) => {
        const users = doc.nodes.find((n) => n.kind === 'users' && !doc.edges.some((e) => e.from === n.id));
        if (key === 'asgH') {
          const lbId = uid('n');
          doc.nodes.push(makeNode(lbId, 'lb', x - 150, y, 'Load Balancer'));
          doc.nodes.push(makeNode(appId, 'app', x + 90, y, 'Server', { size: 2, autoscale: autoH(2, 10) }));
          doc.edges.push(makeEdge(uid('e'), lbId, appId));
          if (users) doc.edges.push(makeEdge(uid('e'), users.id, lbId));
        } else {
          doc.nodes.push(makeNode(appId, 'app', x, y, 'Server', { size: 1, autoscale: autoV(1, 4) }));
          if (users) doc.edges.push(makeEdge(uid('e'), users.id, appId));
        }
      });
      set((s) => { s.ui.sel = { type: 'node', id: appId }; s.ui.tab = 'inspect'; });
      toast(key === 'asgH' ? 'Autoscaling group added: load balancer + servers' : 'Vertical autoscaler added: one server that resizes');
    },
    updateNode(id: string, patch: Partial<DesignNode>) {
      edit((doc) => { const n = findNode(doc, id); if (n) Object.assign(n, patch); }, `node:${id}:${keysOf(patch)}`);
    },
    moveNode(id: string, x: number, y: number) {
      edit((doc) => { const n = findNode(doc, id); if (n) { n.x = x; n.y = y; } }, `move:${id}`);
    },
    updateAutoscale(id: string, patch: Partial<DesignNode['autoscale']>, resetRuntime = false) {
      edit((doc, s) => {
        const n = findNode(doc, id); if (!n) return;
        n.autoscale = { ...n.autoscale, ...patch };
        if (resetRuntime) resetRuntimeFor(s, id);
      }, `as:${id}:${keysOf(patch)}`);
    },
    updateDb(id: string, patch: Partial<NonNullable<DesignNode['dbc']>>) {
      edit((doc) => { const n = findNode(doc, id); if (n) n.dbc = { ...(n.dbc ?? {}), ...patch }; }, `db:${id}:${keysOf(patch)}`);
    },
    updateLb(id: string, patch: Partial<NonNullable<DesignNode['lbc']>>) {
      edit((doc) => { const n = findNode(doc, id); if (n) n.lbc = { ...(n.lbc ?? {}), ...patch }; }, `lb:${id}:${keysOf(patch)}`);
    },
    updateCache(id: string, patch: Partial<NonNullable<DesignNode['cachec']>>) {
      edit((doc) => { const n = findNode(doc, id); if (n) n.cachec = { ...(n.cachec ?? {}), ...patch }; }, `cache:${id}:${keysOf(patch)}`);
    },
    toggleDown(id: string) { edit((doc) => { const n = findNode(doc, id); if (n) n.down = !n.down; }); },
    deleteNode(id: string) {
      edit((doc, s) => {
        doc.nodes = doc.nodes.filter((n) => n.id !== id);
        doc.edges = doc.edges.filter((e) => e.from !== id && e.to !== id);
        for (const f of doc.flows) f.steps = f.steps.filter((x) => x !== id);
        resetRuntimeFor(s, id);
        s.ui.sel = null; s.ui.pending = null;
      });
    },
    /** Insert a load balancer between a scaled node and its non-balancer parents. */
    addLoadBalancer(id: string) {
      edit((doc, s) => {
        const n = findNode(doc, id); if (!n) return;
        const byId = new Map(doc.nodes.map((x) => [x.id, x]));
        const incoming = doc.edges.filter((e) => e.to === id && byId.has(e.from) && !isBalancer(byId.get(e.from)));
        const maxPx = incoming.length ? Math.max(...incoming.map((e) => byId.get(e.from)!.x)) : n.x - 420;
        const nx = Math.min(1000, Math.max(n.x, maxPx + 420));
        const lbId = uid('n');
        doc.nodes.push(makeNode(lbId, 'lb', Math.round((maxPx + nx) / 20) * 10, n.y, 'Load Balancer'));
        n.x = nx;
        const seen = new Set<string>();
        const moved: DesignEdge[] = [];
        for (const e of incoming) if (!seen.has(e.from)) { seen.add(e.from); moved.push({ ...e, id: uid('e'), to: lbId }); }
        moved.push(makeEdge(uid('e'), lbId, id, { proto: incoming[0]?.proto ?? 'REST' }));
        doc.edges = doc.edges.filter((e) => !incoming.includes(e)).concat(moved);
        resetRuntimeFor(s, id);
      });
      toast('Load balancer added. Replicas will now share the traffic.');
    },

    /* ---------- edges ---------- */
    /** Connect tool: first click picks the source, second click creates the edge. */
    connectClick(id: string) {
      const { ui, doc } = get();
      if (!doc) return;
      if (!ui.pending || ui.pending === id) {
        set((s) => { s.ui.pending = s.ui.pending === id ? null : id; s.ui.sel = { type: 'node', id }; });
        return;
      }
      const from = ui.pending;
      if (!doc.edges.some((e) => e.from === from && e.to === id)) edit((d) => { d.edges.push(makeEdge(uid('e'), from, id)); });
      set((s) => { s.ui.pending = null; s.ui.sel = { type: 'node', id }; });
    },
    updateEdge(id: string, patch: Partial<DesignEdge>) {
      edit((doc) => { const e = doc.edges.find((x) => x.id === id); if (e) Object.assign(e, patch); }, `edge:${id}:${keysOf(patch)}`);
    },
    /** Move one end of a connection to another node, keeping its settings. */
    rewireEdge(id: string, end: EdgeEnd, nodeId: string) {
      const { doc } = get();
      if (!doc || !canRewire(doc, id, end, nodeId)) return false;
      const e = doc.edges.find((x) => x.id === id)!;
      if (e[end] === nodeId) return true;
      edit((d, s) => {
        const x = d.edges.find((y) => y.id === id);
        if (x) x[end] = nodeId;
        s.ui.sel = { type: 'edge', id }; s.ui.tab = 'inspect';
      });
      const label = doc.nodes.find((n) => n.id === nodeId)?.label ?? 'node';
      toast(end === 'to' ? `Connection now goes to ${label}` : `Connection now starts at ${label}`);
      return true;
    },
    reverseEdge(id: string) {
      edit((doc) => { const e = doc.edges.find((x) => x.id === id); if (e) [e.from, e.to] = [e.to, e.from]; });
    },
    deleteEdge(id: string) {
      edit((doc, s) => { doc.edges = doc.edges.filter((e) => e.id !== id); if (s.ui.sel?.id === id) s.ui.sel = null; });
    },

    /* ---------- groups & notes ---------- */
    addGroup() {
      const id = uid('g');
      edit((doc) => {
        const n = doc.groups.length;
        doc.groups.push({ id, label: 'VPC · Region', x: 300 + n * 30, y: 230 + n * 30, w: 420, h: 300, color: 'blue' });
      });
      set((s) => { s.ui.sel = { type: 'group', id }; s.ui.tab = 'inspect'; });
    },
    updateGroup(id: string, patch: Partial<DesignGroup>) {
      edit((doc) => { const g = doc.groups.find((x) => x.id === id); if (g) Object.assign(g, patch); }, `group:${id}:${keysOf(patch)}`);
    },
    /** Fold a group into a summary card, or open it again. */
    toggleGroupCollapsed(id: string) {
      const g = get().doc?.groups.find((x) => x.id === id);
      if (!g) return;
      const collapse = !g.collapsed;
      edit((doc, s) => {
        const x = doc.groups.find((y) => y.id === id);
        if (x) x.collapsed = collapse;
        if (collapse) {
          // hidden members cannot stay selected
          const inside = new Set(groupContents(doc, id).filter((p) => p.type !== 'group' || p.id !== id).map((p) => `${p.type}:${p.id}`));
          if (s.ui.sel && s.ui.sel.type !== 'edge' && inside.has(`${s.ui.sel.type}:${s.ui.sel.id}`)) s.ui.sel = null;
          s.ui.multi = s.ui.multi.filter((p) => !inside.has(`${p.type}:${p.id}`));
          s.ui.sel = { type: 'group', id };
        }
      });
    },
    setGroupColor(id: string, color: GroupColor) { get().actions.updateGroup(id, { color }); },
    deleteGroup(id: string) { edit((doc, s) => { doc.groups = doc.groups.filter((g) => g.id !== id); s.ui.sel = null; }); },
    addNote() {
      const id = uid('t');
      edit((doc) => {
        const n = doc.notes.length;
        doc.notes.push({ id, text: 'Why this choice?', x: 980 - n * 20, y: 260 + n * 30 });
      });
      set((s) => { s.ui.sel = { type: 'note', id }; s.ui.tab = 'inspect'; });
    },
    updateNote(id: string, patch: Partial<{ text: string; x: number; y: number }>) {
      edit((doc) => { const t = doc.notes.find((x) => x.id === id); if (t) Object.assign(t, patch); }, `note:${id}:${keysOf(patch)}`);
    },
    deleteNote(id: string) { edit((doc, s) => { doc.notes = doc.notes.filter((t) => t.id !== id); s.ui.sel = null; }); },
    clearCanvas() {
      edit((doc, s) => {
        doc.nodes = []; doc.edges = []; doc.groups = []; doc.notes = []; doc.flows = [];
        s.ui.sel = null; s.ui.pending = null; s.ui.recording = null; s.ui.flowPlay = null;
        s.runtime = { ...EMPTY_RUNTIME, autoRep: {}, drain: {}, autoSize: {}, qDepth: {}, spike: s.runtime.spike };
      });
    },

    /* ---------- flows ---------- */
    newFlow() {
      const id = uid('f');
      edit((doc, s) => {
        doc.flows.push({ id, name: `Flow ${doc.flows.length + 1}`, steps: [] });
        s.ui.recording = id; s.ui.flowPlay = null; s.ui.tool = 'select'; s.ui.pending = null; s.ui.tab = 'flows';
      });
      toast('Click components in the order the request travels');
    },
    recordStep(nodeId: string) {
      edit((doc, s) => {
        const f = doc.flows.find((x) => x.id === s.ui.recording);
        if (f && f.steps[f.steps.length - 1] !== nodeId) f.steps.push(nodeId);
      });
    },
    undoStep() { edit((doc, s) => { doc.flows.find((x) => x.id === s.ui.recording)?.steps.pop(); }); },
    finishRecording() {
      const { doc, ui } = get();
      const n = doc?.flows.find((f) => f.id === ui.recording)?.steps.length ?? 0;
      set((s) => { s.ui.recording = null; });
      toast(n >= 2 ? 'Flow saved · press Play below' : 'Add at least two steps to play it');
    },
    rerecordFlow(id: string) {
      edit((doc, s) => {
        const f = doc.flows.find((x) => x.id === id); if (f) f.steps = [];
        s.ui.recording = id; s.ui.flowPlay = null; s.ui.tool = 'select';
      });
    },
    renameFlow(id: string, name: string) { edit((doc) => { const f = doc.flows.find((x) => x.id === id); if (f) f.name = name; }, `flowname:${id}`); },
    deleteFlow(id: string) {
      edit((doc, s) => {
        doc.flows = doc.flows.filter((f) => f.id !== id);
        if (s.ui.flowPlay?.id === id) s.ui.flowPlay = null;
        if (s.ui.recording === id) s.ui.recording = null;
      });
    },
    playFlow(id: string) {
      const f = get().doc?.flows.find((x) => x.id === id);
      if (!f || f.steps.length < 2) return toast('A flow needs at least two steps');
      set((s) => { s.ui.flowPlay = { id, idx: 0, playing: true }; s.ui.recording = null; });
    },
    setFlowPlay(fp: FlowPlayback | null) { set((s) => { s.ui.flowPlay = fp; }); },

    /* ---------- lesson ---------- */
    loadLessonStep(step: number) {
      const s = lessonStep(step);
      edit((doc, st) => {
        doc.nodes = s.nodes; doc.edges = s.edges; doc.users = s.users;
        doc.lesson = { id: doc.lesson?.id ?? 'horizontal-scaling', step };
        st.ui.sel = null; st.ui.pending = null;
        st.runtime = { ...EMPTY_RUNTIME, autoRep: {}, drain: {}, autoSize: {}, qDepth: {}, spike: st.runtime.spike };
        st.events = [];
      });
    },

    /* ---------- history ---------- */
    undo() {
      set((s) => {
        const prev = s.past.pop();
        if (!prev || !s.doc) return;
        s.future.push(s.doc);
        s.doc = prev;
        s.editSeq++; s.saveState = 'dirty'; s.ui.pending = null;
        keepValidSelection(s);
      });
    },
    redo() {
      set((s) => {
        const next = s.future.pop();
        if (!next || !s.doc) return;
        s.past.push(s.doc);
        s.doc = next;
        s.editSeq++; s.saveState = 'dirty'; s.ui.pending = null;
        keepValidSelection(s);
      });
    },

    /* ---------- clipboard ---------- */
    /** Returns false when nothing copyable is selected. */
    copySelection() {
      const clip = snapshotSelection();
      if (!clip) return false;
      clipboard = clip; pasteCount = 0;
      const n = clip.nodes.length + clip.groups.length + clip.notes.length;
      if (n > 1) toast(`Copied ${n} items${clip.edges.length ? ` + ${clip.edges.length} connections` : ''}`);
      return true;
    },
    cutSelection() {
      const clip = snapshotSelection();
      if (!clip) return false;
      clipboard = clip; pasteCount = 0;
      get().actions.deleteSelection();
      toast('Cut · press Ctrl+V to paste');
      return true;
    },
    paste() {
      if (!clipboard) return false;
      pasteCount++;
      insertClip(clipboard, 30 * pasteCount);
      return true;
    },
    duplicateSelection() {
      const clip = snapshotSelection();
      if (!clip) return false;
      insertClip(clip, 30);
      return true;
    },

    /** Replace the whole doc (e.g. after restoring a version). */
    replaceFromServer(design: Design) {
      set((s) => {
        s.past = []; s.future = [];
        s.doc = design.doc; s.revision = design.revision; s.editSeq++; s.saveState = 'saved';
        s.ui.sel = null; s.ui.pending = null; s.ui.recording = null; s.ui.flowPlay = null;
        s.runtime = { ...EMPTY_RUNTIME, autoRep: {}, drain: {}, autoSize: {}, qDepth: {} };
        s.events = [];
      });
    },
  };
}

export type EditorActions = ReturnType<typeof createActions>;

export const useEditorStore = create<EditorState>()(
  immer((set, get) => ({
    designId: null,
    name: '',
    revision: 0,
    shareEnabled: false,
    shareToken: null,
    doc: null,
    editSeq: 0,
    saveState: 'idle',
    ui: initialUi,
    runtime: EMPTY_RUNTIME,
    events: [],
    past: [],
    future: [],
    actions: createActions(set, get),
  })),
);

/** Actions never change identity, so components using only this never re-render. */
export const useEditorActions = () => useEditorStore((s) => s.actions);

export { clamp };
