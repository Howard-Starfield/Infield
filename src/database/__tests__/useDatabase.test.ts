import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

// ---- Mocks ----

const okResult = <T,>(data: T) => ({ status: 'ok' as const, data })

const mockGetFields = vi.fn()
const mockGetRowsFilteredSorted = vi.fn()
const mockGetCellsForRows = vi.fn()
const mockUpdateCell = vi.fn()
const mockCreateRow = vi.fn()
const mockCreateRowInGroup = vi.fn()
const mockDeleteNode = vi.fn()

vi.mock('../../bindings', () => ({
  commands: {
    getFields: (...args: unknown[]) => mockGetFields(...args),
    getRowsFilteredSorted: (...args: unknown[]) => mockGetRowsFilteredSorted(...args),
    getCellsForRows: (...args: unknown[]) => mockGetCellsForRows(...args),
    updateCell: (...args: unknown[]) => mockUpdateCell(...args),
    createRow: (...args: unknown[]) => mockCreateRow(...args),
    createRowInGroup: (...args: unknown[]) => mockCreateRowInGroup(...args),
    deleteNode: (...args: unknown[]) => mockDeleteNode(...args),
  },
}))

const mockToastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args), success: vi.fn() },
}))

// Import AFTER vi.mock so the hook resolves to the mocked bindings.
import { useDatabase } from '../useDatabase'

const DB_ID = 'db-1'

function makeRows(n: number, prefix = 'r') {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, database_id: DB_ID }))
}

