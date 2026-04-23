/**
 * Persisted sidenote rail state lives on the parent document's `workspace_nodes.properties` JSON
 * under `sidenote_rail` (see workspace plan).
 */

export type SidenoteRailPersisted = {
  /** Share of horizontal space for the right column (sidenotes + optional AI stack), 1–99. */
  width_percent?: number
  /** Document node IDs pinned from elsewhere in the workspace (not necessarily children). */
  pinned_ids?: string[]
  active_id?: string | null
  /** When true or unset, the sidenote rail is hidden. Only `collapsed === false` opens the rail. */
  collapsed?: boolean
  /** When sidenote rail and AI are both open: vertical share (percent) for the bottom AI strip. */
  ai_vertical_percent?: number
}

export function parseSidenoteRail(propertiesJson: string): SidenoteRailPersisted {
  try {
    const p = JSON.parse(propertiesJson || '{}') as Record<string, unknown>
    const r = p.sidenote_rail
    if (!r || typeof r !== 'object') return {}
    const o = r as Record<string, unknown>
    const pinned = Array.isArray(o.pinned_ids)
      ? o.pinned_ids.filter((x): x is string => typeof x === 'string')
      : undefined
    return {
      width_percent: typeof o.width_percent === 'number' ? clamp(o.width_percent, 18, 55) : undefined,
      pinned_ids: pinned,
      active_id: typeof o.active_id === 'string' ? o.active_id : o.active_id === null ? null : undefined,
      collapsed: typeof o.collapsed === 'boolean' ? o.collapsed : undefined,
      ai_vertical_percent:
        typeof o.ai_vertical_percent === 'number' ? clamp(o.ai_vertical_percent, 15, 60) : undefined,
    }
  } catch {
    return {}
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function mergeSidenoteRailIntoProperties(
  propertiesJson: string,
  railPatch: Partial<SidenoteRailPersisted>,
): string {
  try {
    const p = JSON.parse(propertiesJson || '{}') as Record<string, unknown>
    const prev =
      p.sidenote_rail && typeof p.sidenote_rail === 'object'
        ? { ...(p.sidenote_rail as Record<string, unknown>) }
        : {}
    const next = { ...prev, ...railPatch }
    p.sidenote_rail = next
    return JSON.stringify(p)
  } catch {
    return JSON.stringify({ sidenote_rail: railPatch })
  }
}
