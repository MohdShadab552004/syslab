import { memo, useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/utils/cx';
import { Button, Icon, ICON, type Option } from '@/components/ui';
import type { MetricView } from '@/hooks/editor/useMetrics';
import type { Tool } from '@/types/editor';

export const TitleBlock = memo(function TitleBlock({ title, sub, badge }: { title: string; sub: string; badge?: string }) {
  return (
    <div className="titleblock">
      <h1 className="h1">{title}{badge && <span className="timepill">{badge}</span>}</h1>
      <p className="sub">{sub}</p>
    </div>
  );
});

export const MetricsBar = memo(function MetricsBar({ metrics }: { metrics: MetricView[] }) {
  return (
    <div className="metrics">
      {metrics.map((m) => (
        <div key={m.key} className={cx('metric', m.bad && 'bad')} title={m.tip}>
          <div className="mlabel"><Icon path={m.icon} size={11} stroke={2.4} />{m.label}</div>
          <div className="mval">{m.value}</div>
        </div>
      ))}
    </div>
  );
});

export interface ViewMenuProps {
  toggles: { key: string; label: string; hint: string; on: boolean; onToggle: () => void }[];
  actions: { key: string; label: string; hint: string; onSelect: () => void; disabled: boolean }[];
}

interface ToolbarProps {
  tool: Tool;
  onTool: (t: Tool) => void;
  onAddGroup: () => void;
  onAddNote: () => void;
  onClear: () => void;
  spikes: Option[];
  view: ViewMenuProps;
}

export const CanvasToolbar = memo(function CanvasToolbar({ tool, onTool, onAddGroup, onAddNote, onClear, spikes, view }: ToolbarProps) {
  return (
    <div className="toolbar" onPointerDown={(e) => e.stopPropagation()}>
      <Button size="sm" icon={ICON.cursor} active={tool === 'select'} onClick={() => onTool('select')} aria-label="Move" data-tip="Move · drag components around   V">Move</Button>
      <Button size="sm" icon={ICON.link} active={tool === 'connect'} onClick={() => onTool('connect')} aria-label="Connect" data-tip="Connect · click two components to link them   C">Connect</Button>
      <span className="sep" />
      <Button size="sm" icon={ICON.group} onClick={onAddGroup} aria-label="Group" data-tip="Group · add a box (VPC, region…)   G">Group</Button>
      <Button size="sm" icon={ICON.note} onClick={onAddNote} aria-label="Note" data-tip="Note · add a sticky note   N">Note</Button>
      <span className="sep" />
      <SpikeMenu spikes={spikes} />
      <ViewMenu {...view} />
      <span className="sep" />
      <Button size="sm" icon={ICON.trash} onClick={onClear} aria-label="Clear" data-tip="Clear · remove everything from the canvas">Clear</Button>
    </div>
  );
});

/** Close a popup on an outside click or Escape. */
function useDismiss(open: boolean, setOpen: (v: boolean) => void, ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open, setOpen, ref]);
}

/** Readability options: hide shared-infra lines, elbow lines, note icons, layout and groups. */
function ViewMenu({ toggles, actions }: ViewMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, setOpen, ref);
  return (
    <div className="spikemenu" ref={ref}>
      <Button size="sm" className="keep" icon={ICON.view} data-tip={open ? undefined : 'View · make big diagrams readable'} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        View
        <svg className={cx('caret', open && 'up')} width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Button>
      {open && (
        <div className="spikelist viewlist" role="menu" aria-label="View options">
          {toggles.map((t) => (
            <button key={t.key} type="button" role="menuitemcheckbox" aria-checked={t.on} className={cx('spikeopt', 'vopt', t.on && 'on')} title={t.hint} onClick={t.onToggle}>
              <span className={cx('vcheck', t.on && 'on')} aria-hidden="true">{t.on ? '✓' : ''}</span>{t.label}
            </button>
          ))}
          <div className="vsep" />
          {actions.map((x) => (
            <button key={x.key} type="button" role="menuitem" className="spikeopt vopt" disabled={x.disabled} title={x.hint} onClick={() => { x.onSelect(); setOpen(false); }}>
              <span className="vcheck" aria-hidden="true" />{x.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Traffic spike picker: one button that opens a small list. */
function SpikeMenu({ spikes }: { spikes: Option[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = spikes.find((s) => s.active);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  const on = !!current && current.key !== '1';
  return (
    <div className="spikemenu" ref={ref}>
      <Button size="sm" className="keep" icon={ICON.spike} active={on} data-tip={open ? undefined : 'Traffic spike · multiply incoming users   1–5'} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Spike: {current?.label ?? 'Off'}
        <svg className={cx('caret', open && 'up')} width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Button>
      {open && (
        <div className="spikelist" role="listbox" aria-label="Traffic spike">
          {spikes.map((s) => (
            <button key={s.key} type="button" role="option" aria-selected={s.active} className={cx('spikeopt', s.active && 'on')}
              onClick={() => { s.onSelect(); setOpen(false); }}>
              {s.key === '1' ? 'Off (normal traffic)' : `${s.label} traffic`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const ConnectHint = memo(function ConnectHint({ text }: { text: string }) {
  return <div className="connhint">{text}</div>;
});

export const RecordBar = memo(function RecordBar({ name, count, onUndo, onDone }: { name: string; count: number; onUndo: () => void; onDone: () => void }) {
  return (
    <div className="recbar" onPointerDown={(e) => e.stopPropagation()}>
      <span className="recdot" />
      <span>Recording “{name}” · {count} steps · click components in order</span>
      <Button size="sm" onClick={onUndo}>Undo</Button>
      <Button size="sm" variant="primary" onClick={onDone}>Done</Button>
    </div>
  );
});

export const EventsFeed = memo(function EventsFeed({ events }: { events: { key: string; text: string; up: boolean }[] }) {
  return (
    <div className="events">
      {events.map((e) => (
        <div key={e.key} className={cx('ev', e.up ? 'up' : 'down')}>
          <Icon path={e.up ? ICON.up : ICON.down} size={12} stroke={2.4} />
          {e.text}
        </div>
      ))}
    </div>
  );
});

export const EmptyCanvas = memo(function EmptyCanvas() {
  return <div className="empty">Empty canvas.<br />Drag <b>Users</b> in first, then add what serves them.</div>;
});
