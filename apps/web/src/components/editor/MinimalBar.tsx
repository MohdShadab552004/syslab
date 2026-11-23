import Link from 'next/link';
import { memo, type ReactNode } from 'react';
import { Button, Icon, ICON } from '@/components/ui';

interface Props {
  name: string;
  status: string;
  running: boolean;
  onToggleRun: () => void;
  onShare: () => void;
  onRestore: () => void;
  /** the metrics cards, placed under the name pill */
  metrics: ReactNode;
  /** the canvas toolbar, placed before the run controls */
  toolbar: ReactNode;
}

/** The canvas captures every press for panning / box-select; buttons on top of it must opt out. */
const stop = (e: React.PointerEvent) => e.stopPropagation();

/**
 * Top row while the UI is minimized: name pill (metrics under it) on the left, toolbar and run
 * controls on the right. When the canvas is too narrow the toolbar turns to icons, then toolbar +
 * run controls wrap to a second line together, right-aligned.
 */
export const MinimalBar = memo(function MinimalBar(p: Props) {
  return (
    <div className="minirow">
      <div className="ministart">
        <div className="minibar left" onPointerDown={stop}>
          <Link href="/designs" className="minibtn" aria-label="My designs" title="My designs"><Icon path={ICON.chevronLeft} size={14} stroke={2.4} /></Link>
          <span className="mininame" title={p.name}>{p.name}</span>
          <button type="button" className="minibtn" onClick={p.onRestore} aria-label="Show panels" title="Show panels (Ctrl+Shift+\)">
            <Icon path={ICON.panels} size={15} stroke={2} />
          </button>
        </div>
        {p.metrics}
      </div>
      <div className="miniend">
        {p.toolbar}
        <div className="minibar right" onPointerDown={stop}>
          <span className="status" title={p.status}><span className={p.running ? 'live' : 'idle'} /><span className="stext">{p.status}</span></span>
          <Button size="sm" icon={ICON.share} onClick={p.onShare}>Share</Button>
          <Button size="sm" variant="primary" iconFill icon={p.running ? ICON.pause : ICON.play} onClick={p.onToggleRun}>{p.running ? 'Pause' : 'Run'}</Button>
        </div>
      </div>
    </div>
  );
});
