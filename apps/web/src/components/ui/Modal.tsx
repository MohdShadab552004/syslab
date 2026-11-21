'use client';

import { useEffect, useId, type ReactNode } from 'react';
import { Button } from './Button';
import { ICON } from './Icon';

export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="mhead">
          <h2 className="mtitle" id={id}>{title}</h2>
          <Button size="sm" iconOnly icon={ICON.close} onClick={onClose} aria-label="Close" />
        </div>
        {children}
        {footer && <div className="mfoot">{footer}</div>}
      </div>
    </div>
  );
}
