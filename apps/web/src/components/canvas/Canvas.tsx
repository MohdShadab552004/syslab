import { memo, type ReactNode } from 'react';
import { cx } from '@/lib/utils/cx';
import type { CanvasView } from '@/lib/canvas/buildCanvasView';
import type { CanvasHandlers } from '@/hooks/editor/useCanvasInteractions';
import type { Camera } from '@/hooks/editor/useCamera';
import { EdgeHandles, EdgeLabels, EdgeLayer, FlowLayer, RewireGhost } from './EdgeLayer';
import { GroupBox } from './GroupBox';
import { NodeView } from './NodeView';
import { StickyNote } from './StickyNote';

interface Props {
  view: CanvasView;
  handlers: Partial<CanvasHandlers>;
  camera: Camera;
  onNoteText?: (id: string, text: string) => void;
  dragging?: boolean;
  readOnly?: boolean;
  /** overlays pinned to the viewport (title, metrics, toolbar...); they do not pan or zoom */
  children?: ReactNode;
}

const noop = () => {};
const GRID = 20;
/** Below these zoom levels the canvas switches to a simpler, more readable drawing. */
const FAR = 0.6, MID = 0.85;

/**
 * The isometric world on an infinite, pannable, zoomable stage.
 * World layers, back to front: groups, edges, flow, labels, nodes, notes.
 */
export const Canvas = memo(function Canvas({ view, handlers: h, camera: c, onNoteText = noop, dragging, readOnly, children }: Props) {
  const { x, y, z } = c.cam;
  const g = GRID * z;
  // level of detail: far = names + problems only, mid = no connection labels
  const lod = z < FAR ? 'lod-far' : z < MID ? 'lod-mid' : null;
  // counter-scale factors so key text keeps a readable size on screen when zoomed out
  const inv = Math.min(1 / z, 4), lw = Math.min(1 / z, 2.5);
  return (
    <section
      ref={c.setStage}
      className={cx('stage', lod, c.spaceHeld && 'grab', c.panning && 'panning')}
      aria-label="Canvas"
      style={{ backgroundSize: `${g}px ${g}px`, backgroundPosition: `${x - g / 2}px ${y - g / 2}px`, '--inv': inv, '--lw': lw } as React.CSSProperties}
      onPointerDownCapture={c.onPointerDownCapture}
      onPointerMoveCapture={c.onPointerMoveCapture}
      onPointerUpCapture={c.onPointerUpCapture}
      onPointerCancelCapture={c.onPointerUpCapture}
      onPointerDown={h.onWorldPointerDown}
      onPointerMove={h.onWorldPointerMove}
      onPointerUp={h.onWorldPointerUp}
      onDoubleClick={h.onWorldDoubleClick}
      onDragOver={h.onDragOver}
      onDrop={h.onDrop}
    >
      <div
        className={cx('world', dragging && 'dragging', readOnly && 'readonly')}
        style={{ transform: `translate(${x}px, ${y}px) scale(${z})` }}
      >
        {view.groups.map((gr) => <GroupBox key={gr.id} v={gr} onMove={h.onGroupPointerDown ?? noop} onResize={h.onGroupResizeDown ?? noop} onToggle={h.onGroupToggle} />)}
        <EdgeLayer edges={view.edges} replication={view.replication} />
        <FlowLayer segments={view.flow} />
        <EdgeLabels edges={view.edges} onPick={h.onEdgePick ?? noop} />
        {view.nodes.map((n) => <NodeView key={n.id} v={n} onPointerDown={h.onNodePointerDown ?? noop} />)}
        {view.notes.map((t) => <StickyNote key={t.id} v={t} onMove={h.onNotePointerDown ?? noop} onFocus={h.onNoteFocus ?? noop} onText={onNoteText} />)}
        {h.onEdgeHandleDown && <EdgeHandles edges={view.edges} onDown={h.onEdgeHandleDown} />}
        <RewireGhost v={view.rewire} />
        {view.marquee && <div className="marquee" style={{ left: view.marquee.x, top: view.marquee.y, width: view.marquee.w, height: view.marquee.h }} />}
      </div>
      <div className="hud">
        {children}
        <ZoomControls zoom={z} onIn={c.zoomIn} onOut={c.zoomOut} onReset={c.resetZoom} onFit={c.fit} />
      </div>
    </section>
  );
});

interface ZoomProps { zoom: number; onIn: () => void; onOut: () => void; onReset: () => void; onFit: () => void }

const ZoomControls = memo(function ZoomControls({ zoom, onIn, onOut, onReset, onFit }: ZoomProps) {
  return (
    <div className="zoombar" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" onClick={onOut} title="Zoom out (Ctrl -)" aria-label="Zoom out">−</button>
      <button type="button" className="zpct" onClick={onReset} title="Reset to 100% (Shift 0)">{Math.round(zoom * 100)}%</button>
      <button type="button" onClick={onIn} title="Zoom in (Ctrl +)" aria-label="Zoom in">+</button>
      <span className="zsep" />
      <button type="button" className="zfit" onClick={onFit} title="Fit to screen (Shift 1)">Fit</button>
    </div>
  );
});
