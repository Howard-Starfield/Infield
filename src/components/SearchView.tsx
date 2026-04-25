// src/components/SearchView.tsx — W3 wired
import { useCallback, useEffect, useReducer, useState } from 'react'
import { commands, type WorkspaceSearchResult, type RerankResult } from '../bindings'
import { Search } from 'lucide-react'
import { SearchResultRow } from './SearchResultRow'
import { SearchFilters, initialFilters, type SearchFiltersState } from './SearchFilters'
import { RecentQueriesChips, NoResultsEmpty } from './SearchEmptyStates'
import { parseSearchTokens } from '../editor/searchTokens'
import { recordQuery } from '../editor/recentQueries'

const PAGE_SIZE = 20
const DEBOUNCE_MS = 200
const RERANK_TIMEOUT_MS = 100

type State = {
  query: string
  filters: SearchFiltersState
  results: WorkspaceSearchResult[]
  page: number
  loading: boolean
  noMore: boolean
}

type Action =
  | { type: 'SET_QUERY'; q: string }
  | { type: 'SET_FILTERS'; filters: SearchFiltersState }
  | { type: 'SET_RESULTS'; results: WorkspaceSearchResult[]; replace: boolean }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'NEXT_PAGE' }
  | { type: 'NO_MORE' }

const initial: State = {
  query: '',
  filters: initialFilters,
  results: [],
  page: 0,
  loading: false,
  noMore: false,
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'SET_QUERY':       return { ...s, query: a.q, page: 0, noMore: false }
    case 'SET_FILTERS':     return { ...s, filters: a.filters, page: 0, noMore: false }
    case 'SET_RESULTS':     return { ...s, results: a.replace ? a.results : [...s.results, ...a.results], loading: false }
    case 'SET_LOADING':     return { ...s, loading: a.loading }
    case 'NEXT_PAGE':       return { ...s, page: s.page + 1 }
    case 'NO_MORE':         return { ...s, noMore: true }
    default:                return s
  }
}

export function SearchView() {
  const [state, dispatch] = useReducer(reducer, initial)
  const [debounceTimer, setDebounceTimer] = useState<number | null>(null)

  const runSearch = useCallback(
    async (replace: boolean) => {
      const trimmed = state.query.trim()
      if (!trimmed) {
        dispatch({ type: 'SET_RESULTS', results: [], replace: true })
        return
      }
      dispatch({ type: 'SET_LOADING', loading: true })

      const { query: stripped, dateFilter } = parseSearchTokens(state.query)
      const q = stripped || state.query
      const offset = replace ? 0 : state.page * PAGE_SIZE

      const res = await commands.searchWorkspaceHybrid(
        q,
        PAGE_SIZE,
        offset,
        state.filters.nodeTypes.size > 0 ? Array.from(state.filters.nodeTypes) : undefined,
        state.filters.tags.size > 0 ? Array.from(state.filters.tags) : undefined,
        dateFilter?.from ?? undefined,
        dateFilter?.to ?? undefined,
      )
      if (res.status !== 'ok') {
        dispatch({ type: 'SET_RESULTS', results: [], replace: true })
        return
      }

      let candidates = res.data
      if (candidates.length === 0) dispatch({ type: 'NO_MORE' })

      if (candidates.length >= 2) {
        const rr = await commands.rerankCandidates(
          q,
          candidates.map((c) => ({
            node_id: c.node_id,
            title: c.title,
            excerpt: c.excerpt ?? '',
          })),
          PAGE_SIZE,
          RERANK_TIMEOUT_MS,
        )
        if (rr.status === 'ok' && rr.data) {
          const byId = new Map(candidates.map((c) => [c.node_id, c]))
          candidates = rr.data
            .map((r: RerankResult) => byId.get(r.node_id))
            .filter((c): c is WorkspaceSearchResult => !!c)
        }
      }

      dispatch({ type: 'SET_RESULTS', results: candidates, replace })
      if (replace) recordQuery(trimmed)
    },
    [state.query, state.filters, state.page],
  )

  // Debounce on query change.
  useEffect(() => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer)
    const t = window.setTimeout(() => {
      void runSearch(true)
    }, DEBOUNCE_MS)
    setDebounceTimer(t)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.query, state.filters])

  const openInTab = (nodeId: string, meta: boolean) => {
    const ev = meta ? 'notes:open-new-tab' : 'notes:open'
    window.dispatchEvent(new CustomEvent(ev, { detail: nodeId }))
  }

  return (
    <div className="search-view">
      <SearchFilters
        state={state.filters}
        onChange={(filters) => dispatch({ type: 'SET_FILTERS', filters })}
      />
      <main className="search-view__main">
        <div className="search-view__input-row">
          <Search size={16} className="search-view__input-icon" />
          <input
            type="text"
            className="search-view__input"
            value={state.query}
            onChange={(e) => dispatch({ type: 'SET_QUERY', q: e.currentTarget.value })}
            placeholder="Search notes…"
          />
        </div>

        {state.query.trim() === '' ? (
          <RecentQueriesChips onPick={(q) => dispatch({ type: 'SET_QUERY', q })} />
        ) : state.results.length === 0 && !state.loading ? (
          <NoResultsEmpty query={state.query} />
        ) : (
          <>
            <p className="search-view__count">
              {state.results.length} result{state.results.length === 1 ? '' : 's'}
            </p>
            <div className="search-view__results">
              {state.results.map((r) => (
                <SearchResultRow
                  key={r.node_id}
                  result={r}
                  isActive={false}
                  onClick={(e) => openInTab(r.node_id, e.metaKey || e.ctrlKey)}
                />
              ))}
            </div>
            {!state.noMore && state.results.length >= PAGE_SIZE && (
              <button
                type="button"
                className="search-view__load-more"
                onClick={() => {
                  dispatch({ type: 'NEXT_PAGE' })
                  void runSearch(false)
                }}
              >
                Load {PAGE_SIZE} more
              </button>
            )}
          </>
        )}
      </main>
    </div>
  )
}
