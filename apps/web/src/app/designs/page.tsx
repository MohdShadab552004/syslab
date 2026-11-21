'use client';

import { useDesignsHome } from '@/hooks/data/useDesignsHome';
import { Brand } from '@/components/editor/Brand';
import { Button, ICON } from '@/components/ui';
import { DesignCard, NewDesignModal, TemplateCard } from '@/components/designs/DesignsViews';

/** “My designs”: wires the home hook into presentational components. */
export default function DesignsPage() {
  const home = useDesignsHome();
  const { newModal } = home;

  return (
    <div className="app">
      <header className="top">
        <div className="left-top">
          <Brand />
          <nav className="tabs" aria-label="Sections">
            <span className="tab">Lessons</span>
            <span className="tab on" aria-current="page">Design Lab</span>
            <span className="tab">Practice</span>
          </nav>
        </div>
        <div className="right-top">
          <Button variant="primary" icon={ICON.plus} onClick={newModal.onOpen}>New design</Button>
        </div>
      </header>

      <main className="home">
        <div className="wrap">
          <div>
            <h1 className="h0">My designs</h1>
            <p className="lead">Sketch an HLD, wire up the request flows, then load-test it.</p>
          </div>

          <section className="section">
            <div className="ph">Start from</div>
            <div className="tgrid">{home.templates.map(({ key, ...t }) => <TemplateCard key={key} {...t} />)}</div>
          </section>

          <section className="section">
            <div className="ph">Your designs · {home.designs.length}</div>
            {home.error && <div className="empty static">Could not reach the API: {home.error.message}</div>}
            {home.isLoading && <div className="empty static">Loading…</div>}
            {!home.isLoading && !home.error && !home.designs.length && <div className="empty static">No designs yet. Start from a template above.</div>}
            <div className="dgrid">{home.designs.map((d) => <DesignCard key={d.id} {...d} />)}</div>
          </section>
        </div>
      </main>

      <NewDesignModal {...newModal} />
    </div>
  );
}
