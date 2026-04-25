export interface DateFilter {
  from: number  // unix-ms inclusive
  to?: number   // unix-ms inclusive
}

export interface ParsedSearchTokens {
  query: string
  dateFilter?: DateFilter
  tag?: string
}

const TAG_RE = /^\s*#([a-zA-Z0-9_-]+)\s*$/

const TOKEN_PATTERNS: Array<{
  pattern: RegExp
  toFilter: (now: Date) => DateFilter
}> = [
  {
    pattern: /\btoday\b/i,
    toFilter: (now) => ({
      from: startOfDay(now).getTime(),
      to: endOfDay(now).getTime(),
    }),
  },
  {
    pattern: /\byesterday\b/i,
    toFilter: (now) => {
      const y = addDays(now, -1)
      return { from: startOfDay(y).getTime(), to: endOfDay(y).getTime() }
    },
  },
  {
    pattern: /\blast\s+week\b/i,
    toFilter: (now) => weekRange(now, -1),
  },
  {
    pattern: /\bthis\s+week\b/i,
    toFilter: (now) => weekRange(now, 0),
  },
  {
    pattern: /\blast\s+month\b/i,
    toFilter: (now) => monthRange(now, -1),
  },
  {
    pattern: /\bthis\s+month\b/i,
    toFilter: (now) => monthRange(now, 0),
  },
]

export function parseSearchTokens(raw: string): ParsedSearchTokens {
  const tagMatch = raw.match(TAG_RE)
  if (tagMatch) {
    return { query: '', tag: tagMatch[1] }
  }

  const now = new Date()
  for (const { pattern, toFilter } of TOKEN_PATTERNS) {
    if (pattern.test(raw)) {
      return {
        query: raw.replace(pattern, '').replace(/\s+/g, ' ').trim(),
        dateFilter: toFilter(now),
      }
    }
  }
  return { query: raw }
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function weekRange(now: Date, weekOffset: number): DateFilter {
  // Week starts Monday (locale-agnostic for simplicity).
  const day = now.getDay()  // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const daysSinceMonday = (day + 6) % 7
  const thisMonday = addDays(now, -daysSinceMonday)
  const targetMonday = addDays(thisMonday, weekOffset * 7)
  const targetSunday = addDays(targetMonday, 6)
  return {
    from: startOfDay(targetMonday).getTime(),
    to: endOfDay(targetSunday).getTime(),
  }
}

function monthRange(now: Date, monthOffset: number): DateFilter {
  const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0)
  return {
    from: startOfDay(start).getTime(),
    to: endOfDay(end).getTime(),
  }
}
