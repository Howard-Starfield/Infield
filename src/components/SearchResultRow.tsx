import { renderSnippet } from '../editor/searchSnippet'
import type { WorkspaceSearchResult } from '../bindings'

export interface SearchResultRowProps {
  result: WorkspaceSearchResult
  isActive: boolean
  showDebug?: boolean
  onClick: (e: React.MouseEvent) => void
  onMouseEnter?: () => void
}

export function SearchResultRow({
  result,
  isActive,
  showDebug,
  onClick,
  onMouseEnter,
}: SearchResultRowProps) {
  const fts = result.keyword_rank !== null && result.keyword_rank !== undefined
  const vec = result.semantic_rank !== null && result.semantic_rank !== undefined

  return (
    <button
      type="button"
      className={'search-result' + (isActive ? ' search-result--active' : '')}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div className="search-result__header">
        <span className="search-result__icon" aria-hidden>
          {result.icon || '📄'}
        </span>
        <span className="search-result__title" title={result.title}>
          {result.title || 'Untitled'}
        </span>
        {result.parent_name && (
          <span className="search-result__breadcrumb">
            {result.parent_name}
          </span>
        )}
      </div>
      {result.excerpt && (
        <div className="search-result__snippet">
          {renderSnippet(result.excerpt, 'search-result__hit')}
        </div>
      )}
      <div className="search-result__badges" aria-label="Match types">
        {fts && <span className="search-result__badge search-result__badge--fts" title="Keyword match">🟢</span>}
        {vec && <span className="search-result__badge search-result__badge--vec" title="Semantic match">🟣</span>}
        {showDebug && (
          <span className="search-result__debug">
            [fts:r={result.keyword_rank ?? '–'} · vec:r={result.semantic_rank ?? '–'} · score:{result.score.toFixed(3)}]
          </span>
        )}
      </div>
    </button>
  )
}
