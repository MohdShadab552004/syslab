import { memo } from 'react';
import { cx } from '@/lib/utils/cx';
import { Icon, ICON } from '@/components/ui';
import type { GroupView } from '@/lib/canvas/buildCanvasView';

interface Props {
  v: GroupView;
  onMove: (e: React.PointerEvent, id: string) => void;
  onResize: (e: React.PointerEvent, id: string) => void;
  /** omitted on read-only canvases */
  onToggle?: (e: React.SyntheticEvent, id: string) => void;
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
    <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const GroupBox = memo(function GroupBox({ v, onMove, onResize, onToggle }: Props) {
  const toggle = onToggle && (
    <button type="button" className="gtoggle" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => onToggle(e, v.id)}
      aria-label={v.collapsed ? `Expand ${v.label}` : `Collapse ${v.label}`} aria-expanded={!v.collapsed}
      title={v.collapsed ? 'Expand group' : 'Collapse group into a card'}>
      <Chevron open={!v.collapsed} />
    </button>
  );

  if (v.collapsed && v.summary) {
    return (
      <div data-group={v.id} className={cx('group collapsed', v.selected && 'sel', v.summary.bad && 'bad')}
        style={{ left: v.x, top: v.y, width: v.w, height: v.h, borderColor: v.summary.bad ? undefined : v.border }}
        onPointerDown={(e) => onMove(e, v.id)}>
        <div className="gcard-head">
          {toggle}
          <Icon path={ICON.group} size={12} stroke={2.6} />
          <span className="gcard-title">{v.label}</span>
        </div>
        <div className="gcard-parts">{v.summary.parts}</div>
        <div className={cx('gcard-status', v.summary.bad && 'bad')}><i />{v.summary.status}</div>
        {v.summary.traffic && <div className="gcard-traffic">{v.summary.traffic}</div>}
        {/* zoomed far out the card body is too small to read, so its name and status float below it */}
        <div className={cx('gcard-far', v.summary.bad && 'bad')} aria-hidden="true">
          <b>{v.label}</b>
          <span><i />{v.summary.status}</span>
        </div>
      </div>
    );
  }

  return (
    <div data-group={v.id} className={cx('group', v.selected && 'sel')} style={{ left: v.x, top: v.y, width: v.w, height: v.h, borderColor: v.border, background: v.bg }}>
      <div className="ghead" onPointerDown={(e) => onMove(e, v.id)}>
        {toggle}
        <Icon path={ICON.group} size={11} stroke={2.6} />
        {v.label}
      </div>
      <div className="gresize" onPointerDown={(e) => onResize(e, v.id)} role="presentation" />
    </div>
  );
});
