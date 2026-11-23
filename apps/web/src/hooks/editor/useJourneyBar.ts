'use client';

import type { JourneyBarProps } from '@/components/canvas/Overlays';
import type { JourneyView } from '@/lib/canvas/buildCanvasView';
import { useEditorStore } from './editor.store';

/** Props for the journey playback bar of the selected component, or null when nothing is selected. */
export function useJourneyBar(j: JourneyView | null): JourneyBarProps | null {
  const a = useEditorStore((s) => s.actions);
  if (!j) return null;
  const at = (idx: number, playing: boolean) => a.setJourneyPlay({ focus: j.focus, idx: Math.max(0, Math.min(j.steps - 1, idx)), playing, at: Date.now() });
  return {
    label: j.label, steps: j.steps, idx: j.idx, playing: j.playing, caption: j.caption,
    onPlay: () => a.playJourney(j.focus),
    onPause: () => at(j.idx ?? 0, false),
    // ‹ / › move one step and pause; 0 resumes from the current step
    onStep: (d) => at((j.idx ?? 0) + d, d === 0),
    onClose: () => a.setJourneyPlay(null),
    onDismiss: () => a.clearSelection(),
  };
}
