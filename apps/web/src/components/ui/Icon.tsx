import { memo } from 'react';

interface IconProps { path: string; size?: number; stroke?: number; className?: string; fill?: boolean; color?: string }

/** Inline stroke icon from a single SVG path. */
export const Icon = memo(function Icon({ path, size = 14, stroke = 2.2, className, fill, color = 'currentColor' }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill={fill ? color : 'none'} stroke={fill ? 'none' : color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
});

export const ICON = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  play: 'M7 4l13 8-13 8z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  check: 'M5 12l5 5 9-10',
  share: 'M4 12v7h16v-7M12 3v12M7 8l5-5 5 5',
  history: 'M12 21a9 9 0 1 0-9-9M3 4v5h5M12 7v5l3 2',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  power: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
  cursor: 'M5 3l14 7-6 2-2 6z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  group: 'M4 4h16v16H4z',
  note: 'M4 4h16v11l-5 5H4zM15 20v-5h5',
  spike: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  warn: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01',
  reverse: 'M7 7h13l-4-4M17 17H4l4 4',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M5 12l7 7 7-7',
  users: 'M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1.5a4 4 0 0 0-3-3.9M15.5 4.1a3.5 3.5 0 0 1 0 6.8',
  lb: 'M3 12h6l4-6h8M9 12l4 6h8',
};
