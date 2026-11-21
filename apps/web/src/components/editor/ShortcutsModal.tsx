import { memo } from 'react';
import { Modal } from '@/components/ui';
import { SHORTCUT_GROUPS } from '@/lib/editor/shortcuts';

/** Help panel listing every keyboard shortcut. Opened from the "?" button or the ? key. */
export const ShortcutsModal = memo(function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="Keyboard shortcuts" onClose={onClose}>
      <div className="kbdgrid">
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.title} className="kbdgroup">
            <h3 className="ph">{g.title}</h3>
            {g.rows.map((r) => (
              <div key={r.label + r.keys.join()} className="kbdrow">
                <span>{r.label}</span>
                <span className="kbdkeys">
                  {r.keys.map((k, i) => (
                    <span key={k} className="kbdpair">{i > 0 && (r.sep === ' ' ? null : <i>+</i>)}<kbd>{k}</kbd></span>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
      <p className="kbdnote">Shortcuts pause while you type in a field or note. Press <kbd>?</kbd> anytime to open this list.</p>
    </Modal>
  );
});
