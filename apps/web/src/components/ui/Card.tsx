import type { ReactNode } from 'react';
import { cx } from '@/lib/utils/cx';

export function Card({ children, tone, className }: { children: ReactNode; tone?: 'warn' | 'active'; className?: string }) {
  return <div className={cx('card', tone === 'warn' && 'card-warn', tone === 'active' && 'card-active', className)}>{children}</div>;
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ph', className)}>{children}</div>;
}

export function Row({ label, value, bad }: { label: ReactNode; value: ReactNode; bad?: boolean }) {
  return (
    <div className="row">
      <span className="k">{label}</span>
      <span className={cx('v', bad && 'bad')}>{value}</span>
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="hint">{children}</p>;
}
