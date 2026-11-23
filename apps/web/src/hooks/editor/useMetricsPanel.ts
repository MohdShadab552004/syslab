'use client';

import { useMemo } from 'react';
import { costBreakdown } from '@syslab/sim';
import { buildCharts, spanLabel, type ChartView } from '@/lib/metrics/history';
import { buildCostView, type CostView } from '@/lib/metrics/cost';
import { useEditorStore } from './editor.store';
import { useSimulation } from './useSimulation';

export interface MetricsPanelView {
  charts: ChartView[];
  span: string;
  empty: boolean;
  marksHint: string | null;
  cost: CostView;
  onClear: () => void;
}

/** Graphs from the recorded history and the cost breakdown of the current simulation. */
export function useMetricsPanel(): MetricsPanelView | null {
  const doc = useEditorStore((s) => s.doc);
  const history = useEditorStore((s) => s.history);
  const clear = useEditorStore((s) => s.actions.clearHistory);
  const sim = useSimulation();
  return useMemo(() => {
    if (!doc || !sim) return null;
    const charts = buildCharts(history, doc.requirements.slo);
    const hasMarks = history.some((s) => s.events.length);
    return {
      charts,
      span: spanLabel(history),
      empty: history.length < 2,
      marksHint: hasMarks ? 'Vertical ticks mark autoscaling events.' : null,
      cost: buildCostView(costBreakdown(doc, sim)),
      onClear: clear,
    };
  }, [doc, sim, history, clear]);
}
