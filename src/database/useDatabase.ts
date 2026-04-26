/**
 * useDatabase — single hook for the W4 Databases surface.
 *
 * Manages three layers:
 *   - rowIndex: small per-row metadata loaded once via getRowsFilteredSorted.
 *   - cells: rowId -> fieldId -> CellData, populated lazily by cellsForRange.
 *   - cellsVersion: counter that increments after each fetch / mutation so
 *     callers can re-render the affected rows.
 *
 * All mutations are optimistic (local state updated synchronously, server
 * roundtrip in the background). On error we revert and fire a sonner toast.
 *
 * Debounce policy is split:
 *   - 'typing'    — 300ms debounce per (rowId, fieldId) key (RichText / Number).
 *   - 'immediate' — fire-and-forget, no debounce, no batching.
 *
 * `lastSeenMtimeSecs` is tracked per row, populated from the
 * `last_modified_secs` field of each `RowCellsBatch` returned by
 * `getCellsForRows`. Feeds the Rule 13 conflict guard on `updateCell`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { commands, type CellData, type Field, type FieldType, type Row } from '../bindings'
import { parseVaultConflictError } from '../editor/conflictState'

const TYPING_DEBOUNCE_MS = 300

export type MutationKind = 'typing' | 'immediate'

export interface RowMeta {
  /** workspace_node id of the row */
  id: string
  /** Stable position within the current sort. Equal to the array index. */
  position: number
  /** Display title — derived from the primary field once cells are loaded. */
  title: string
  /** SingleSelect option id used for Board grouping. Null until cells load or no select field exists. */
  groupKey: string | null
}

export interface UseDatabaseResult {
  fields: Field[]
  rowIndex: RowMeta[]
  cells: Map<string, Map<string, CellData>>
  cellsVersion: number
  isLoading: boolean
  cellsForRange: (startIdx: number, endIdx: number) => void
  mutateCell: (rowId: string, fieldId: string, data: CellData, kind: MutationKind) => Promise<void>
  createRow: () => Promise<void>
  createRowInGroup: (fieldId: string, optionId: string) => Promise<void>
  moveRowGroup: (rowId: string, fieldId: string, optionId: string) => Promise<void>
  deleteRow: (rowId: string) => Promise<void>
  createField: (name: string, fieldType: FieldType) => Promise<void>
}

const EMPTY_CELLS: Map<string, Map<string, CellData>> = new Map()

const FIELD_TYPE_BY_DATA: Record<CellData['type'], FieldType> = {
  rich_text: 'rich_text',
  number: 'number',
  date_time: 'date_time',
  single_select: 'single_select',
  multi_select: 'multi_select',
  checkbox: 'checkbox',
  url: 'url',
  checklist: 'checklist',
  last_edited_time: 'last_edited_time',
  created_time: 'created_time',
  time: 'time',
  date: 'date',
  media: 'media',
  protected: 'protected',
}

function fieldTypeFromCellData(data: CellData): FieldType {
  return FIELD_TYPE_BY_DATA[data.type]
}

