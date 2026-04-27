import { describe, it, expect } from 'vitest'
import { PendingImageWidget, ImageWidget } from '../livePreviewWidgets'

describe('PendingImageWidget', () => {
  it('renders a span with spinner aria-label', () => {
    const w = new PendingImageWidget('abc123')
    const dom = w.toDOM()
    expect(dom.tagName).toBe('SPAN')
    expect(dom.classList.contains('cm-md-image-pending')).toBe(true)
    const spinner = dom.querySelector('.cm-md-image-spinner')
    expect(spinner).not.toBeNull()
    expect(spinner?.getAttribute('aria-label')).toBe('Saving image')
  })

  it('eq returns true for same tempId, false for different', () => {
    const a = new PendingImageWidget('abc123')
    const b = new PendingImageWidget('abc123')
    const c = new PendingImageWidget('xyz789')
    expect(a.eq(b)).toBe(true)
    expect(a.eq(c)).toBe(false)
  })

  it('ignoreEvent returns true (static element)', () => {
    expect(new PendingImageWidget('abc').ignoreEvent()).toBe(true)
  })
})

describe('ImageWidget', () => {
  it('renders an img with src/alt/loading/decoding attributes', () => {
    const w = new ImageWidget(
      'asset://localhost/foo.png',
      'a cat',
      400,
      null,
      0,
      30,
      'attachments/2026/04/foo.png',
    )
    const dom = w.toDOM(null as any)
    expect(dom.classList.contains('cm-md-image-wrap')).toBe(true)
    const img = dom.querySelector('img')!
    expect(img.src).toBe('asset://localhost/foo.png')
    expect(img.alt).toBe('a cat')
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('decoding')).toBe('async')
    expect(img.width).toBe(400)
  })

  it('omits width when null', () => {
    const w = new ImageWidget(
      'asset://x.png', '', null, null, 0, 10,
      'attachments/x.png',
    )
    const img = w.toDOM(null as any).querySelector('img')!
    expect(img.hasAttribute('width')).toBe(false)
  })

  it('renders both resize handles', () => {
    const w = new ImageWidget(
      'asset://x.png', '', 200, null, 0, 10,
      'attachments/x.png',
    )
    const handles = w.toDOM(null as any).querySelectorAll('.cm-md-image-handle')
    expect(handles.length).toBe(2)
  })

  it('eq is true only when every field matches', () => {
    const a = new ImageWidget('asset://x.png', 'a', 100, null, 0, 10, 'p.png')
    const b = new ImageWidget('asset://x.png', 'a', 100, null, 0, 10, 'p.png')
    const c = new ImageWidget('asset://x.png', 'a', 200, null, 0, 10, 'p.png')
    expect(a.eq(b)).toBe(true)
    expect(a.eq(c)).toBe(false)
  })
})
