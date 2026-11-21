import Link from 'next/link';
import { memo } from 'react';
import { Button, ICON, Modal, OptionGroup, TextField, type Option } from '@/components/ui';
import { MiniCube } from '@/components/iso/IsoShape';
import type { CubeColors } from '@/hooks/data/useDesignsHome';

export const TemplateCard = memo(function TemplateCard({ name, desc, cubes, onSelect }: { name: string; desc: string; cubes: CubeColors[]; onSelect: () => void }) {
  return (
    <button type="button" className="tcard" onClick={onSelect}>
      <span className="tprev">{cubes.map((c, i) => <MiniCube key={i} {...c} size={34} />)}</span>
      <span className="tname">{name}</span>
      <span className="tdesc">{desc}</span>
    </button>
  );
});

interface DesignCardProps { name: string; isLesson: boolean; meta: string; cubes: CubeColors[]; href: string; onDuplicate: () => void; onDelete: () => void }

export const DesignCard = memo(function DesignCard(p: DesignCardProps) {
  return (
    <article className="dcard">
      <Link className="dprev" href={p.href} aria-label={`Open ${p.name}`}>{p.cubes.map((c, i) => <MiniCube key={i} {...c} />)}</Link>
      <div className="dbody">
        <div>
          <div className="dname">{p.name}{p.isLesson && <span className="tag">Lesson</span>}</div>
          <div className="dmeta">{p.meta}</div>
        </div>
        <div className="dact">
          <Link className="btn btn-sm btn-primary" href={p.href}>Open</Link>
          <Button size="sm" onClick={p.onDuplicate}>Duplicate</Button>
          <Button size="sm" iconOnly variant="danger" icon={ICON.trash} onClick={p.onDelete} aria-label="Delete design" className="push-right" />
        </div>
      </div>
    </article>
  );
});

interface NewDesignModalProps {
  open: boolean; name: string; placeholder: string; options: Option[]; creating: boolean;
  onName: (v: string) => void; onClose: () => void; onCreate: () => void;
}

export function NewDesignModal(p: NewDesignModalProps) {
  return (
    <Modal open={p.open} title="New design" onClose={p.onClose}
      footer={<><Button onClick={p.onClose}>Cancel</Button><Button variant="primary" disabled={p.creating} onClick={p.onCreate}>{p.creating ? 'Creating…' : 'Create design'}</Button></>}>
      <TextField label="Name" value={p.name} onValue={p.onName} placeholder={p.placeholder} autoFocus />
      <div className="flab">Start from</div>
      <OptionGroup layout="grid" options={p.options} />
    </Modal>
  );
}
