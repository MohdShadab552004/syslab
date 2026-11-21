'use client';

import { useEffect } from 'react';
import { simulate, stepRuntime } from '@syslab/sim';
import { useEditorStore } from './editor.store';

const TICK_MS = 1000;
const TOAST_MS = 2600;

/**
 * One clock for everything time-based in the editor: autoscaling, flow playback,
 * toast and event expiry. Reads state imperatively so it never causes re-renders itself.
 */
export function useEngineTicker() {
  useEffect(() => {
    const timer = setInterval(() => {
      const s = useEditorStore.getState();
      const { actions, doc, ui } = s;
      if (!doc) return;
      const now = Date.now();

      if (ui.toast && now - ui.toast.at > TOAST_MS) actions.clearToast();
      actions.expireEvents(now);

      if (ui.running && !ui.dragging) {
        const step = stepRuntime(doc, simulate(doc, s.runtime), s.runtime, now);
        if (step) actions.applyRuntime(step.runtime, step.events);
      }

      const fp = ui.flowPlay;
      if (fp?.playing) {
        const flow = doc.flows.find((f) => f.id === fp.id);
        if (!flow) actions.setFlowPlay(null);
        else if (fp.idx < flow.steps.length - 2) actions.setFlowPlay({ ...fp, idx: fp.idx + 1 });
        else actions.setFlowPlay({ ...fp, playing: false });
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);
}
