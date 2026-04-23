import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { fitRectInViewport, placeMenuAtPointer } from './workspaceFloatingLayer'

describe('fitRectInViewport', () => {
  beforeEach(() => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps a box fully inside the viewport with padding', () => {
    expect(fitRectInViewport({ top: 8, left: 8, width: 100, height: 50 }, 8)).toEqual({ top: 8, left: 8 })
  })

  it('shifts left when overflowing the right edge', () => {
    expect(fitRectInViewport({ top: 8, left: 700, width: 200, height: 40 }, 8)).toEqual({
      top: 8,
      left: 592,
    })
  })

  it('shifts top when overflowing the bottom edge', () => {
    expect(fitRectInViewport({ top: 500, left: 8, width: 100, height: 120 }, 8)).toEqual({
      top: 472,
      left: 8,
    })
  })
})

describe('placeMenuAtPointer', () => {
  beforeEach(() => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('places below the pointer when there is room', () => {
    const p = placeMenuAtPointer(100, 100, { menuWidth: 200, menuHeight: 100 })
    expect(p.top).toBe(104)
    expect(p.left).toBe(100)
  })

  it('flips above when opening below would overflow', () => {
    const p = placeMenuAtPointer(100, 550, { menuWidth: 200, menuHeight: 80, gap: 4 })
    expect(p.top).toBe(550 - 4 - 80)
    expect(p.left).toBe(100)
  })
})
