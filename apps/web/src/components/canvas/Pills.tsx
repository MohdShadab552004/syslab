import { memo } from 'react';
import { cx } from '@/lib/utils/cx';
import { Icon, ICON, LoadBar } from '@/components/ui';
import type { LoadPillView } from '@/lib/canvas/buildCanvasView';

export const LoadPill = memo(function LoadPill({ load, offset }: { load: LoadPillView; offset: number }) {
  return (
    <div className={cx('pill above', load.hot && 'hot')} style={{ bottom: `calc(100% + ${offset}px)` }}>
      <span className="cdot" />
      <LoadBar width={load.width} color={load.color} />
      <span>{load.pct}</span>
    </div>
  );
});

export const BelowPill = memo(function BelowPill({ text, info, offset, users }: { text: string; info?: boolean; offset: number; users?: boolean }) {
  return (
    <div className={cx('pill below', info && 'info')} style={{ top: `calc(100% + ${offset}px)` }}>
      {users && <Icon path={ICON.users} size={12} stroke={2.4} />}
      {text}
    </div>
  );
});

export const WarnPill = memo(function WarnPill({ text }: { text: string }) {
  return (
    <div className="warn">
      <Icon path={ICON.warn} size={12} stroke={2.6} color="#b4232b" />
      {text}
    </div>
  );
});
