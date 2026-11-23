import { memo } from 'react';
import { cx } from '@/lib/utils/cx';
import type { ArrowHead } from '@syslab/types';
import type { LineView } from '@/lib/canvas/buildCanvasView';
import { ArrowShape } from './ArrowShape';

/**
 * A straight connector with travelling packets. Without `head` (replication lines) it keeps the
 * classic CSS arrowhead; connections draw their chosen ends as small SVG shapes.
 */
export const Line = memo(function Line({ v, className, packetClass, weight = 1, head, tail = 'none' }: { v: LineView; className?: string; packetClass?: string; weight?: number; head?: ArrowHead; tail?: ArrowHead }) {
  return (
    <div className={cx('edge', v.retract && 'retract', className)} style={{ left: v.x, top: v.y, width: v.len, transform: `rotate(${v.ang}deg)`, '--ew': weight } as React.CSSProperties}>
      {head == null ? <span className="arrow" style={{ left: v.arrowX }} /> : head !== 'none' && (
        <svg className="eshape" style={{ left: v.arrowX + 11 }} aria-hidden="true"><ArrowShape kind={head} /></svg>
      )}
      {tail !== 'none' && <svg className="eshape" style={{ left: v.tailX }} aria-hidden="true"><g transform="rotate(180)"><ArrowShape kind={tail} /></g></svg>}
      {v.packets.map((p) => (
        <span key={p.key} className={cx('pkt', p.fail && 'fail', p.tone != null && `t${p.tone}`, packetClass)} style={{ animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }} />
      ))}
    </div>
  );
});
