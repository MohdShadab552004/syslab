'use client';

import { useMemo } from 'react';
import { simulate, type SimResult } from '@syslab/sim';
import { useEditorStore } from './editor.store';

/** Memoised simulation of the current doc + runtime. Recomputes only when either changes. */
export function useSimulation(): SimResult | null {
  const doc = useEditorStore((s) => s.doc);
  const runtime = useEditorStore((s) => s.runtime);
  return useMemo(() => (doc ? simulate(doc, runtime) : null), [doc, runtime]);
}
