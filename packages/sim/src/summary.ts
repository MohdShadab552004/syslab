import type { DesignDoc, NodeKind } from '@syslab/types';

/** Small denormalised summary stored next to the doc so list views never load the doc. */
export interface DocSummary {
  nodeCount: number;
  flowCount: number;
  previewKinds: NodeKind[];
  isLesson: boolean;
}

export function summarize(doc: DesignDoc): DocSummary {
  const kinds: NodeKind[] = [];
  for (const n of doc.nodes) if (n.kind !== 'users' && !kinds.includes(n.kind)) kinds.push(n.kind);
  return {
    nodeCount: doc.nodes.length,
    flowCount: doc.flows.length,
    previewKinds: (kinds.length ? kinds : (['users'] as NodeKind[])).slice(0, 4),
    isLesson: !!doc.lesson,
  };
}
