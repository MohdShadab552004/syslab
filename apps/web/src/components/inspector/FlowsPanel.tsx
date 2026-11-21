import { Button, Card, Hint, ICON } from '@/components/ui';

export interface FlowItemView {
  id: string; name: string; steps: string; active: boolean; recording: boolean;
  onRename: (v: string) => void; onPlay: () => void; onRerecord: () => void; onDelete: () => void;
}

export function FlowsPanel({ items, onNew }: { items: FlowItemView[]; onNew: () => void }) {
  return (
    <>
      <Button variant="primary" icon={ICON.plus} onClick={onNew}>New request flow</Button>
      {!items.length && <Card><Hint>A flow is one request’s path, like “Checkout” or “Login”. Hit New, click the components in order, then Play it from the bar below.</Hint></Card>}
      {items.map((f) => (
        <Card key={f.id} tone={f.active ? 'active' : undefined}>
          <input className="field sm" type="text" value={f.name} onChange={(e) => f.onRename(e.target.value)} aria-label="Flow name" />
          <div className="steps-text">{f.steps}</div>
          <div className="chips">
            <Button size="sm" variant="primary" icon={ICON.play} iconFill onClick={f.onPlay}>Play</Button>
            <Button size="sm" active={f.recording} onClick={f.onRerecord}>Re-record</Button>
            <Button size="sm" iconOnly variant="danger" icon={ICON.trash} onClick={f.onDelete} aria-label="Delete flow" className="push-right" />
          </div>
        </Card>
      ))}
    </>
  );
}
