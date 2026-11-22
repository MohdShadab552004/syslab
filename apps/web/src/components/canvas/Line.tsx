import { memo } from 'react';
import { cx } from '@/lib/utils/cx';
import type { LineView } from '@/lib/canvas/buildCanvasView';

/** A straight connector with an arrowhead and travelling packets. */
export const Line = memo(function Line({ v, className, packetClass, weight = 1 }: { v: LineView; className?: string; packetClass?: string; weight?: number }) {
  return (
    <div className={cx('edge', v.retract && 'retract', className)} style={{ left: v.x, top: v.y, width: v.len, transform: `rotate(${v.ang}deg)`, '--ew': weight } as React.CSSProperties}>
      <span className="arrow" style={{ left: v.arrowX }} />
      {v.packets.map((p) => (
        <span key={p.key} className={cx('pkt', p.fail && 'fail', p.tone != null && `t${p.tone}`, packetClass)} style={{ animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }} />
      ))}
    </div>
  );
});
