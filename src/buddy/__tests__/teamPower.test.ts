// src/buddy/__tests__/teamPower.test.ts
import { describe, it, expect } from 'vitest';
import { computeTeamPower, lootBonusPct, BASE_STATS } from '../teamPower';
import type { BuddyUnlock, GearItem } from '../types';

const scoutLvl1: BuddyUnlock = {
  buddy_id: 'scout-wings', unlocked_at_ms: 0, xp_total: 0, level: 1, shiny: false,
  equipped_hat_id: null, equipped_aura_id: null, equipped_charm_id: null,
};

describe('computeTeamPower', () => {
  it('handles a level-1 scout with no gear', () => {
    // (10+10+10) × log2(2) = 30
    expect(computeTeamPower([scoutLvl1], [])).toBeCloseTo(30, 1);
  });

  it('adds equipped gear stats', () => {
    const gear: GearItem = {
      gear_id: 'g1', slot: 'hat', species: 'top-hat', rarity: 'rare', shiny: false,
      power_bonus: 5, speed_bonus: 5, charm_bonus: 5, acquired_at_ms: 0,
    };
    const eq = { ...scoutLvl1, equipped_hat_id: 'g1' };
    expect(computeTeamPower([eq], [gear])).toBeCloseTo(30 + 15, 1);
  });
});

describe('lootBonusPct', () => {
  it('clamps to 0 at teamPower=0', () => {
    expect(lootBonusPct(0)).toBe(0);
  });
  // NOTE: divergence flagged — plan test said lootBonusPct(1) ≈ 0, but
  // the Rust formula ((tp+1).log10() * 8).floor().clamp(0,30) gives 2 at tp=1.
  // Corrected to match the Rust implementation which is authoritative.
  it('returns 2 at teamPower=1 (matches Rust formula)', () => {
    expect(lootBonusPct(1)).toBe(2);
  });
  it('caps at 30 for very large team power', () => {
    expect(lootBonusPct(1_000_000)).toBe(30);
  });
});
