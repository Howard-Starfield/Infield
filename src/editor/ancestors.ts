import type { commands as Commands, WorkspaceNode } from '../bindings'

const DEPTH_CAP = 64

type CommandsLike = Pick<typeof Commands, 'getNode'>

const cache = new Map<string, WorkspaceNode[]>()

export function clearAncestorsCache() {
  cache.clear()
}

/**
 * Walk up the parent chain from `leafId` and return the chain in
 * root-to-leaf order (inclusive of the leaf). Stops at a missing
 * parent, a cycle, or depth cap (64).
 *
 * Session-memoized by leaf id; call `clearAncestorsCache()` on any
 * tree mutation that could invalidate a cached chain.
 */
export async function getAncestors(
  leafId: string,
  commands: CommandsLike,
): Promise<WorkspaceNode[]> {
  const cached = cache.get(leafId)
  if (cached) return cached

  const chain: WorkspaceNode[] = []
  let currentId: string | null = leafId
  while (currentId) {
    const res = await commands.getNode(currentId)
    if (res.status !== 'ok' || !res.data) break
    chain.unshift(res.data)
    if (chain.length >= DEPTH_CAP) break
    currentId = res.data.parent_id
  }
  cache.set(leafId, chain)
  return chain
}
