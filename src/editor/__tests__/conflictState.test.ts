import { describe, it, expect } from 'vitest'
import {
  initialConflictState,
  conflictReducer,
  parseVaultConflictError,
  isVaultConflictError,
} from '../conflictState'

describe('parseVaultConflictError', () => {
  it('accepts the documented Rust format', () => {
    const err =
      'VAULT_CONFLICT:{"node_id":"abc-123","disk_mtime_secs":1700000099,"last_seen_secs":1700000000}'
    expect(isVaultConflictError(err)).toBe(true)
    const parsed = parseVaultConflictError(err)
    expect(parsed).toEqual({
      nodeId: 'abc-123',
      diskMtimeSecs: 1700000099,
      lastSeenSecs: 1700000000,
    })
  })

  it('rejects unrelated error strings', () => {
    expect(isVaultConflictError('some other error')).toBe(false)
    expect(parseVaultConflictError('some other error')).toBeNull()
  })

  it('rejects malformed VAULT_CONFLICT payloads', () => {
    expect(parseVaultConflictError('VAULT_CONFLICT:{not json}')).toBeNull()
  })
})

describe('conflictReducer', () => {
  it('idle + SAVE_START → saving', () => {
    const next = conflictReducer(initialConflictState, { type: 'SAVE_START' })
    expect(next.status).toBe('saving')
  })

  it('saving + SAVE_OK → saved with timestamp', () => {
    const saving = conflictReducer(initialConflictState, { type: 'SAVE_START' })
    const next = conflictReducer(saving, {
      type: 'SAVE_OK',
      updatedAt: 1700000500,
    })
    expect(next.status).toBe('saved')
    expect(next.savedAtMs).toBeGreaterThan(0)
    expect(next.lastSeenMtime).toBe(1700000500)
  })

  it('saving + SAVE_CONFLICT → conflicted', () => {
    const saving = conflictReducer(initialConflictState, { type: 'SAVE_START' })
    const next = conflictReducer(saving, {
      type: 'SAVE_CONFLICT',
      diskMtimeSecs: 1700000999,
    })
    expect(next.status).toBe('conflicted')
    expect(next.conflictDiskMtime).toBe(1700000999)
  })

  it('saving + SAVE_ERROR → error', () => {
    const saving = conflictReducer(initialConflictState, { type: 'SAVE_START' })
    const next = conflictReducer(saving, { type: 'SAVE_ERROR', message: 'no' })
    expect(next.status).toBe('error')
    expect(next.errorMessage).toBe('no')
  })

  it('conflicted + RESOLVE_RELOAD → idle with fresh mtime', () => {
    let s = conflictReducer(initialConflictState, { type: 'SAVE_START' })
    s = conflictReducer(s, { type: 'SAVE_CONFLICT', diskMtimeSecs: 1700000999 })
    const next = conflictReducer(s, {
      type: 'RESOLVE_RELOAD',
      newMtime: 1700000999,
    })
    expect(next.status).toBe('idle')
    expect(next.conflictDiskMtime).toBeNull()
    expect(next.lastSeenMtime).toBe(1700000999)
  })

  it('conflicted + RESOLVE_KEEP → saving with adopted mtime', () => {
    let s = conflictReducer(initialConflictState, { type: 'SAVE_START' })
    s = conflictReducer(s, { type: 'SAVE_CONFLICT', diskMtimeSecs: 1700000999 })
    const next = conflictReducer(s, { type: 'RESOLVE_KEEP' })
    expect(next.status).toBe('saving')
    expect(next.conflictDiskMtime).toBeNull()
    expect(next.lastSeenMtime).toBe(1700000999)
  })

  it('RESOLVE_RELOAD from non-conflicted state is a no-op', () => {
    const next = conflictReducer(
      { ...initialConflictState, status: 'saving' },
      { type: 'RESOLVE_RELOAD', newMtime: 1700000999 },
    )
    expect(next.status).toBe('saving')
    expect(next.lastSeenMtime).toBeNull()
  })

  it('NODE_LOAD resets state + seeds mtime', () => {
    const next = conflictReducer(
      { ...initialConflictState, status: 'saved' },
      { type: 'NODE_LOAD', mtime: 1700111111 },
    )
    expect(next.status).toBe('idle')
    expect(next.lastSeenMtime).toBe(1700111111)
  })
})
