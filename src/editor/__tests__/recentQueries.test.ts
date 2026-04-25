import { describe, expect, test, beforeEach } from 'vitest'
import { recordQuery, getRecentQueries, clearRecentQueries } from '../recentQueries'

beforeEach(() => {
  localStorage.clear()
})

describe('recentQueries', () => {
  test('empty initially', () => {
    expect(getRecentQueries()).toEqual([])
  })

  test('records up to 10', () => {
    for (let i = 0; i < 10; i++) recordQuery(`q${i}`)
    expect(getRecentQueries().length).toBe(10)
  })

  test('drops oldest beyond 10', () => {
    for (let i = 0; i < 12; i++) recordQuery(`q${i}`)
    const recent = getRecentQueries()
    expect(recent.length).toBe(10)
    expect(recent[0]).toBe('q11')   // most recent first
    expect(recent[9]).toBe('q2')    // oldest kept
  })

  test('dedupes — re-recording an existing query promotes it', () => {
    recordQuery('a')
    recordQuery('b')
    recordQuery('a')
    expect(getRecentQueries()).toEqual(['a', 'b'])
  })

  test('ignores empty / whitespace-only queries', () => {
    recordQuery('')
    recordQuery('   ')
    expect(getRecentQueries()).toEqual([])
  })

  test('clear empties', () => {
    recordQuery('a')
    clearRecentQueries()
    expect(getRecentQueries()).toEqual([])
  })

  test('persists across reads', () => {
    recordQuery('persist-me')
    const fromStorage = JSON.parse(localStorage.getItem('handy.search.recent') ?? '[]')
    expect(fromStorage).toEqual(['persist-me'])
  })
})
