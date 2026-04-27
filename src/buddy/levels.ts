// src/buddy/levels.ts
// Pure helpers — match the Rust implementation in managers/buddy.rs

export function xpToNext(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.4));
}

export function levelFromXp(xp: number): number {
  let cumulative = 0;
  for (let level = 1; level <= 10_000; level++) {
    const needed = xpToNext(level);
    if (cumulative + needed > xp) return level;
    cumulative += needed;
  }
  return 10_000;
}

export function statMultiplier(level: number): number {
  return Math.log2(level + 1);
}
