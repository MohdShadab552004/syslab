import { Button, Modal, Switch } from '@/components/ui';

interface Props {
  open: boolean; name: string; enabled: boolean; busy: boolean; link: string; embed: string;
  onClose: () => void; onToggle: () => void; onCopy: () => void;
}

export function ShareModal(p: Props) {
  return (
    <Modal open={p.open} title={`Share “${p.name}”`} onClose={p.onClose}>
      <div className="row">
        <span>
          <span className="title-sm">Anyone with the link can view</span>
          <span className="hint">Viewers can run the simulation and play flows, not edit.</span>
        </span>
        <Switch on={p.enabled} onToggle={p.busy ? () => undefined : p.onToggle} label="Toggle link sharing" />
      </div>
      {p.link ? (
        <>
          <div className="linkbox">
            <input className="field sm" type="text" value={p.link} readOnly aria-label="Share link" />
            <Button variant="primary" onClick={p.onCopy}>Copy link</Button>
          </div>
          <div className="flab">Embed in a README or blog</div>
          <pre className="code">{p.embed}</pre>
        </>
      ) : <p className="hint">Turn on link sharing to get a read-only link.</p>}
    </Modal>
  );
}
