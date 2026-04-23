import { useCallback, useMemo } from 'react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import {
  parseDatabaseProperties,
  parseRowProperties,
  parseViewOptions,
  type Field,
  type NodeView,
  type WorkspaceNode,
} from '../../types/workspace'
import { isBoardColumnFieldType } from '@/lib/workspaceFieldSelect'
import { extractCellValue } from './GridCell'
import {
  WorkspacePieChart,
  WorkspaceRadarChart,
  WorkspaceXYAreaChart,
  WorkspaceXYBarChart,
  WorkspaceXYLineChart,
  WorkspaceXYScatterChart,
} from './charts/RechartsWorkspaceKit'

interface Props {
  databaseNode: WorkspaceNode
  viewId: string
  filteredRows: WorkspaceNode[]
  activeView: NodeView | undefined
}

type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'scatter' | 'radar'

const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: 'line', label: 'Line' },
  { id: 'bar', label: 'Bar' },
  { id: 'area', label: 'Area' },
  { id: 'pie', label: 'Pie' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'radar', label: 'Radar' },
]

function cellToLabel(field: Field, raw: unknown): string {
  const v = extractCellValue(raw)
  if (v == null || v === '') return '—'
  if (isBoardColumnFieldType(field.field_type)) {
    const opt = field.type_option?.options?.find(o => o.id === v)
    return opt?.name ?? String(v)
  }
  if (field.field_type === 'multi_select' && Array.isArray(v)) {
    return v.join(', ')
  }
  if (field.field_type === 'checkbox') return v === true ? 'Yes' : 'No'
  return String(v)
}

