import { describe, expect, test, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Breadcrumb } from '../Breadcrumb'
import type { WorkspaceNode } from '../../bindings'
import { clearAncestorsCache } from '../../editor/ancestors'

function node(id: string, parent: string | null, name: string): WorkspaceNode {
  return {
    id, parent_id: parent, name, icon: '📄',
    node_type: 'document', position: 0, body: '',
    properties: '{}', created_at: 0, updated_at: 0,
    deleted_at: null, vault_rel_path: null, vault_version: 0,
  } as unknown as WorkspaceNode
}

function makeGetNode(chain: Record<string, WorkspaceNode | undefined>) {
  return vi.fn(async (id: string) => {
    const n = chain[id]
    if (!n) return { status: 'error' as const, error: 'missing' }
    return { status: 'ok' as const, data: n }
  })
}

// Mock the commands binding used inside Breadcrumb.
vi.mock('../../bindings', () => ({
  commands: { getNode: vi.fn() },
}))
import { commands } from '../../bindings'

describe('Breadcrumb', () => {
  beforeEach(() => { clearAncestorsCache(); vi.clearAllMocks() })

  test('renders a 3-segment chain root → mid → leaf', async () => {
    ;(commands.getNode as any).mockImplementation(
      makeGetNode({
        root: node('root', null, 'Projects'),
        mid:  node('mid', 'root', 'Handy'),
        leaf: node('leaf', 'mid', 'W2.5 Plan'),
      }),
    )
    render(<Breadcrumb nodeId="leaf" onNavigate={() => {}} />)
    await waitFor(() => expect(screen.getByText('Projects')).toBeInTheDocument())
    expect(screen.getByText('Handy')).toBeInTheDocument()
    expect(screen.getByText('W2.5 Plan')).toBeInTheDocument()
  })

  test('click on a non-leaf segment fires onNavigate with its id', async () => {
    ;(commands.getNode as any).mockImplementation(
      makeGetNode({
        root: node('root', null, 'Projects'),
        leaf: node('leaf', 'root', 'W2.5'),
      }),
    )
    const onNavigate = vi.fn()
    render(<Breadcrumb nodeId="leaf" onNavigate={onNavigate} />)
    await waitFor(() => screen.getByText('Projects'))
    fireEvent.click(screen.getByText('Projects'))
    expect(onNavigate).toHaveBeenCalledWith('root')
  })

  test('collapses middles with "…" when chain total exceeds 60 chars', async () => {
    const chainMap: Record<string, WorkspaceNode> = {}
    const ids = ['n0','n1','n2','n3','n4','n5','n6','n7','n8']
    ids.forEach((id, i) => {
      chainMap[id] = node(id, i === 0 ? null : ids[i - 1], `Level-${i}-segment-${'x'.repeat(8)}`)
    })
    ;(commands.getNode as any).mockImplementation(makeGetNode(chainMap))
    render(<Breadcrumb nodeId="n8" onNavigate={() => {}} />)
    await waitFor(() => screen.getByText('…'))
    // Root should still be visible.
    expect(screen.getByText(/Level-0-/)).toBeInTheDocument()
    // Leaf should still be visible.
    expect(screen.getByText(/Level-8-/)).toBeInTheDocument()
    // A middle (e.g. Level-4) should be collapsed out.
    expect(screen.queryByText(/Level-4-/)).not.toBeInTheDocument()
  })

  test('clicking "…" expands all segments', async () => {
    const chainMap: Record<string, WorkspaceNode> = {}
    const ids = ['n0','n1','n2','n3','n4','n5']
    ids.forEach((id, i) => {
      chainMap[id] = node(id, i === 0 ? null : ids[i - 1], `Longish-Name-Number-${i}`)
    })
    ;(commands.getNode as any).mockImplementation(makeGetNode(chainMap))
    render(<Breadcrumb nodeId="n5" onNavigate={() => {}} />)
    await waitFor(() => screen.getByText('…'))
    fireEvent.click(screen.getByText('…'))
    await waitFor(() => expect(screen.queryByText('…')).not.toBeInTheDocument())
    expect(screen.getByText(/Longish-Name-Number-3/)).toBeInTheDocument()
  })
})
