'use client';

import { useMemo } from 'react';
import { ICONS, KINDS, PALETTE_GROUPS, PRESETS, TECHS } from '@syslab/sim';
import { useEditorStore } from './editor.store';
import type { PaletteDragItem } from './useCanvasInteractions';

export interface PaletteItemView { key: string; name: string; desc: string; tile: string; icon: string; item: PaletteDragItem }
export interface PaletteGroupView { title: string; items: PaletteItemView[] }

/** Component catalogue filtered by the search box. */
export function usePalette() {
  const query = useEditorStore((s) => s.ui.query);
  const setQuery = useEditorStore((s) => s.actions.setQuery);

  const groups = useMemo<PaletteGroupView[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (text: string) => !q || text.toLowerCase().includes(q);
    const out: PaletteGroupView[] = PALETTE_GROUPS.map((g) => ({
      title: g.title,
      items: g.kinds
        .filter((k) => match(`${KINDS[k].name} ${KINDS[k].desc} ${TECHS[k].join(' ')}`))
        .map((k) => ({ key: k, name: KINDS[k].name, desc: KINDS[k].desc, tile: KINDS[k].tile ?? KINDS[k].colors[1], icon: ICONS[k], item: { type: 'kind', kind: k } as PaletteDragItem })),
    }));
    const presets = PRESETS.filter((p) => match(`${p.name} ${p.desc} autoscaling scaling`)).map((p) => ({
      key: p.key, name: p.name, desc: p.desc, tile: KINDS.app.colors[1], icon: p.icon, item: { type: 'preset', key: p.key } as PaletteDragItem,
    }));
    out.splice(2, 0, { title: 'Scaling', items: presets });
    return out.filter((g) => g.items.length);
  }, [query]);

  return { query, setQuery, groups };
}
