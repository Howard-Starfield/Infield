import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest'
import { parseSearchTokens } from '../searchTokens'

describe('parseSearchTokens', () => {
  beforeEach(() => {
    // Freeze time to 2026-04-25 12:00 local for date math.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-25T12:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('plain query returns query unchanged with no filter or tag', () => {
    const r = parseSearchTokens('react patterns')
    expect(r.query).toBe('react patterns')
    expect(r.dateFilter).toBeUndefined()
    expect(r.tag).toBeUndefined()
  })

  test('today token strips and produces a same-day date filter', () => {
    const r = parseSearchTokens('today recipe')
    expect(r.query).toBe('recipe')
    expect(r.dateFilter).toBeDefined()
    const startOfDay = new Date('2026-04-25T00:00:00').getTime()
    const endOfDay = new Date('2026-04-25T23:59:59.999').getTime()
    expect(r.dateFilter!.from).toBe(startOfDay)
    expect(r.dateFilter!.to).toBe(endOfDay)
  })

  test('yesterday token produces yesterday date filter', () => {
    const r = parseSearchTokens('voice memo yesterday')
    expect(r.query).toBe('voice memo')
    const start = new Date('2026-04-24T00:00:00').getTime()
    expect(r.dateFilter!.from).toBe(start)
  })

  test('last week produces a 7-day range', () => {
    const r = parseSearchTokens('last week meeting')
    expect(r.query).toBe('meeting')
    expect(r.dateFilter).toBeDefined()
    expect(r.dateFilter!.to! - r.dateFilter!.from).toBeGreaterThan(6 * 86400_000)
    expect(r.dateFilter!.to! - r.dateFilter!.from).toBeLessThan(8 * 86400_000)
  })

  test('exact tag short-circuit returns tag and empty query', () => {
    const r = parseSearchTokens('#research')
    expect(r.tag).toBe('research')
    expect(r.query).toBe('')
  })

  test('hash inside a longer query is NOT a tag short-circuit', () => {
    const r = parseSearchTokens('what about #research strategy')
    expect(r.tag).toBeUndefined()
    expect(r.query).toBe('what about #research strategy')
  })

  test('case-insensitive token matching', () => {
    const r = parseSearchTokens('TODAY important note')
    expect(r.query).toBe('important note')
    expect(r.dateFilter).toBeDefined()
  })
})
