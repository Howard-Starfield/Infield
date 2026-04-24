import { useState } from 'react'
import { motion } from 'motion/react'
import { Search as SearchIcon, Sparkles } from 'lucide-react'
import { HerOSInput } from './HerOS'

type SearchScope = 'everything' | 'notes' | 'databases'

export function SearchView() {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<SearchScope>('everything')

  return (
    <div
      className="heros-page-container"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}
    >
      {/* Page header */}
      <section
        style={{
          padding: '56px 40px 28px 40px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
          flexShrink: 0,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ textAlign: 'center' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                width: 48,
                height: 2,
                background: 'linear-gradient(to right, transparent, var(--heros-brand))',
                opacity: 0.5,
              }}
            />
            <span
              style={{
                fontSize: 11,
                color: 'var(--heros-brand)',
                fontWeight: 800,
                letterSpacing: '0.4em',
                textTransform: 'uppercase',
              }}
            >
              Search
            </span>
            <div
              style={{
                width: 48,
                height: 2,
                background: 'linear-gradient(to left, transparent, var(--heros-brand))',
                opacity: 0.5,
              }}
            />
          </div>
          <h1
            style={{
              fontSize: 38,
              fontWeight: 200,
              margin: 0,
              letterSpacing: '-0.03em',
              color: '#fff',
            }}
          >
            Find anything in your{' '}
            <span style={{ color: 'var(--heros-brand)', fontWeight: 400 }}>vault</span>
          </h1>
          <p
            style={{
              marginTop: 12,
              fontSize: 13,
              color: 'rgba(255,255,255,0.45)',
              maxWidth: 520,
              lineHeight: 1.6,
            }}
          >
            Hybrid search across notes, voice memos, interviews, and databases — title, body,
            and semantic similarity combined.
          </p>
        </motion.div>

        {/* Scope segmented control */}
        <div
          role="tablist"
          aria-label="Search scope"
          style={{
            display: 'inline-flex',
            padding: 4,
            gap: 4,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--segmented-radius, 999px)',
          }}
        >
          {(
            [
              { id: 'everything', label: 'Everything' },
              { id: 'notes', label: 'Notes' },
              { id: 'databases', label: 'Databases' },
            ] as const
          ).map((s) => {
            const active = scope === s.id
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={active}
                onClick={() => setScope(s.id)}
                style={{
                  padding: '8px 18px',
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  background: active ? 'var(--heros-brand)' : 'transparent',
                  color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                  border: 'none',
                  borderRadius: 'var(--segmented-radius, 999px)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'background 180ms ease, color 180ms ease',
                }}
              >
                {s.label}
              </button>
            )
          })}
        </div>

        {/* Search input */}
        <div style={{ width: '100%', maxWidth: 720, position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              inset: '-2px',
              background: 'linear-gradient(135deg, var(--heros-brand), transparent 40%)',
              borderRadius: 20,
              opacity: 0.15,
              filter: 'blur(8px)',
              zIndex: -1,
            }}
          />
          <HerOSInput
            placeholder={
              scope === 'notes'
                ? 'Search notes and voice memos…'
                : scope === 'databases'
                  ? 'Search database rows and fields…'
                  : 'Search your entire vault…'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            icon={<SearchIcon size={20} color="var(--heros-brand)" />}
          />
          <div
            style={{
              position: 'absolute',
              right: 20,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 10,
                padding: '4px 8px',
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 6,
                color: 'rgba(255,255,255,0.4)',
                fontWeight: 700,
              }}
            >
              ⌘
            </span>
            <span
              style={{
                fontSize: 10,
                padding: '4px 8px',
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 6,
                color: 'rgba(255,255,255,0.4)',
                fontWeight: 700,
              }}
            >
              K
            </span>
          </div>
        </div>
      </section>

      {/* Empty state — W3 wires this to search_workspace_hybrid */}
      <section
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 40px 40px 40px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            maxWidth: 440,
            textAlign: 'center',
            opacity: query.trim() ? 1 : 0.7,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(204,76,43,0.08)',
              border: '1px solid rgba(204,76,43,0.2)',
              color: 'var(--heros-brand)',
            }}
          >
            <Sparkles size={22} />
          </div>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>
            {query.trim() ? `Searching for "${query.trim()}"` : 'Ready to search'}
          </div>
          <div
            style={{
              color: 'rgba(255,255,255,0.45)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            Hybrid search (FTS + vector embeddings) lands in Phase W3. For now this surface
            is cosmetic — the backend is ready, wiring is pending.
          </div>
        </div>
      </section>
    </div>
  )
}
