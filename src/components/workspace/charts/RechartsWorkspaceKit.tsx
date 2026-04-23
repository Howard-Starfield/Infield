/**
 * Prebuilt Recharts compositions themed for the workspace (CSS variables).
 * Wire ChartView / analytics views to these once `layout: 'chart'` exists in node_views.
 * Data props are plain arrays — map from row aggregates in the parent.
 */
import type { ReactElement, ReactNode } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  RadialBarChart,
  RadialBar,
  ScatterChart,
  Scatter,
  ZAxis,
  ComposedChart,
  FunnelChart,
  Funnel,
} from 'recharts'

const AXIS = { fontSize: 10, fill: 'var(--workspace-text-muted)' }
const GRID_STROKE = 'var(--workspace-border)'
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--workspace-panel)',
  border: '1px solid var(--workspace-border-strong)',
  borderRadius: 6,
  fontSize: 11,
}

const PALETTE = [
  'var(--workspace-accent)',
  '#006b58',
  '#3B82F6',
  '#EAB308',
  '#9B59B6',
  '#F97316',
  '#06B6D4',
]

export const SAMPLE_TREND = [
  { name: 'Jan', a: 40, b: 24 },
  { name: 'Feb', a: 30, b: 38 },
  { name: 'Mar', a: 20, b: 48 },
  { name: 'Apr', a: 27, b: 39 },
  { name: 'May', a: 18, b: 52 },
]

export const SAMPLE_PIE = [
  { name: 'A', value: 400 },
  { name: 'B', value: 300 },
  { name: 'C', value: 200 },
]

export const SAMPLE_RADAR = [
  { subject: 'A', x: 120, fullMark: 150 },
  { subject: 'B', x: 98, fullMark: 150 },
  { subject: 'C', x: 86, fullMark: 150 },
  { subject: 'D', x: 99, fullMark: 150 },
]

export const SAMPLE_SCATTER = [
  { x: 10, y: 30, z: 200 },
  { x: 30, y: 200, z: 100 },
  { x: 45, y: 100, z: 260 },
  { x: 50, y: 400, z: 80 },
  { x: 70, y: 150, z: 420 },
]

export const SAMPLE_FUNNEL = [
  { name: 'Visit', value: 1000, fill: 'var(--workspace-accent)' },
  { name: 'Click', value: 600, fill: '#006b58' },
  { name: 'Buy', value: 200, fill: '#3B82F6' },
]

