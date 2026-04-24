import { useMemo, useState, useRef } from 'react'
import { ChevronRight, X } from 'lucide-react'
import type { WorkspaceNode } from '../bindings'

export interface PropertiesPanelProps {
  node: WorkspaceNode
  onIconChange: (icon: string) => Promise<void>
  onTagsChange: (tags: string[]) => Promise<void>
}

const EMOJI_PALETTE = [
  '📄','📝','📁','🗂️','📓','🎯','✅','🔖','⭐','💡',
  '📌','🧭','🏷️','🔗','🔍','🧪','🧰','🗓️','📊','🧵',
]

function parseTags(propertiesJson: string): string[] {
  try {
    const obj = JSON.parse(propertiesJson || '{}')
    const t = obj?.tags
    return Array.isArray(t) ? t.filter((x: unknown) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function formatDate(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  return d.toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function PropertiesPanel({ node, onIconChange, onTagsChange }: PropertiesPanelProps) {
  const [collapsed, setCollapsed] = useState(true)
  const [picker, setPicker] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const tagInputRef = useRef<HTMLInputElement>(null)

  const tags = useMemo(() => parseTags(node.properties), [node.properties])

  const commitTag = async () => {
    const next = tagDraft.trim()
    if (!next) return
    if (tags.includes(next)) { setTagDraft(''); return }
    await onTagsChange([...tags, next])
    setTagDraft('')
  }

  const removeTag = async (t: string) => {
    await onTagsChange(tags.filter((x) => x !== t))
  }

  return (
    <div className="properties-panel">
      <button
        type="button"
        className="properties-panel__toggle"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <ChevronRight
          size={12}
          className={
            'properties-panel__chevron' +
            (!collapsed ? ' properties-panel__chevron--open' : '')
          }
        />
        <span>Properties · {tags.length} {tags.length === 1 ? 'tag' : 'tags'}</span>
      </button>
      {!collapsed && (
        <div className="properties-panel__body">
          <dl className="properties-panel__grid">
            <dt>Icon</dt>
            <dd>
              <button
                type="button"
                className="properties-panel__icon-btn"
                onClick={() => setPicker((p) => !p)}
                aria-label="Change icon"
              >
                {node.icon || '📄'}
              </button>
              {picker && (
                <div className="properties-panel__picker" role="listbox">
                  {EMOJI_PALETTE.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className="properties-panel__picker-item"
                      onClick={() => { void onIconChange(e); setPicker(false) }}
                    >{e}</button>
                  ))}
                </div>
              )}
            </dd>

            <dt>Tags</dt>
            <dd>
              <div className="properties-panel__tags">
                {tags.map((t) => (
                  <span key={t} className="properties-panel__tag-chip" title={t}>
                    <span className="properties-panel__tag-chip__label">{t}</span>
                    <button
                      type="button"
                      className="properties-panel__tag-chip__remove"
                      onClick={() => void removeTag(t)}
                      aria-label={`Remove tag ${t}`}
                    ><X size={10} /></button>
                  </span>
                ))}
                <input
                  ref={tagInputRef}
                  className="properties-panel__tag-input"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.currentTarget.value)}
                  onBlur={() => void commitTag()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void commitTag()
                    } else if (e.key === 'Backspace' && !tagDraft && tags.length > 0) {
                      e.preventDefault()
                      void removeTag(tags[tags.length - 1])
                    }
                  }}
                  placeholder="Add tag…"
                />
              </div>
            </dd>

            <dt>Title</dt>
            <dd className="properties-panel__readonly">{node.name}</dd>

            <dt>ID</dt>
            <dd className="properties-panel__readonly properties-panel__mono">{node.id}</dd>

            <dt>Parent ID</dt>
            <dd className="properties-panel__readonly properties-panel__mono">
              {node.parent_id ?? '—'}
            </dd>

            <dt>Created</dt>
            <dd className="properties-panel__readonly">{formatDate(node.created_at as number)}</dd>

            <dt>Updated</dt>
            <dd className="properties-panel__readonly">{formatDate(node.updated_at as number)}</dd>

            <dt>Vault version</dt>
            <dd className="properties-panel__readonly">
              {(node as any).vault_version ?? '—'}
            </dd>
          </dl>
        </div>
      )}
    </div>
  )
}
