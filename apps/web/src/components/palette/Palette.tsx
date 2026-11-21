import { memo } from 'react';
import { Icon, ICON } from '@/components/ui';
import type { PaletteGroupView, PaletteItemView } from '@/hooks/editor/usePalette';
import type { PaletteDragItem } from '@/hooks/editor/useCanvasInteractions';

interface Props {
  query: string;
  onQuery: (q: string) => void;
  groups: PaletteGroupView[];
  onDragStart: (e: React.DragEvent, item: PaletteDragItem) => void;
  onClick: (item: PaletteDragItem) => void;
}

const PaletteItem = memo(function PaletteItem({ v, onDragStart, onClick }: { v: PaletteItemView } & Pick<Props, 'onDragStart' | 'onClick'>) {
  return (
    <button type="button" className="pitem" draggable onDragStart={(e) => onDragStart(e, v.item)} onClick={() => onClick(v.item)}>
      <span className="ptile" style={{ background: v.tile }}><Icon path={v.icon} size={17} stroke={2} color="#1f2a37" /></span>
      <span>
        <span className="pname">{v.name}</span>
        <span className="pdesc">{v.desc}</span>
      </span>
    </button>
  );
});

export const Palette = memo(function Palette({ query, onQuery, groups, onDragStart, onClick }: Props) {
  return (
    <aside className="palette" aria-label="Components">
      <label className="search">
        <Icon path={ICON.search} size={15} stroke={2} />
        <input type="text" placeholder="Search components" aria-label="Search components" value={query} onChange={(e) => onQuery(e.target.value)} />
      </label>
      {groups.map((g) => (
        <div key={g.title} className="pgroup">
          <div className="ph">{g.title}</div>
          {g.items.map((it) => <PaletteItem key={it.key} v={it} onDragStart={onDragStart} onClick={onClick} />)}
        </div>
      ))}
      <div className="phint">Drag a component onto the canvas, or click it to drop it in. Group and Note live in the canvas toolbar.</div>
    </aside>
  );
});
