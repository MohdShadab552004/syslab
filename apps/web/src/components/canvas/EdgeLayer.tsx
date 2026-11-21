import { memo } from 'react';
import { cx } from '@/lib/utils/cx';
import type { EdgeView, FlowSegmentView, ReplicationLineView, RewireView } from '@/lib/canvas/buildCanvasView';
import type { EdgeEnd } from '@/hooks/editor/editor.store';
import { Line } from './Line';

export const EdgeLayer = memo(function EdgeLayer({ edges, replication }: { edges: EdgeView[]; replication: ReplicationLineView[] }) {
  return (
    <>
      {edges.map((e) => e.lines.map((l) => <Line key={l.key} v={l} className={cx(e.async && 'async', e.selected && 'sel', e.dim && 'dim')} />))}
      {replication.map((l) => <Line key={l.key} v={l} className="repl" packetClass="repl" />)}
    </>
  );
});

export const EdgeLabels = memo(function EdgeLabels({ edges, onPick }: { edges: EdgeView[]; onPick: (e: React.PointerEvent, id: string) => void }) {
  return (
    <>
      {edges.filter((e) => e.showLabel).map((e) => (
        <button key={e.id} type="button" className={cx('elabel', e.selected && 'sel', e.dim && 'dim')} style={{ left: e.labelX, top: e.labelY }} onPointerDown={(ev) => onPick(ev, e.id)}>
          {e.label}
        </button>
      ))}
    </>
  );
});

/** Round grips at both ends of the selected connection: drag one onto another node to reconnect. */
export const EdgeHandles = memo(function EdgeHandles({ edges, onDown }: { edges: EdgeView[]; onDown: (e: React.PointerEvent<HTMLElement>, id: string, end: EdgeEnd) => void }) {
  return (
    <>
      {edges.filter((e) => e.handles).map((e) => (['from', 'to'] as const).map((end) => {
        const p = e.handles![end];
        return (
          <span key={`${e.id}-${end}`} className={cx('ehandle', end)} style={{ left: p.x, top: p.y }}
            title={end === 'from' ? 'Drag to change where this connection starts' : 'Drag to change where this connection goes'}
            onPointerDown={(ev) => onDown(ev, e.id, end)} />
        );
      }))}
    </>
  );
});

/** Live preview while an end is being dragged. */
export const RewireGhost = memo(function RewireGhost({ v }: { v: RewireView | null }) {
  if (!v) return null;
  return (
    <>
      <div className={cx('rwline', !v.valid && 'bad')} style={{ left: v.x, top: v.y, width: v.len, transform: `rotate(${v.ang}deg)` }} />
      <span className={cx('rwdot', !v.valid && 'bad')} style={{ left: v.dotX, top: v.dotY }} />
    </>
  );
});

export const FlowLayer = memo(function FlowLayer({ segments }: { segments: FlowSegmentView[] }) {
  return (
    <>
      {segments.map((s) => (
        <div key={s.key} className={cx('fseg', s.state)} style={{ left: s.x, top: s.y, width: s.len, transform: `rotate(${s.ang}deg)` }}>
          {s.token && <span className="tok" />}
        </div>
      ))}
    </>
  );
});
