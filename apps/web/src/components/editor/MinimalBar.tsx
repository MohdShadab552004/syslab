import Link from 'next/link';
import { memo } from 'react';
import { Button, Icon, ICON } from '@/components/ui';

interface Props {
  name: string;
  status: string;
  running: boolean;
  onToggleRun: () => void;
  onShare: () => void;
  onRestore: () => void;
}

/** Floating pills shown instead of the header and side panels while the UI is minimized. */
export const MinimalBar = memo(function MinimalBar(p: Props) {
  return (
    <>
      <div className="minibar left">
        <Link href="/designs" className="minibtn" aria-label="My designs" title="My designs"><Icon path={ICON.chevronLeft} size={14} stroke={2.4} /></Link>
        <span className="mininame" title={p.name}>{p.name}</span>
        <button type="button" className="minibtn" onClick={p.onRestore} aria-label="Show panels" title="Show panels (Ctrl+Shift+\)">
          <Icon path={ICON.panels} size={15} stroke={2} />
        </button>
      </div>
      <div className="minibar right">
        <span className="status"><span className={p.running ? 'live' : 'idle'} />{p.status}</span>
        <Button icon={ICON.share} onClick={p.onShare}>Share</Button>
        <Button variant="primary" iconFill icon={p.running ? ICON.pause : ICON.play} onClick={p.onToggleRun}>{p.running ? 'Pause' : 'Run'}</Button>
      </div>
    </>
  );
});
