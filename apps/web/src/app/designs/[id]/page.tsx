'use client';

import { useParams } from 'next/navigation';
import { useEditorStore } from '@/hooks/editor/editor.store';
import { useEditorBootstrap } from '@/hooks/editor/useEditorBootstrap';
import { useAutosave } from '@/hooks/editor/useAutosave';
import { useEngineTicker } from '@/hooks/editor/useEngineTicker';
import { useCanvasView } from '@/hooks/editor/useCanvasView';
import { useCanvasInteractions } from '@/hooks/editor/useCanvasInteractions';
import { useCamera } from '@/hooks/editor/useCamera';
import { useEditorShortcuts } from '@/hooks/editor/useEditorShortcuts';
import { useEditorChrome } from '@/hooks/editor/useEditorChrome';
import { useMetrics } from '@/hooks/editor/useMetrics';
import { usePalette } from '@/hooks/editor/usePalette';
import { useInspector } from '@/hooks/editor/useInspector';
import { useFlowsPanel } from '@/hooks/editor/useFlowsPanel';
import { useFlowPlayer } from '@/hooks/editor/useFlowPlayer';
import { useLesson } from '@/hooks/editor/useLesson';
import { useVersions } from '@/hooks/data/useVersions';
import { useShare } from '@/hooks/data/useShare';
import { Tabs, Toast } from '@/components/ui';
import { Canvas } from '@/components/canvas/Canvas';
import { CanvasToolbar, ConnectHint, EmptyCanvas, EventsFeed, MetricsBar, RecordBar } from '@/components/canvas/Overlays';
import { Palette } from '@/components/palette/Palette';
import { NodeInspector } from '@/components/inspector/NodeInspector';
import { EdgeInspector } from '@/components/inspector/EdgeInspector';
import { GroupInspector, HowToCard, MultiInspector, NoteInspector, RequirementsCard, SummaryCard, TrafficCard } from '@/components/inspector/SimpleInspectors';
import { FlowsPanel } from '@/components/inspector/FlowsPanel';
import { VersionsPanel } from '@/components/inspector/VersionsPanel';
import { EditorHeader } from '@/components/editor/EditorHeader';
import { FlowPlayerBar, LessonTimeline } from '@/components/editor/BottomBars';
import { ShareModal } from '@/components/editor/ShareModal';
import { ShortcutsModal } from '@/components/editor/ShortcutsModal';

/** Design Lab editor. Hooks own all logic; this file only wires them to components. */
export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const boot = useEditorBootstrap(id);
  useAutosave();
  useEngineTicker();

  const view = useCanvasView();
  const handlers = useCanvasInteractions();
  const camera = useCamera();
  const shortcuts = useEditorShortcuts();
  const chrome = useEditorChrome();
  const metrics = useMetrics();
  const palette = usePalette();
  const inspector = useInspector();
  const flows = useFlowsPanel();
  const player = useFlowPlayer();
  const lesson = useLesson();
  const versions = useVersions(id, chrome.tab === 'versions');
  const share = useShare();
  const dragging = useEditorStore((s) => s.ui.dragging);
  const updateNote = useEditorStore((s) => s.actions.updateNote);

  if (boot.error) return <div className="empty static center">Could not load this design: {boot.error.message}</div>;
  if (!boot.ready || !view || !metrics || !inspector || !player) return <div className="empty static center">Loading design…</div>;

  return (
    <div className="app">
      <EditorHeader {...chrome.header} onSaveVersion={versions.onSave} onShare={share.onOpen} onHelp={shortcuts.openHelp} />

      <div className="main">
        <Palette query={palette.query} onQuery={palette.setQuery} groups={palette.groups} onDragStart={handlers.onPaletteDragStart} onClick={handlers.onPaletteClick} />

        <Canvas view={view} handlers={handlers} camera={camera} dragging={dragging} onNoteText={(nid, text) => updateNote(nid, { text })}>
          <MetricsBar metrics={metrics.metrics} />
          <CanvasToolbar {...chrome.toolbar} />
          {chrome.connectHint && <ConnectHint text={chrome.connectHint} />}
          {chrome.recording && <RecordBar {...chrome.recording} />}
          {!view.nodes.length && <EmptyCanvas />}
          <EventsFeed events={chrome.events} />
        </Canvas>

        <aside className="inspector" aria-label="Inspector">
          <Tabs items={chrome.tabs} />
          {chrome.tab === 'inspect' && (
            <>
              {inspector.kind === 'node' && <NodeInspector v={inspector.node} />}
              {inspector.kind === 'edge' && <EdgeInspector v={inspector.edge} />}
              {inspector.kind === 'group' && <GroupInspector v={inspector.group} />}
              {inspector.kind === 'note' && <NoteInspector onDelete={inspector.onDelete} />}
              {inspector.kind === 'multi' && <MultiInspector v={inspector.multi} />}
              {inspector.kind === 'none' && (
                <>
                  {inspector.lesson ? <TrafficCard t={inspector.traffic} s={metrics} /> : <RequirementsCard r={inspector.requirements} s={metrics} />}
                  {!inspector.lesson && <TrafficCard t={inspector.traffic} s={metrics} />}
                  <HowToCard />
                  <SummaryCard s={metrics} />
                </>
              )}
            </>
          )}
          {chrome.tab === 'flows' && <FlowsPanel items={flows.items} onNew={flows.onNew} />}
          {chrome.tab === 'versions' && <VersionsPanel items={versions.items} saveText={chrome.header.saveText} canSave={versions.canSave} onSave={versions.onSave} />}
        </aside>
      </div>

      {lesson ? <LessonTimeline {...lesson} /> : <FlowPlayerBar {...player} />}
      <ShareModal {...share} />
      <ShortcutsModal open={shortcuts.helpOpen} onClose={shortcuts.closeHelp} />
      <Toast text={chrome.toast} />
    </div>
  );
}
