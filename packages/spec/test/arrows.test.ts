import { describe, expect, test } from 'vitest';
import { buildDesign } from '../src/build';
import { docToSpec } from '../src/readback';
import { c, spec } from './helpers';

const two = (conn: Record<string, unknown>) => buildDesign(spec({
  components: [c('Users', 'users'), c('API', 'app'), c('DB', 'db')],
  connections: [{ from: 'Users', to: 'API' }, { from: 'API', to: 'DB', ...conn }],
}));
const edge = (r: ReturnType<typeof two>) => r.doc.edges.find((e) => e.to === r.doc.nodes.find((n) => n.label === 'DB')!.id)!;
const back = (r: ReturnType<typeof two>) => docToSpec('x', r.doc).connections!.find((k) => k.to === 'DB')!;

describe('line ends in the spec', () => {
  test('arrowStart / arrowEnd map to the edge and read back', () => {
    const r = two({ arrowStart: 'circle', arrowEnd: 'diamond' });
    expect(edge(r)).toMatchObject({ tail: 'circle', head: 'diamond' });
    expect(back(r)).toMatchObject({ arrowStart: 'circle', arrowEnd: 'diamond' });
  });

  test('defaults are not stored or written back', () => {
    const r = two({ arrowStart: 'none', arrowEnd: 'triangle' });
    expect(edge(r).head).toBeUndefined();
    expect(edge(r).tail).toBeUndefined();
    expect(back(r)).not.toHaveProperty('arrowStart');
    expect(back(r)).not.toHaveProperty('arrowEnd');
  });

  test('unknown ends are rejected', () => {
    expect(() => two({ arrowEnd: 'star' })).toThrow();
  });
});
