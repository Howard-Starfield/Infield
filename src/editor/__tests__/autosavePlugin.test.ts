import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDebouncedSaver } from '../autosavePlugin'

describe('createDebouncedSaver', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not call onSave immediately', () => {
    const onSave = vi.fn()
    const saver = createDebouncedSaver(onSave, 300)
    saver.schedule('body-1')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onSave after the debounce window', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const saver = createDebouncedSaver(onSave, 300)
    saver.schedule('body-1')
    vi.advanceTimersByTime(300)
    await vi.runAllTimersAsync()
    expect(onSave).toHaveBeenCalledWith('body-1')
  })

  it('coalesces rapid schedules into a single call with the last value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const saver = createDebouncedSaver(onSave, 300)
    saver.schedule('v1')
    vi.advanceTimersByTime(100)
    saver.schedule('v2')
    vi.advanceTimersByTime(100)
    saver.schedule('v3')
    vi.advanceTimersByTime(300)
    await vi.runAllTimersAsync()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('v3')
  })

  it('flush() calls onSave immediately with the pending value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const saver = createDebouncedSaver(onSave, 300)
    saver.schedule('pending')
    await saver.flush()
    expect(onSave).toHaveBeenCalledWith('pending')
  })

  it('flush() is a no-op when nothing pending', async () => {
    const onSave = vi.fn()
    const saver = createDebouncedSaver(onSave, 300)
    await saver.flush()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('cancel() discards pending save', async () => {
    const onSave = vi.fn()
    const saver = createDebouncedSaver(onSave, 300)
    saver.schedule('v1')
    saver.cancel()
    vi.advanceTimersByTime(300)
    await vi.runAllTimersAsync()
    expect(onSave).not.toHaveBeenCalled()
  })
})
