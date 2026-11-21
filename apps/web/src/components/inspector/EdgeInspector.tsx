import { Button, Card, Hint, ICON, OptionGroup, Row, SectionLabel, SelectField, Stepper, TextField } from '@/components/ui';
import type { EdgeInspectorView } from '@/hooks/editor/useInspector';

export function EdgeInspector({ v }: { v: EdgeInspectorView }) {
  return (
    <>
      <Card>
        <SectionLabel>Connection</SectionLabel>
        <div className="title-sm">{v.title}</div>
        <div className="segs">
          <SelectField label="From" value={v.ends.from.value} options={v.ends.from.options} onValue={v.ends.from.onChange} />
          <SelectField label="To" value={v.ends.to.value} options={v.ends.to.options} onValue={v.ends.to.onChange} />
        </div>
        <Hint>Or drag the round handles at either end of the line onto another component.</Hint>
        <div className="flab">Call type</div>
        <OptionGroup options={v.modes} />
        <div className="flab">Protocol</div>
        <OptionGroup options={v.protocols} />
        <div className="flab">Carries</div>
        <OptionGroup options={v.ops} />
        {v.route && <TextField small label="Route (gateway path)" value={v.route.value} onValue={v.route.onChange} placeholder="/orders/*" />}
      </Card>
      <Card>
        <div className="row"><SectionLabel>Traffic weight</SectionLabel><Stepper label="traffic weight" {...v.weight} /></div>
        {v.weightNote && <Hint>{v.weightNote}</Hint>}
        <Row label="Share" value={v.share} />
        <Row label="Carrying" value={v.rps} />
        <Row label="In the P95 path" value={v.onSlowPath} />
      </Card>
      <div className="actions">
        <Button icon={ICON.reverse} onClick={v.onReverse}>Reverse</Button>
        <Button variant="danger" onClick={v.onDelete}>Delete</Button>
      </div>
    </>
  );
}
