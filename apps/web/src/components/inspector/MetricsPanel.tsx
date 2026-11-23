import { Button, Card, Hint, Row, SectionLabel } from '@/components/ui';
import type { MetricsPanelView } from '@/hooks/editor/useMetricsPanel';
import { Spark } from './Spark';

/** Graphs of the running simulation and the monthly bill with ways to cut it. */
export function MetricsPanel({ v }: { v: MetricsPanelView }) {
  return (
    <>
      <Card>
        <div className="row"><SectionLabel>Over time</SectionLabel><span className="v">{v.span || 'collecting…'}</span></div>
        {v.charts.length === 0 || v.empty
          ? <Hint>Graphs fill in while the simulation runs: one point per second, the last 5 minutes. Change traffic, take a node offline or spike it and watch what happens.</Hint>
          : v.charts.map((c) => (
            <Spark key={c.key} label={c.title} points={c.points} secondary={c.secondary} max={c.max} threshold={c.threshold?.value ?? null}
              thresholdLabel={c.threshold?.label} marks={c.marks} value={c.value} maxText={c.maxText} bad={c.bad} span={v.span} />
          ))}
        {v.marksHint && <Hint>{v.marksHint}</Hint>}
        {!v.empty && <Button size="sm" onClick={v.onClear}>Clear graphs</Button>}
      </Card>

      <Card>
        <div className="row"><SectionLabel>Cost</SectionLabel><span className="v">{v.cost.total}</span></div>
        <Hint>{v.cost.source}. Usage-based services (CDN, requests, data transfer) follow the live traffic and the sizes in Requirements.</Hint>
        {v.cost.categories.map((c) => (
          <div key={c.key} className="costbar">
            <div className="row"><span className="k">{c.label}</span><span className="v">{c.amount}</span></div>
            <div className="cbtrack"><div className="cbfill" style={{ width: `${Math.max(2, c.pct)}%` }} /></div>
          </div>
        ))}
      </Card>

      <Card>
        <SectionLabel>Biggest line items</SectionLabel>
        {v.cost.items.map((i) => (
          <div key={i.key} className="costitem">
            <Row label={i.label} value={i.amount} />
            <div className="cidetail">{i.detail}</div>
          </div>
        ))}
      </Card>

      {v.cost.savings.length > 0 && (
        <Card>
          <div className="row"><SectionLabel>Ways to save</SectionLabel><span className="v good">up to {v.cost.bestSaving}/mo</span></div>
          {v.cost.savings.map((s) => (
            <div key={s.key} className="saving">
              <span>{s.text}</span>
              <span className="samt">{s.amount}</span>
            </div>
          ))}
          <Hint>Each option is estimated on its own; they overlap, so don&apos;t add them up.</Hint>
        </Card>
      )}
    </>
  );
}
