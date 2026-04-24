/**
 * Batch existence check for absolute file paths.
 *
 * Returns the subset of input paths that actually exist on disk. Runs
 * existence checks in parallel via Promise.all. Falls back to "assume
 * all OK" on plugin failure so a missing permission can't break the
 * calling page.
 *
 * Per CLAUDE.md Rule 14 (no fs watcher / no aggressive startup scan),
 * callers should invoke this only on user-triggered loads.
 */
export async function pathsExist(paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set()
  try {
    const { exists } = await import('@tauri-apps/plugin-fs')
    const results = await Promise.all(
      paths.map(async (p) => ({ p, ok: await exists(p).catch(() => false) })),
    )
    return new Set(results.filter((r) => r.ok).map((r) => r.p))
  } catch {
    return new Set(paths)
  }
}
