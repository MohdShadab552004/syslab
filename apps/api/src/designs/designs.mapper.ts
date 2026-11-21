import type { Design, DesignDoc, DesignSummary } from '@syslab/types';
import type { DocSummary } from '@syslab/sim';
import type { DesignRecord, DesignSummaryRecord } from './designs.repository';

export const toDesign = (r: DesignRecord): Design => ({
  id: r.id,
  name: r.name,
  doc: r.doc as unknown as DesignDoc,
  revision: r.revision,
  shareEnabled: r.shareEnabled,
  shareToken: r.shareToken,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export const toSummary = (r: DesignSummaryRecord): DesignSummary => {
  const s = r.summary as unknown as DocSummary;
  return {
    id: r.id,
    name: r.name,
    isLesson: !!s.isLesson,
    nodeCount: s.nodeCount ?? 0,
    flowCount: s.flowCount ?? 0,
    previewKinds: s.previewKinds ?? [],
    updatedAt: r.updatedAt.toISOString(),
  };
};
