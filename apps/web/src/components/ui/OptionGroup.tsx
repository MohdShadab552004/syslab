import { Button } from './Button';

export interface Option { key: string; label: string; sub?: string; active: boolean; onSelect: () => void }

/** A row of toggle buttons, or a two-column grid when options carry a sub-label. */
export function OptionGroup({ options, layout = 'chips' }: { options: Option[]; layout?: 'chips' | 'grid' }) {
  if (layout === 'grid') {
    return (
      <div className="segs">
        {options.map((o) => (
          <Button key={o.key} className="seg" active={o.active} onClick={o.onSelect}>
            {o.label}
            {o.sub && <small>{o.sub}</small>}
          </Button>
        ))}
      </div>
    );
  }
  return (
    <div className="chips">
      {options.map((o) => <Button key={o.key} size="sm" active={o.active} onClick={o.onSelect}>{o.label}</Button>)}
    </div>
  );
}
