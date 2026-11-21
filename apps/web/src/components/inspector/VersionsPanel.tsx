import { Button, Card, Hint, Row } from '@/components/ui';

export interface VersionItemView { id: string; name: string; note: string; when: string; onRestore: () => void }

export function VersionsPanel({ items, saveText, canSave, onSave }: { items: VersionItemView[]; saveText: string; canSave: boolean; onSave: () => void }) {
  return (
    <>
      <Button variant="primary" disabled={!canSave} onClick={onSave}>Save current as new version</Button>
      <Card>
        <Row label="Autosave" value={saveText} />
        {!items.length && <Hint>No versions yet. Save one before a big change, like “v1: single server”, so you can roll back.</Hint>}
        {items.map((v) => (
          <div key={v.id} className="vrow">
            <div><div className="vname">{v.name}</div><div className="vmeta">{v.when} · {v.note}</div></div>
            <Button size="sm" onClick={v.onRestore}>Restore</Button>
          </div>
        ))}
      </Card>
    </>
  );
}
