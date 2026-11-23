import { fmtMoney, type CostBreakdown, type CostCategory } from '@syslab/sim';

const CATEGORY_LABEL: Record<CostCategory, string> = {
  compute: 'Compute (EC2)', database: 'Databases', cache: 'Caches', messaging: 'Messaging', storage: 'Object storage',
  network: 'Load balancing, gateway and data transfer', cdn: 'CDN', 'third-party': 'Third-party services',
};

export interface CostView {
  total: string;
  source: string;
  categories: { key: CostCategory; label: string; amount: string; pct: number }[];
  items: { key: string; label: string; detail: string; amount: string }[];
  savings: { key: string; text: string; amount: string }[];
  /** the biggest single saving, formatted */
  bestSaving: string | null;
}

/** The cost section of the metrics panel: totals, where the money goes, how to spend less. */
export function buildCostView(b: CostBreakdown, topN = 8): CostView {
  return {
    total: `${fmtMoney(b.total)}/month`,
    source: b.source,
    categories: b.byCategory.map((c) => ({ key: c.category, label: CATEGORY_LABEL[c.category], amount: fmtMoney(c.monthly), pct: b.total > 0 ? Math.round((c.monthly / b.total) * 100) : 0 })),
    items: b.items.filter((i) => i.monthly > 0).slice(0, topN).map((i) => ({ key: i.id, label: i.label, detail: i.detail, amount: fmtMoney(i.monthly) })),
    savings: b.savings.slice(0, 6).map((s) => ({ key: s.key, text: s.text, amount: `−${fmtMoney(s.monthly)}/mo` })),
    bestSaving: b.savings.length ? fmtMoney(b.savings[0].monthly) : null,
  };
}
