// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Design, DesignDoc } from '@syslab/types';
import { blankDoc, makeEdge, makeNode, simulate } from '@syslab/sim';
import { useEditorStore } from '@/hooks/editor/editor.store';
import { useInspector } from '@/hooks/editor/useInspector';
import { sampleOf, type Sample } from '@/lib/metrics/history';

const N = makeNode, E = makeEdge;
const S = () => useEditorStore.getState();
const A = () => S().actions;
const doc = (): DesignDoc => blankDoc({
  users: 12000,
  nodes: [N('u', 'users', 0, 0, 'Users'), N('a', 'app', 300, 0, 'A'), N('d', 'db', 700, 0, 'DB', { tech: 'Postgres' })],
  edges: [E('ua', 'u', 'a'), E('ad', 'a', 'd')],
});
const design = (d: DesignDoc): Design => ({ id: 'd1', name: 'D', doc: d, revision: 1, shareEnabled: false, shareToken: null, createdAt: '', updatedAt: '' });
const sample = (t: number, over: Partial<Sample> = {}) => ({ ...sampleOf(doc(), simulate(doc()), t), ...over });

beforeEach(() => { act(() => A().load(design(doc()))); });
afterEach(() => { cleanup(); });

describe('history in the store', () => {
  it('records samples, clears them, and a new design starts empty', () => {
    act(() => { A().recordSample(sample(1)); A().recordSample(sample(2)); });
    expect(S().history.map((x) => x.t)).toEqual([1, 2]);
    act(() => A().clearHistory());
    expect(S().history).toEqual([]);
    act(() => A().recordSample(sample(3)));
    act(() => A().load(design(doc())));
    expect(S().history).toEqual([]);
  });
});

describe('inspector: cost detail and trend', () => {
  it('a selected node shows how its price is made and its last two minutes', () => {
    act(() => { for (let t = 0; t < 5; t++) A().recordSample(sample(t * 1000)); });
    act(() => A().select({ type: 'node', id: 'd' }));
    const v = renderHook(() => useInspector()).result.current!;
    if (v.kind !== 'node') throw new Error('expected a node');
    expect(v.node.stats!.costDetail).toBe('RDS 1 × m6i.4xlarge + 500 GB each');
    expect(v.node.stats!.trend!.load).toHaveLength(5);
    expect(v.node.stats!.trend!.latency[0]).toBeGreaterThan(0);
  });

  it('no trend before two samples', () => {
    act(() => A().select({ type: 'node', id: 'a' }));
    const v = renderHook(() => useInspector()).result.current!;
    if (v.kind !== 'node') throw new Error('expected a node');
    expect(v.node.stats!.trend).toBeNull();
    expect(v.node.stats!.costDetail).toBe('EC2 1 × m6i.4xlarge');
  });
});

describe('requirements: sizes used for the cost', () => {
  it('shows the defaults and saves edits (with sane minimums)', () => {
    const r = () => { const v = renderHook(() => useInspector()).result.current!; if (v.kind !== 'none') throw new Error('expected none'); return v.requirements; };
    expect([r().respKb, r().assetKb, r().storageGb]).toEqual([10, 100, 500]);
    // take the callbacks outside act(); each one patches the current requirements when called
    const first = r();
    act(() => first.onRespKb(4));
    act(() => first.onAssetKb(250));
    act(() => first.onStorageGb(2000));
    expect(S().doc!.requirements).toMatchObject({ respKb: 4, assetKb: 250, storageGb: 2000 });
    expect([r().respKb, r().assetKb, r().storageGb]).toEqual([4, 250, 2000]);
    // an empty field falls back to the default instead of 0
    const again = r();
    act(() => { again.onRespKb(0); again.onAssetKb(Number.NaN); again.onStorageGb(0); });
    expect(S().doc!.requirements).toMatchObject({ respKb: 10, assetKb: 100, storageGb: 500 });
    const last = r();
    act(() => last.onRespKb(-3));
    expect(S().doc!.requirements.respKb).toBe(0.1);
  });
});
