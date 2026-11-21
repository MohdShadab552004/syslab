'use client';

import { useMemo } from 'react';
import type { DesignFlow, DesignNode } from '@syslab/types';
import { useEditorStore } from './editor.store';

// Stable empty arrays: a selector must not return a fresh [] or React loops forever.
const NO_FLOWS: DesignFlow[] = [];
const NO_NODES: DesignNode[] = [];

/** Flows tab: list of recorded request paths with play / re-record / delete. */
export function useFlowsPanel() {
  const flows = useEditorStore((s) => s.doc?.flows ?? NO_FLOWS);
  const nodes = useEditorStore((s) => s.doc?.nodes ?? NO_NODES);
  const fp = useEditorStore((s) => s.ui.flowPlay);
  const recording = useEditorStore((s) => s.ui.recording);
  const a = useEditorStore((s) => s.actions);

  return useMemo(() => {
    const label = new Map(nodes.map((n) => [n.id, n.label]));
    return {
      onNew: a.newFlow,
      items: flows.map((f) => ({
        id: f.id,
        name: f.name,
        steps: f.steps.length ? f.steps.map((id) => label.get(id) ?? '?').join(' → ') : 'No steps yet',
        active: fp?.id === f.id || recording === f.id,
        recording: recording === f.id,
        onRename: (v: string) => a.renameFlow(f.id, v),
        onPlay: () => a.playFlow(f.id),
        onRerecord: () => a.rerecordFlow(f.id),
        onDelete: () => a.deleteFlow(f.id),
      })),
    };
  }, [flows, nodes, fp, recording, a]);
}
