'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EMPTY_RUNTIME, simulate, stepRuntime, type Runtime } from '@syslab/sim';
import { designsApi } from '@/lib/api/designs.api';
import { buildCanvasView } from '@/lib/canvas/buildCanvasView';

/** Read-only, self-contained viewer for a shared link: own runtime, no store, no saving. */
export function useSharedViewer(token: string) {
  const q = useQuery({ queryKey: ['shared', token], queryFn: ({ signal }) => designsApi.getShared(token, signal), staleTime: Infinity });
  const [runtime, setRuntime] = useState<Runtime>(EMPTY_RUNTIME);
  const [running, setRunning] = useState(true);
  const doc = q.data?.doc;

  const sim = useMemo(() => (doc ? simulate(doc, runtime) : null), [doc, runtime]);

  useEffect(() => {
    if (!doc || !running) return;
    const t = setInterval(() => {
      setRuntime((rt) => stepRuntime(doc, simulate(doc, rt), rt, Date.now())?.runtime ?? rt);
    }, 1000);
    return () => clearInterval(t);
  }, [doc, running]);

  const view = useMemo(() => (doc && sim ? buildCanvasView(doc, sim, {
    sel: null, pending: null, tool: 'select', recording: null, flowPlay: null, running, drain: runtime.drain, isLesson: !!doc.lesson,
    rewire: null, readOnly: true,
  }) : null), [doc, sim, running, runtime.drain]);

  return {
    name: q.data?.name ?? '',
    goal: doc?.requirements.goal ?? '',
    view,
    error: q.error as Error | null,
    running,
    onToggleRun: () => setRunning((r) => !r),
  };
}
