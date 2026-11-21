import { memo } from 'react';
import type { Shape } from '@syslab/types';
import type { QueueVisual } from '@/lib/canvas/buildCanvasView';

const S = '#232a33';
type Colors = readonly [string, string, string];

interface IsoShapeProps {
  shape: Shape;
  colors: Colors;
  icon?: string;
  label?: string;
  dashed?: boolean;
  bands?: boolean;
  people?: { x: number; y: number; c: string }[];
  /** live backlog for queues */
  queue?: QueueVisual | null;
}

const FaceIcon = ({ path, top }: { path: string; top: string }) => (
  <div className="face" style={{ top }}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1f2a37" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
  </div>
);

function Cube({ c, dashed }: { c: Colors; dashed?: boolean }) {
  return (
    <svg className="shape" viewBox="0 0 120 120" aria-hidden="true">
      <path d="M60 10 L104 35 L60 60 L16 35 Z" fill={c[0]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M16 35 L60 60 L60 110 L16 85 Z" fill={c[1]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M60 60 L104 35 L104 85 L60 110 Z" fill={c[2]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M60 10 L104 35 L104 85 L60 110 L16 85 L16 35 Z" fill="none" stroke={S} strokeWidth="3.4" strokeLinejoin="round" strokeDasharray={dashed ? '7 6' : undefined} />
    </svg>
  );
}

function Slab({ c }: { c: Colors }) {
  return (
    <svg className="shape" viewBox="0 0 124 100" aria-hidden="true">
      <path d="M62 18 L114 46 L62 74 L10 46 Z" fill={c[0]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M10 46 L62 74 L62 94 L10 66 Z" fill={c[1]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M62 74 L114 46 L114 66 L62 94 Z" fill={c[2]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M62 18 L114 46 L114 66 L62 94 L10 66 L10 46 Z" fill="none" stroke={S} strokeWidth="3.4" strokeLinejoin="round" />
    </svg>
  );
}

function Cylinder({ c, bands }: { c: Colors; bands?: boolean }) {
  return (
    <svg className="shape" viewBox="0 0 104 120" aria-hidden="true">
      <path d="M14 30 L14 92 A38 14 0 0 0 90 92 L90 30 Z" fill={c[1]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M62 43 L62 105 A38 14 0 0 0 90 92 L90 30 A38 14 0 0 1 62 43 Z" fill={c[2]} />
      <path d="M14 61 A38 14 0 0 0 90 61" fill="none" stroke={S} strokeWidth="2" />
      {bands && <>
        <path d="M14 45 A38 14 0 0 0 90 45" fill="none" stroke="#5a4fb0" strokeWidth="2" strokeDasharray="4 3" />
        <path d="M14 77 A38 14 0 0 0 90 77" fill="none" stroke="#5a4fb0" strokeWidth="2" strokeDasharray="4 3" />
      </>}
      <ellipse cx="52" cy="30" rx="38" ry="14" fill={c[0]} stroke={S} strokeWidth="2.4" />
      <path d="M14 30 L14 92 A38 14 0 0 0 90 92 L90 30" fill="none" stroke={S} strokeWidth="3.4" strokeLinejoin="round" />
    </svg>
  );
}

const MESSAGES = ['M28.8 60 L42.6 52 L53 58 L39.2 66 Z', 'M49.6 72 L63.4 64 L73.8 70 L60 78 Z', 'M70.4 84 L84.2 76 L94.6 82 L80.7 90 Z', 'M91.1 96 L105 88 L115.4 94 L101.5 102 Z'];

/** One message, centred on 0,0, same tilt as the slots. */
const TOKEN = 'M-7.3 0.6 L1 -4.2 L7.3 -0.6 L-1 4.2 Z';

function QueueBar({ c, q }: { c: Colors; q?: QueueVisual | null }) {
  const filled = q?.filled ?? 0;
  const dur = Number(q?.dur ?? 2);
  return (
    <svg className={q ? `shape q-${q.state}` : 'shape'} viewBox="0 0 146 142" aria-hidden="true">
      <path d="M8 60 L42.6 40 L137.9 95 L103.3 115 Z" fill={c[0]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M8 60 L103.3 115 L103.3 137 L8 82 Z" fill={c[1]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M103.3 115 L137.9 95 L137.9 117 L103.3 137 Z" fill={c[2]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
      {/* slots fill from the exit end (the head of the queue) as the backlog grows */}
      {MESSAGES.map((d, i) => {
        const on = i >= MESSAGES.length - filled;
        return <path key={d} d={d} className={on ? 'qslot on' : 'qslot'} fill={on ? '#f2bf73' : '#fbfbf9'} stroke={S} strokeWidth="1.8" strokeLinejoin="round" style={on ? { animationDelay: `${(MESSAGES.length - 1 - i) * 0.18}s` } : undefined} />;
      })}
      {q?.flowing && [0, 1, 2].map((i) => (
        <path key={i} className="qmsg" d={TOKEN} fill="#f2bf73" stroke={S} strokeWidth="1.4" strokeLinejoin="round"
          style={{ animationDuration: `${dur}s`, animationDelay: `${-(i * dur) / 3}s` }} />
      ))}
      <path d="M8 60 L42.6 40 L137.9 95 L137.9 117 L103.3 137 L8 82 Z" fill="none" stroke={S} strokeWidth="3.4" strokeLinejoin="round" />
    </svg>
  );
}

const LANES = [
  { line: 'M18 52.6 L57 75.1', head: 'M62 78 L54.19 77.53 L57.69 71.47 Z', cy: 52.6, dash: false },
  { line: 'M18 76.6 L57 99.1', head: 'M62 102 L54.19 101.53 L57.69 95.47 Z', cy: 76.6, dash: true },
  { line: 'M18 100.6 L57 123.1', head: 'M62 126 L54.19 125.53 L57.69 119.47 Z', cy: 100.6, dash: false },
];

function Gate({ c }: { c: Colors }) {
  return (
    <svg className="shape" viewBox="0 0 96 150" aria-hidden="true">
      <path d="M10 20 L23.9 12 L84.5 47 L70.6 55 Z" fill={c[0]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M10 20 L70.6 55 L70.6 145 L10 110 Z" fill={c[1]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M70.6 55 L84.5 47 L84.5 137 L70.6 145 Z" fill={c[2]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
      {LANES.map((l) => (
        <g key={l.cy}>
          <path d={l.line} fill="none" stroke={S} strokeWidth="2" strokeLinecap="round" strokeDasharray={l.dash ? '4 3' : undefined} />
          <path d={l.head} fill={S} stroke={S} strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="18" cy={l.cy} r="2.8" fill="#fbfbf9" stroke={S} strokeWidth="1.6" />
        </g>
      ))}
      <path d="M10 20 L23.9 12 L84.5 47 L84.5 137 L70.6 145 L10 110 Z" fill="none" stroke={S} strokeWidth="3.4" strokeLinejoin="round" />
    </svg>
  );
}

function Platform({ c, people }: { c: Colors; people: { x: number; y: number; c: string }[] }) {
  return (
    <>
      <svg className="shape" viewBox="0 0 180 120" aria-hidden="true">
        <path d="M90 20 L170 60 L90 100 L10 60 Z" fill={c[0]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M10 60 L90 100 L90 112 L10 72 Z" fill={c[1]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M90 100 L170 60 L170 72 L90 112 Z" fill={c[2]} stroke={S} strokeWidth="2.4" strokeLinejoin="round" />
      </svg>
      {people.map((p, i) => (
        <div key={i} className="person" style={{ left: p.x, top: p.y }}>
          <div className="hd" style={{ background: p.c }} />
          <div className="bd" style={{ background: p.c }} />
        </div>
      ))}
    </>
  );
}

/** Any isometric block. Pure SVG; pills and interaction live in the caller. */
export const IsoShape = memo(function IsoShape({ shape, colors, icon, label, dashed, bands, people = [], queue }: IsoShapeProps) {
  switch (shape) {
    case 'cube':
      return (<><Cube c={colors} dashed={dashed} />{icon && <FaceIcon path={icon} top="17%" />}{label && <div className="face flabel" style={{ top: '53%' }}>{label}</div>}</>);
    case 'slab':
      return (<><Slab c={colors} />{icon && <FaceIcon path={icon} top="36%" />}</>);
    case 'db':
      return (<><Cylinder c={colors} bands={bands} />{icon && <FaceIcon path={icon} top="58%" />}</>);
    case 'queue':
      return <QueueBar c={colors} q={queue} />;
    case 'gate':
      return <Gate c={colors} />;
    case 'users':
      return <Platform c={colors} people={people} />;
  }
});

/** Small cube used in template / design previews. */
export const MiniCube = memo(function MiniCube({ t, l, r, size = 40 }: { t: string; l: string; r: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <path d="M60 10 L104 35 L60 60 L16 35 Z" fill={t} stroke={S} strokeWidth="6" strokeLinejoin="round" />
      <path d="M16 35 L60 60 L60 110 L16 85 Z" fill={l} stroke={S} strokeWidth="6" strokeLinejoin="round" />
      <path d="M60 60 L104 35 L104 85 L60 110 Z" fill={r} stroke={S} strokeWidth="6" strokeLinejoin="round" />
    </svg>
  );
});
