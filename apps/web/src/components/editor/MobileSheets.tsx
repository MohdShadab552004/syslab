import { memo, type ReactNode } from 'react';
import { cx } from '@/lib/utils/cx';
import { Button, ICON } from '@/components/ui';

/**
 * Wraps the palette / inspector. On desktop it is invisible (`display: contents`), so the
 * child stays a normal column. On phones it becomes a bottom sheet with a title and close button.
 */
export const Sheet = memo(function Sheet({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <div className={cx('sheet', open && 'open')} role={open ? 'dialog' : undefined} aria-label={title}>
      <div className="sheethead">
        <b>{title}</b>
        <Button size="sm" iconOnly icon={ICON.close} onClick={onClose} aria-label={`Close ${title}`} />
      </div>
      {children}
    </div>
  );
});

/** Floating buttons that open the sheets; only shown on phones. */
export const MobileFabs = memo(function MobileFabs({ onAdd, onDetails, hasSelection }: { onAdd: () => void; onDetails: () => void; hasSelection: boolean }) {
  return (
    <div className="mobilefabs">
      <Button variant="primary" icon={ICON.plus} onClick={onAdd}>Add</Button>
      <Button variant={hasSelection ? 'primary' : 'default'} icon={ICON.search} onClick={onDetails}>{hasSelection ? 'Details' : 'Design'}</Button>
    </div>
  );
});