beforeEach(() => {
  mockGetFields.mockResolvedValue(okResult([]))
  mockGetRowsFilteredSorted.mockResolvedValue(okResult([]))
  mockGetCellsForRows.mockResolvedValue(okResult([]))
  mockUpdateCell.mockResolvedValue(okResult(null))
  mockCreateRow.mockResolvedValue(okResult({ id: 'new-row', database_id: DB_ID }))
  mockCreateRowInGroup.mockResolvedValue(okResult({ id: 'grouped-row', database_id: DB_ID }))
  mockDeleteNode.mockResolvedValue(okResult(null))
})

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useDatabase', () => {
  test('paged slice math: cellsForRange fetches the requested window once', async () => {
    const rows = makeRows(100)
    mockGetRowsFilteredSorted.mockResolvedValueOnce(okResult(rows))

    const { result } = renderHook(() => useDatabase(DB_ID))
    await waitFor(() => expect(result.current.rowIndex).toHaveLength(100))

    act(() => result.current.cellsForRange(10, 59))

    await waitFor(() => expect(mockGetCellsForRows).toHaveBeenCalledTimes(1))
    const [, requestedIds] = mockGetCellsForRows.mock.calls[0]
    expect(requestedIds).toHaveLength(50)
    expect(requestedIds[0]).toBe('r10')
    expect(requestedIds[49]).toBe('r59')

    // Second call for the same window must hit the fetched cache, not Tauri.
    act(() => result.current.cellsForRange(10, 59))
    expect(mockGetCellsForRows).toHaveBeenCalledTimes(1)
  })

  test('sort independence: cellsForRange fetches in rowIndex order, not id order', async () => {
    // Rows arrive in a non-natural order; the hook must fetch in that order.
    const rows = [
      { id: 'r5', database_id: DB_ID },
      { id: 'r2', database_id: DB_ID },
      { id: 'r9', database_id: DB_ID },
      { id: 'r0', database_id: DB_ID },
    ]
    mockGetRowsFilteredSorted.mockResolvedValueOnce(okResult(rows))

    const { result } = renderHook(() => useDatabase(DB_ID))
    await waitFor(() => expect(result.current.rowIndex).toHaveLength(4))

    act(() => result.current.cellsForRange(0, 3))

    await waitFor(() => expect(mockGetCellsForRows).toHaveBeenCalledTimes(1))
    const [, requestedIds] = mockGetCellsForRows.mock.calls[0]
    expect(requestedIds).toEqual(['r5', 'r2', 'r9', 'r0'])
  })

  test('atomic mutation skips debounce — updateCell fires synchronously', async () => {
    mockGetRowsFilteredSorted.mockResolvedValueOnce(okResult(makeRows(1)))

    const { result } = renderHook(() => useDatabase(DB_ID))
    await waitFor(() => expect(result.current.rowIndex).toHaveLength(1))

    vi.useFakeTimers()
    await act(async () => {
      await result.current.mutateCell('r0', 'f-check', { type: 'checkbox', value: true }, 'immediate')
    })
    // No pending timers — atomic path bypasses the 300ms debounce.
    expect(vi.getTimerCount()).toBe(0)
    expect(mockUpdateCell).toHaveBeenCalledTimes(1)
    expect(mockUpdateCell).toHaveBeenCalledWith(
      DB_ID,
      'r0',
      'f-check',
      'checkbox',
      { type: 'checkbox', value: true },
      null,
    )
  })

  test('updateCell error reverts cell to prior value, not undefined', async () => {
    // Seed a row with an existing rich_text cell so prevValue is defined.
    mockGetRowsFilteredSorted.mockResolvedValueOnce(okResult(makeRows(1)))
    mockGetCellsForRows.mockResolvedValueOnce(
      okResult([['r0', [['f-text', { type: 'rich_text', value: 'abc' }]]]]),
    )
    // Make the update fail.
    mockUpdateCell.mockResolvedValueOnce({ status: 'error' as const, error: 'boom' })

    // Silence the console.error the rollback path emits.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useDatabase(DB_ID))
    await waitFor(() => expect(result.current.rowIndex).toHaveLength(1))

    // Load the cell into local state.
    act(() => result.current.cellsForRange(0, 0))
    await waitFor(() =>
      expect(result.current.cells.get('r0')?.get('f-text')).toEqual({
        type: 'rich_text',
        value: 'abc',
      }),
    )

    // Type "abcd" — optimistic write lands locally, server returns error.
    await act(async () => {
      await result.current.mutateCell(
        'r0',
        'f-text',
        { type: 'rich_text', value: 'abcd' },
        'immediate',
      )
    })

    // After rollback the cell must be restored to "abc" (NOT deleted/undefined).
    expect(result.current.cells.get('r0')?.get('f-text')).toEqual({
      type: 'rich_text',
      value: 'abc',
    })
    // User-facing toast fired.
    expect(mockToastError).toHaveBeenCalledWith('Failed to save')

    consoleSpy.mockRestore()
  })

  test('updateCell error on previously-empty cell deletes the optimistic write', async () => {
    // No existing cell — prevValue should be undefined and rollback should
    // remove the optimistic entry rather than leave stale data behind.
    mockGetRowsFilteredSorted.mockResolvedValueOnce(okResult(makeRows(1)))
    mockUpdateCell.mockResolvedValueOnce({ status: 'error' as const, error: 'boom' })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useDatabase(DB_ID))
    await waitFor(() => expect(result.current.rowIndex).toHaveLength(1))

    await act(async () => {
      await result.current.mutateCell(
        'r0',
        'f-text',
        { type: 'rich_text', value: 'abcd' },
        'immediate',
      )
    })

    // No prior value → rollback drops the optimistic entry.
    expect(result.current.cells.get('r0')?.get('f-text')).toBeUndefined()
    expect(mockToastError).toHaveBeenCalledWith('Failed to save')

    consoleSpy.mockRestore()
  })

  test('soft-delete hides row and clears its cells entry', async () => {
    mockGetRowsFilteredSorted.mockResolvedValueOnce(okResult(makeRows(3)))
    mockGetCellsForRows.mockResolvedValueOnce(
      okResult([
        ['r0', [['f1', { type: 'rich_text', value: 'hello' }]]],
        ['r1', [['f1', { type: 'rich_text', value: 'world' }]]],
        ['r2', [['f1', { type: 'rich_text', value: 'foo' }]]],
      ]),
    )

    const { result } = renderHook(() => useDatabase(DB_ID))
    await waitFor(() => expect(result.current.rowIndex).toHaveLength(3))

    act(() => result.current.cellsForRange(0, 2))
    await waitFor(() => expect(result.current.cells.has('r1')).toBe(true))

    await act(async () => {
      await result.current.deleteRow('r1')
    })

    expect(mockDeleteNode).toHaveBeenCalledWith('r1')
    expect(result.current.rowIndex.map(r => r.id)).toEqual(['r0', 'r2'])
    expect(result.current.cells.has('r1')).toBe(false)
    // Surviving rows keep their cells.
    expect(result.current.cells.has('r0')).toBe(true)
    expect(result.current.cells.has('r2')).toBe(true)
  })
})
