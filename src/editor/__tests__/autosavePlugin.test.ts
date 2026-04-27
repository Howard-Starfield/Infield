import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createDebouncedSaver, autosavePlugin } from '../autosavePlugin'

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

describe('autosavePlugin: pending:// pause guard', () => {
  it('does NOT call saver.schedule when doc contains pending://', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const saver = createDebouncedSaver(onSave, 10)
    const dirtyChange = vi.fn()

    const state = EditorState.create({
      doc: '![Saving image…](pending://abc123)\n',
      extensions: [autosavePlugin(saver, dirtyChange)],
    })
    const view = new EditorView({ state, parent: document.createElement('div') })

    view.dispatch({
      changes: { from: view.state.doc.length, insert: 'x' },
      userEvent: 'input.type',
    })

    await new Promise((r) => setTimeout(r, 30))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls saver.schedule once doc no longer contains pending://', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const saver = createDebouncedSaver(onSave, 10)
    const dirtyChange = vi.fn()

    const state = EditorState.create({
      doc: '![](attachments/2026/04/foo.png)\n',
      extensions: [autosavePlugin(saver, dirtyChange)],
    })
    const view = new EditorView({ state, parent: document.createElement('div') })

    view.dispatch({
      changes: { from: view.state.doc.length, insert: 'x' },
      userEvent: 'input.type',
    })

    await new Promise((r) => setTimeout(r, 30))
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
