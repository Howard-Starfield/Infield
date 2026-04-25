const KEY = 'handy.search.recent'
const MAX = 10

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

function write(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // localStorage full or disabled — silent no-op.
  }
}

export function getRecentQueries(): string[] {
  return read()
}

export function recordQuery(q: string): void {
  const trimmed = q.trim()
  if (!trimmed) return
  const list = read().filter((x) => x !== trimmed)
  list.unshift(trimmed)
  write(list.slice(0, MAX))
}

export function clearRecentQueries(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // no-op
  }
}
