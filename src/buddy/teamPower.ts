// src/buddy/teamPower.ts
import type { BuddyUnlock, GearItem } from './types';

export const BASE_STATS: Record<string, [number, number, number]> = {
  'scout-wings':   [10, 10, 10],
  'hover-wings':   [8, 14, 8],
  'glide-wings':   [14, 8, 8],
  'lookout-wings': [8, 8, 14],
  'sleepy-wings':  [10, 12, 8],
  'patrol-wings':  [12, 12, 6],
};

export function computeTeamPower(roster: BuddyUnlock[], inv: GearItem[]): number {
  let total = 0;
  for (const b of roster) {
    const [p, s, c] = BASE_STATS[b.buddy_id] ?? [10, 10, 10];
    total += (p + s + c) * Math.log2(b.level + 1);
    for (const id of [b.equipped_hat_id, b.equipped_aura_id, b.equipped_charm_id]) {
      if (id == null) continue;
      const g = inv.find(g => g.gear_id === id);
      if (g) total += g.power_bonus + g.speed_bonus + g.charm_bonus;
    }
  }
  return total;
}

export function lootBonusPct(teamPower: number): number {
  return Math.min(30, Math.max(0, Math.floor(Math.log10(teamPower + 1) * 8)));
}
