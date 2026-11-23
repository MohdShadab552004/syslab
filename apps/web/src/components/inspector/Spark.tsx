import { memo } from 'react';
import { cx } from '@/lib/utils/cx';

interface Props {
  label: string;
  points: number[];
  /** faint second series drawn behind the main one */
  secondary?: number[] | null;
  max: number;
  /** dashed target line (same unit as the points) */
  threshold?: number | null;
  thresholdLabel?: string;
  /** sample indexes to mark (autoscaling events) */
  marks?: number[];
  unit?: string;
  value?: string;
  maxText?: string;
  bad?: boolean;
  height?: number;
  span?: string;
}

const W = 260;

/** A small time-series chart: area + line, optional target line and event marks. */
export const Spark = memo(function Spark({ label, points, secondary, max, threshold, thresholdLabel, marks = [], unit = '', value, maxText, bad, height = 46, span }: Props) {
  const H = height;
  const n = Math.max(points.length, secondary?.length ?? 0);
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W);
  const y = (v: number) => H - 2 - (Math.max(0, Math.min(v, max)) / (max || 1)) * (H - 4);
  const line = (ps: number[]) => ps.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const shown = value ?? (last == null ? '—' : `${Math.round(last * 10) / 10}${unit}`);
  return (
    <div className={cx('spark', bad && 'bad')}>
      <div className="sphead">
        <span className="splabel">{label}</span>
        <span className="spval">{shown}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${shown}`}>
        {threshold != null && threshold <= max && <line className="spth" x1="0" x2={W} y1={y(threshold)} y2={y(threshold)} />}
        {marks.map((i) => <line key={i} className="spmark" x1={x(i)} x2={x(i)} y1="0" y2={H} />)}
        {secondary && secondary.length > 1 && <path className="sp2" d={line(secondary)} />}
        {points.length > 1 && <path className="sparea" d={`${line(points)} L${x(points.length - 1).toFixed(1)} ${H} L0 ${H} Z`} />}
        {points.length > 1 && <path className="spline" d={line(points)} />}
      </svg>
      {(maxText || span || thresholdLabel) && (
        <div className="spfoot">
          <span>{span}</span>
          <span>{thresholdLabel ? `${thresholdLabel} · ` : ''}{maxText ? `max ${maxText}` : ''}</span>
        </div>
      )}
    </div>
  );
});