function cellToNumber(field: Field, raw: unknown): number | null {
  const v = extractCellValue(raw)
  if (v == null) return null
  if (field.field_type === 'checkbox') return v === true ? 1 : 0
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function aggregatePie(points: { name: string; value: number }[]) {
  const m = new Map<string, number>()
  for (const p of points) {
    const key = p.name || '—'
    m.set(key, (m.get(key) ?? 0) + p.value)
  }
  return Array.from(m, ([name, value]) => ({ name, value }))
}

export function ChartView({ databaseNode, viewId, filteredRows, activeView }: Props) {
  const { updateView } = useWorkspaceStore()

  const fields = useMemo(() => {
    return parseDatabaseProperties(databaseNode).fields.sort((a, b) => a.position - b.position)
  }, [databaseNode])

  const viewOptions = useMemo(() => {
    if (!activeView) return {} as Record<string, unknown>
    try {
      return parseViewOptions(activeView)
    } catch {
      return {}
    }
  }, [activeView])

  const chartType: ChartType = useMemo(() => {
    const t = viewOptions.chart_type
    if (t === 'line' || t === 'bar' || t === 'area' || t === 'pie' || t === 'scatter' || t === 'radar') {
      return t
    }
    return 'line'
  }, [viewOptions.chart_type])

  const xFieldId = typeof viewOptions.x_field_id === 'string' ? viewOptions.x_field_id : ''
  const yFieldId = typeof viewOptions.y_field_id === 'string' ? viewOptions.y_field_id : ''

  const defaultXField = useMemo(() => {
    return (
      fields.find(f => f.field_type === 'rich_text' && f.is_primary) ??
      fields.find(f => f.field_type === 'rich_text') ??
      fields.find(f => isBoardColumnFieldType(f.field_type)) ??
      fields[0]
    )
  }, [fields])

  const defaultYField = useMemo(() => {
    return fields.find(f => f.field_type === 'number') ?? fields.find(f => f.field_type === 'checkbox')
  }, [fields])

  const xField = useMemo(() => {
    if (xFieldId) {
      const f = fields.find(x => x.id === xFieldId)
      if (f) return f
    }
    return defaultXField
  }, [fields, xFieldId, defaultXField])

  const yField = useMemo(() => {
    if (yFieldId) {
      const f = fields.find(x => x.id === yFieldId)
      if (f) return f
    }
    return defaultYField
  }, [fields, yFieldId, defaultYField])

  const persistOptions = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!activeView) return
      let base: Record<string, unknown> = {}
      try {
        base = parseViewOptions(activeView)
      } catch {
        base = {}
      }
      const next = { ...base, ...patch }
      await updateView(
        activeView.id,
        activeView.name,
        activeView.color,
        activeView.filters,
        activeView.sorts,
        JSON.stringify(next),
      )
    },
    [activeView, updateView],
  )

  const cartesianPoints = useMemo(() => {
    if (!xField || !yField) return []
    const out: { name: string; value: number }[] = []
    for (const row of filteredRows) {
      const cells = parseRowProperties(row).cells ?? {}
      const y = cellToNumber(yField, cells[yField.id])
      if (y == null) continue
      const name = cellToLabel(xField, cells[xField.id]).slice(0, 48)
      out.push({ name: name || '—', value: y })
    }
    return out
  }, [filteredRows, xField, yField])

  const scatterPoints = useMemo(() => {
    if (!xField || !yField) return []
    if (xField.field_type !== 'number' || yField.field_type !== 'number') return []
    const out: { x: number; y: number }[] = []
    for (const row of filteredRows) {
      const cells = parseRowProperties(row).cells ?? {}
      const x = cellToNumber(xField, cells[xField.id])
      const y = cellToNumber(yField, cells[yField.id])
      if (x == null || y == null) continue
      out.push({ x, y })
    }
    return out
  }, [filteredRows, xField, yField])

  const pieData = useMemo(() => aggregatePie(cartesianPoints), [cartesianPoints])

  const radarData = useMemo(() => {
    if (cartesianPoints.length === 0) return []
    const maxY = Math.max(...cartesianPoints.map(p => p.value), 1)
    const cap = maxY * 1.1
    return cartesianPoints.map(p => ({
      subject: p.name.slice(0, 24),
      x: p.value,
      fullMark: cap,
    }))
  }, [cartesianPoints])

  const chartBody = useMemo(() => {
    const h = 360
    switch (chartType) {
      case 'bar':
        return <WorkspaceXYBarChart data={cartesianPoints} height={h} />
      case 'area':
        return <WorkspaceXYAreaChart data={cartesianPoints} height={h} />
      case 'pie':
        return <WorkspacePieChart data={pieData} height={h} />
      case 'scatter':
        return <WorkspaceXYScatterChart data={scatterPoints} height={h} />
      case 'radar':
        return <WorkspaceRadarChart data={radarData} height={h} />
      case 'line':
      default:
        return <WorkspaceXYLineChart data={cartesianPoints} height={h} />
    }
  }, [chartType, cartesianPoints, pieData, scatterPoints, radarData])

  if (fields.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--workspace-text-muted)',
          fontSize: 13,
          fontFamily: 'Space Grotesk, sans-serif',
        }}
      >
        Add fields to this database to chart row values.
      </div>
    )
  }

  const scatterReady =
    chartType === 'scatter' && xField?.field_type === 'number' && yField?.field_type === 'number'

  return (
    <div
      key={`${viewId}-${databaseNode.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--workspace-bg)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--workspace-border)',
          fontSize: 11,
          fontFamily: 'Space Grotesk, sans-serif',
          color: 'var(--workspace-text-muted)',
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Chart
          <select
            value={chartType}
            onChange={e => void persistOptions({ chart_type: e.target.value })}
            style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 11 }}
          >
            {CHART_TYPES.map(t => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {chartType === 'scatter' ? 'X (number)' : 'X labels'}
          <select
            value={xField?.id ?? ''}
            onChange={e => void persistOptions({ x_field_id: e.target.value })}
            style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 11 }}
          >
            {fields.map(f => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {chartType === 'scatter' ? 'Y (number)' : chartType === 'pie' ? 'Values' : 'Y values'}
          <select
            value={yField?.id ?? ''}
            onChange={e => void persistOptions({ y_field_id: e.target.value })}
            style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 11 }}
          >
            {fields.map(f => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.field_type})
              </option>
            ))}
          </select>
        </label>
        <span style={{ color: 'var(--workspace-text-soft)', marginLeft: 'auto' }}>
          {filteredRows.length} row{filteredRows.length === 1 ? '' : 's'} after filters
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: 12, overflow: 'auto' }}>
        {chartType === 'scatter' && !scatterReady && (
          <div style={{ fontSize: 12, color: 'var(--workspace-text-muted)', marginBottom: 8 }}>
            Scatter needs two <strong>Number</strong> columns (pick both axes above).
          </div>
        )}
        {chartType !== 'scatter' && !yField && (
          <div style={{ fontSize: 12, color: 'var(--workspace-text-muted)', marginBottom: 8 }}>
            Pick a numeric column for values.
          </div>
        )}
        {chartType === 'scatter'
          ? scatterReady && scatterPoints.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--workspace-text-muted)', marginBottom: 8 }}>
                No rows with both X and Y numbers.
              </div>
            )
          : cartesianPoints.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--workspace-text-muted)', marginBottom: 8 }}>
                No rows with a numeric Y value. Check filters or pick another column.
              </div>
            )}
        {chartBody}
      </div>
    </div>
  )
}
