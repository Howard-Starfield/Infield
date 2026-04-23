/**
 * Browser timer helpers. Auto-lock and OAuth polling are still orchestrated in `main.ts`;
 * this module centralizes `setInterval` / `clearInterval` for consistency and future refactors.
 */

export function startInterval(ms: number, callback: () => void): number {
  return window.setInterval(callback, ms);
}

export function clearIntervalId(id: number | null): void {
  if (id !== null) {
    window.clearInterval(id);
  }
}
