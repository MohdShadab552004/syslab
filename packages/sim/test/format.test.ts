import { describe, expect, test } from 'vitest';
import { S } from './helpers';

describe('fmtInt / fmtMoney', () => {
  test('rounds and adds thousands separators', () => {
    expect(S.fmtInt(1234.6)).toBe('1,235');
    expect(S.fmtInt(0.4)).toBe('0');
    expect(S.fmtInt(1_000_000)).toBe('1,000,000');
  });

  test('money is a dollar sign and a whole number', () => {
    expect(S.fmtMoney(1234.4)).toBe('$1,234');
    expect(S.fmtMoney(0)).toBe('$0');
  });
});

describe('fmtCompact', () => {
  test('millions: one decimal below 10M, none from 10M', () => {
    expect(S.fmtCompact(2_500_000)).toBe('2.5M');
    expect(S.fmtCompact(1_000_000)).toBe('1.0M');
    expect(S.fmtCompact(15_000_000)).toBe('15M');
  });

  test('thousands: one decimal below 10k, none from 10k', () => {
    expect(S.fmtCompact(1500)).toBe('1.5k');
    expect(S.fmtCompact(1000)).toBe('1.0k');
    expect(S.fmtCompact(12_345)).toBe('12k');
    expect(S.fmtCompact(999_499)).toBe('999k');
  });

  test('small numbers are rounded integers', () => {
    expect(S.fmtCompact(42.4)).toBe('42');
    expect(S.fmtCompact(999)).toBe('999');
    expect(S.fmtCompact(0)).toBe('0');
  });
});

describe('fmtMs / fmtPct', () => {
  test('milliseconds below one second, seconds from one second', () => {
    expect(S.fmtMs(12.4)).toBe('12 ms');
    expect(S.fmtMs(999)).toBe('999 ms');
    expect(S.fmtMs(1000)).toBe('1.0 s');
    expect(S.fmtMs(1540)).toBe('1.5 s');
  });

  test('percent of a ratio', () => {
    expect(S.fmtPct(0.123)).toBe('12%');
    expect(S.fmtPct(1)).toBe('100%');
    expect(S.fmtPct(0)).toBe('0%');
  });
});

describe('timeAgo', () => {
  const now = Date.UTC(2026, 0, 10, 12, 0, 0);

  test('under a minute is "just now", including times in the future', () => {
    expect(S.timeAgo(now - 30_000, now)).toBe('just now');
    expect(S.timeAgo(now + 3_600_000, now)).toBe('just now');
  });

  test('minutes, hours and days', () => {
    expect(S.timeAgo(now - 60_000, now)).toBe('1 min ago');
    expect(S.timeAgo(now - 59 * 60_000, now)).toBe('59 min ago');
    expect(S.timeAgo(now - 2 * 3_600_000, now)).toBe('2 h ago');
    expect(S.timeAgo(now - 23.9 * 3_600_000, now)).toBe('23 h ago');
    expect(S.timeAgo(now - 3 * 86_400_000, now)).toBe('3 d ago');
  });

  test('accepts ISO strings and defaults to the current time', () => {
    expect(S.timeAgo(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 min ago');
    expect(S.timeAgo(new Date().toISOString())).toBe('just now');
  });
});
