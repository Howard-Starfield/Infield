import { useState, useCallback } from 'react'
import type { Field, WorkspaceNode } from '../../types/workspace'
import { parseRowProperties } from '../../types/workspace'

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface Props {
  rowNode: WorkspaceNode
  fields: Field[]
  onFieldChange: (fieldId: string, value: unknown) => void
}

function SelectEditor({
  value,
  options,
  onChange,
}: {
  value: unknown
  options: Array<{ id: string; name: string; color: string }>
  onChange: (newValue: string) => void
}) {
  return (
    <select
      value={value as string || ''}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '4px 6px',
        border: '1px solid var(--workspace-border)',
        borderRadius: 4,
        background: 'var(--workspace-bg)',
        color: 'var(--workspace-text)',
        fontSize: 12,
        fontFamily: 'Inter, sans-serif',
        cursor: 'pointer',
      }}
    >
      <option value="">—</option>
      {options.map(opt => (
        <option key={opt.id} value={opt.id}>{opt.name}</option>
      ))}
    </select>
  )
}

function MultiSelectEditor({
  value,
  options,
  onChange,
}: {
  value: unknown
  options: Array<{ id: string; name: string; color: string }>
  onChange: (newValue: string[]) => void
}) {
  const selected = Array.isArray(value) ? value as string[] : []

  const handleToggle = (optId: string) => {
    if (selected.includes(optId)) {
      onChange(selected.filter(id => id !== optId))
    } else {
      onChange([...selected, optId])
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map(opt => {
        const isSelected = selected.includes(opt.id)
        return (
          <button
            key={opt.id}
            onClick={() => handleToggle(opt.id)}
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid',
              borderColor: isSelected ? `rgb(${opt.color})` : 'var(--workspace-border)',
              background: isSelected ? `rgba(${opt.color}, 0.15)` : 'transparent',
              color: isSelected ? `rgb(${opt.color})` : 'var(--workspace-text)',
              fontSize: 11,
              fontFamily: 'Inter, sans-serif',
              cursor: 'pointer',
              transition: 'background 100ms, border-color 100ms',
            }}
          >
            {opt.name}
          </button>
        )
      })}
    </div>
  )
}

function CheckboxEditor({
  value,
  onChange,
}: {
  value: unknown
  onChange: (newValue: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        padding: '4px 8px',
        borderRadius: 4,
        border: '1px solid var(--workspace-border)',
        background: value ? 'rgba(183,35,1,0.08)' : 'transparent',
        color: value ? 'var(--workspace-accent)' : 'var(--workspace-text-muted)',
        fontSize: 14,
        cursor: 'pointer',
        width: 32,
        textAlign: 'center',
      }}
    >
      {value ? '☑' : '☐'}
    </button>
  )
}

function DateEditor({
  value,
  onChange,
}: {
  value: unknown
  onChange: (newValue: string) => void
}) {
  const dateValue = value instanceof Date ? value.toISOString().split('T')[0] : value as string

  return (
    <input
      type="date"
      value={dateValue || ''}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '4px 6px',
        border: '1px solid var(--workspace-border)',
        borderRadius: 4,
        background: 'var(--workspace-bg)',
        color: 'var(--workspace-text)',
        fontSize: 12,
        fontFamily: 'Inter, sans-serif',
      }}
    />
  )
}

function TextEditor({
  value,
  onChange,
}: {
  value: unknown
  onChange: (newValue: string) => void
}) {
  return (
    <input
      type="text"
      value={value as string || ''}
      onChange={e => onChange(e.target.value)}
      placeholder="—"
      style={{
        width: '100%',
        padding: '4px 6px',
        border: '1px solid var(--workspace-border)',
        borderRadius: 4,
        background: 'var(--workspace-bg)',
        color: 'var(--workspace-text)',
        fontSize: 12,
        fontFamily: 'Inter, sans-serif',
      }}
    />
  )
}

function UrlEditor({
  value,
  onChange,
}: {
  value: unknown
  onChange: (newValue: string) => void
}) {
  return (
    <input
      type="url"
      value={value as string || ''}
      onChange={e => onChange(e.target.value)}
      placeholder="https://"
      style={{
        width: '100%',
        padding: '4px 6px',
        border: '1px solid var(--workspace-border)',
        borderRadius: 4,
        background: 'var(--workspace-bg)',
        color: 'var(--workspace-text)',
        fontSize: 12,
        fontFamily: 'Inter, sans-serif',
      }}
    />
  )
}

