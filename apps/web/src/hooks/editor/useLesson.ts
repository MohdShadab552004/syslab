'use client';

import { useMemo } from 'react';
import { HORIZONTAL_SCALING_STEPS } from '@syslab/sim';
import { useEditorStore } from './editor.store';

export interface LessonStepView { n: number; label: string; state: 'done' | 'active' | 'todo'; onSelect: () => void }

/** Guided lesson timeline, only when the open design is a lesson. */
export function useLesson() {
  const lesson = useEditorStore((s) => s.doc?.lesson ?? null);
  const loadStep = useEditorStore((s) => s.actions.loadLessonStep);

  return useMemo(() => {
    if (!lesson) return null;
    const steps = HORIZONTAL_SCALING_STEPS;
    const current = steps[Math.max(0, Math.min(steps.length - 1, lesson.step - 1))];
    return {
      title: 'Horizontal Scaling',
      steps: steps.map<LessonStepView>((s) => ({
        n: s.n, label: s.label, state: s.n === lesson.step ? 'active' : s.n < lesson.step ? 'done' : 'todo', onSelect: () => loadStep(s.n),
      })),
      caption: { title: current.label, text: current.caption },
      onPrev: () => loadStep(Math.max(1, lesson.step - 1)),
      onNext: () => loadStep(Math.min(steps.length, lesson.step + 1)),
    };
  }, [lesson, loadStep]);
}
