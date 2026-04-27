// src/buddy/__tests__/levels.test.ts
import { describe, it, expect } from 'vitest';
import { xpToNext, levelFromXp, statMultiplier } from '../levels';

describe('xpToNext', () => {
  it('returns 100 for level 1', () => {
    expect(xpToNext(1)).toBe(100);
  });
  it('grows with level^1.4', () => {
    expect(xpToNext(10)).toBe(Math.floor(100 * Math.pow(10, 1.4)));
  });
});

describe('levelFromXp', () => {
  it('returns 1 for 0 xp', () => {
    expect(levelFromXp(0)).toBe(1);
  });
  it('crosses to level 2 at 100 xp', () => {
    expect(levelFromXp(99)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
  });
  it('matches expected trajectory', () => {
    // Cumulative for L=10 ≈ 12,800 xp
    expect(levelFromXp(12_800)).toBeGreaterThanOrEqual(10);
    expect(levelFromXp(12_800)).toBeLessThanOrEqual(11);
  });
});

describe('statMultiplier', () => {
  it('returns 1.0 at level 1', () => {
    expect(statMultiplier(1)).toBeCloseTo(1.0, 2);
  });
  it('returns ~3.46 at level 10', () => {
    expect(statMultiplier(10)).toBeCloseTo(Math.log2(11), 2);
  });
});
