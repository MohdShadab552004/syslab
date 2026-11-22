import { memo } from 'react';
import { cx } from '@/lib/utils/cx';
import type { EdgeView, FlowSegmentView, ReplicationLineView, RewireView } from '@/lib/canvas/buildCanvasView';
import type { EdgeEnd } from '@/hooks/editor/editor.store';
import { Line } from './Line';

const edgeClass = (e: EdgeView) => cx(e.async && 'async', e.selected && 'sel', e.dim && 'dim', e.hl && 'hl', e.read && 'read', e.tone !== 'ok' && e.tone);

interface LayerProps {
  edges: EdgeView[];
  replication: ReplicationLineView[];
  /** pointer over / off a routed line */
  onHover?: (id: string | null) => void;
  onPick?: (e: React.PointerEvent, id: string) => void;
}

export const EdgeLayer = memo(function EdgeLayer({ edges, replication, onHover, onPick }: LayerProps) {
  const paths = edges.flatMap((e) => e.lines.filter((l) => l.path).map((l) => ({ e, l })));
  return (
    <>
      {edges.map((e) => e.lines.filter((l) => !l.path).map((l) => <Line key={l.key} v={l} className={edgeClass(e)} weight={e.weight} />))}
      {paths.length > 0 && (
        <svg className="opaths" aria-hidden="true">
          {paths.map(({ e, l }) => (
            <g key={l.key} className={cx('opath', edgeClass(e))} style={{ '--ew': e.weight } as React.CSSProperties}>
              <path d={l.path!.d} />
              <polygon points="0,-5.5 11,0 0,5.5" transform={`translate(${l.path!.arrow.x} ${l.path!.arrow.y}) rotate(${l.path!.arrow.ang}) translate(-11 0)`} />
              {(onHover || onPick) && (
                <path className="hit" d={l.path!.d}
                  onPointerEnter={onHover ? () => onHover(e.id) : undefined}
                  onPointerLeave={onHover ? () => onHover(null) : undefined}
                  onPointerDown={onPick ? (ev) => onPick(ev, e.id) : undefined} />
              )}
            </g>
          ))}
        </svg>
      )}
      {paths.map(({ e, l }) => l.packets.map((p) => (
        <span key={p.key} className={cx('ppkt', p.fail && 'fail', p.tone != null && `t${p.tone}`, e.dim && 'dim')}
          style={{ offsetPath: `path('${l.path!.d}')`, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` } as React.CSSProperties} />
      )))}
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
      {edges.filter((e) => e.tip).map((e) => (
        <span key={`tip-${e.id}`} className={cx('etip', e.tone !== 'ok' && e.tone)} style={{ left: e.labelX, top: e.labelY }} role="tooltip">{e.tip}</span>
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

/** Algorithm tags on load balancer lines (share, weight, open connections). */
export const LineTags = memo(function LineTags({ edges }: { edges: EdgeView[] }) {
  return (
    <>
      {edges.flatMap((e) => e.lines.filter((l) => l.tag).map((l) => (
        <span key={`tag-${l.key}`} className={cx('etag', l.tag!.hot && 'hot', e.dim && 'dim')} style={{ left: l.tag!.x, top: l.tag!.y }}>{l.tag!.text}</span>
      )))}
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
