'use client';

import { useEffect } from 'react';
import { simulate, stepRuntime } from '@syslab/sim';
import { traceJourney } from '@/lib/canvas/trace';
import { sampleOf } from '@/lib/metrics/history';
import { useEditorStore } from './editor.store';

const TICK_MS = 1000;
const TOAST_MS = 2600;
/** time to read one step of a journey before the next one lights up */
export const JOURNEY_STEP_MS = 2200;

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
        const sim = simulate(doc, s.runtime);
        const step = stepRuntime(doc, sim, s.runtime, now);
        if (step) actions.applyRuntime(step.runtime, step.events);
        actions.recordSample(sampleOf(doc, sim, now, step?.events.map((e) => e.text) ?? []));
      }

      const jp = ui.journeyPlay;
      if (jp?.playing && now - (jp.at ?? 0) >= JOURNEY_STEP_MS) {
        const j = traceJourney(doc, null, jp.focus);
        if (!j) actions.setJourneyPlay(null);
        else if (jp.idx < j.steps - 1) actions.setJourneyPlay({ ...jp, idx: jp.idx + 1, at: now });
        else actions.setJourneyPlay({ ...jp, playing: false });
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
