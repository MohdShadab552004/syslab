import { Button, Card, Hint, ICON, Icon, LoadBar, OptionGroup, Row, SectionLabel, SelectField, Stepper, Switch, TextField } from '@/components/ui';
import type { NodeInspectorView } from '@/hooks/editor/useInspector';

export function NodeInspector({ v }: { v: NodeInspectorView }) {
  return (
    <>
      <Card>
        <div className="row">
          <span className="kindchip">
            <span className="ptile sm" style={{ background: v.tile }}><Icon path={v.icon} size={13} color="#1f2a37" /></span>
            <SectionLabel>{v.kindName}</SectionLabel>
          </span>
          <span className={v.state.bad ? 'v bad' : 'v'}>{v.state.text}</span>
        </div>
        <TextField label="Name" value={v.name} onValue={v.onRename} />
        <SelectField label="Technology" value={v.tech.value} options={v.tech.options} onValue={v.tech.onChange} />
      </Card>

      {v.needsLB && (
        <Card tone="warn">
          <SectionLabel className="warn-text">Needs a load balancer</SectionLabel>
          <Hint>Traffic goes straight into one server, so extra replicas get nothing. Put a load balancer in front and it will spread requests across every replica.</Hint>
          <Button variant="primary" icon={ICON.lb} onClick={v.needsLB.onAdd}>Add load balancer</Button>
        </Card>
      )}

      {v.cache && (
        <Card>
          <div className="row"><SectionLabel>Cache</SectionLabel><span className={v.cache.state.bad ? 'v bad' : 'v'}>{v.cache.state.text}</span></div>
          <Row label="Hit rate" value={v.cache.hit} />
          <div className="flab">Key TTL</div>
          <OptionGroup options={v.cache.ttl} />
          <Hint>{v.cache.hint}</Hint>
        </Card>
      )}

      {v.queue && (
        <Card>
          <div className="row"><SectionLabel>Backlog</SectionLabel><span className={v.queue.trend.bad ? 'v bad' : 'v'}>{v.queue.trend.text}</span></div>
          <Row label="Waiting" value={v.queue.waiting} />
          <Row label={`Capacity (${v.queue.max})`} value={<span className="kindchip"><LoadBar size={70} width={v.queue.fill.width} color={v.queue.fill.color} />{v.queue.fill.pct}</span>} />
          <Row label="Arriving" value={v.queue.inRate} />
          <Row label="Leaving" value={v.queue.outRate} />
          <Row label="Consumers can take" value={v.queue.drainCap} />
          <Hint>{v.queue.hint}</Hint>
          {v.queue.onPurge && <Button variant="danger" icon={ICON.trash} onClick={v.queue.onPurge}>Purge messages</Button>}
        </Card>
      )}

      {v.lb && (
        <Card>
          <SectionLabel>Balancing algorithm</SectionLabel>
          <OptionGroup layout="grid" options={v.lb.algos} />
          <Hint>{v.lb.hint}</Hint>
          {v.lb.vnodes && (
            <>
              <div className="flab">Virtual nodes per server</div>
              <OptionGroup options={v.lb.vnodes} />
            </>
          )}
        </Card>
      )}

      {v.lb && (
        <Card>
          <div className="row"><SectionLabel>Backends</SectionLabel><span className={v.lb.spread.bad ? 'v bad' : 'v'}>{v.lb.spread.text}</span></div>
          {v.lb.empty ? <Hint>No servers behind this load balancer yet. Connect it to app servers.</Hint> : v.lb.backends.map((b) => (
            <div key={b.key} className={b.down ? 'lbrow down' : 'lbrow'}>
              <span className="lbname">{b.label}</span>
              <span className="lbshare" title={b.rps}>{b.down ? 'health check: skipped' : b.share}</span>
              <span className="kindchip lbload"><LoadBar size={40} width={b.load.width} color={b.load.color} />{b.load.pct}</span>
              {b.weight && <span className="lbweight"><span className="k">Weight</span><Stepper label={`weight of ${b.label}`} {...b.weight} /></span>}
            </div>
          ))}
        </Card>
      )}

      {v.sizes && (
        <Card>
          <SectionLabel>Instance size</SectionLabel>
          <OptionGroup layout="grid" options={v.sizes} />
        </Card>
      )}

      {v.autoscale && (
        <Card>
          <div className="row"><SectionLabel>Autoscaling</SectionLabel><Switch on={v.autoscale.on} onToggle={v.autoscale.onToggle} label="Toggle autoscaling" /></div>
          {v.autoscale.on && (
            <>
              <OptionGroup layout="grid" options={v.autoscale.modes} />
              <Hint>{v.autoscale.hint}</Hint>
              {v.autoscale.horizontal && (
                <>
                  <div className="row"><span className="k">Min replicas</span><Stepper label="minimum replicas" {...v.autoscale.horizontal.min} /></div>
                  <div className="row"><span className="k">Max replicas</span><Stepper label="maximum replicas" {...v.autoscale.horizontal.max} /></div>
                </>
              )}
              {v.autoscale.vertical && (
                <>
                  <div className="row"><span className="k">Smallest</span><Stepper wide label="minimum size" {...v.autoscale.vertical.min} /></div>
                  <div className="row"><span className="k">Largest</span><Stepper wide label="maximum size" {...v.autoscale.vertical.max} /></div>
                </>
              )}
              <div className="flab">Scale when CPU passes</div>
              <OptionGroup options={v.autoscale.targets} />
              <Row label="Now" value={v.autoscale.status} />
            </>
          )}
        </Card>
      )}

      {v.db && (
        <>
          <Card>
            <div className="row"><SectionLabel>Read replicas</SectionLabel><Stepper label="read replicas" {...v.db.replicas} /></div>
            {v.db.syncModes && <OptionGroup layout="grid" options={v.db.syncModes} />}
            <Hint>{v.db.replicaHint}</Hint>
          </Card>
          <Card>
            <div className="row"><SectionLabel>Sharding</SectionLabel><Stepper label="shards" {...v.db.shards} /></div>
            {v.db.sharding && (
              <>
                <TextField small label="Shard key" value={v.db.sharding.key} onValue={v.db.sharding.onKey} placeholder="user_id" />
                <div className="flab">Strategy</div>
                <OptionGroup options={v.db.sharding.strategies} />
              </>
            )}
            <Hint>{v.db.shardHint}</Hint>
          </Card>
          <Card>
            <SectionLabel>Partitioning</SectionLabel>
            <OptionGroup options={v.db.partitions} />
            {v.db.partition && (
              <div className="segs">
                <TextField small label="Partition key" value={v.db.partition.key} onValue={v.db.partition.onKey} placeholder="created_at" />
                <div className="fieldwrap"><div className="flab">Partitions</div><Stepper label="partitions" {...v.db.partition.count} /></div>
              </div>
            )}
            <Hint>{v.db.partitionHint}</Hint>
          </Card>
        </>
      )}

      {v.stats && (
        <Card>
          {v.replicas && <div className="row"><SectionLabel>Replicas</SectionLabel><Stepper label="replicas" {...v.replicas} /></div>}
          <Row label="Incoming" value={v.stats.incoming} />
          <Row label="Capacity" value={v.stats.capacity} />
          <Row label="Load" value={<span className="kindchip"><LoadBar size={70} width={v.stats.load.width} color={v.stats.load.color} />{v.stats.load.pct}</span>} />
          {v.db && <><Row label="Write load (primary)" value={v.db.writeLoad} /><Row label="Read load (each reader)" value={v.db.readLoad} /></>}
          <Row label="Added latency" value={v.stats.latency} />
          <Row label="Cost / month" value={v.stats.cost} />
        </Card>
      )}

      <Card>
        <SectionLabel>Connections</SectionLabel>
        {v.connections.length ? v.connections.map((c) => (
          <div key={c.key} className="conn-row">
            <span>{c.text}</span>
            <Button size="sm" iconOnly icon={ICON.close} onClick={c.onRemove} aria-label="Remove connection" />
          </div>
        )) : <Hint>Not wired yet. Use Connect, then click this node and a target.</Hint>}
      </Card>

      <div className="actions">
        <Button icon={ICON.power} onClick={v.onToggleDown}>{v.downLabel}</Button>
        <Button variant="danger" icon={ICON.trash} onClick={v.onDelete}>Delete</Button>
      </div>
    </>
  );
}
