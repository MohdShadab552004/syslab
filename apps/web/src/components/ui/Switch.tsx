import { cx } from '@/lib/utils/cx';

export function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return <button type="button" className={cx('switch', on && 'on')} onClick={onToggle} aria-pressed={on} aria-label={label} />;
}
