import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'

vi.mock('../../bindings', () => ({
  commands: {
    saveAttachment: vi.fn(),
  },
}))

import { commands } from '../../bindings'
import { insertImage } from '../imageInsert'

const mkView = (initialDoc = ''): EditorView => {
  const state = EditorState.create({
    doc: initialDoc,
    extensions: [markdown({ base: markdownLanguage, extensions: [GFM] })],
  })
  const parent = document.createElement('div')
  return new EditorView({ state, parent })
}

describe('insertImage', () => {
  beforeEach(() => {
    vi.mocked(commands.saveAttachment).mockReset()
  })

  it('inserts placeholder, then swaps to real path on success (paste case)', async () => {
    vi.mocked(commands.saveAttachment).mockResolvedValue({
      status: 'ok',
      data: {
        vault_rel_path: 'attachments/2026/04/foo-abc12345.png',
        display_name: 'foo',
        bytes_written: 100,
      },
    })

    const view = mkView('hello\n')
    await insertImage(
      { view, nodeId: 'node-1', insertAt: 6 },
      new Uint8Array([0x89, 0x50, 0x4E, 0x47]),
      'image/png',
      null,
    )

    const doc = view.state.doc.toString()
    expect(doc).toContain('![](attachments/2026/04/foo-abc12345.png)')
    expect(doc).not.toContain('pending://')
  })

  it('uses display_name as alt for drop case', async () => {
    vi.mocked(commands.saveAttachment).mockResolvedValue({
      status: 'ok',
      data: {
        vault_rel_path: 'attachments/2026/04/sketch-abc12345.png',
        display_name: 'sketch',
        bytes_written: 100,
      },
    })

    const view = mkView('hello\n')
    await insertImage(
      { view, nodeId: 'node-1', insertAt: 6 },
      new Uint8Array([0x89, 0x50, 0x4E, 0x47]),
      'image/png',
      'sketch.png',
    )

    expect(view.state.doc.toString()).toContain(
      '![sketch](attachments/2026/04/sketch-abc12345.png)',
    )
  })

  it('removes placeholder line on save failure', async () => {
    vi.mocked(commands.saveAttachment).mockResolvedValue({
      status: 'error',
      error: 'image exceeds 25MB cap',
    })

    const view = mkView('hello\n')
    await insertImage(
      { view, nodeId: 'node-1', insertAt: 6 },
      new Uint8Array([0xFF]),
      'image/png',
      null,
    )

    const doc = view.state.doc.toString()
    expect(doc).not.toContain('pending://')
    expect(doc).not.toContain('Saving image')
    expect(doc.trimEnd()).toBe('hello')
  })
})
