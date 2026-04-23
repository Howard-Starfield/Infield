/**
 * Workspace document tags live in `workspace_nodes.properties` JSON as `tags: string[]`.
 * Canonical store for v1 — not mirrored to YAML frontmatter (avoids drift).
 */

export function parseTagsFromProperties(propertiesJson: string): string[] {
  try {
    const p = JSON.parse(propertiesJson || "{}") as Record<string, unknown>
    const t = p.tags
    if (!Array.isArray(t)) return []
    return t
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export function mergeTagsIntoProperties(
  propertiesJson: string,
  tags: string[],
): string {
  let p: Record<string, unknown> = {}
  try {
    p = JSON.parse(propertiesJson || "{}") as Record<string, unknown>
  } catch {
    p = {}
  }
  if (tags.length === 0) {
    delete p.tags
  } else {
    p.tags = tags
  }
  return JSON.stringify(p)
}

/** Trim, length cap, dedupe by case-insensitive key (keeps first spelling). */
export function normalizeTagsForSave(raw: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    const t = x.trim()
    if (!t || t.length > 48) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

export function parseTagInput(raw: string): string | null {
  const t = raw.trim()
  if (!t || t.length > 48) return null
  return t
}
