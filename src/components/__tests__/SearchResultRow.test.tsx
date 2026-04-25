import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SearchResultRow } from '../SearchResultRow'
import type { WorkspaceSearchResult } from '../../bindings'

function mkResult(over: Partial<WorkspaceSearchResult> = {}): WorkspaceSearchResult {
  return {
    node_id: 'n1',
    node_type: 'document',
    title: 'My Doc',
    parent_name: 'Projects',
    icon: '📄',
    score: 0.5,
    keyword_rank: 1,
    semantic_rank: 2,
    excerpt: 'A snippet with <mark>hit</mark> here.',
    ...over,
  } as WorkspaceSearchResult
}

describe('SearchResultRow', () => {
  test('renders title + breadcrumb + excerpt', () => {
    render(<SearchResultRow result={mkResult()} isActive={false} onClick={() => {}} />)
    expect(screen.getByText('My Doc')).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('hit')).toBeInTheDocument()  // the <mark> contents
  })

  test('Untitled fallback when title empty', () => {
    render(<SearchResultRow result={mkResult({ title: '' })} isActive={false} onClick={() => {}} />)
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })

  test('shows both badges when both ranks present', () => {
    const { container } = render(
      <SearchResultRow result={mkResult()} isActive={false} onClick={() => {}} />,
    )
    expect(container.querySelector('.search-result__badge--fts')).toBeInTheDocument()
    expect(container.querySelector('.search-result__badge--vec')).toBeInTheDocument()
  })

  test('shows only fts badge when semantic_rank is null', () => {
    const { container } = render(
      <SearchResultRow
        result={mkResult({ semantic_rank: null as unknown as number })}
        isActive={false}
        onClick={() => {}}
      />,
    )
    expect(container.querySelector('.search-result__badge--fts')).toBeInTheDocument()
    expect(container.querySelector('.search-result__badge--vec')).not.toBeInTheDocument()
  })

  test('active modifier class when isActive', () => {
    const { container } = render(
      <SearchResultRow result={mkResult()} isActive={true} onClick={() => {}} />,
    )
    expect(container.querySelector('.search-result--active')).toBeInTheDocument()
  })

  test('onClick fires with mouse event', () => {
    const onClick = vi.fn()
    render(<SearchResultRow result={mkResult()} isActive={false} onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test('debug overlay shows when showDebug', () => {
    render(
      <SearchResultRow result={mkResult()} isActive={false} showDebug onClick={() => {}} />,
    )
    expect(screen.getByText(/score:0\.500/)).toBeInTheDocument()
  })
})
