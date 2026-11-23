import { describe, expect, it } from 'vitest';
import { loadMinimal, saveMinimal } from '@/lib/editor/chromePrefs';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
};

describe('minimize UI preference', () => {
  it('round-trips through storage and defaults to off', () => {
    const s = mem();
    expect(loadMinimal(s)).toBe(false);
    saveMinimal(true, s);
    expect(loadMinimal(s)).toBe(true);
    saveMinimal(false, s);
    expect(loadMinimal(s)).toBe(false);
  });

  it('survives storage that is missing or throws', () => {
    expect(loadMinimal(undefined)).toBe(false);
    expect(loadMinimal({ getItem: () => { throw new Error('blocked'); } })).toBe(false);
    expect(() => saveMinimal(true, { setItem: () => { throw new Error('blocked'); } })).not.toThrow();
    expect(() => saveMinimal(true, undefined)).not.toThrow();
  });
});
