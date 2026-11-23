import Link from 'next/link';
import { memo } from 'react';
import { cx } from '@/lib/utils/cx';
import { Button, Icon, ICON } from '@/components/ui';

interface Props {
  name: string;
  onRename: (v: string) => void;
  saveText: string;
  saveBad: boolean;
  status: string;
  running: boolean;
  onToggleRun: () => void;
  onSaveVersion: () => void;
  onShare: () => void;
  onHelp: () => void;
  onMinimize: () => void;
}

export const EditorHeader = memo(function EditorHeader(p: Props) {
  return (
    <header className="top">
      <div className="left-top">
        <Link href="/designs" className="btn btn-sm"><Icon path={ICON.chevronLeft} size={13} stroke={2.4} />My designs</Link>
        <input className="nameinput" type="text" value={p.name} onChange={(e) => p.onRename(e.target.value)} aria-label="Design name" />
        <button type="button" className="minibtn minimize" onClick={p.onMinimize} aria-label="Minimize UI" title="Minimize UI (Ctrl+Shift+\)">
          <Icon path={ICON.panels} size={15} stroke={2} />
        </button>
        <span className={cx('saved', p.saveBad && 'bad')}><Icon path={ICON.check} size={12} stroke={2.6} />{p.saveText}</span>
      </div>
      <div className="right-top">
        <span className="status"><span className={p.running ? 'live' : 'idle'} />{p.status}</span>
        <Button className="helpbtn" onClick={p.onHelp} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">?</Button>
        <Button icon={ICON.history} onClick={p.onSaveVersion}>Save version</Button>
        <Button icon={ICON.share} onClick={p.onShare}>Share</Button>
        <Button variant="primary" iconFill icon={p.running ? ICON.pause : ICON.play} onClick={p.onToggleRun}>{p.running ? 'Pause' : 'Run simulation'}</Button>
      </div>
    </header>
  );
});
