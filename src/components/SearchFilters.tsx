import { useEffect, useState } from 'react'
import { commands } from '../bindings'

export type SearchFiltersState = {
  nodeTypes: Set<'document' | 'database' | 'row'>
  tags: Set<string>
  dateRange: 'any' | 'today' | 'last_week' | 'last_month'
}

export const initialFilters: SearchFiltersState = {
  nodeTypes: new Set(),
  tags: new Set(),
  dateRange: 'any',
}

export function SearchFilters({
  state,
  onChange,
}: {
  state: SearchFiltersState
  onChange: (next: SearchFiltersState) => void
}) {
  const [knownTags, setKnownTags] = useState<string[]>([])

  useEffect(() => {
    void loadKnownTags().then(setKnownTags)
  }, [])

  return (
    <aside className="search-filters">
      <section className="search-filters__section">
        <h3 className="search-filters__heading">Type</h3>
        {(['document', 'database', 'row'] as const).map((t) => (
          <label key={t} className="search-filters__checkbox">
            <input
              type="checkbox"
              checked={state.nodeTypes.has(t)}
              onChange={(e) => {
                const next = new Set(state.nodeTypes)
                if (e.currentTarget.checked) next.add(t)
                else next.delete(t)
                onChange({ ...state, nodeTypes: next })
              }}
            />
            <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
          </label>
        ))}
      </section>

      {knownTags.length > 0 && (
        <section className="search-filters__section">
          <h3 className="search-filters__heading">Tags</h3>
          {knownTags.map((tag) => (
            <label key={tag} className="search-filters__checkbox">
              <input
                type="checkbox"
                checked={state.tags.has(tag)}
                onChange={(e) => {
                  const next = new Set(state.tags)
                  if (e.currentTarget.checked) next.add(tag)
                  else next.delete(tag)
                  onChange({ ...state, tags: next })
                }}
              />
              <span>#{tag}</span>
            </label>
          ))}
        </section>
      )}

      <section className="search-filters__section">
        <h3 className="search-filters__heading">Date</h3>
        {(['any', 'today', 'last_week', 'last_month'] as const).map((d) => (
          <label key={d} className="search-filters__radio">
            <input
              type="radio"
              checked={state.dateRange === d}
              onChange={() => onChange({ ...state, dateRange: d })}
            />
            <span>{labelFor(d)}</span>
          </label>
        ))}
      </section>
    </aside>
  )
}

function labelFor(d: string): string {
  switch (d) {
    case 'any': return 'Any time'
    case 'today': return 'Today'
    case 'last_week': return 'Last week'
    case 'last_month': return 'Last month'
    default: return d
  }
}

async function loadKnownTags(): Promise<string[]> {
  // For v1, derive tags by scanning all live nodes' properties JSON.
  // If this becomes slow at scale, push into a SQL aggregate view.
  try {
    const res = await commands.getRootNodes()
    if (res.status !== 'ok') return []
    const tagSet = new Set<string>()
    const collect = (props: string) => {
      try {
        const obj = JSON.parse(props || '{}')
        const tags = obj?.tags
        if (Array.isArray(tags)) {
          for (const t of tags) if (typeof t === 'string') tagSet.add(t)
        }
      } catch {
        // skip malformed JSON
      }
    }
    for (const n of res.data) collect(n.properties)
    return Array.from(tagSet).sort()
  } catch {
    return []
  }
}
