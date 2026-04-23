import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Field } from '@/types/workspace'
import { isBoardColumnFieldType } from '@/lib/workspaceFieldSelect'
import { cursorDebugLog } from '@/lib/cursorDebugLog'
import { extractCellValue } from './GridCell'

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface ChipProps { field: Field; value: unknown }

function Chip({ field, value }: ChipProps) {
  if (value === null || value === undefined) return null
  if (isBoardColumnFieldType(field.field_type)) {
    const opt = field.type_option?.options?.find((o: { id: string }) => o.id === value)
    const color = opt?.color ?? ''
    const bg = color ? hexToRgba(color, 0.15) : 'rgba(0,0,0,0.06)'
    const fg = color ? `rgb(${color})` : 'var(--workspace-text-muted)'
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '1px 6px',
          borderRadius: 4,
          fontSize: 10,
          background: bg,
          color: fg,
          fontWeight: 500,
        }}
      >
        {opt?.name ?? String(value)}
      </span>
    )
  }
  if (field.field_type === 'checkbox') {
    return value === true ? (
      <span style={{ fontSize: 10, color: 'var(--workspace-accent)' }}>☑</span>
    ) : null
  }
  if (field.field_type === 'number') {
    return (
      <span style={{ fontSize: 10, color: 'var(--workspace-text-muted)' }}>
        {typeof value === 'number' ? value.toLocaleString() : String(value)}
      </span>
    )
  }
  return null
}

interface Props {
  id: string
  title: string
  /** Plain preview of row `body` (markdown). */
  bodyPreview?: string
  fields: Field[]
  cells: Record<string, unknown>
  /** Board view: hide chips for these field ids (e.g. the column group field — already shown in the column header). */
  suppressChipFieldIds?: string[]
  isOverlay?: boolean
  /** Double-click card to open row editor. */
  onOpenRow?: () => void
}

function BodyPreviewLine({ text }: { text: string }) {
  if (!text.trim()) return null
  return (
    <span
      style={{
        fontSize: 11,
        lineHeight: 1.35,
        color: 'var(--workspace-text-muted)',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical' as const,
        overflow: 'hidden',
        wordBreak: 'break-word',
      }}
    >
      {text}
    </span>
  )
}

