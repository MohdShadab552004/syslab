import { memo } from 'react';
import { cx } from '@/lib/utils/cx';
import type { NoteView } from '@/lib/canvas/buildCanvasView';

interface Props {
  v: NoteView;
  onMove: (e: React.PointerEvent, id: string) => void;
  onFocus: (e: React.PointerEvent, id: string) => void;
  onText: (id: string, text: string) => void;
}

export const StickyNote = memo(function StickyNote({ v, onMove, onFocus, onText }: Props) {
  if (!v.open) {
    return (
      <button type="button" data-note={v.id} className="note-icon" style={{ left: v.x, top: v.y }} title={v.text} aria-label={`Note: ${v.text}`}
        onPointerDown={(e) => onMove(e, v.id)}>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14v12l-6 6H5zM13 21v-6h6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /></svg>
      </button>
    );
  }
  return (
    <div data-note={v.id} className={cx('note', v.selected && 'sel')} style={{ left: v.x, top: v.y }}>
      <div className="nhead" onPointerDown={(e) => onMove(e, v.id)} aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <textarea aria-label="Note" value={v.text} onChange={(e) => onText(v.id, e.target.value)} onPointerDown={(e) => onFocus(e, v.id)} />
    </div>
  );
});
