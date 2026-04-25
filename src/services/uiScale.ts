const MIN_UI_SCALE = 0.5
const MAX_UI_SCALE = 1.5
const DEFAULT_UI_SCALE = 1.0

export const UI_SCALE_STORAGE_KEY = 'ui-scale'
export const UI_SCALE_BASELINE_VERSION_KEY = 'ui-scale-density-baseline-version'
export const UI_DENSITY_BASELINE = 0.9
export const UI_SCALE_BASELINE_VERSION = 'density-0.9-v1'

function roundScale(value: number): number {
  return Number(value.toFixed(4))
}

export function clampUiScale(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? parseFloat(value)
        : Number.NaN
  const scale = Number.isFinite(parsed) ? parsed : DEFAULT_UI_SCALE
  return Math.max(MIN_UI_SCALE, Math.min(MAX_UI_SCALE, scale))
}

export function effectiveUiScale(logicalScale: unknown): number {
  return roundScale(clampUiScale(logicalScale) * UI_DENSITY_BASELINE)
}

export function readStoredLogicalUiScale(storage: Storage = localStorage): number {
  try {
    const raw = storage.getItem(UI_SCALE_STORAGE_KEY)
    const stored = raw == null ? DEFAULT_UI_SCALE : clampUiScale(raw)
    const baselineVersion = storage.getItem(UI_SCALE_BASELINE_VERSION_KEY)

    if (baselineVersion !== UI_SCALE_BASELINE_VERSION) {
      const migrated = raw == null ? DEFAULT_UI_SCALE : clampUiScale(stored / UI_DENSITY_BASELINE)
      persistLogicalUiScale(migrated, storage)
      return migrated
    }

    return stored
  } catch {
    return DEFAULT_UI_SCALE
  }
}

export function persistLogicalUiScale(value: unknown, storage: Storage = localStorage): number {
  const logicalScale = roundScale(clampUiScale(value))
  try {
    storage.setItem(UI_SCALE_STORAGE_KEY, String(logicalScale))
    storage.setItem(UI_SCALE_BASELINE_VERSION_KEY, UI_SCALE_BASELINE_VERSION)
  } catch {
    /* private browsing / quota - keep runtime scale working */
  }
  return logicalScale
}
