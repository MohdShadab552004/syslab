import { Button, Card, Hint, ICON, OptionGroup, Row, SectionLabel, SelectField, Stepper, Switch, TextField } from '@/components/ui';
import type { ArrowPickView, EdgeInspectorView } from '@/hooks/editor/useInspector';
import { ArrowShape } from '@/components/canvas/ArrowShape';

/** A row of line-end previews, like Figma's start / end point menus. */
function ArrowPicker({ label, items, flip }: { label: string; items: ArrowPickView[]; flip?: boolean }) {
  return (
    <div className="arrowpick" role="radiogroup" aria-label={label}>
      {items.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={o.active} aria-label={o.label} title={o.label} className={o.active ? 'apick on' : 'apick'} onClick={o.onSelect}>
          <svg viewBox="-2 -8 34 16" width="34" height="16" aria-hidden="true">
            <line x1="0" y1="0" x2="30" y2="0" />
            <g transform={flip ? 'translate(0 0) rotate(180)' : 'translate(30 0)'}><ArrowShape kind={o.key} /></g>
          </svg>
        </button>
      ))}
    </div>
  );
}

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
        {v.calls && (
          <>
            <div className="flab">Calls per request</div>
            <OptionGroup options={v.calls} />
            <Hint>Split: the caller&apos;s traffic is shared between its connections. 1×, 2×…: every request makes that many calls here (fan-out), so this target gets all of it.</Hint>
          </>
        )}
        <Row label="Share" value={v.share} />
        <Row label="Carrying" value={v.rps} />
        <Row label="In the P95 path" value={v.onSlowPath} />
      </Card>
      {v.resilience && (
        <Card>
          <div className="row"><SectionLabel>Failure handling</SectionLabel><span className={v.resilience.bad ? 'v bad' : 'v'}>{v.resilience.state}</span></div>
          <div className="flab">Retries</div>
          <OptionGroup options={v.resilience.retries} />
          <div className="row"><span className="k">Circuit breaker</span><Switch on={v.resilience.breaker.on} onToggle={v.resilience.breaker.onToggle} label="Toggle circuit breaker" /></div>
          <Hint>{v.resilience.hint}</Hint>
        </Card>
      )}
      <Card>
        <div className="row"><SectionLabel>Line ends</SectionLabel><Button size="sm" icon={ICON.reverse} onClick={v.arrows.onSwap} title="Swap the two ends (traffic direction stays)">Swap</Button></div>
        <div className="flab">Start</div>
        <ArrowPicker label="Start of the line" items={v.arrows.start} flip />
        <div className="flab">End</div>
        <ArrowPicker label="End of the line" items={v.arrows.end} />
      </Card>
      <div className="actions">
        <Button icon={ICON.reverse} onClick={v.onReverse}>Reverse</Button>
        <Button variant="danger" onClick={v.onDelete}>Delete</Button>
      </div>
    </>
  );
}
