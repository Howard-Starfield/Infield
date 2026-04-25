// src/components/SearchEmptyStates.tsx
import { getRecentQueries } from '../editor/recentQueries'

export function RecentQueriesChips({ onPick }: { onPick: (q: string) => void }) {
  const queries = getRecentQueries()
  if (queries.length === 0) {
    return (
      <div className="search-empty">
        <p className="search-empty__hint">
          Try <kbd>today</kbd> for recent notes or <kbd>#tag</kbd> for tagged notes.
        </p>
      </div>
    )
  }
  return (
    <div className="search-empty">
      <p className="search-empty__label">Recent searches</p>
      <div className="search-empty__chips">
        {queries.map((q) => (
          <button
            key={q}
            type="button"
            className="search-empty__chip"
            onClick={() => onPick(q)}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}

export function NoResultsEmpty({ query }: { query: string }) {
  return (
    <div className="search-empty">
      <p className="search-empty__title">No results for "{query}".</p>
    </div>
  )
}

export function DidYouMean({
  suggestion,
  onPick,
}: {
  suggestion: string
  onPick: (q: string) => void
}) {
  return (
    <div className="search-empty">
      <p className="search-empty__title">
        Did you mean:{' '}
        <button
          type="button"
          className="search-empty__suggestion"
          onClick={() => onPick(suggestion)}
        >
          {suggestion}
        </button>
        ?
      </p>
    </div>
  )
}