// Render a read-only cell value
function CellValueDisplay({ field, value }: { field: Field; value: unknown }) {
  if (value === null || value === undefined) {
    return <span style={{ opacity: 0.4, fontSize: 12 }}>—</span>
  }

  switch (field.field_type) {
    case 'checkbox':
      return (
        <span style={{ fontSize: 14, color: value ? 'var(--workspace-accent)' : 'var(--workspace-text-soft)' }}>
          {value ? '☑' : '☐'}
        </span>
      )
    case 'number':
      return <span style={{ fontSize: 12 }}>{typeof value === 'number' ? value.toLocaleString() : String(value)}</span>
    case 'date':
    case 'date_time': {
      if (typeof value === 'string') {
        try {
          const d = new Date(value)
          if (!isNaN(d.getTime())) {
            return (
              <span style={{ fontSize: 12 }}>
                {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )
          }
        } catch {
          // fall through
        }
      }
      return <span style={{ fontSize: 12 }}>{String(value)}</span>
    }
    case 'board':
    case 'single_select': {
      const option = field.type_option?.options?.find((o: { id: string }) => o.id === value)
      const color = option?.color ?? ''
      const bg = color ? hexToRgba(color, 0.15) : 'rgba(0,0,0,0.06)'
      const fg = color ? `rgb(${color})` : 'var(--workspace-text)'
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            background: bg,
            color: fg,
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {option?.name ?? String(value)}
        </span>
      )
    }
    case 'multi_select': {
      if (!Array.isArray(value)) return <span style={{ fontSize: 12 }}>{String(value)}</span>
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {value.map((v: string, i: number) => {
            const option = field.type_option?.options?.find((o: { id: string }) => o.id === v)
            const color = option?.color ?? ''
            const bg = color ? hexToRgba(color, 0.15) : 'rgba(0,0,0,0.06)'
            const fg = color ? `rgb(${color})` : 'var(--workspace-text)'
            return (
              <span
                key={i}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: 10,
                  background: bg,
                  color: fg,
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                {option?.name ?? v}
              </span>
            )
          })}
        </div>
      )
    }
    case 'url': {
      const url = String(value)
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'var(--workspace-accent)',
            textDecoration: 'none',
            fontSize: 11,
            fontFamily: 'Inter, sans-serif',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 200,
            display: 'block',
          }}
        >
          {url}
        </a>
      )
    }
    default:
      return <span style={{ fontSize: 12 }}>{String(value)}</span>
  }
}

// Field chip/row for a single property
function FieldPropertyRow({ field, value, onChange }: { field: Field; value: unknown; onChange: (newValue: unknown) => void }) {
  const [isEditing, setIsEditing] = useState(false)

  const handleChange = useCallback((newValue: unknown) => {
    onChange(newValue)
  }, [onChange])

  const renderEditor = () => {
    switch (field.field_type) {
      case 'board':
      case 'single_select':
        return (
          <SelectEditor
            value={value}
            options={field.type_option?.options || []}
            onChange={handleChange}
          />
        )
      case 'multi_select':
        return (
          <MultiSelectEditor
            value={value}
            options={field.type_option?.options || []}
            onChange={handleChange}
          />
        )
      case 'checkbox':
        return <CheckboxEditor value={value} onChange={handleChange} />
      case 'date':
      case 'date_time':
        return <DateEditor value={value} onChange={handleChange} />
      case 'url':
        return <UrlEditor value={value} onChange={handleChange} />
      case 'number':
        return (
          <input
            type="number"
            value={value as number ?? ''}
            onChange={e => handleChange(e.target.value ? Number(e.target.value) : null)}
            placeholder="—"
            style={{
              width: '100%',
              padding: '4px 6px',
              border: '1px solid var(--workspace-border)',
              borderRadius: 4,
              background: 'var(--workspace-bg)',
              color: 'var(--workspace-text)',
              fontSize: 12,
              fontFamily: 'Inter, sans-serif',
            }}
          />
        )
      default:
        return <TextEditor value={value} onChange={handleChange} />
    }
  }

  return (
    <div
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--workspace-border)',
      }}
    >
      {/* Field label */}
      <div
        style={{
          fontSize: 10,
          fontFamily: 'Inter, sans-serif',
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          color: 'var(--workspace-text-muted)',
          marginBottom: 6,
          fontWeight: 600,
        }}
      >
        {field.name}
      </div>

      {/* Editable cell value */}
      {isEditing ? (
        <div onBlur={() => setIsEditing(false)}>
          {renderEditor()}
        </div>
      ) : (
        <div
          onClick={() => setIsEditing(true)}
          style={{
            cursor: 'pointer',
            minHeight: 24,
            display: 'flex',
            alignItems: 'center',
          }}
          title="Click to edit"
        >
          <CellValueDisplay field={field} value={value} />
        </div>
      )}
    </div>
  )
}

export function PropertiesSidebar({ rowNode, fields, onFieldChange }: Props) {
  const cells = parseRowProperties(rowNode).cells

  // Sort fields by position
  const sortedFields = [...fields].sort((a, b) => a.position - b.position)

  return (
    <div
      className="workspace-soft-panel"
      style={{
        width: 280,
        flexShrink: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid var(--workspace-border)',
          fontSize: 11,
          fontFamily: 'Inter, sans-serif',
          textTransform: 'uppercase',
          letterSpacing: '.12em',
          color: 'var(--workspace-text-soft)',
          fontWeight: 600,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.4), rgba(255,255,255,0)), transparent',
        }}
      >
        Properties
      </div>

      {/* Field rows */}
      <div style={{ flex: 1 }}>
        {sortedFields.length === 0 ? (
          <div
            style={{
              padding: 16,
              textAlign: 'center',
              color: 'var(--workspace-text-muted)',
              fontSize: 12,
              opacity: 0.6,
            }}
          >
            No fields defined
          </div>
        ) : (
          sortedFields.map(field => (
            <FieldPropertyRow
              key={field.id}
              field={field}
              value={cells[field.id]}
              onChange={newValue => onFieldChange(field.id, newValue)}
            />
          ))
        )}
      </div>
    </div>
  )
}
