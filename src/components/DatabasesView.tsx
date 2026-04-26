/**
 * DatabasesView — W4 Commit F shell.
 *
 * Inline sidebar (list_databases) + inline chrome (title, view tabs, filter
 * pill) + view router (Table | Board | EmptyState for deferred views).
 *
 * Routing to a row's note: dispatch the existing `notes:open` event after
 * `onNavigate('notes')` — same pattern AppShell + SearchView already use.
 *
 * Focus reconcile (Rule 14): not implemented this commit. The intended
 * approach is to re-stat virtualizer-visible rows on window focus, but no
 * `useFocusReconcile` hook exists yet and lifting the visible range out of
 * DatabaseTableView is more change than this shell rewrite warrants.
 * Tracked for the W4 polish phase.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Calendar as CalendarIcon,
  Clock,
  Columns3,
  Database,
  Filter,
  Grid3x3,
  List,
  Plus,
  Search,
  Table2,
} from 'lucide-react'
import { toast } from 'sonner'
import { commands } from '../bindings'
import type { DatabaseSummary } from '../bindings'
import { DatabaseTableView } from './DatabaseTableView'
import { DatabaseBoardView } from './DatabaseBoardView'
import { EmptyState } from './EmptyState'
import { HerOSInput } from './HerOS'

type ViewType = 'table' | 'board' | 'calendar' | 'list' | 'gallery' | 'timeline'

interface Props {
  onNavigate: (page: string) => void
}

const SEARCH_DEBOUNCE_MS = 150

export function DatabasesView({ onNavigate }: Props) {
  const [databases, setDatabases] = useState<DatabaseSummary[]>([])
  const [selectedDbId, setSelectedDbId] = useState<string | null>(null)
  const [currentView, setCurrentView] = useState<ViewType>('table')
  const [searchQuery, setSearchQuery] = useState('')

  // Load + refresh on search query change. 150ms debounce.
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      const res = await commands.listDatabases(searchQuery.trim() || null)
      if (cancelled) return
      if (res.status === 'ok') {
        setDatabases(res.data)
      } else {
        toast.error('Failed to load databases', { description: res.error })
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [searchQuery])

  // Auto-select first database on initial load if nothing is selected.
  useEffect(() => {
    if (!selectedDbId && databases.length > 0) {
      setSelectedDbId(databases[0].id)
    }
  }, [databases, selectedDbId])

  const handleOpenRow = useCallback(
    (rowId: string) => {
      // Existing pattern: navigate to Notes, then fire the `notes:open`
      // event NotesView already listens for (W2.5 Task 16).
      onNavigate('notes')
      window.dispatchEvent(new CustomEvent('notes:open', { detail: rowId }))
    },
    [onNavigate],
  )

  const handleNewDatabase = useCallback(async () => {
    const defaultViewId = crypto.randomUUID()
    const res = await commands.createDatabase('Untitled database', defaultViewId)
    if (res.status === 'ok') {
      const newId = res.data.id
      const refresh = await commands.listDatabases(searchQuery.trim() || null)
      if (refresh.status === 'ok') {
        setDatabases(refresh.data)
      }
      setSelectedDbId(newId)
    } else {
      toast.error('Failed to create database', { description: res.error })
    }
  }, [searchQuery])

  const selectedDb = useMemo(
    () => databases.find(d => d.id === selectedDbId) ?? null,
    [databases, selectedDbId],
  )

  const renderView = () => {
    if (!selectedDbId) {
      return (
        <EmptyState
          variant="empty-inbox"
          title="No database selected"
          description="Pick a database from the sidebar, or create a new one to get started."
          compact
        />
      )
    }
    switch (currentView) {
      case 'table':
        return <DatabaseTableView dbId={selectedDbId} onOpenRow={handleOpenRow} />
      case 'board':
        return <DatabaseBoardView dbId={selectedDbId} onOpenRow={handleOpenRow} />
      default:
        return (
          <EmptyState
            variant="empty-inbox"
            title={`${capitalise(currentView)} view coming soon`}
            description="This view ships in a later W4 polish phase."
            compact
          />
        )
    }
  }

  return (
    <div className="db-shell">
      <aside className="db-sidebar">
        <HerOSInput
          className="db-sidebar__search"
          placeholder="Search databases…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          icon={<Search size={14} />}
        />
        {databases.map(db => (
          <button
            key={db.id}
            type="button"
            className={
              'db-sidebar__item' +
              (selectedDbId === db.id ? ' db-sidebar__item--active' : '')
            }
            onClick={() => setSelectedDbId(db.id)}
          >
            <Database size={14} />
            <span>{db.title || 'Untitled'}</span>
            <span className="db-sidebar__count">{db.row_count}</span>
          </button>
        ))}
        <button
          type="button"
          className="db-sidebar__item"
          onClick={() => void handleNewDatabase()}
        >
          <Plus size={14} />
          <span>New database</span>
        </button>
      </aside>

      <section className="db-stage">
        <header className="db-chrome">
          <span className="db-chrome__title">{selectedDb?.title ?? ''}</span>
          <div className="db-chrome__tabs">
            {VIEW_TABS.map(v => (
              <button
                key={v}
                type="button"
                className={
                  'db-chrome__tab' +
                  (currentView === v ? ' db-chrome__tab--active' : '')
                }
                onClick={() => setCurrentView(v)}
              >
                {viewIcon(v)}
                <span>{capitalise(v)}</span>
              </button>
            ))}
          </div>
          <button type="button" className="db-pill" disabled>
            <Filter size={12} />
            <span>Filter</span>
          </button>
        </header>
        {renderView()}
      </section>
    </div>
  )
}

const VIEW_TABS: ViewType[] = ['table', 'board', 'calendar', 'list', 'gallery', 'timeline']

function viewIcon(v: ViewType) {
  switch (v) {
    case 'table':
      return <Table2 size={12} />
    case 'board':
      return <Columns3 size={12} />
    case 'calendar':
      return <CalendarIcon size={12} />
    case 'list':
      return <List size={12} />
    case 'gallery':
      return <Grid3x3 size={12} />
    case 'timeline':
      return <Clock size={12} />
  }
}

function capitalise(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1)
}
