import { useCallback, useEffect, useReducer, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { commands, type WorkspaceSearchResult, type RerankResult } from '../bindings'
import { SearchResultRow } from './SearchResultRow'
import { RecentQueriesChips, NoResultsEmpty, DidYouMean } from './SearchEmptyStates'
import { parseSearchTokens } from '../editor/searchTokens'
import { recordQuery } from '../editor/recentQueries'

const DEBOUNCE_MS = 200
const RERANK_TIMEOUT_MS = 100

type State = {
  query: string
  results: WorkspaceSearchResult[]
  active: number
  loading: boolean
  showDebug: boolean
  didYouMean: string | null
}

type Action =
  | { type: 'SET_QUERY'; q: string }
  | { type: 'SET_RESULTS'; results: WorkspaceSearchResult[] }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'MOVE'; delta: number }
  | { type: 'TOGGLE_DEBUG' }
  | { type: 'SET_SUGGESTION'; suggestion: string | null }

const initial: State = {
  query: '',
  results: [],
  active: 0,
  loading: false,
  showDebug: false,
  didYouMean: null,
}

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case 'SET_QUERY':
      return { ...state, query: a.q, active: 0 }
    case 'SET_RESULTS':
      return { ...state, results: a.results, active: 0, loading: false, didYouMean: null }
    case 'SET_LOADING':
      return { ...state, loading: a.loading }
    case 'MOVE': {
      const next = Math.max(0, Math.min(state.results.length - 1, state.active + a.delta))
      return { ...state, active: next }
    }
    case 'TOGGLE_DEBUG':
      return { ...state, showDebug: !state.showDebug }
    case 'SET_SUGGESTION':
      return { ...state, didYouMean: a.suggestion }
    default:
      return state
  }
}

export interface SpotlightOverlayProps {
  onDismiss: () => void
  onOpenPreview: (nodeId: string) => void
  onOpenInNewTab: (nodeId: string) => void
}

export function SpotlightOverlay({
  onDismiss,
  onOpenPreview,
  onOpenInNewTab,
}: SpotlightOverlayProps) {
  const [state, dispatch] = useReducer(reducer, initial)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<number | null>(null)
  const reqIdRef = useRef(0)

  // Focus input on mount.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced search.
  const runSearch = useCallback(async (raw: string) => {
    const myReq = ++reqIdRef.current
    const trimmed = raw.trim()
    if (!trimmed) {
      dispatch({ type: 'SET_RESULTS', results: [] })
      return
    }
    dispatch({ type: 'SET_LOADING', loading: true })

    const { query: stripped } = parseSearchTokens(raw)
    const queryForSearch = stripped || raw  // if token-strip empties the query, keep raw

    try {
      const res = await commands.searchWorkspaceHybrid(
        queryForSearch,
        30,
        0,
        undefined,
        undefined,
        undefined,
        undefined,
      )
      if (myReq !== reqIdRef.current) return  // newer request superseded
      if (res.status !== 'ok') {
        dispatch({ type: 'SET_RESULTS', results: [] })
        return
      }
      let candidates = res.data

      // Stage 4: rerank top-30 → top-10.
      if (candidates.length >= 2 && !shortCircuit(candidates)) {
        const rerankRes = await commands.rerankCandidates(
          queryForSearch,
          candidates.map((c) => ({
            node_id: c.node_id,
            title: c.title,
            excerpt: c.excerpt ?? '',
          })),
          10,
          RERANK_TIMEOUT_MS,
        )
        if (myReq !== reqIdRef.current) return
        if (rerankRes.status === 'ok' && rerankRes.data) {
          candidates = applyRerank(candidates, rerankRes.data)
        }
      }

      candidates = candidates.slice(0, 10)
      dispatch({ type: 'SET_RESULTS', results: candidates })

      if (candidates.length > 0) {
        recordQuery(trimmed)
      }
    } catch {
      dispatch({ type: 'SET_RESULTS', results: [] })
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
    }
    debounceRef.current = window.setTimeout(() => {
      void runSearch(state.query)
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
      }
    }
  }, [state.query, runSearch])

  // Keyboard handling.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onDismiss()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      dispatch({ type: 'MOVE', delta: 1 })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      dispatch({ type: 'MOVE', delta: -1 })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = state.results[state.active]
      if (!r) return
      const meta = e.metaKey || e.ctrlKey
      if (meta) onOpenInNewTab(r.node_id)
      else onOpenPreview(r.node_id)
      onDismiss()
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      dispatch({ type: 'TOGGLE_DEBUG' })
    }
  }

  return createPortal(
    <div
      className="spotlight-backdrop"
      onClick={onDismiss}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <div
        className="spotlight"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="spotlight__input-row">
          <Search size={16} className="spotlight__input-icon" />
          <input
            ref={inputRef}
            type="text"
            className="spotlight__input"
            value={state.query}
            onChange={(e) => dispatch({ type: 'SET_QUERY', q: e.currentTarget.value })}
            placeholder="Search notes…"
          />
          <kbd className="spotlight__hint-kbd">⌘K</kbd>
        </div>

        {state.query.trim() === '' ? (
          <RecentQueriesChips onPick={(q) => dispatch({ type: 'SET_QUERY', q })} />
        ) : state.results.length === 0 && !state.loading ? (
          state.didYouMean ? (
            <DidYouMean suggestion={state.didYouMean} onPick={(q) => dispatch({ type: 'SET_QUERY', q })} />
          ) : (
            <NoResultsEmpty query={state.query} />
          )
        ) : (
          <div className="spotlight__results" role="listbox">
            {state.results.map((r, i) => (
              <SearchResultRow
                key={r.node_id}
                result={r}
                isActive={i === state.active}
                showDebug={state.showDebug}
                onClick={(e) => {
                  const meta = e.metaKey || e.ctrlKey
                  if (meta) onOpenInNewTab(r.node_id)
                  else onOpenPreview(r.node_id)
                  onDismiss()
                }}
                onMouseEnter={() => {
                  // Update active index on hover for parity with keyboard nav.
                  if (i !== state.active) {
                    dispatch({ type: 'MOVE', delta: i - state.active })
                  }
                }}
              />
            ))}
          </div>
        )}

        <div className="spotlight__footer">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>⌘↵ new tab</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function shortCircuit(results: WorkspaceSearchResult[]): boolean {
  if (results.length < 2) return false
  const top = results[0].score
  const second = results[1].score
  return second > 0 && top >= 2 * second
}

function applyRerank(
  candidates: WorkspaceSearchResult[],
  reranked: RerankResult[],
): WorkspaceSearchResult[] {
  const byId = new Map(candidates.map((c) => [c.node_id, c]))
  return reranked
    .map((r) => byId.get(r.node_id))
    .filter((c): c is WorkspaceSearchResult => !!c)
}