export function BoardCard({
  id,
  title,
  bodyPreview,
  fields,
  cells,
  suppressChipFieldIds,
  isOverlay,
  onOpenRow,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: 'card' },
  })

  // dnd-kit's transform lives in a CSS variable so the CSS hover rule can
  // compose `translateY(-1px)` after it without a JS-vs-React race. The
  // `transform` property itself is set by `.infield-board-card` in
  // semantic.css — don't write it inline, or the inline value will clobber
  // the hover composition (inline styles have higher specificity).
  const dndTransform = CSS.Transform.toString(transform) ?? ''

  const baseStyle: React.CSSProperties = {
    width: '100%',
    margin: 0,
    // HerOS mockup card: radius 12, glass-tinted fill, hairline border, soft shadow
    borderRadius: 12,
    border: '1px solid color-mix(in srgb, var(--on-surface) 8%, transparent)',
    padding: 'calc(12px * var(--density-scale, 1) * var(--ui-scale, 1))',
    minHeight: 72,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: 'color-mix(in srgb, var(--on-surface) 6%, transparent)',
    boxShadow: '0 4px 12px color-mix(in srgb, black 12%, transparent)',
    // Override sortable's default transition only when it hasn't set one
    // itself — otherwise respect dnd-kit's timing during drop animations.
    transition: transition ?? undefined,
    cursor: 'grab',
    userSelect: 'none',
    boxSizing: 'border-box',
    touchAction: 'none',
    willChange: isDragging ? 'transform' : undefined,
    // Read by `.infield-board-card` in semantic.css. A CSS var never fights
    // inline styles so :hover can add translateY(-1px) cleanly.
    ['--infield-card-transform' as string]: dndTransform || 'none',
  }

  // #region agent log
  /** Capture-only: never replace `{...listeners}` activators (MouseSensor uses onMouseDown, not onPointerDown). */
  const pointerDiagProps = {
    onPointerDownCapture: (e: React.PointerEvent<HTMLDivElement>) => {
      cursorDebugLog({
        hypothesisId: 'H_pointer_capture',
        message: 'board_card_pointerdown_capture',
        data: {
          id,
          defaultPrevented: e.defaultPrevented,
          isPrimary: e.isPrimary,
          button: e.button,
          listenerKeys: listeners ? Object.keys(listeners) : ['listeners_undefined'],
        },
      })
    },
  }
  // #endregion

  const suppressed = new Set(suppressChipFieldIds ?? [])
  // Secondary chips: first 2 non-primary fields that have values (omit board group-by — same as column title)
  const secondaryChips = fields
    .filter(
      f =>
        !f.is_primary &&
        !suppressed.has(f.id) &&
        cells[f.id] !== undefined &&
        cells[f.id] !== null,
    )
    .slice(0, 2)
    .map(f => ({ field: f, value: extractCellValue(cells[f.id]) }))

  if (isDragging && !isOverlay) {
    return (
      <div
        ref={setNodeRef}
        className="infield-board-card"
        data-dragging="true"
        style={{
          ...baseStyle,
          opacity: 0.55,
          borderStyle: 'dashed',
          background: 'var(--workspace-panel-muted)',
          boxShadow: 'none',
        }}
        {...attributes}
        {...pointerDiagProps}
        {...listeners}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--workspace-text-muted)', fontStyle: 'italic' }}>
          {title || 'Untitled'}
        </span>
        {bodyPreview ? <BodyPreviewLine text={bodyPreview} /> : null}
      </div>
    )
  }

  if (isOverlay) {
    // Overlay (follow-the-cursor ghost) gets an extra rotate + lift on top
    // of the dnd transform. Encoded in the CSS var so the .infield-board-card
    // transform rule produces: transform: <dnd> rotate(1.4deg) translateY(-2px).
    const overlayStyle: React.CSSProperties = {
      ...baseStyle,
      width: 280,
      background: 'color-mix(in srgb, var(--on-surface) 12%, transparent)',
      boxShadow: '0 14px 30px color-mix(in srgb, black 30%, transparent)',
      border: '1px solid color-mix(in srgb, var(--on-surface) 16%, transparent)',
      opacity: 0.98,
      ['--infield-card-transform' as string]:
        `${dndTransform || ''} rotate(1.4deg) translateY(-2px)`.trim(),
    }

    return (
      <div
        ref={setNodeRef}
        className="infield-board-card"
        data-dragging="true"
        style={overlayStyle}
        {...attributes}
        {...pointerDiagProps}
        {...listeners}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--workspace-text)' }}>
          {title || 'Untitled'}
        </span>
        {bodyPreview ? <BodyPreviewLine text={bodyPreview} /> : null}
        {secondaryChips.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
            {secondaryChips.map(({ field, value }) => (
              <Chip key={field.id} field={field} value={value} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      className="infield-board-card"
      style={baseStyle}
      {...attributes}
      {...pointerDiagProps}
      {...listeners}
      onDoubleClick={(e) => {
        if (!onOpenRow) return
        e.preventDefault()
        e.stopPropagation()
        onOpenRow()
      }}
    >
      <span
        style={{
          fontSize: 'calc(13px * var(--ui-scale, 1))',
          fontWeight: 500,
          color: 'var(--workspace-text)',
          lineHeight: 1.35,
        }}
      >
        {title || 'Untitled'}
      </span>
      {bodyPreview ? <BodyPreviewLine text={bodyPreview} /> : null}
      {secondaryChips.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {secondaryChips.map(({ field, value }) => (
            <Chip key={field.id} field={field} value={value} />
          ))}
        </div>
      )}
    </div>
  )
}