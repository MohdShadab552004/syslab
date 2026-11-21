'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export type MobilePanel = 'none' | 'palette' | 'inspector';

/**
 * On narrow screens the palette and the inspector are bottom sheets; this tracks which one is open.
 * On desktop both are always-visible columns and this state simply has no visual effect.
 */
export function useMobilePanel() {
  const [panel, setPanel] = useState<MobilePanel>('none');
  const toggle = useCallback((p: MobilePanel) => setPanel((cur) => (cur === p ? 'none' : p)), []);
  const close = useCallback(() => setPanel('none'), []);
  const togglePalette = useCallback(() => toggle('palette'), [toggle]);
  const toggleInspector = useCallback(() => toggle('inspector'), [toggle]);

  useEffect(() => {
    if (panel === 'none') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel('none'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel]);

  return useMemo(() => ({ panel, close, togglePalette, toggleInspector }), [panel, close, togglePalette, toggleInspector]);
}