function shell(height: number, children: ReactNode) {
  return (
    <div style={{ width: '100%', height, minHeight: height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children as ReactElement}
      </ResponsiveContainer>
    </div>
  )
}

export function WorkspaceLineChart({
  data = SAMPLE_TREND,
  height = 220,
}: {
  data?: { name: string; a?: number; b?: number }[]
  height?: number
}) {
  return shell(
    height,
    <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
      <XAxis dataKey="name" tick={AXIS} />
      <YAxis tick={AXIS} width={32} />
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      <Line type="monotone" dataKey="a" stroke={PALETTE[0]} strokeWidth={2} dot={false} />
      <Line type="monotone" dataKey="b" stroke={PALETTE[1]} strokeWidth={2} dot={false} />
    </LineChart>
  )
}

export function WorkspaceAreaChart({
  data = SAMPLE_TREND,
  height = 220,
}: {
  data?: { name: string; a?: number; b?: number }[]
  height?: number
}) {
  return shell(
    height,
    <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
      <XAxis dataKey="name" tick={AXIS} />
      <YAxis tick={AXIS} width={32} />
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      <Area type="monotone" dataKey="a" stackId="1" stroke={PALETTE[0]} fill={PALETTE[0]} fillOpacity={0.25} />
      <Area type="monotone" dataKey="b" stackId="1" stroke={PALETTE[1]} fill={PALETTE[1]} fillOpacity={0.25} />
    </AreaChart>
  )
}

export function WorkspaceBarChart({
  data = SAMPLE_TREND,
  height = 220,
}: {
  data?: { name: string; a?: number; b?: number }[]
  height?: number
}) {
  return shell(
    height,
    <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
      <XAxis dataKey="name" tick={AXIS} />
      <YAxis tick={AXIS} width={32} />
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      <Bar dataKey="a" fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
      <Bar dataKey="b" fill={PALETTE[1]} radius={[4, 4, 0, 0]} />
    </BarChart>
  )
}

export function WorkspaceHorizontalBarChart({
  data = SAMPLE_TREND,
  height = 220,
}: {
  data?: { name: string; a?: number; b?: number }[]
  height?: number
}) {
  return shell(
    height,
    <BarChart layout="vertical" data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
      <XAxis type="number" tick={AXIS} />
      <YAxis type="category" dataKey="name" tick={AXIS} width={48} />
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      <Bar dataKey="a" fill={PALETTE[0]} radius={[0, 4, 4, 0]} />
      <Bar dataKey="b" fill={PALETTE[1]} radius={[0, 4, 4, 0]} />
    </BarChart>
  )
}

export function WorkspacePieChart({
  data = SAMPLE_PIE,
  height = 240,
}: {
  data?: { name: string; value: number }[]
  height?: number
}) {
  return shell(
    height,
    <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
      <Pie dataKey="value" data={data} cx="50%" cy="50%" outerRadius={72} label>
        {data.map((_, i) => (
          <Cell key={String(i)} fill={PALETTE[i % PALETTE.length]} />
        ))}
      </Pie>
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
    </PieChart>
  )
}

export function WorkspaceRadarChart({
  data = SAMPLE_RADAR,
  height = 260,
}: {
  data?: { subject: string; x: number; fullMark: number }[]
  height?: number
}) {
  return shell(
    height,
    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
      <PolarGrid stroke={GRID_STROKE} />
      <PolarAngleAxis dataKey="subject" tick={AXIS} />
      <PolarRadiusAxis tick={AXIS} />
      <Radar name="Series" dataKey="x" stroke={PALETTE[0]} fill={PALETTE[0]} fillOpacity={0.35} />
      <Tooltip contentStyle={TOOLTIP_STYLE} />
    </RadarChart>
  )
}

export function WorkspaceRadialBarChart({ height = 260 }) {
  const data = [{ name: 'A', uv: 60, fill: PALETTE[0] }, { name: 'B', uv: 40, fill: PALETTE[1] }]
  return shell(
    height,
    <RadialBarChart
      cx="50%"
      cy="50%"
      innerRadius="20%"
      outerRadius="90%"
      data={data}
      startAngle={90}
      endAngle={-270}
    >
      <RadialBar background dataKey="uv" cornerRadius={4} />
      <Legend iconSize={10} layout="horizontal" verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
      <Tooltip contentStyle={TOOLTIP_STYLE} />
    </RadialBarChart>
  )
}

export function WorkspaceScatterChart({
  data = SAMPLE_SCATTER,
  height = 240,
}: {
  data?: { x: number; y: number; z: number }[]
  height?: number
}) {
  return shell(
    height,
    <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
      <CartesianGrid stroke={GRID_STROKE} />
      <XAxis type="number" dataKey="x" tick={AXIS} name="x" />
      <YAxis type="number" dataKey="y" tick={AXIS} name="y" />
      <ZAxis type="number" dataKey="z" range={[40, 160]} />
      <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={TOOLTIP_STYLE} />
      <Scatter name="Points" data={data} fill={PALETTE[0]} />
    </ScatterChart>
  )
}

export function WorkspaceComposedChart({
  data = SAMPLE_TREND,
  height = 240,
}: {
  data?: { name: string; a?: number; b?: number }[]
  height?: number
}) {
  return shell(
    height,
    <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
      <XAxis dataKey="name" tick={AXIS} />
      <YAxis tick={AXIS} width={32} />
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      <Area type="monotone" dataKey="b" fill={PALETTE[1]} stroke={PALETTE[1]} fillOpacity={0.2} />
      <Bar dataKey="a" barSize={20} fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
      <Line type="monotone" dataKey="a" stroke={PALETTE[2]} strokeWidth={2} dot />
    </ComposedChart>
  )
}

export function WorkspaceFunnelChart({
  data = SAMPLE_FUNNEL,
  height = 260,
}: {
  data?: { name: string; value: number; fill: string }[]
  height?: number
}) {
  return shell(
    height,
    <FunnelChart margin={{ top: 8, right: 24, left: 24, bottom: 8 }}>
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      <Funnel dataKey="value" data={data} isAnimationActive />
    </FunnelChart>
  )
}

/** Single Y series; X axis uses `name`, Y uses `value` (workspace database chart view). */
export function WorkspaceXYLineChart({
  data,
  height = 320,
}: {
  data: { name: string; value: number }[]
  height?: number
}) {
  return shell(
    height,
    <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
      <XAxis dataKey="name" tick={AXIS} />
      <YAxis tick={AXIS} width={40} />
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      <Line type="monotone" dataKey="value" stroke={PALETTE[0]} strokeWidth={2} dot />
    </LineChart>,
  )
}

export function WorkspaceXYBarChart({
  data,
  height = 320,
}: {
  data: { name: string; value: number }[]
  height?: number
}) {
  return shell(
    height,
    <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
      <XAxis dataKey="name" tick={AXIS} />
      <YAxis tick={AXIS} width={40} />
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      <Bar dataKey="value" fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
    </BarChart>,
  )
}

export function WorkspaceXYAreaChart({
  data,
  height = 320,
}: {
  data: { name: string; value: number }[]
  height?: number
}) {
  return shell(
    height,
    <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
      <XAxis dataKey="name" tick={AXIS} />
      <YAxis tick={AXIS} width={40} />
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      <Area
        type="monotone"
        dataKey="value"
        stroke={PALETTE[0]}
        fill={PALETTE[0]}
        fillOpacity={0.25}
      />
    </AreaChart>,
  )
}

export function WorkspaceXYScatterChart({
  data,
  height = 320,
}: {
  data: { x: number; y: number }[]
  height?: number
}) {
  const withZ = data.map((p) => ({ ...p, z: 200 }))
  return shell(
    height,
    <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
      <XAxis type="number" dataKey="x" tick={AXIS} name="x" />
      <YAxis type="number" dataKey="y" tick={AXIS} name="y" />
      <ZAxis type="number" dataKey="z" range={[60, 60]} />
      <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={TOOLTIP_STYLE} />
      <Scatter name="Data" data={withZ} fill={PALETTE[0]} />
    </ScatterChart>,
  )
}

/** Scrollable gallery of all presets — useful for QA or embedding in a “chart picker”. */
export function WorkspaceChartGallery() {
  const block = (title: string, node: ReactNode) => (
    <div
      key={title}
      style={{
        border: '1px solid var(--workspace-border)',
        borderRadius: 8,
        padding: 12,
        background: 'var(--workspace-panel)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--workspace-text-muted)', marginBottom: 8 }}>
        {title}
      </div>
      {node}
    </div>
  )

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 12,
        padding: 12,
        overflow: 'auto',
        height: '100%',
        alignContent: 'start',
      }}
    >
      {block('Line', <WorkspaceLineChart />)}
      {block('Area', <WorkspaceAreaChart />)}
      {block('Bar', <WorkspaceBarChart />)}
      {block('Horizontal bar', <WorkspaceHorizontalBarChart />)}
      {block('Pie', <WorkspacePieChart />)}
      {block('Radar', <WorkspaceRadarChart />)}
      {block('Radial bar', <WorkspaceRadialBarChart />)}
      {block('Scatter', <WorkspaceScatterChart />)}
      {block('Composed', <WorkspaceComposedChart />)}
      {block('Funnel', <WorkspaceFunnelChart />)}
    </div>
  )
}
