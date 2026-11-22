import { expect } from 'vitest';
import type { DesignDoc } from '@syslab/types';
import { SpecError, buildDesign } from '../src/build';
import type { DesignSpecInput } from '../src/schema';

type Comp = DesignSpecInput['components'][number];

/** Shorthand for a component: c('API', 'app', { replicas: 2 }). */
export const c = (name: string, kind: Comp['kind'], extra: Partial<Comp> = {}): Comp => ({ name, kind, ...extra });

/** A spec with defaults filled in for the boring fields. */
export const spec = (patch: Partial<DesignSpecInput>): DesignSpecInput => ({ name: 'Test', components: [c('Users', 'users')], ...patch });

/** Build and return the node with this label. */
export const nodeOf = (doc: DesignDoc, label: string) => {
  const n = doc.nodes.find((x) => x.label === label);
  if (!n) throw new Error(`no node ${label}`);
  return n;
};

/** Run buildDesign, expect it to throw a SpecError, and return its issues. */
export function issuesOf(input: unknown) {
  try {
    buildDesign(input);
  } catch (e) {
    expect(e).toBeInstanceOf(SpecError);
    return (e as SpecError).issues;
  }
  throw new Error('buildDesign did not throw');
}

/** Rectangle a placed node occupies (anchor plus its extents). */
export interface Rect { l: number; t: number; r: number; b: number }
export const overlaps = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
