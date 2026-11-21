import type { DesignDoc, DesignGroup } from '@syslab/types';

/** Size of a collapsed group card, world px. */
export const GROUP_CARD = { w: 260, h: 118 };

export interface GroupMembers { nodes: string[]; notes: string[]; groups: string[] }

/** What sits inside a group's box: node and note anchors inside it, child groups fully inside it. */
export function groupMembers(doc: DesignDoc, g: DesignGroup): GroupMembers {
  const inside = (x: number, y: number) => x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h;
  return {
    nodes: doc.nodes.filter((n) => inside(n.x, n.y)).map((n) => n.id),
    notes: doc.notes.filter((t) => inside(t.x, t.y)).map((t) => t.id),
    groups: doc.groups.filter((o) => o.id !== g.id && inside(o.x, o.y) && inside(o.x + o.w, o.y + o.h)).map((o) => o.id),
  };
}

/**
 * Which items are hidden inside a collapsed group, keyed `node:id` / `note:id` / `group:id`,
 * mapped to the outermost collapsed group that hides them (that group draws the card).
 */
export function collapsedOwners(doc: DesignDoc): Map<string, string> {
  const owners = new Map<string, string>();
  const collapsed = doc.groups.filter((g) => g.collapsed).sort((a, b) => b.w * b.h - a.w * a.h);
  for (const g of collapsed) {
    if (owners.has(`group:${g.id}`)) continue; // already inside a bigger collapsed group
    const m = groupMembers(doc, g);
    m.nodes.forEach((id) => { if (!owners.has(`node:${id}`)) owners.set(`node:${id}`, g.id); });
    m.notes.forEach((id) => { if (!owners.has(`note:${id}`)) owners.set(`note:${id}`, g.id); });
    m.groups.forEach((id) => { if (!owners.has(`group:${id}`)) owners.set(`group:${id}`, g.id); });
  }
  return owners;
}

/** Centre of a collapsed group's card, where its hidden members' connections attach. */
export const cardCenter = (g: DesignGroup) => ({ x: g.x + GROUP_CARD.w / 2, y: g.y + GROUP_CARD.h / 2 });
