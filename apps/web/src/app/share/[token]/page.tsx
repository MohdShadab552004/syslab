'use client';

import { useParams } from 'next/navigation';
import { useSharedViewer } from '@/hooks/data/useSharedViewer';
import { Canvas } from '@/components/canvas/Canvas';
import { useCamera } from '@/hooks/editor/useCamera';
import { TitleBlock } from '@/components/canvas/Overlays';
import { Brand } from '@/components/editor/Brand';
import { Button, ICON } from '@/components/ui';

/** Public read-only view of a shared design. */
export default function SharedPage() {
  const { token } = useParams<{ token: string }>();
  const v = useSharedViewer(token);
  const camera = useCamera();

  if (v.error) return <div className="empty static center">This link is not available.</div>;
  if (!v.view) return <div className="empty static center">Loading…</div>;

  return (
    <div className="app">
      <header className="top">
        <div className="left-top"><Brand /><span className="saved">Shared design · read only</span></div>
        <div className="right-top">
          <Button variant="primary" iconFill icon={v.running ? ICON.pause : ICON.play} onClick={v.onToggleRun}>{v.running ? 'Pause' : 'Run simulation'}</Button>
        </div>
      </header>
      <div className="main">
        <Canvas view={v.view} handlers={{}} camera={camera} readOnly>
          <TitleBlock title={v.name} sub={v.goal} />
        </Canvas>
      </div>
    </div>
  );
}
