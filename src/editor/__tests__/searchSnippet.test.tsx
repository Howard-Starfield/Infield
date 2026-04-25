import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { renderSnippet } from '../searchSnippet'

describe('renderSnippet', () => {
  test('plain text renders as a single span', () => {
    const { container } = render(<>{renderSnippet('plain text', 'hit')}</>)
    expect(container.textContent).toBe('plain text')
    expect(container.querySelectorAll('.hit').length).toBe(0)
  })

  test('single hit splits into 3 parts (before, hit, after)', () => {
    const { container } = render(
      <>{renderSnippet('foo <mark>bar</mark> baz', 'hit')}</>,
    )
    expect(container.textContent).toBe('foo bar baz')
    const hits = container.querySelectorAll('.hit')
    expect(hits.length).toBe(1)
    expect(hits[0].textContent).toBe('bar')
  })

  test('multiple hits all render', () => {
    const { container } = render(
      <>{renderSnippet('<mark>react</mark> and <mark>vue</mark>', 'hit')}</>,
    )
    const hits = container.querySelectorAll('.hit')
    expect(hits.length).toBe(2)
    expect(hits[0].textContent).toBe('react')
    expect(hits[1].textContent).toBe('vue')
  })

  test('HTML in source is treated as plain text (no XSS)', () => {
    const { container } = render(
      <>{renderSnippet('<script>alert(1)</script> and <mark>safe</mark>', 'hit')}</>,
    )
    expect(container.textContent).toContain('<script>alert(1)</script>')
    expect(container.querySelectorAll('script').length).toBe(0)
  })

  test('malformed marks do not crash', () => {
    const { container } = render(
      <>{renderSnippet('start <mark>unclosed and more text', 'hit')}</>,
    )
    expect(container.textContent).toContain('unclosed')
  })

  test('empty input renders empty', () => {
    const { container } = render(<>{renderSnippet('', 'hit')}</>)
    expect(container.textContent).toBe('')
  })
})
