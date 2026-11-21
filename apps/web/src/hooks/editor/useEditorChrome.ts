'use client';

import { useEditorStore } from './editor.store';
import type { SaveState } from '@/types/editor';

const SAVE_TEXT: Record<SaveState, string> = {
  idle: 'All changes saved', saved: 'All changes saved', dirty: 'Unsaved changes', saving: 'Saving…',
  error: 'Save failed, retrying on next edit', conflict: 'Changed elsewhere, reload',
};

const SPIKES = [1, 2, 10, 50, 100];

/** Header, toolbar and toast state. */
export function useEditorChrome() {
  const name = useEditorStore((s) => s.name);
  const saveState = useEditorStore((s) => s.saveState);
  const running = useEditorStore((s) => s.ui.running);
  const spike = useEditorStore((s) => s.runtime.spike);
  const tool = useEditorStore((s) => s.ui.tool);
  const pending = useEditorStore((s) => s.ui.pending);
  const recording = useEditorStore((s) => s.ui.recording);
  const toast = useEditorStore((s) => s.ui.toast);
  const events = useEditorStore((s) => s.events);
  const tab = useEditorStore((s) => s.ui.tab);
  const flowCount = useEditorStore((s) => s.doc?.flows.length ?? 0);
  const doc = useEditorStore((s) => s.doc);
  const a = useEditorStore((s) => s.actions);

  const recFlow = recording ? doc?.flows.find((f) => f.id === recording) : undefined;
  const pendingLabel = pending ? doc?.nodes.find((n) => n.id === pending)?.label : undefined;

  return {
    header: {
      name, onRename: a.rename,
      saveText: SAVE_TEXT[saveState], saveBad: saveState === 'error' || saveState === 'conflict',
      running, onToggleRun: a.toggleRunning,
      status: running ? (spike > 1 ? `Simulating · spike ×${spike}` : 'Simulating') : 'Paused',
    },
    toolbar: {
      tool, onTool: a.setTool,
      onAddGroup: a.addGroup, onAddNote: a.addNote, onClear: a.clearCanvas,
      spikes: SPIKES.map((v) => ({ key: String(v), label: v === 1 ? 'Off' : `${v}×`, active: spike === v, onSelect: () => a.setSpike(v) })),
    },
    connectHint: tool === 'connect' && !recording ? (pending ? `Now click the target for ${pendingLabel ?? 'this node'}` : 'Click a source component') : null,
    recording: recFlow ? { name: recFlow.name, count: recFlow.steps.length, onUndo: a.undoStep, onDone: a.finishRecording } : null,
    toast: toast?.text ?? null,
    events: events.map((e) => ({ key: e.id, text: e.text, up: e.up })),
    tabs: [
      { key: 'inspect', label: 'Inspect', active: tab === 'inspect', onSelect: () => a.setTab('inspect') },
      { key: 'flows', label: `Flows · ${flowCount}`, active: tab === 'flows', onSelect: () => a.setTab('flows') },
      { key: 'versions', label: 'Versions', active: tab === 'versions', onSelect: () => a.setTab('versions') },
    ],
    tab,
  };
}
