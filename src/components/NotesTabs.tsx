import { X, Plus } from 'lucide-react'
import type { Tab } from '../editor/tabsReducer'

export interface NotesTabsProps {
  tabs: Tab[]
  activeTabId: string | null
  nodeMetaById: Map<string, { name: string; icon: string }>
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onPromote: (tabId: string) => void
  onNewTab: () => void
}

export function NotesTabs({
  tabs, activeTabId, nodeMetaById, onSelect, onClose, onPromote, onNewTab,
}: NotesTabsProps) {
  if (tabs.length === 0) return null
  return (
    <div role="tablist" className="notes-tabs">
      {tabs.map((tab) => {
        const meta = nodeMetaById.get(tab.nodeId)
        const name = meta?.name ?? 'Untitled'
        const icon = meta?.icon || '📄'
        const isActive = tab.id === activeTabId
        const cls =
          'notes-tabs__tab' +
          (isActive ? ' notes-tabs__tab--active' : '') +
          (tab.preview ? ' notes-tabs__tab--preview' : '') +
          (tab.dirty ? ' notes-tabs__tab--dirty' : '')
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            className={cls}
            title={name}
            onClick={() => onSelect(tab.id)}
            onDoubleClick={(e) => {
              e.preventDefault()
              if (tab.preview) onPromote(tab.id)
            }}
            onAuxClick={(e) => {
              // Middle-click closes — cheap to add, matches browser affordance.
              if (e.button === 1) {
                e.preventDefault()
                onClose(tab.id)
              }
            }}
          >
            <span className="notes-tabs__tab__icon" aria-hidden>{icon}</span>
            <span className="notes-tabs__tab__label">{name}</span>
            <span
              className="notes-tabs__tab__close"
              role="button"
              aria-label="Close tab"
              title={tab.dirty ? 'Unsaved — resolve before closing' : 'Close'}
              onClick={(e) => { e.stopPropagation(); onClose(tab.id) }}
            >
              <X size={12} />
            </span>
          </button>
        )
      })}
      <button
        type="button"
        className="notes-tabs__new"
        aria-label="New tab"
        title="New tab"
        onClick={onNewTab}
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
