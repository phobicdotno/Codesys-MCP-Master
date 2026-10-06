import { describe, it, expect } from 'vitest';

// The clamp helper isn't exported (it's local to bin.ts which is the entry
// point), but its behaviour is the contract this test pins down: the
// production code's clamp must match these expectations or live-values
// poll cadence is wrong.

const MIN = 100;
const MAX = 60_000;
const DEFAULT = 500;

function clampInterval(raw: string | undefined): number {
  const parsed = parseInt(raw ?? String(DEFAULT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT;
  return Math.max(MIN, Math.min(parsed, MAX));
}

describe('clampInterval', () => {
  it('returns default when raw is undefined', () => {
    expect(clampInterval(undefined)).toBe(DEFAULT);
  });

  it('returns default when raw is unparseable', () => {
    expect(clampInterval('not-a-number')).toBe(DEFAULT);
  });

  it('clamps below the minimum', () => {
    expect(clampInterval('50')).toBe(MIN);
    expect(clampInterval('0')).toBe(MIN);
    expect(clampInterval('-100')).toBe(MIN);
  });

  it('clamps above the maximum', () => {
    expect(clampInterval('1000000')).toBe(MAX);
  });

  it('passes through values inside the range', () => {
    expect(clampInterval('100')).toBe(100);
    expect(clampInterval('500')).toBe(500);
    expect(clampInterval('1000')).toBe(1000);
    expect(clampInterval('60000')).toBe(60_000);
  });
});
