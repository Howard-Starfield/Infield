export type ConflictStatus = 'idle' | 'saving' | 'saved' | 'conflicted' | 'error'

export interface ConflictState {
  status: ConflictStatus
  lastSeenMtime: number | null
  conflictDiskMtime: number | null
  errorMessage: string | null
  savedAtMs: number | null
}

export const initialConflictState: ConflictState = {
  status: 'idle',
  lastSeenMtime: null,
  conflictDiskMtime: null,
  errorMessage: null,
  savedAtMs: null,
}

export type ConflictAction =
  | { type: 'NODE_LOAD'; mtime: number }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_OK'; updatedAt: number }
  | { type: 'SAVE_CONFLICT'; diskMtimeSecs: number }
  | { type: 'SAVE_ERROR'; message: string }
  | { type: 'RESOLVE_RELOAD'; newMtime: number }
  /**
   * User chose "Keep mine" after a VAULT_CONFLICT. Adopts the disk mtime
   * as the new last-seen baseline so the next save wins. Caller MUST
   * invoke `update_node` immediately after dispatching — the reducer
   * optimistically transitions to 'saving' but cannot fire the save
   * itself.
   */
  | { type: 'RESOLVE_KEEP' }
  | { type: 'CLEAR_SAVED' }

export function conflictReducer(
  state: ConflictState,
  action: ConflictAction,
): ConflictState {
  switch (action.type) {
    case 'NODE_LOAD':
      return {
        ...initialConflictState,
        lastSeenMtime: action.mtime,
      }
    case 'SAVE_START':
      return { ...state, status: 'saving', errorMessage: null }
    case 'SAVE_OK':
      return {
        ...state,
        status: 'saved',
        lastSeenMtime: action.updatedAt,
        savedAtMs: Date.now(),
        errorMessage: null,
        conflictDiskMtime: null,
      }
    case 'SAVE_CONFLICT':
      return {
        ...state,
        status: 'conflicted',
        conflictDiskMtime: action.diskMtimeSecs,
        errorMessage: null,
      }
    case 'SAVE_ERROR':
      return { ...state, status: 'error', errorMessage: action.message }
    case 'RESOLVE_RELOAD':
      if (state.status !== 'conflicted') return state
      return {
        ...initialConflictState,
        lastSeenMtime: action.newMtime,
      }
    case 'RESOLVE_KEEP':
      return {
        ...state,
        status: 'saving',
        lastSeenMtime: state.conflictDiskMtime ?? state.lastSeenMtime,
        conflictDiskMtime: null,
      }
    case 'CLEAR_SAVED':
      return state.status === 'saved' ? { ...state, status: 'idle' } : state
    default:
      return state
  }
}

const VAULT_CONFLICT_PREFIX = 'VAULT_CONFLICT:'

export function isVaultConflictError(err: string): boolean {
  return typeof err === 'string' && err.startsWith(VAULT_CONFLICT_PREFIX)
}

export interface ParsedVaultConflict {
  nodeId: string
  diskMtimeSecs: number
  lastSeenSecs: number
}

export function parseVaultConflictError(err: string): ParsedVaultConflict | null {
  if (!isVaultConflictError(err)) return null
  try {
    const payload = JSON.parse(err.slice(VAULT_CONFLICT_PREFIX.length))
    if (
      typeof payload?.node_id !== 'string' ||
      !Number.isFinite(payload?.disk_mtime_secs) ||
      !Number.isFinite(payload?.last_seen_secs) ||
      payload.disk_mtime_secs < 0 ||
      payload.last_seen_secs < 0
    ) {
      return null
    }
    return {
      nodeId: payload.node_id,
      diskMtimeSecs: payload.disk_mtime_secs,
      lastSeenSecs: payload.last_seen_secs,
    }
  } catch {
    return null
  }
}
