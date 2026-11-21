import { memo } from 'react';
import { cx } from '@/lib/utils/cx';
import { Button, ICON } from '@/components/ui';
import type { LessonStepView } from '@/hooks/editor/useLesson';
import type { FlowChipView } from '@/hooks/editor/useFlowPlayer';

interface LessonProps {
  steps: LessonStepView[];
  caption: { title: string; text: string };
  onPrev: () => void;
  onNext: () => void;
}

export const LessonTimeline = memo(function LessonTimeline({ steps, caption, onPrev, onNext }: LessonProps) {
  return (
    <footer className="timeline">
      <div className="tl-left">
        <div className="ph">Lesson · Scenario</div>
        <div className="tl-nav">
          <Button size="sm" iconOnly icon={ICON.chevronLeft} onClick={onPrev} aria-label="Previous step" />
          <Button size="sm" onClick={onNext}>Next step</Button>
        </div>
      </div>
      <div className="steps">
        {steps.map((s, i) => (
          <button key={s.n} type="button" className={cx('step', s.state === 'active' && 'active', s.state === 'done' && 'done')} onClick={s.onSelect}>
            {i > 0 && <span className="line" />}
            <span className="dot">{s.n}</span>
            <span className="slabel">{s.label}</span>
          </button>
        ))}
      </div>
      <p className="caption"><b>{caption.title}.</b> {caption.text}</p>
    </footer>
  );
});

interface FlowProps {
  chips: FlowChipView[];
  caption: string;
  isPlaying: boolean;
  active: boolean;
  playLabel: string;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onStop: () => void;
  onNew: () => void;
}

export const FlowPlayerBar = memo(function FlowPlayerBar(p: FlowProps) {
  return (
    <footer className="timeline compact">
      <div className="tl-left">
        <div className="ph">Request flows</div>
        <div className="tl-nav">
          <Button size="sm" iconOnly icon={ICON.chevronLeft} onClick={p.onPrev} aria-label="Previous step" />
          <Button size="sm" variant="primary" iconFill icon={p.isPlaying ? ICON.pause : ICON.play} onClick={p.onToggle}>{p.playLabel}</Button>
          <Button size="sm" iconOnly icon={ICON.chevronRight} onClick={p.onNext} aria-label="Next step" />
          {p.active && <Button size="sm" onClick={p.onStop}>Exit</Button>}
        </div>
      </div>
      <div className="fchips">
        {p.chips.map((c) => <Button key={c.id} size="sm" active={c.active} onClick={c.onSelect}>{c.name}</Button>)}
        <Button size="sm" icon={ICON.plus} onClick={p.onNew}>New flow</Button>
      </div>
      <p className="caption" title={p.caption}>{p.caption}</p>
    </footer>
  );
});
