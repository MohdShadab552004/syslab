'use client';

import { useMemo } from 'react';
import { useEditorStore } from './editor.store';

export interface FlowChipView { id: string; name: string; active: boolean; onSelect: () => void }

/** Bottom bar for playing back recorded request flows. */
export function useFlowPlayer() {
  const flows = useEditorStore((s) => s.doc?.flows ?? null);
  const nodes = useEditorStore((s) => s.doc?.nodes ?? null);
  const edges = useEditorStore((s) => s.doc?.edges ?? null);
  const fp = useEditorStore((s) => s.ui.flowPlay);
  const recording = useEditorStore((s) => s.ui.recording);
  const actions = useEditorStore((s) => s.actions);

  return useMemo(() => {
    if (!flows || !nodes || !edges) return null;
    const label = (id: string) => nodes.find((n) => n.id === id)?.label ?? '?';
    const playing = fp ? flows.find((f) => f.id === fp.id) : undefined;
    const recF = recording ? flows.find((f) => f.id === recording) : undefined;
    const last = playing ? playing.steps.length - 2 : 0;

    let caption: string;
    if (!flows.length) caption = 'No flows yet. Record one request’s path, like Checkout or Login.';
    else if (recF) caption = `Recording “${recF.name}”. Click components in the order the request travels.`;
    else if (!playing || !fp) caption = 'Pick a flow, then press Play to trace one request end to end.';
    else {
      const a = playing.steps[fp.idx], b = playing.steps[fp.idx + 1];
      const e = edges.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
      const done = !fp.playing && fp.idx >= last;
      caption = `${done ? 'Done. ' : ''}Step ${fp.idx + 1} of ${playing.steps.length - 1} · ${label(a)} → ${label(b)}${e ? ` · ${e.proto}${e.mode === 'async' ? ' (async)' : ''}` : ''}`;
    }

    const firstPlayable = flows.find((f) => f.steps.length >= 2);
    return {
      chips: flows.map<FlowChipView>((f) => ({ id: f.id, name: f.name, active: playing?.id === f.id, onSelect: () => actions.playFlow(f.id) })),
      caption,
      isPlaying: !!fp?.playing,
      active: !!playing,
      playLabel: fp?.playing ? 'Pause' : playing && fp && fp.idx >= last ? 'Replay' : 'Play',
      onToggle: () => {
        if (!fp) return firstPlayable ? actions.playFlow(firstPlayable.id) : actions.toast('Record a flow first');
        if (fp.playing) return actions.setFlowPlay({ ...fp, playing: false });
        actions.setFlowPlay({ ...fp, idx: fp.idx >= last ? 0 : fp.idx, playing: true });
      },
      onPrev: () => fp && actions.setFlowPlay({ ...fp, idx: Math.max(0, fp.idx - 1), playing: false }),
      onNext: () => fp && actions.setFlowPlay({ ...fp, idx: Math.min(last, fp.idx + 1), playing: false }),
      onStop: () => actions.setFlowPlay(null),
      onNew: actions.newFlow,
    };
  }, [flows, nodes, edges, fp, recording, actions]);
}
