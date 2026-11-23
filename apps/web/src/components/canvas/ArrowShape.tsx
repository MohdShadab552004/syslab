import type { ArrowHead } from '@syslab/types';

/**
 * One line end, drawn Figma-style: the tip sits at (0, 0) and the line comes in from the left
 * (negative x), so callers only translate to the end point and rotate to the line's direction.
 */
export function ArrowShape({ kind }: { kind: ArrowHead }) {
  switch (kind) {
    case 'triangle': return <polygon className="head" points="-11,-5.5 0,0 -11,5.5" />;
    case 'reverse': return <polygon className="head" points="0,-5.5 0,5.5 -11,0" />;
    case 'diamond': return <polygon className="head" points="0,0 -6.5,-5 -13,0 -6.5,5" />;
    case 'circle': return <circle className="head" cx="-5" cy="0" r="5" />;
    case 'line': return <polyline className="head open" points="-10,-6 0,0 -10,6" />;
    default: return null;
  }
}

/** An end placed at a point and angle (degrees) in an SVG layer. */
export function ArrowAt({ kind, x, y, ang }: { kind: ArrowHead; x: number; y: number; ang: number }) {
  if (kind === 'none') return null;
  return <g transform={`translate(${x} ${y}) rotate(${ang})`}><ArrowShape kind={kind} /></g>;
}
