import { cx } from '@/lib/utils/cx';
import { Button, Card, Hint, NumberField, OptionGroup, RangeField, Row, SectionLabel, TextField } from '@/components/ui';
import type { GroupInspectorView, MultiInspectorView, RequirementsView, TrafficView } from '@/hooks/editor/useInspector';

export function GroupInspector({ v }: { v: GroupInspectorView }) {
  return (
    <>
      <Card>
        <SectionLabel>Group</SectionLabel>
        <TextField label="Label" value={v.label} onValue={v.onRename} />
        <div className="flab">Colour</div>
        <div className="chips">
          {v.colors.map((c) => <button key={c.key} type="button" className={cx('swatch', c.active && 'on')} style={{ background: c.swatch }} onClick={c.onSelect} aria-label={c.name} />)}
        </div>
        <Row label="Inside" value={v.contents} />
        <Hint>Use groups for a VPC, region, Docker host or team boundary. Drag the label to move it with everything inside, the corner to resize. Collapse it to fold the whole group into one card; it keeps simulating.</Hint>
      </Card>
      <div className="actions">
        <Button onClick={v.onToggleCollapse}>{v.collapsed ? 'Expand group' : 'Collapse group'}</Button>
        <Button variant="danger" onClick={v.onDelete}>Delete group</Button>
      </div>
    </>
  );
}

export function MultiInspector({ v }: { v: MultiInspectorView }) {
  return (
    <>
      <Card>
        <SectionLabel>{v.title}</SectionLabel>
        <Row label="Contains" value={v.parts} />
        <Row label="Connections between them" value={String(v.links)} />
        <Hint>Drag any selected item to move them all. Copy or duplicate keeps the connections between them. Shift+click adds or removes one item.</Hint>
      </Card>
      <div className="actions">
        <Button onClick={v.onCopy}>Copy</Button>
        <Button onClick={v.onDuplicate}>Duplicate</Button>
        <Button variant="danger" onClick={v.onDelete}>Delete</Button>
      </div>
    </>
  );
}

export function NoteInspector({ onDelete }: { onDelete: () => void }) {
  return (
    <>
      <Card><SectionLabel>Note</SectionLabel><Hint>Type straight on the sticky. Notes are good for “why this choice?” and known bottlenecks.</Hint></Card>
      <Button variant="danger" onClick={onDelete}>Delete note</Button>
    </>
  );
}

interface Summary { usersText: string; rpsText: string; costText: string; bottleneck: { text: string; bad: boolean }; nodeCount: number; edgeCount: number }

export function RequirementsCard({ r, s }: { r: RequirementsView; s: Summary }) {
  return (
    <Card>
      <SectionLabel>Requirements</SectionLabel>
      <TextField small label="What are you building?" value={r.goal} onValue={r.onGoal} placeholder="e.g. Shorten links, redirect in <100 ms" />
      <NumberField small label="Daily active users" min={0} step={1000} value={r.dau} onValue={r.onDau} />
      <div className="flab">Peak online at once</div>
      <OptionGroup options={r.peaks} />
      <RangeField label="Reads vs writes" aside={r.readText} min={0} max={100} step={5} value={r.read} onValue={r.onRead} />
      <div className="segs">
        <NumberField small label="P95 target (ms)" min={10} step={10} value={r.slo} onValue={r.onSlo} />
        <TextField small label="Data size" value={r.dataNote} onValue={r.onDataNote} placeholder="e.g. 2 TB / yr" />
      </div>
      <Row label="Peak users" value={s.usersText} />
      <Row label="Requests / sec" value={s.rpsText} />
      <Row label="Bottleneck" value={s.bottleneck.text} bad={s.bottleneck.bad} />
    </Card>
  );
}

export function TrafficCard({ t, s }: { t: TrafficView; s: Summary }) {
  return (
    <Card>
      <RangeField label="Traffic" aside={s.usersText} min={0} max={80} step={1} value={t.slider} onValue={t.onSlider} />
      <OptionGroup options={t.presets} />
      <Row label="Requests / sec" value={s.rpsText} />
      <Row label="Bottleneck" value={s.bottleneck.text} bad={s.bottleneck.bad} />
    </Card>
  );
}

export function HowToCard() {
  return (
    <Card>
      <SectionLabel>How to build</SectionLabel>
      <ul className="tips">
        <li>Fill in requirements, they set the traffic.</li>
        <li>Drag components in and name them.</li>
        <li>Connect, then click a link label to set sync / async and protocol.</li>
        <li>Record a request flow in the Flows tab.</li>
        <li>Run, spike traffic, take nodes offline.</li>
      </ul>
    </Card>
  );
}

export function SummaryCard({ s }: { s: Summary }) {
  return (
    <Card>
      <Row label="Components" value={s.nodeCount} />
      <Row label="Connections" value={s.edgeCount} />
      <Row label="Est. cost / month" value={s.costText} />
    </Card>
  );
}
