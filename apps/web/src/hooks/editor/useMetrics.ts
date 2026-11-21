'use client';

import { useMemo } from 'react';
import { bottleneck, fmtCompact, fmtInt, fmtMoney, fmtMs, isOver } from '@syslab/sim';
import { useEditorStore } from './editor.store';
import { useSimulation } from './useSimulation';

export interface MetricView { key: string; label: string; value: string; bad: boolean; icon: string }

const ICON = {
  latency: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  errors: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01',
  tput: 'M3 12h4l3-8 4 16 3-8h4',
  cost: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5',
};

/** Headline numbers for the metrics bar and inspector summaries. */
export function useMetrics() {
  const doc = useEditorStore((s) => s.doc);
  const sim = useSimulation();

  return useMemo(() => {
    if (!doc || !sim) return null;
    const slo = doc.requirements.slo;
    const b = bottleneck(doc, sim);
    const metrics: MetricView[] = [
      { key: 'p95', label: `P95 · SLO ${slo} ms`, value: sim.rps > 0 ? fmtMs(sim.p95) : '—', bad: sim.rps > 0 && sim.p95 > slo, icon: ICON.latency },
      { key: 'err', label: 'Errors', value: (sim.errorRate * 100).toFixed(sim.errorRate > 0 && sim.errorRate < 0.1 ? 1 : 0) + '%', bad: sim.errorRate > 0.0005, icon: ICON.errors },
      { key: 'tput', label: 'Throughput', value: fmtCompact(sim.rps * (1 - sim.errorRate)) + ' rps', bad: false, icon: ICON.tput },
      { key: 'cost', label: 'Cost / month', value: fmtMoney(sim.cost), bad: false, icon: ICON.cost },
    ];
    return {
      metrics,
      usersText: `${fmtInt(sim.users)} users`,
      rpsText: fmtCompact(sim.rps),
      costText: fmtMoney(sim.cost),
      bottleneck: b ? { text: `${b.node.label} · ${Math.round(b.load * 100)}%`, bad: isOver(b.load) } : { text: '—', bad: false },
      nodeCount: doc.nodes.length,
      edgeCount: doc.edges.length,
    };
  }, [doc, sim]);
}
