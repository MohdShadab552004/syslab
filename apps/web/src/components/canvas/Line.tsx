import { memo } from 'react';
import { cx } from '@/lib/utils/cx';
import type { LineView } from '@/lib/canvas/buildCanvasView';

/** A straight connector with an arrowhead and travelling packets. */
export const Line = memo(function Line({ v, className, packetClass }: { v: LineView; className?: string; packetClass?: string }) {
  return (
    <div className={cx('edge', v.retract && 'retract', className)} style={{ left: v.x, top: v.y, width: v.len, transform: `rotate(${v.ang}deg)` }}>
      <span className="arrow" style={{ left: v.arrowX }} />
      {v.packets.map((p) => (
        <span key={p.key} className={cx('pkt', p.fail && 'fail', packetClass)} style={{ animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }} />
      ))}
    </div>
  );
});