export function useDatabase(dbId: string | null): UseDatabaseResult {
  const [fields, setFields] = useState<Field[]>([])
  const [rowIndex, setRowIndex] = useState<RowMeta[]>([])
  const [cellsVersion, setCellsVersion] = useState<number>(0)
  const [isLoading, setIsLoading] = useState<boolean>(false)

  // Mutable refs — never trigger re-render directly; bump cellsVersion instead.
  const cellsRef = useRef<Map<string, Map<string, CellData>>>(new Map())
  const fetchedRowsRef = useRef<Set<string>>(new Set())
  const debounceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const lastSeenMtimeRef = useRef<Map<string, number | null>>(new Map())
  // (rowId -> Set<fieldId>) for in-flight mutations. cellsForRange skips
  // these fields when layering server cells, otherwise a mid-fetch SQLite
  // read clobbers the user's optimistic value before the in-flight
  // updateCell completes.
  const pendingMutationsRef = useRef<Map<string, Set<string>>>(new Map())

  // Live-mirror dbId so async callbacks can detect a switch after `await`.
  // Without this, an in-flight fetch from DB-A can scribble onto DB-B's state.
  const dbIdRef = useRef<string | null>(dbId)
  useEffect(() => {
    dbIdRef.current = dbId
  }, [dbId])

  // Live-mirror of rowIndex so async callbacks (toast Reload action) can
  // resolve a row's array index without re-running the closure.
  const rowIndexRef = useRef<RowMeta[]>([])

  // Reset everything when dbId changes (or on mount).
  useEffect(() => {
    if (!dbId) {
      cellsRef.current = new Map()
      fetchedRowsRef.current = new Set()
      lastSeenMtimeRef.current = new Map()
      pendingMutationsRef.current = new Map()
      setFields([])
      setRowIndex([])
      setCellsVersion(v => v + 1)
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    cellsRef.current = new Map()
    fetchedRowsRef.current = new Set()
    lastSeenMtimeRef.current = new Map()
    pendingMutationsRef.current = new Map()

    ;(async () => {
      try {
        const [fieldsRes, rowsRes] = await Promise.all([
          commands.getFields(dbId),
          commands.getRowsFilteredSorted(dbId, [], []),
        ])
        if (cancelled) return
        if (fieldsRes.status !== 'ok') throw new Error(fieldsRes.error)
        if (rowsRes.status !== 'ok') throw new Error(rowsRes.error)

        setFields(fieldsRes.data)
        setRowIndex(rowsToMeta(rowsRes.data))
        setCellsVersion(v => v + 1)
      } catch (err) {
        if (!cancelled) {
          toast.error('Failed to load database')
          // eslint-disable-next-line no-console
          console.error('[useDatabase] load failed', err)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
      // Clear any pending debounce timers — they close over the previous dbId
      // and would fire stale mutateCell calls 300ms after the switch.
      for (const t of debounceTimersRef.current.values()) clearTimeout(t)
      debounceTimersRef.current.clear()
    }
  }, [dbId])

  // Keep rowIndexRef synced so the toast Reload action can find a row's
  // array index without React state being stale across the await boundary.
  useEffect(() => {
    rowIndexRef.current = rowIndex
  }, [rowIndex])

  const recomputeRowMeta = useCallback(() => {
    setRowIndex(prev => prev.map((meta, idx) => annotateMeta(meta, idx, fields, cellsRef.current)))
  }, [fields])

  const cellsForRange = useCallback(
    (startIdx: number, endIdx: number) => {
      if (!dbId) return
      const capturedDbId = dbId
      // Snap into bounds; consumer may pass arbitrary virtualizer ranges.
      const rows = rowIndex
      if (rows.length === 0) return
      const lo = Math.max(0, Math.min(startIdx, rows.length - 1))
      const hi = Math.max(lo, Math.min(endIdx, rows.length - 1))

      const missing: string[] = []
      for (let i = lo; i <= hi; i++) {
        const id = rows[i].id
        if (!fetchedRowsRef.current.has(id)) missing.push(id)
      }
      if (missing.length === 0) return

      // Mark optimistically so concurrent calls don't re-issue.
      for (const id of missing) fetchedRowsRef.current.add(id)

      ;(async () => {
        try {
          const res = await commands.getCellsForRows(capturedDbId, missing)
          // Stale-response guard: dbId switched while we were awaiting. The
          // dbId-change effect already reset cellsRef/fetchedRowsRef; bail
          // before scribbling DB-A data onto DB-B's state.
          if (dbIdRef.current !== capturedDbId) return
          if (res.status !== 'ok') throw new Error(res.error)
          for (const batch of res.data) {
            // Race guard (Fix 5): preserve any cells with pending in-flight
            // mutations — otherwise a mid-fetch SQLite read overwrites the
            // user's optimistic value before the updateCell roundtrip ends.
            const pendingFields = pendingMutationsRef.current.get(batch.row_id)
            const map = new Map<string, CellData>()
            const existing = cellsRef.current.get(batch.row_id)
            if (existing && pendingFields) {
              for (const fid of pendingFields) {
                const v = existing.get(fid)
                if (v != null) map.set(fid, v)
              }
            }
            for (const [fieldId, data] of batch.cells) {
              if (pendingFields?.has(fieldId)) continue
              map.set(fieldId, data)
            }
            cellsRef.current.set(batch.row_id, map)
            // Track vault-file mtime so subsequent updateCell calls can feed
            // the Rule 13 conflict guard. None when the row's vault file
            // doesn't exist yet (e.g. brand-new row in this session).
            if (batch.last_modified_secs != null) {
              lastSeenMtimeRef.current.set(batch.row_id, batch.last_modified_secs)
            }
          }
          setCellsVersion(v => v + 1)
          recomputeRowMeta()
        } catch (err) {
          // Only roll back if we're still on the same dbId — otherwise the
          // fetched-markers were already wiped by the dbId effect.
          if (dbIdRef.current === capturedDbId) {
            for (const id of missing) fetchedRowsRef.current.delete(id)
            toast.error('Failed to load cells')
          }
          // eslint-disable-next-line no-console
          console.error('[useDatabase] cellsForRange failed', err)
        }
      })()
    },
    [dbId, rowIndex, recomputeRowMeta],
  )

  // Re-fetches a single row's cells, refreshing both its CellData and
  // `lastSeenMtimeSecs`. Used by the VAULT_CONFLICT toast's Reload action.
  const reloadRow = useCallback(
    (rowId: string) => {
      if (dbIdRef.current == null) return
      // Drop the fetched marker so the next cellsForRange will re-fetch.
      fetchedRowsRef.current.delete(rowId)
      const idx = rowIndexRef.current.findIndex(r => r.id === rowId)
      if (idx >= 0) cellsForRangeRef.current?.(idx, idx)
    },
    [],
  )
  // Forward-decl ref so reloadRow can call cellsForRange without the
  // recomputeRowMeta -> cellsForRange -> reloadRow circular dep.
  const cellsForRangeRef = useRef<((startIdx: number, endIdx: number) => void) | null>(null)

  const performMutateCell = useCallback(
    async (rowId: string, fieldId: string, data: CellData, prevValue: CellData | undefined) => {
      if (!dbId) return
      const capturedDbId = dbId
      const fieldType = fieldTypeFromCellData(data)
      const lastSeenMtimeSecs = lastSeenMtimeRef.current.get(rowId) ?? null

      // Mark this (rowId, fieldId) as in-flight so cellsForRange won't
      // overwrite the optimistic value while the mutation is pending.
      let pending = pendingMutationsRef.current.get(rowId)
      if (!pending) {
        pending = new Set<string>()
        pendingMutationsRef.current.set(rowId, pending)
      }
      pending.add(fieldId)

      try {
        const res = await commands.updateCell(capturedDbId, rowId, fieldId, fieldType, data, lastSeenMtimeSecs)
        // Stale-response guard: ignore the result if dbId changed mid-flight.
        if (dbIdRef.current !== capturedDbId) return
        if (res.status !== 'ok') throw new Error(res.error)
      } catch (err) {
        // Only roll back if we're still on the same dbId — otherwise the
        // dbId effect already wiped state and rolling back now would corrupt
        // the new database's view.
        if (dbIdRef.current === capturedDbId) {
          // VAULT_CONFLICT path (Fix 2): row file changed on disk between
          // the last cellsForRange and this updateCell. Don't roll back —
          // keep the optimistic value visible, surface a Reload action so
          // the user picks the resolution.
          const errorMessage = err instanceof Error ? err.message : String(err)
          const conflict = parseVaultConflictError(errorMessage)
          if (conflict) {
            toast.error('Row changed on disk', {
              action: {
                label: 'Reload',
                onClick: () => reloadRow(rowId),
              },
            })
          } else {
            // Restore the prior value rather than blanking the cell. The user
            // may still be looking at the new value in a contentEditable; a
            // sudden `undefined` is jarring and loses the previous state.
            const rowMap = cellsRef.current.get(rowId)
            if (rowMap) {
              if (prevValue === undefined) {
                rowMap.delete(fieldId)
                if (rowMap.size === 0) cellsRef.current.delete(rowId)
              } else {
                rowMap.set(fieldId, prevValue)
              }
            }
            setCellsVersion(v => v + 1)
            toast.error('Failed to save')
          }
        }
        // eslint-disable-next-line no-console
        console.error('[useDatabase] updateCell failed', err)
      } finally {
        // Always release the pending marker, success OR error. Without this,
        // a failed mutation would freeze the cell in optimistic state forever.
        const set = pendingMutationsRef.current.get(rowId)
        if (set) {
          set.delete(fieldId)
          if (set.size === 0) pendingMutationsRef.current.delete(rowId)
        }
      }
    },
    [dbId, reloadRow],
  )

  // Sync the forward-declared ref so reloadRow can invoke cellsForRange.
  useEffect(() => {
    cellsForRangeRef.current = cellsForRange
  }, [cellsForRange])

  const mutateCell = useCallback<UseDatabaseResult['mutateCell']>(
    async (rowId, fieldId, data, kind) => {
      // Snapshot the prior value BEFORE the optimistic write so we can
      // restore it on server error. May be undefined if the cell was empty.
      const existingRowMap = cellsRef.current.get(rowId)
      const prevValue = existingRowMap?.get(fieldId)

      // Optimistic local update.
      let rowMap = existingRowMap
      if (!rowMap) {
        rowMap = new Map()
        cellsRef.current.set(rowId, rowMap)
      }
      rowMap.set(fieldId, data)
      setCellsVersion(v => v + 1)
      recomputeRowMeta()

      const key = `${rowId}:${fieldId}`
      const existing = debounceTimersRef.current.get(key)
      if (existing) {
        clearTimeout(existing)
        debounceTimersRef.current.delete(key)
      }

      if (kind === 'immediate') {
        await performMutateCell(rowId, fieldId, data, prevValue)
        return
      }

      // 'typing' — coalesce. Note: the snapshotted prevValue is the value at
      // the moment the FIRST keystroke fired (before any optimistic write
      // landed). Successive coalesced keystrokes overwrite the timer but
      // share this same prevValue, which is the correct rollback target.
      const timer = setTimeout(() => {
        debounceTimersRef.current.delete(key)
        void performMutateCell(rowId, fieldId, data, prevValue)
      }, TYPING_DEBOUNCE_MS)
      debounceTimersRef.current.set(key, timer)
    },
    [performMutateCell, recomputeRowMeta],
  )

  const createRow = useCallback<UseDatabaseResult['createRow']>(async () => {
    if (!dbId) return
    const capturedDbId = dbId
    try {
      const res = await commands.createRow(capturedDbId)
      // Stale-response guard: don't append a row from DB-A onto DB-B.
      if (dbIdRef.current !== capturedDbId) return
      if (res.status !== 'ok') throw new Error(res.error)
      setRowIndex(prev => {
        const next = [...prev, { id: res.data.id, position: prev.length, title: '', groupKey: null }]
        return next.map((m, i) => annotateMeta(m, i, fields, cellsRef.current))
      })
    } catch (err) {
      if (dbIdRef.current === capturedDbId) toast.error('Failed to create row')
      // eslint-disable-next-line no-console
      console.error('[useDatabase] createRow failed', err)
    }
  }, [dbId, fields])

  const createRowInGroup = useCallback<UseDatabaseResult['createRowInGroup']>(
    async (fieldId, optionId) => {
      if (!dbId) return
      const capturedDbId = dbId
      try {
        const res = await commands.createRowInGroup(capturedDbId, fieldId, optionId)
        // Stale-response guard: don't seed cells/rows for the wrong dbId.
        if (dbIdRef.current !== capturedDbId) return
        if (res.status !== 'ok') throw new Error(res.error)
        // Seed the SingleSelect cell so the new row appears in the right column
        // before the next cellsForRange round-trip.
        const seeded = new Map<string, CellData>()
        seeded.set(fieldId, { type: 'single_select', value: optionId })
        cellsRef.current.set(res.data.id, seeded)
        fetchedRowsRef.current.add(res.data.id)
        setRowIndex(prev => {
          const next = [...prev, { id: res.data.id, position: prev.length, title: '', groupKey: optionId }]
          return next.map((m, i) => annotateMeta(m, i, fields, cellsRef.current))
        })
        setCellsVersion(v => v + 1)
      } catch (err) {
        if (dbIdRef.current === capturedDbId) toast.error('Failed to create row')
        // eslint-disable-next-line no-console
        console.error('[useDatabase] createRowInGroup failed', err)
      }
    },
    [dbId, fields],
  )

  const moveRowGroup = useCallback<UseDatabaseResult['moveRowGroup']>(
    async (rowId, fieldId, optionId) => {
      await mutateCell(rowId, fieldId, { type: 'single_select', value: optionId }, 'immediate')
    },
    [mutateCell],
  )

  const createField = useCallback<UseDatabaseResult['createField']>(
    async (name, fieldType) => {
      if (!dbId) return
      const capturedDbId = dbId
      const trimmed = name.trim()
      if (!trimmed) {
        toast.error('Column name required')
        return
      }
      try {
        const res = await commands.createField(capturedDbId, trimmed, fieldType)
        if (dbIdRef.current !== capturedDbId) return
        if (res.status !== 'ok') throw new Error(res.error)
        setFields(prev => [...prev, res.data])
      } catch (err) {
        if (dbIdRef.current === capturedDbId) toast.error('Failed to add column')
        // eslint-disable-next-line no-console
        console.error('[useDatabase] createField failed', err)
      }
    },
    [dbId],
  )

  const deleteRow = useCallback<UseDatabaseResult['deleteRow']>(async rowId => {
    const capturedDbId = dbIdRef.current
    try {
      const res = await commands.deleteNode(rowId)
      // Stale-response guard: dbId switched mid-flight. The dbId effect
      // already cleared cellsRef/rowIndex; don't touch the new database.
      if (dbIdRef.current !== capturedDbId) return
      if (res.status !== 'ok') throw new Error(res.error)
      cellsRef.current.delete(rowId)
      fetchedRowsRef.current.delete(rowId)
      lastSeenMtimeRef.current.delete(rowId)
      pendingMutationsRef.current.delete(rowId)
      setRowIndex(prev =>
        prev
          .filter(m => m.id !== rowId)
          .map((m, i) => ({ ...m, position: i })),
      )
      setCellsVersion(v => v + 1)
    } catch (err) {
      if (dbIdRef.current === capturedDbId) toast.error('Failed to delete row')
      // eslint-disable-next-line no-console
      console.error('[useDatabase] deleteRow failed', err)
    }
  }, [])

  return {
    fields,
    rowIndex,
    cells: cellsRef.current ?? EMPTY_CELLS,
    cellsVersion,
    isLoading,
    cellsForRange,
    mutateCell,
    createRow,
    createRowInGroup,
    moveRowGroup,
    deleteRow,
    createField,
  }
}

// ---------- helpers ----------

function rowsToMeta(rows: Row[]): RowMeta[] {
  return rows.map((r, i) => ({ id: r.id, position: i, title: '', groupKey: null }))
}

/**
 * Decorate a RowMeta with title + groupKey derived from the loaded cells.
 * Pure read of the cells ref; safe to call inside setState updaters.
 */
function annotateMeta(
  meta: RowMeta,
  idx: number,
  fields: Field[],
  cells: Map<string, Map<string, CellData>>,
): RowMeta {
  const rowCells = cells.get(meta.id)
  let title = meta.title
  let groupKey = meta.groupKey

  if (rowCells) {
    const primary = fields.find(f => f.is_primary)
    if (primary) {
      const cell = rowCells.get(primary.id)
      if (cell && cell.type === 'rich_text') title = cell.value
    }
    const groupField = fields.find(f => f.field_type === 'single_select')
    if (groupField) {
      const cell = rowCells.get(groupField.id)
      if (cell && cell.type === 'single_select') groupKey = cell.value
      else groupKey = null
    }
  }

  if (idx === meta.position && title === meta.title && groupKey === meta.groupKey) return meta
  return { ...meta, position: idx, title, groupKey }
}
