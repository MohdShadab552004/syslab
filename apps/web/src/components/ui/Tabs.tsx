import { cx } from '@/lib/utils/cx';

export interface TabItem { key: string; label: string; active: boolean; onSelect: () => void }

export function Tabs({ items }: { items: TabItem[] }) {
  return (
    <div className="itabs" role="tablist">
      {items.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.active} className={cx('itab', t.active && 'on')} onClick={t.onSelect}>{t.label}</button>
      ))}
    </div>
  );
}
