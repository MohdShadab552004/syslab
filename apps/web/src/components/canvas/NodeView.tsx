import { memo } from 'react';
import { cx } from '@/lib/utils/cx';
import { IsoShape } from '@/components/iso/IsoShape';
import type { InstanceView, NodeView as NodeVM } from '@/lib/canvas/buildCanvasView';
import { BelowPill, LoadPill, WarnPill } from './Pills';

const pillOffset = (scale: number, h: number) => Math.round(((scale - 1) * h) / 2) + 8;

const Instance = memo(function Instance({ v }: { v: InstanceView }) {
  const off = pillOffset(v.scale, v.h);
  return (
    <div className={cx('rep', v.draining && 'drain')} style={{ left: v.dx, top: v.dy, width: v.w, height: v.h }}>
      <div className="lift">
        <div className="shadow" />
        <div className="body" style={{ transform: `scale(${v.scale})` }}>
          <IsoShape shape={v.shape} colors={v.colors} icon={v.icon} label={v.label} bands={v.bands} />
        </div>
        <LoadPill load={v.load} offset={off} />
        {v.below && <BelowPill text={v.below.text} info={v.below.info} offset={off} />}
        <div className="ring" />
      </div>
    </div>
  );
});

interface Props { v: NodeVM; onPointerDown: (e: React.PointerEvent, id: string) => void }

/** One node on the canvas, plus its extra instances (replicas, shards). */
export const NodeView = memo(function NodeView({ v, onPointerDown }: Props) {
  const off = pillOffset(v.scale, v.h);
  return (
    <div
      data-node={v.id}
      className={cx('node', v.selected && 'sel', v.pending && 'pend', v.hot && 'hot', v.dim && 'dim', v.crosshair && 'crosshair', v.drop && `drop-${v.drop}`)}
      style={{ left: v.left, top: v.top, width: v.w, height: v.h }}
      onPointerDown={(e) => onPointerDown(e, v.id)}
    >
      <div className="lift">
        <div className="shadow" />
        {v.ghostStack > 1 && <div className="body ghost" style={{ transform: 'translate(18px,-14px)', opacity: 0.45 }}><IsoShape shape={v.shape} colors={v.colors} /></div>}
        {v.ghostStack > 0 && <div className="body ghost" style={{ transform: 'translate(9px,-7px)', opacity: 0.75 }}><IsoShape shape={v.shape} colors={v.colors} /></div>}
        <div className="body" style={{ transform: `scale(${v.scale})` }}>
          <IsoShape shape={v.shape} colors={v.colors} icon={v.icon} label={v.label} dashed={v.dashed} bands={v.bands} people={v.people} queue={v.queue} />
        </div>
        {v.load && <LoadPill load={v.load} offset={off} />}
        {v.below && <BelowPill text={v.below.text} info={v.below.info} offset={off} users={v.kind === 'users'} />}
        {v.warn && <WarnPill text={v.warn} />}
        {v.badge && <div className="fbadge">{v.badge}</div>}
        <div className="ring" />
      </div>
      {v.extras.map((x) => <Instance key={x.key} v={x} />)}
      <div className="nname" aria-hidden="true">{v.name}</div>
    </div>
  );
});
