'use client';

import { useMemo } from 'react';
import { buildCanvasView, type CanvasView } from '@/lib/canvas/buildCanvasView';
import { useEditorStore } from './editor.store';
import { useSimulation } from './useSimulation';

/** Canvas view model; recomputed only when doc, runtime or relevant UI state changes. */
export function useCanvasView(): CanvasView | null {
  const doc = useEditorStore((s) => s.doc);
  const sim = useSimulation();
  const sel = useEditorStore((s) => s.ui.sel);
  const pending = useEditorStore((s) => s.ui.pending);
  const tool = useEditorStore((s) => s.ui.tool);
  const recording = useEditorStore((s) => s.ui.recording);
  const flowPlay = useEditorStore((s) => s.ui.flowPlay);
  const running = useEditorStore((s) => s.ui.running);
  const drain = useEditorStore((s) => s.runtime.drain);
  const rewire = useEditorStore((s) => s.ui.rewire);
  const multi = useEditorStore((s) => s.ui.multi);
  const marquee = useEditorStore((s) => s.ui.marquee);
  const hover = useEditorStore((s) => s.ui.hover);
  const view = useEditorStore((s) => s.ui.view);

  return useMemo(() => {
    if (!doc || !sim) return null;
    return buildCanvasView(doc, sim, { sel, pending, tool, recording, flowPlay, running, drain, isLesson: !!doc.lesson, rewire, multi, marquee, hover, view });
  }, [doc, sim, sel, pending, tool, recording, flowPlay, running, drain, rewire, multi, marquee, hover, view]);
}
