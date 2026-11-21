'use client';

import { useEffect, useRef } from 'react';
import { designsApi } from '@/lib/api/designs.api';
import { ApiError } from '@/lib/api/http';
import { useEditorStore } from './editor.store';

const DEBOUNCE_MS = 900;

/**
 * Debounced, single-flight autosave with optimistic concurrency.
 * Drag storms collapse into one PATCH; a 409 stops saving and asks for a reload.
 */
export function useAutosave() {
  const editSeq = useEditorStore((s) => s.editSeq);
  const designId = useEditorStore((s) => s.designId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const again = useRef(false);

  useEffect(() => {
    const save = async () => {
      const s = useEditorStore.getState();
      if (!s.designId || !s.doc || s.saveState === 'conflict') return;
      if (s.ui.dragging) { timer.current = setTimeout(save, DEBOUNCE_MS); return; }
      if (inFlight.current) { again.current = true; return; }
      inFlight.current = true;
      const seq = s.editSeq;
      s.actions.setSaveState('saving');
      try {
        const res = await designsApi.update(s.designId, { name: s.name, doc: s.doc, revision: s.revision });
        useEditorStore.getState().actions.markSaved(res.revision, seq);
      } catch (err) {
        const a = useEditorStore.getState().actions;
        if (err instanceof ApiError && err.isConflict) {
          a.setSaveState('conflict');
          a.toast('This design changed in another tab. Reload to continue.');
        } else {
          a.setSaveState('error');
        }
      } finally {
        inFlight.current = false;
        if (again.current) { again.current = false; void save(); }
      }
    };

    if (!designId || editSeq === 0) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, DEBOUNCE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [editSeq, designId]);

  // Warn before closing the tab with unsaved work.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const st = useEditorStore.getState().saveState;
      if (st === 'dirty' || st === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}
