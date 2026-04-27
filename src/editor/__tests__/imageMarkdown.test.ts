import { describe, it, expect } from 'vitest'
import { parseImageMarkdown } from '../imageMarkdown'

describe('parseImageMarkdown', () => {
  it('parses bare image syntax', () => {
    const r = parseImageMarkdown('![cat](pets/cat.png)')
    expect(r).toEqual({ alt: 'cat', path: 'pets/cat.png', width: null, height: null })
  })

  it('parses image with width', () => {
    const r = parseImageMarkdown('![cat|400](pets/cat.png)')
    expect(r).toEqual({ alt: 'cat', path: 'pets/cat.png', width: 400, height: null })
  })

  it('parses image with width and height', () => {
    const r = parseImageMarkdown('![cat|400x300](pets/cat.png)')
    expect(r).toEqual({ alt: 'cat', path: 'pets/cat.png', width: 400, height: 300 })
  })

  it('parses image with empty alt', () => {
    const r = parseImageMarkdown('![](pets/cat.png)')
    expect(r).toEqual({ alt: '', path: 'pets/cat.png', width: null, height: null })
  })

  it('parses pending placeholder', () => {
    const r = parseImageMarkdown('![Saving image…](pending://abc12345)')
    expect(r).toEqual({ alt: 'Saving image…', path: 'pending://abc12345', width: null, height: null })
  })

  it('returns null for malformed input', () => {
    expect(parseImageMarkdown('![alt(no-bracket.png)')).toBeNull()
    expect(parseImageMarkdown('not an image')).toBeNull()
    expect(parseImageMarkdown('[link](path)')).toBeNull()
  })

  it('ignores trailing whitespace in width', () => {
    const r = parseImageMarkdown('![cat| 400 ](pets/cat.png)')
    expect(r?.width).toBe(400)
  })

  it('handles spaces in alt text', () => {
    const r = parseImageMarkdown('![my cat photo|200](cat.png)')
    expect(r?.alt).toBe('my cat photo')
    expect(r?.width).toBe(200)
  })
})
