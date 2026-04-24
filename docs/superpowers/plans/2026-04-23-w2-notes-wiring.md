# W2 — Notes wiring (Workspace tree + CodeMirror 6 editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dormant eBay-style `NotesView` with a functional workspace tree + CodeMirror 6 markdown editor + backlinks pane, wired to Handy's stable Rust backend so users can create, edit, organize, and cross-link documents with autosave to SQLite + vault `.md` files.

**Architecture:** Three-column layout inside `NotesView`'s existing `.heros-page-container` glass frame — `<Tree>` (left, drag-drop, filter, keyboard nav) / `<MarkdownEditor>` (middle, CM6 with markdown+GFM) / `<BacklinksPane>` (right, `get_backlinks` results). CM6 owns the doc body (Approach B uncontrolled); React reads the body only on save. The Rule 13 conflict guard already ships in Rust (`VAULT_CONFLICT:{json}` error); the frontend pattern-matches the prefix and drives an inline banner state machine. No new Tauri commands.

**Tech Stack:** CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/lang-markdown`, `@codemirror/autocomplete`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/search`, `@lezer/markdown` with GFM), `@dnd-kit/core` + `@dnd-kit/sortable` (already in `package.json`), `@tanstack/react-virtual` (already), Vitest + jsdom, React 19, Tauri 2.

**Spec:** [docs/superpowers/specs/2026-04-23-w2-notes-wiring-design.md](../specs/2026-04-23-w2-notes-wiring-design.md).

---

## Pre-flight

Verify you can build before touching anything. W2 is additive — if the
tree is broken at start, diagnose first.

- [ ] **Check baseline is green**

```bash
bun run build
cd src-tauri && cargo test --lib && cd ..
bunx vitest run
```

Expected: all three succeed. Note the Vitest count (should be around the
post-Phase-A 125-test baseline plus whatever W0/W1 added).

- [ ] **Confirm the Rust conflict guard format**

```bash
grep -n "VAULT_CONFLICT" src-tauri/src/managers/workspace/workspace_manager.rs
```

Expected: line ~1670 shows `format!("VAULT_CONFLICT:{{\"node_id\":\"{}\",\"disk_mtime_secs\":{},\"last_seen_secs\":{}}}", …)`.
If the format differs, STOP and adjust the spec + this plan. The
frontend depends on this exact shape.

---

## Part A — Foundation (deps, utilities, theme)

### Task 1: Add CodeMirror 6 dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install CM6 packages**

```bash
bun add codemirror@^6.0.1 \
  @codemirror/state@^6.5.0 \
  @codemirror/view@^6.34.0 \
  @codemirror/commands@^6.7.0 \
  @codemirror/language@^6.10.0 \
  @codemirror/search@^6.5.6 \
  @codemirror/lang-markdown@^6.3.0 \
  @codemirror/autocomplete@^6.18.0 \
  @lezer/markdown@^1.3.0
```

Expected: `package.json` gains 9 new entries under `dependencies`. No
`Agentz360/secure-lang-markdown` anywhere — verify with
`grep -c "Agentz360" package.json` → `0`.

- [ ] **Step 2: Rebuild lockfile + verify types resolve**

```bash
bun install
bun run build
```

Expected: build succeeds. If a package version in step 1 turns out to
be stale, `bun add <pkg>@latest` and re-try.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "deps: add CodeMirror 6 + @lezer/markdown for W2 editor"
```

---

### Task 2: Extract `pathsExist` to a shared util

**Files:**
- Create: `src/utils/pathsExist.ts`
- Modify: `src/components/AudioView.tsx`

- [ ] **Step 1: Create the util file**

Create `src/utils/pathsExist.ts`:

```ts
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
```

- [ ] **Step 2: Delete the local copy in AudioView.tsx and import from util**

In `src/components/AudioView.tsx`:

1. Delete the entire `async function pathsExist(…)` block (currently lines
   ~272-285 — the one with the JSDoc starting "Batch existence check").
2. Add at the top of the imports:
   ```ts
   import { pathsExist } from '../utils/pathsExist'
   ```

- [ ] **Step 3: Verify AudioView still typechecks and tests pass**

```bash
bun run build
bunx vitest run
```

Expected: build + tests succeed. AudioView should still function
identically — it's using the same implementation via a different
import path.

- [ ] **Step 4: Commit**

```bash
git add src/utils/pathsExist.ts src/components/AudioView.tsx
git commit -m "refactor(utils): extract pathsExist from AudioView for reuse in voice-memo pill"
```

---

### Task 3: Create the HerOS CM6 theme

**Files:**
- Create: `src/editor/herosTheme.ts`

- [ ] **Step 1: Write the theme**

Create `src/editor/herosTheme.ts`:

```ts
import { EditorView } from '@codemirror/view'

/**
 * HerOS-token CM6 theme. Every value comes from a CSS custom property
 * declared in src/App.css — zero literal colours, radii, or shadows
 * per CLAUDE.md Rule 12 / 18.
 */
export const herosEditorTheme = EditorView.theme({
  '&': {
    color: 'var(--heros-text)',
    backgroundColor: 'transparent',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-sans, system-ui)',
    fontSize: 'var(--text-base, 15px)',
    lineHeight: '1.7',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: 'var(--space-6, 24px) 0',
    maxWidth: '760px',
    margin: '0 auto',
    caretColor: 'var(--heros-brand)',
  },
  '.cm-line': {
    padding: '0 var(--space-6, 24px)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--heros-brand)',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--heros-brand) 25%, transparent)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--heros-brand) 18%, transparent)',
  },
  '&.cm-focused': { outline: 'none' },
  // Autocomplete popup — HerOS card
  '.cm-tooltip-autocomplete': {
    background: 'rgba(20, 21, 26, 0.95)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 'var(--radius-container, 10px)',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4)',
    fontFamily: 'var(--font-sans, system-ui)',
    padding: 'var(--space-1, 4px)',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: 'var(--space-2, 8px) var(--space-3, 12px)',
    borderRadius: 'var(--radius-sm, 6px)',
    color: 'rgba(255, 255, 255, 0.85)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'color-mix(in srgb, var(--heros-brand) 15%, transparent)',
    color: '#fff',
  },
  '.cm-tooltip-autocomplete .cm-completionLabel': {
    fontWeight: 500,
  },
  '.cm-tooltip-autocomplete .cm-completionDetail': {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 'var(--text-xs, 11px)',
    marginLeft: 'var(--space-3, 12px)',
  },
  // node:// link mark — see Task 7
  '.cm-node-link': {
    color: 'var(--heros-brand)',
    cursor: 'pointer',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  '.cm-node-link:hover': {
    filter: 'brightness(1.15)',
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add src/editor/herosTheme.ts
git commit -m "feat(editor): add HerOS CM6 theme — tokens only per Rule 12"
```

---

## Part B — Pure editor pieces (TDD)

### Task 4: Split slash completion source into its own module

The existing `src/editor/slashCommands.ts` contains both the command
catalog and the completion source. Extract the source so Tier 2
commands (`/link`, `/today`) can register into one registry without
touching the catalog file.

**Files:**
- Create: `src/editor/slashCompletion.ts`
- Modify: `src/editor/slashCommands.ts`
- Create: `src/editor/__tests__/slashCompletion.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/editor/__tests__/slashCompletion.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { CompletionContext } from '@codemirror/autocomplete'
import { slashCompletionSource } from '../slashCompletion'
import { tier1SlashCommands } from '../slashCommands'

/** Build a minimal CompletionContext for testing. */
function ctx(doc: string, pos: number, explicit = false): CompletionContext {
  const state = EditorState.create({ doc })
  return {
    state,
    pos,
    explicit,
    aborted: false,
    matchBefore: (re: RegExp) => {
      const line = state.doc.lineAt(pos)
      const text = state.sliceDoc(line.from, pos)
      const match = text.match(re)
      if (!match) return null
      return { from: pos - match[0].length, to: pos, text: match[0] }
    },
    tokenBefore: () => null,
    addEventListener: () => {},
  } as unknown as CompletionContext
}

describe('slashCompletionSource', () => {
  const source = slashCompletionSource(tier1SlashCommands)

  it('triggers at the start of an empty line', () => {
    const result = source(ctx('/', 1))
    expect(result).not.toBeNull()
    expect(result!.options.length).toBe(tier1SlashCommands.length)
  })

  it('triggers after indentation only', () => {
    const result = source(ctx('  /', 3))
    expect(result).not.toBeNull()
  })

  it('does NOT trigger mid-sentence', () => {
    const result = source(ctx('go to /usr', 10))
    expect(result).toBeNull()
  })

  it('filters by query prefix, case-insensitive', () => {
    const result = source(ctx('/ta', 3))
    expect(result).not.toBeNull()
    const labels = result!.options.map((o) => o.label)
    expect(labels).toContain('Table')
    expect(labels).not.toContain('Heading 1')
  })

  it('matches aliases', () => {
    const result = source(ctx('/bullet', 7))
    expect(result).not.toBeNull()
    const labels = result!.options.map((o) => o.label)
    expect(labels).toContain('Bulleted list')
  })

  it('returns empty options when query matches nothing', () => {
    const result = source(ctx('/zzznothing', 11))
    expect(result).not.toBeNull()
    expect(result!.options.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
bunx vitest run src/editor/__tests__/slashCompletion.test.ts
```

Expected: fails with "Cannot find module '../slashCompletion'".

- [ ] **Step 3: Extract the source into a new file**

Create `src/editor/slashCompletion.ts`:

```ts
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { SlashCommand } from './slashCommands'

const matchesQuery = (cmd: SlashCommand, query: string): boolean => {
  if (query.length === 0) return true
  const haystack = [cmd.id, cmd.label.toLowerCase(), ...(cmd.aliases ?? [])]
  return haystack.some((h) => h.toLowerCase().startsWith(query))
}

export const slashCompletionSource =
  (commands: SlashCommand[]) =>
  (ctx: CompletionContext): CompletionResult | null => {
    const match = ctx.matchBefore(/\/[\w#]*/)
    if (!match) return null
    if (match.from === match.to && !ctx.explicit) return null

    const line = ctx.state.doc.lineAt(match.from)
    const beforeSlash = ctx.state.sliceDoc(line.from, match.from)
    if (beforeSlash.trim().length > 0) return null

    const query = ctx.state.sliceDoc(match.from + 1, match.to).toLowerCase()
    const options: Completion[] = commands
      .filter((cmd) => matchesQuery(cmd, query))
      .map((cmd) => ({
        label: cmd.label,
        detail: cmd.shortcutHint,
        info: cmd.description,
        type: cmd.category,
        boost: cmd.boost ?? 0,
        apply: (view, _completion, from, to) => cmd.run(view, from, to),
      }))

    return { from: match.from, to: match.to, options, filter: false }
  }
```

- [ ] **Step 4: Delete the old inline source from slashCommands.ts**

In `src/editor/slashCommands.ts`, delete the `matchesQuery` helper and
the `slashCompletionSource` export (the whole block from line ~122 to
end). Keep `SlashCategory`, `SlashCommand`, `replaceAndMoveCaret`, and
`tier1SlashCommands`.

- [ ] **Step 5: Run tests — expect pass**

```bash
bunx vitest run src/editor/__tests__/slashCompletion.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/editor/slashCompletion.ts src/editor/slashCommands.ts src/editor/__tests__/slashCompletion.test.ts
git commit -m "refactor(editor): split slashCompletionSource into its own module + tests"
```

---

### Task 5: Wikilink autocomplete source

**Files:**
- Create: `src/editor/wikilinkCompletion.ts`
- Create: `src/editor/__tests__/wikilinkCompletion.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/editor/__tests__/wikilinkCompletion.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { CompletionContext } from '@codemirror/autocomplete'
import { wikilinkCompletionSource } from '../wikilinkCompletion'

function ctx(doc: string, pos: number): CompletionContext {
  const state = EditorState.create({ doc })
  return {
    state,
    pos,
    explicit: false,
    aborted: false,
    matchBefore: (re: RegExp) => {
      const line = state.doc.lineAt(pos)
      const text = state.sliceDoc(line.from, pos)
      const match = text.match(re)
      if (!match) return null
      return { from: pos - match[0].length, to: pos, text: match[0] }
    },
    tokenBefore: () => null,
    addEventListener: () => {},
  } as unknown as CompletionContext
}

describe('wikilinkCompletionSource', () => {
  it('triggers on [[ with no query', async () => {
    const fakeSearch = vi.fn().mockResolvedValue([
      { id: 'abc-1', name: 'Project Alpha', node_type: 'document', icon: '📄', parent_name: null },
    ])
    const source = wikilinkCompletionSource(fakeSearch)
    const result = await source(ctx('[[', 2))
    expect(result).not.toBeNull()
    expect(fakeSearch).toHaveBeenCalledWith('', 10)
    expect(result!.options[0].label).toBe('Project Alpha')
  })

  it('triggers on [[query and forwards query to search', async () => {
    const fakeSearch = vi.fn().mockResolvedValue([])
    const source = wikilinkCompletionSource(fakeSearch)
    const result = await source(ctx('[[proj', 6))
    expect(result).not.toBeNull()
    expect(fakeSearch).toHaveBeenCalledWith('proj', 10)
  })

  it('does NOT trigger when only one [ present', async () => {
    const fakeSearch = vi.fn()
    const source = wikilinkCompletionSource(fakeSearch)
    const result = await source(ctx('[proj', 5))
    expect(result).toBeNull()
    expect(fakeSearch).not.toHaveBeenCalled()
  })

  it('does NOT trigger after the closing ]]', async () => {
    const fakeSearch = vi.fn()
    const source = wikilinkCompletionSource(fakeSearch)
    const result = await source(ctx('[[done]] more', 13))
    expect(result).toBeNull()
  })

  it('apply replaces [[query with [title](node://uuid)', async () => {
    const fakeSearch = vi.fn().mockResolvedValue([
      { id: 'abc-123', name: 'Project Alpha', node_type: 'document', icon: '📄', parent_name: null },
    ])
    const source = wikilinkCompletionSource(fakeSearch)
    const result = await source(ctx('[[proj', 6))
    const opt = result!.options[0]
    // The apply function signature is (view, completion, from, to).
    // We can't exercise a real EditorView here, so just inspect the
    // completion shape — `from` is the [[ start and `to` is 6.
    expect(result!.from).toBe(0)
    expect(result!.to).toBe(6)
    expect(typeof opt.apply).toBe('function')
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
bunx vitest run src/editor/__tests__/wikilinkCompletion.test.ts
```

Expected: fails with "Cannot find module '../wikilinkCompletion'".

- [ ] **Step 3: Implement**

Create `src/editor/wikilinkCompletion.ts`:

```ts
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'

export interface WikilinkSearchResult {
  id: string
  name: string
  node_type: string
  icon: string
  parent_name: string | null
}

export type WikilinkSearchFn = (
  query: string,
  limit: number,
) => Promise<WikilinkSearchResult[]>

/**
 * CM6 autocomplete source for `[[` wikilinks.
 *
 * Triggers when the text immediately before the caret is `[[<query>` on
 * the current line, with <query> containing no `]`. Forwards the query
 * to `searchFn` (typically `commands.searchWorkspaceTitle`). On apply,
 * replaces the entire `[[<query>` span with `[title](node://<uuid>)`.
 */
export const wikilinkCompletionSource =
  (searchFn: WikilinkSearchFn) =>
  async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const match = ctx.matchBefore(/\[\[([^\]\n]*)$/)
    if (!match) return null

    const query = match.text.slice(2) // strip leading "[["
    const hits = await searchFn(query, 10).catch(() => [])

    const options: Completion[] = hits.map((h) => ({
      label: h.name,
      detail: h.icon || h.node_type,
      info: h.parent_name ? `in ${h.parent_name}` : undefined,
      type: 'wikilink',
      apply: (view: EditorView, _c: Completion, from: number, to: number) => {
        const insert = `[${h.name}](node://${h.id})`
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
        })
      },
    }))

    return {
      from: match.from,
      to: match.to,
      options,
      filter: false,
    }
  }
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bunx vitest run src/editor/__tests__/wikilinkCompletion.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/editor/wikilinkCompletion.ts src/editor/__tests__/wikilinkCompletion.test.ts
git commit -m "feat(editor): wikilink autocomplete source + tests"
```

---

### Task 6: Voice-memo pill directive parser + widget

**Files:**
- Create: `src/editor/voiceMemoPill.ts`
- Create: `src/editor/__tests__/voiceMemoPill.test.ts`

- [ ] **Step 1: Write failing tests for the parser**

Create `src/editor/__tests__/voiceMemoPill.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseVoiceMemoDirectives } from '../voiceMemoPill'

describe('parseVoiceMemoDirectives', () => {
  it('returns empty array when no directives present', () => {
    expect(parseVoiceMemoDirectives('Just a plain note.')).toEqual([])
  })

  it('parses a single path="…" directive', () => {
    const body = '::voice_memo_recording{path="C:/audio/memo1.wav"}\n\nHello.'
    const result = parseVoiceMemoDirectives(body)
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('C:/audio/memo1.wav')
    expect(result[0].from).toBe(0)
    // "to" points one past the closing }
    expect(body.slice(result[0].from, result[0].to)).toBe(
      '::voice_memo_recording{path="C:/audio/memo1.wav"}',
    )
  })

  it('parses multiple directives in doc order', () => {
    const body =
      '::voice_memo_recording{path="a.wav"}\n\nA\n\n::voice_memo_recording{path="b.wav"}\n\nB'
    const result = parseVoiceMemoDirectives(body)
    expect(result).toHaveLength(2)
    expect(result[0].path).toBe('a.wav')
    expect(result[1].path).toBe('b.wav')
    expect(result[0].from).toBeLessThan(result[1].from)
  })

  it('tolerates empty path gracefully (path is null)', () => {
    const body = '::voice_memo_recording{path=""}'
    const result = parseVoiceMemoDirectives(body)
    expect(result).toHaveLength(1)
    expect(result[0].path).toBeNull()
  })

  it('ignores malformed directive missing closing brace', () => {
    const body = '::voice_memo_recording{path="broken'
    const result = parseVoiceMemoDirectives(body)
    expect(result).toEqual([])
  })

  it('handles backward-compat JSON shape with audio_file_path', () => {
    const body =
      '::voice_memo_recording{"audio_file_path":"x.wav","recorded_at_ms":123}'
    const result = parseVoiceMemoDirectives(body)
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('x.wav')
    expect(result[0].recordedAtMs).toBe(123)
  })
})
```

- [ ] **Step 2: Run — expect failure (module missing)**

```bash
bunx vitest run src/editor/__tests__/voiceMemoPill.test.ts
```

- [ ] **Step 3: Implement the parser + widget module**

Create `src/editor/voiceMemoPill.ts`:

```ts
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view'
import { convertFileSrc } from '@tauri-apps/api/core'
import { pathsExist } from '../utils/pathsExist'

export interface VoiceMemoDirective {
  path: string | null
  recordedAtMs: number | null
  from: number
  to: number
}

const MARKER = '::voice_memo_recording'

/**
 * Parse all `::voice_memo_recording{…}` directives from a string.
 *
 * Primary format: `::voice_memo_recording{path="<abs path>"}`.
 * Backward-compat: accepts JSON-shape metadata with `audio_file_path`
 * and `recorded_at_ms` keys.
 *
 * Returns directives in document order with absolute offsets; used by
 * both the CM6 decoration plugin and unit tests.
 */
export function parseVoiceMemoDirectives(body: string): VoiceMemoDirective[] {
  const out: VoiceMemoDirective[] = []
  let cursor = 0
  while (cursor <= body.length - MARKER.length) {
    const idx = body.indexOf(MARKER, cursor)
    if (idx === -1) break
    const closeIdx = body.indexOf('}', idx + MARKER.length)
    if (closeIdx === -1) break

    const metaRaw = body.slice(idx + MARKER.length, closeIdx + 1)
    const inner = metaRaw.slice(1, -1).trim()

    let path: string | null = null
    let recordedAtMs: number | null = null

    const pathMatch = inner.match(/path\s*=\s*"([^"]*)"/)
    if (pathMatch) path = pathMatch[1].length > 0 ? pathMatch[1] : null

    if (path === null && (inner.startsWith('"') || inner.startsWith('{'))) {
      try {
        const meta = JSON.parse(metaRaw)
        if (typeof meta?.audio_file_path === 'string') {
          path = meta.audio_file_path.length > 0 ? meta.audio_file_path : null
        }
        if (typeof meta?.recorded_at_ms === 'number') {
          recordedAtMs = meta.recorded_at_ms
        }
      } catch {
        /* malformed JSON — already got path from regex */
      }
    }

    out.push({ path, recordedAtMs, from: idx, to: closeIdx + 1 })
    cursor = closeIdx + 1
  }
  return out
}

/**
 * CM6 widget rendering a play button + path label for a voice-memo
 * directive. Implements no-audio / loading / playing / unavailable
 * states matching AudioView's PlayButton visual treatment.
 */
class VoiceMemoWidget extends WidgetType {
  constructor(private directive: VoiceMemoDirective) {
    super()
  }

  eq(other: VoiceMemoWidget): boolean {
    return (
      this.directive.path === other.directive.path &&
      this.directive.recordedAtMs === other.directive.recordedAtMs
    )
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'voice-memo-pill'
    wrap.dataset.path = this.directive.path ?? ''
    wrap.dataset.state = this.directive.path ? 'idle' : 'no-audio'

    const icon = document.createElement('span')
    icon.className = 'voice-memo-pill__icon'
    icon.textContent = this.directive.path ? '▶' : '🔇'
    wrap.appendChild(icon)

    const label = document.createElement('span')
    label.className = 'voice-memo-pill__label'
    label.textContent = this.directive.path
      ? 'Voice memo'
      : 'No audio'
    wrap.appendChild(label)

    return wrap
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * ViewPlugin that decorates every `::voice_memo_recording{…}` directive
 * in the doc with a widget. Re-runs on doc change. Registers a click
 * handler on the plugin's view root to toggle playback on the singleton
 * audio element.
 */
export function voiceMemoPillPlugin() {
  let audio: HTMLAudioElement | null = null
  let playingPath: string | null = null
  const unavailablePaths = new Set<string>()

  const buildDecorations = (view: EditorView): DecorationSet => {
    const body = view.state.doc.toString()
    const dirs = parseVoiceMemoDirectives(body)
    const widgets = dirs.map((d) =>
      Decoration.replace({
        widget: new VoiceMemoWidget(d),
        inclusive: false,
      }).range(d.from, d.to),
    )
    return Decoration.set(widgets, /* sort */ true)
  }

  const togglePlayback = (path: string, pill: HTMLElement) => {
    if (!path) return
    if (!audio) {
      audio = new Audio()
      audio.preload = 'auto'
    }
    if (playingPath === path) {
      audio.pause()
      pill.dataset.state = 'idle'
      playingPath = null
      return
    }
    // Different path — stop current, start new.
    audio.pause()
    audio.removeAttribute('src')
    pill.dataset.state = 'loading'
    try {
      audio.src = convertFileSrc(path)
      audio.onloadedmetadata = () => {
        pill.dataset.state = 'playing'
        playingPath = path
        void audio!.play().catch(() => {
          pill.dataset.state = 'unavailable'
          unavailablePaths.add(path)
        })
      }
      audio.onerror = () => {
        pill.dataset.state = 'unavailable'
        unavailablePaths.add(path)
        playingPath = null
      }
      audio.onended = () => {
        pill.dataset.state = 'idle'
        playingPath = null
      }
      audio.load()
    } catch {
      pill.dataset.state = 'unavailable'
      unavailablePaths.add(path)
    }
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view)
        // Pre-seed unavailable state for already-missing files.
        const paths = parseVoiceMemoDirectives(view.state.doc.toString())
          .map((d) => d.path)
          .filter((p): p is string => !!p)
        void pathsExist(paths).then((found) => {
          for (const p of paths) {
            if (!found.has(p)) unavailablePaths.add(p)
          }
          // Force a redraw by reissuing decorations.
          view.dispatch({ effects: [] })
        })
      }

      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = buildDecorations(u.view)
      }

      destroy() {
        if (audio) {
          audio.pause()
          audio.removeAttribute('src')
          audio = null
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        click(ev, view) {
          const target = ev.target as HTMLElement
          const pill = target.closest('.voice-memo-pill') as HTMLElement | null
          if (!pill) return
          ev.preventDefault()
          const path = pill.dataset.path
          if (!path) return
          if (unavailablePaths.has(path)) {
            // Retry: clear unavailable and attempt to play again.
            unavailablePaths.delete(path)
          }
          togglePlayback(path, pill)
        },
      },
    },
  )
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bunx vitest run src/editor/__tests__/voiceMemoPill.test.ts
```

Expected: 6 tests pass (parser tests; the widget behaviour is exercised in
the integration verification phase).

- [ ] **Step 5: Commit**

```bash
git add src/editor/voiceMemoPill.ts src/editor/__tests__/voiceMemoPill.test.ts
git commit -m "feat(editor): voice-memo directive parser + CM6 pill ViewPlugin"
```

---

### Task 7: `node://` Lezer mark decoration + click handler

**Files:**
- Create: `src/editor/nodeLinkClick.ts`
- Create: `src/editor/__tests__/nodeLinkClick.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/editor/__tests__/nodeLinkClick.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { findNodeLinkRanges } from '../nodeLinkClick'

describe('findNodeLinkRanges', () => {
  const stateOf = (doc: string) =>
    EditorState.create({ doc, extensions: [markdown()] })

  it('finds one node:// URL', () => {
    const state = stateOf('See [Alpha](node://abc-123) for details.')
    const ranges = findNodeLinkRanges(state)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].nodeId).toBe('abc-123')
    const sliced = state.sliceDoc(ranges[0].from, ranges[0].to)
    expect(sliced).toContain('node://abc-123')
  })

  it('ignores non-node URLs', () => {
    const state = stateOf('See [docs](https://example.com) too.')
    expect(findNodeLinkRanges(state)).toHaveLength(0)
  })

  it('handles multiple links', () => {
    const state = stateOf(
      'First [A](node://aaa) second [B](node://bbb) third.',
    )
    const ranges = findNodeLinkRanges(state)
    expect(ranges).toHaveLength(2)
    expect(ranges.map((r) => r.nodeId)).toEqual(['aaa', 'bbb'])
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
bunx vitest run src/editor/__tests__/nodeLinkClick.test.ts
```

- [ ] **Step 3: Implement**

Create `src/editor/nodeLinkClick.ts`:

```ts
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view'

export interface NodeLinkRange {
  from: number
  to: number
  nodeId: string
}

const NODE_LINK_RE = /^node:\/\/([0-9a-fA-F-]+)$/

/**
 * Walk the markdown Lezer tree and find every URL node whose text
 * matches `node://<uuid>`. Exposed for tests; also used by the
 * decoration plugin.
 */
export function findNodeLinkRanges(state: EditorState): NodeLinkRange[] {
  const out: NodeLinkRange[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'URL') return
      const text = state.sliceDoc(node.from, node.to)
      const m = text.match(NODE_LINK_RE)
      if (m) out.push({ from: node.from, to: node.to, nodeId: m[1] })
    },
  })
  return out
}

/**
 * Mark decoration plugin: decorate every `node://<uuid>` URL span with
 * class `cm-node-link` + data-node-id. A view-level click handler
 * intercepts clicks on those spans and calls `onClick(nodeId)`.
 */
export function nodeLinkClickPlugin(onClick: (nodeId: string) => void) {
  const build = (view: EditorView): DecorationSet => {
    const ranges = findNodeLinkRanges(view.state)
    return Decoration.set(
      ranges.map((r) =>
        Decoration.mark({
          class: 'cm-node-link',
          attributes: { 'data-node-id': r.nodeId },
        }).range(r.from, r.to),
      ),
      true,
    )
  }
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view)
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        click(ev) {
          const target = ev.target as HTMLElement
          const el = target.closest('[data-node-id]') as HTMLElement | null
          if (!el) return
          ev.preventDefault()
          const id = el.dataset.nodeId!
          onClick(id)
        },
      },
    },
  )
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bunx vitest run src/editor/__tests__/nodeLinkClick.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/editor/nodeLinkClick.ts src/editor/__tests__/nodeLinkClick.test.ts
git commit -m "feat(editor): node:// Lezer mark decoration + click handler"
```

---

### Task 8: Autosave plugin (debounce + flush)

**Files:**
- Create: `src/editor/autosavePlugin.ts`
- Create: `src/editor/__tests__/autosavePlugin.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/editor/__tests__/autosavePlugin.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDebouncedSaver } from '../autosavePlugin'

describe('createDebouncedSaver', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not call onSave immediately', () => {
    const onSave = vi.fn()
    const saver = createDebouncedSaver(onSave, 300)
    saver.schedule('body-1')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onSave after the debounce window', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const saver = createDebouncedSaver(onSave, 300)
    saver.schedule('body-1')
    vi.advanceTimersByTime(300)
    await vi.runAllTimersAsync()
    expect(onSave).toHaveBeenCalledWith('body-1')
  })

  it('coalesces rapid schedules into a single call with the last value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const saver = createDebouncedSaver(onSave, 300)
    saver.schedule('v1')
    vi.advanceTimersByTime(100)
    saver.schedule('v2')
    vi.advanceTimersByTime(100)
    saver.schedule('v3')
    vi.advanceTimersByTime(300)
    await vi.runAllTimersAsync()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('v3')
  })

  it('flush() calls onSave immediately with the pending value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const saver = createDebouncedSaver(onSave, 300)
    saver.schedule('pending')
    await saver.flush()
    expect(onSave).toHaveBeenCalledWith('pending')
  })

  it('flush() is a no-op when nothing pending', async () => {
    const onSave = vi.fn()
    const saver = createDebouncedSaver(onSave, 300)
    await saver.flush()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('cancel() discards pending save', async () => {
    const onSave = vi.fn()
    const saver = createDebouncedSaver(onSave, 300)
    saver.schedule('v1')
    saver.cancel()
    vi.advanceTimersByTime(300)
    await vi.runAllTimersAsync()
    expect(onSave).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
bunx vitest run src/editor/__tests__/autosavePlugin.test.ts
```

- [ ] **Step 3: Implement**

Create `src/editor/autosavePlugin.ts`:

```ts
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'

export type SaveFn = (body: string) => Promise<void>

export interface DebouncedSaver {
  schedule: (body: string) => void
  flush: () => Promise<void>
  cancel: () => void
}

/**
 * Create a debounced save controller. `schedule(body)` queues a save
 * for `delayMs` later, coalescing rapid updates into a single call with
 * the most recent body. `flush()` fires the pending save immediately.
 * `cancel()` discards it.
 */
export function createDebouncedSaver(
  onSave: SaveFn,
  delayMs: number,
): DebouncedSaver {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: string | null = null

  const fire = async () => {
    if (pending === null) return
    const body = pending
    pending = null
    timer = null
    await onSave(body)
  }

  return {
    schedule(body: string) {
      pending = body
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void fire(), delayMs)
    },
    async flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      await fire()
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
    },
  }
}

/**
 * CM6 ViewPlugin that invokes `onDirtyChange(true)` whenever the user
 * mutates the doc, and calls `schedule(body)` on the shared saver.
 * The plugin itself is stateless — the saver's lifetime is owned by
 * the React MarkdownEditor component so it survives view rebuilds
 * across node switches.
 */
export function autosavePlugin(
  saver: DebouncedSaver,
  onDirtyChange: (dirty: boolean) => void,
) {
  return ViewPlugin.fromClass(
    class {
      update(u: ViewUpdate) {
        if (!u.docChanged) return
        // Only user-initiated edits count as dirty (not programmatic
        // replace-body dispatches during node load).
        const userEdit = u.transactions.some(
          (tr) => tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move'),
        )
        if (!userEdit) return
        onDirtyChange(true)
        saver.schedule(u.state.doc.toString())
      }
    },
  )
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bunx vitest run src/editor/__tests__/autosavePlugin.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/editor/autosavePlugin.ts src/editor/__tests__/autosavePlugin.test.ts
git commit -m "feat(editor): debounced autosave controller + CM6 plugin"
```

---

### Task 9: Conflict state machine (pure reducer)

**Files:**
- Create: `src/editor/conflictState.ts`
- Create: `src/editor/__tests__/conflictState.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/editor/__tests__/conflictState.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  initialConflictState,
  conflictReducer,
  parseVaultConflictError,
  isVaultConflictError,
} from '../conflictState'

describe('parseVaultConflictError', () => {
  it('accepts the documented Rust format', () => {
    const err =
      'VAULT_CONFLICT:{"node_id":"abc-123","disk_mtime_secs":1700000099,"last_seen_secs":1700000000}'
    expect(isVaultConflictError(err)).toBe(true)
    const parsed = parseVaultConflictError(err)
    expect(parsed).toEqual({
      nodeId: 'abc-123',
      diskMtimeSecs: 1700000099,
      lastSeenSecs: 1700000000,
    })
  })

  it('rejects unrelated error strings', () => {
    expect(isVaultConflictError('some other error')).toBe(false)
    expect(parseVaultConflictError('some other error')).toBeNull()
  })

  it('rejects malformed VAULT_CONFLICT payloads', () => {
    expect(parseVaultConflictError('VAULT_CONFLICT:{not json}')).toBeNull()
  })
})

describe('conflictReducer', () => {
  it('idle + SAVE_START → saving', () => {
    const next = conflictReducer(initialConflictState, { type: 'SAVE_START' })
    expect(next.status).toBe('saving')
  })

  it('saving + SAVE_OK → saved with timestamp', () => {
    const saving = conflictReducer(initialConflictState, { type: 'SAVE_START' })
    const next = conflictReducer(saving, {
      type: 'SAVE_OK',
      updatedAt: 1700000500,
    })
    expect(next.status).toBe('saved')
    expect(next.savedAtMs).toBeGreaterThan(0)
    expect(next.lastSeenMtime).toBe(1700000500)
  })

  it('saving + SAVE_CONFLICT → conflicted', () => {
    const saving = conflictReducer(initialConflictState, { type: 'SAVE_START' })
    const next = conflictReducer(saving, {
      type: 'SAVE_CONFLICT',
      diskMtimeSecs: 1700000999,
    })
    expect(next.status).toBe('conflicted')
    expect(next.conflictDiskMtime).toBe(1700000999)
  })

  it('saving + SAVE_ERROR → error', () => {
    const saving = conflictReducer(initialConflictState, { type: 'SAVE_START' })
    const next = conflictReducer(saving, { type: 'SAVE_ERROR', message: 'no' })
    expect(next.status).toBe('error')
    expect(next.errorMessage).toBe('no')
  })

  it('conflicted + RESOLVE_RELOAD → idle with fresh mtime', () => {
    let s = conflictReducer(initialConflictState, { type: 'SAVE_START' })
    s = conflictReducer(s, { type: 'SAVE_CONFLICT', diskMtimeSecs: 1700000999 })
    const next = conflictReducer(s, {
      type: 'RESOLVE_RELOAD',
      newMtime: 1700000999,
    })
    expect(next.status).toBe('idle')
    expect(next.conflictDiskMtime).toBeNull()
    expect(next.lastSeenMtime).toBe(1700000999)
  })

  it('conflicted + RESOLVE_KEEP → saving with adopted mtime', () => {
    let s = conflictReducer(initialConflictState, { type: 'SAVE_START' })
    s = conflictReducer(s, { type: 'SAVE_CONFLICT', diskMtimeSecs: 1700000999 })
    const next = conflictReducer(s, { type: 'RESOLVE_KEEP' })
    expect(next.status).toBe('saving')
    expect(next.conflictDiskMtime).toBeNull()
    expect(next.lastSeenMtime).toBe(1700000999)
  })

  it('NODE_LOAD resets state + seeds mtime', () => {
    const next = conflictReducer(
      { ...initialConflictState, status: 'saved' },
      { type: 'NODE_LOAD', mtime: 1700111111 },
    )
    expect(next.status).toBe('idle')
    expect(next.lastSeenMtime).toBe(1700111111)
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
bunx vitest run src/editor/__tests__/conflictState.test.ts
```

- [ ] **Step 3: Implement**

Create `src/editor/conflictState.ts`:

```ts
export type ConflictStatus = 'idle' | 'saving' | 'saved' | 'conflicted' | 'error'

export interface ConflictState {
  status: ConflictStatus
  lastSeenMtime: number | null
  conflictDiskMtime: number | null
  errorMessage: string | null
  savedAtMs: number | null
}

export const initialConflictState: ConflictState = {
  status: 'idle',
  lastSeenMtime: null,
  conflictDiskMtime: null,
  errorMessage: null,
  savedAtMs: null,
}

export type ConflictAction =
  | { type: 'NODE_LOAD'; mtime: number }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_OK'; updatedAt: number }
  | { type: 'SAVE_CONFLICT'; diskMtimeSecs: number }
  | { type: 'SAVE_ERROR'; message: string }
  | { type: 'RESOLVE_RELOAD'; newMtime: number }
  | { type: 'RESOLVE_KEEP' }
  | { type: 'CLEAR_SAVED' }

export function conflictReducer(
  state: ConflictState,
  action: ConflictAction,
): ConflictState {
  switch (action.type) {
    case 'NODE_LOAD':
      return {
        ...initialConflictState,
        lastSeenMtime: action.mtime,
      }
    case 'SAVE_START':
      return { ...state, status: 'saving', errorMessage: null }
    case 'SAVE_OK':
      return {
        ...state,
        status: 'saved',
        lastSeenMtime: action.updatedAt,
        savedAtMs: Date.now(),
        errorMessage: null,
        conflictDiskMtime: null,
      }
    case 'SAVE_CONFLICT':
      return {
        ...state,
        status: 'conflicted',
        conflictDiskMtime: action.diskMtimeSecs,
        errorMessage: null,
      }
    case 'SAVE_ERROR':
      return { ...state, status: 'error', errorMessage: action.message }
    case 'RESOLVE_RELOAD':
      return {
        ...initialConflictState,
        lastSeenMtime: action.newMtime,
      }
    case 'RESOLVE_KEEP':
      return {
        ...state,
        status: 'saving',
        lastSeenMtime: state.conflictDiskMtime ?? state.lastSeenMtime,
        conflictDiskMtime: null,
      }
    case 'CLEAR_SAVED':
      return state.status === 'saved' ? { ...state, status: 'idle' } : state
    default:
      return state
  }
}

const VAULT_CONFLICT_PREFIX = 'VAULT_CONFLICT:'

export function isVaultConflictError(err: string): boolean {
  return typeof err === 'string' && err.startsWith(VAULT_CONFLICT_PREFIX)
}

export interface ParsedVaultConflict {
  nodeId: string
  diskMtimeSecs: number
  lastSeenSecs: number
}

export function parseVaultConflictError(err: string): ParsedVaultConflict | null {
  if (!isVaultConflictError(err)) return null
  try {
    const payload = JSON.parse(err.slice(VAULT_CONFLICT_PREFIX.length))
    if (
      typeof payload?.node_id !== 'string' ||
      typeof payload?.disk_mtime_secs !== 'number' ||
      typeof payload?.last_seen_secs !== 'number'
    ) {
      return null
    }
    return {
      nodeId: payload.node_id,
      diskMtimeSecs: payload.disk_mtime_secs,
      lastSeenSecs: payload.last_seen_secs,
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bunx vitest run src/editor/__tests__/conflictState.test.ts
```

Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/editor/conflictState.ts src/editor/__tests__/conflictState.test.ts
git commit -m "feat(editor): conflict state machine + VAULT_CONFLICT parser"
```

---

## Part C — MarkdownEditor component

### Task 10: MarkdownEditor scaffold — mount, unmount, body load

**Files:**
- Create: `src/components/MarkdownEditor.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/MarkdownEditor.tsx`:

```tsx
import { useEffect, useReducer, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { commands } from '../bindings'
import { toast } from 'sonner'
import { herosEditorTheme } from '../editor/herosTheme'
import { slashCompletionSource } from '../editor/slashCompletion'
import { tier1SlashCommands } from '../editor/slashCommands'
import { wikilinkCompletionSource } from '../editor/wikilinkCompletion'
import { voiceMemoPillPlugin } from '../editor/voiceMemoPill'
import { nodeLinkClickPlugin } from '../editor/nodeLinkClick'
import { autosavePlugin, createDebouncedSaver, type DebouncedSaver } from '../editor/autosavePlugin'
import {
  conflictReducer,
  initialConflictState,
  isVaultConflictError,
  parseVaultConflictError,
} from '../editor/conflictState'

interface MarkdownEditorProps {
  nodeId: string
  onNodeLinkClick: (id: string) => void
}

export function MarkdownEditor({ nodeId, onNodeLinkClick }: MarkdownEditorProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const saverRef = useRef<DebouncedSaver | null>(null)
  const nodeMetaRef = useRef<{ name: string; icon: string; properties: string } | null>(null)
  const [state, dispatch] = useReducer(conflictReducer, initialConflictState)
  const stateRef = useRef(state)
  stateRef.current = state

  // Build the saver once; its closure calls commands.updateNode with
  // the latest mtime from stateRef.
  useEffect(() => {
    const doSave = async (body: string) => {
      const meta = nodeMetaRef.current
      if (!meta) return
      dispatch({ type: 'SAVE_START' })
      const res = await commands.updateNode(
        nodeId,
        meta.name,
        meta.icon,
        meta.properties,
        body,
        stateRef.current.lastSeenMtime,
      )
      if (res.status === 'ok') {
        dispatch({ type: 'SAVE_OK', updatedAt: res.data.updated_at })
        return
      }
      if (isVaultConflictError(res.error)) {
        const parsed = parseVaultConflictError(res.error)
        if (parsed && parsed.nodeId === nodeId) {
          dispatch({ type: 'SAVE_CONFLICT', diskMtimeSecs: parsed.diskMtimeSecs })
          return
        }
      }
      dispatch({ type: 'SAVE_ERROR', message: res.error })
      toast.error('Save failed', { description: res.error })
    }
    saverRef.current = createDebouncedSaver(doSave, 300)
    return () => {
      saverRef.current?.cancel()
      saverRef.current = null
    }
  }, [nodeId])

  // Auto-fade saved indicator after 2s.
  useEffect(() => {
    if (state.status !== 'saved') return
    const t = window.setTimeout(() => dispatch({ type: 'CLEAR_SAVED' }), 2000)
    return () => window.clearTimeout(t)
  }, [state.status, state.savedAtMs])

  // Build CM6 view on nodeId change; destroy prior.
  useEffect(() => {
    let cancelled = false
    const build = async () => {
      // Flush pending save for the outgoing node.
      await saverRef.current?.flush().catch(() => {})

      // Tear down prior view.
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }

      // Fetch fresh node.
      const res = await commands.getNode(nodeId)
      if (cancelled || res.status !== 'ok' || !res.data) return
      const node = res.data
      nodeMetaRef.current = {
        name: node.name,
        icon: node.icon,
        properties: node.properties,
      }
      dispatch({ type: 'NODE_LOAD', mtime: node.updated_at })

      const saver = saverRef.current
      if (!saver) return

      const extensions = [
        EditorView.lineWrapping,
        history(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        markdown({ base: markdownLanguage, extensions: [GFM] }),
        autocompletion({
          override: [
            slashCompletionSource(tier1SlashCommands),
            wikilinkCompletionSource((q, limit) =>
              commands.searchWorkspaceTitle(q, limit).then((r) =>
                r.status === 'ok' ? r.data : [],
              ),
            ),
          ],
          activateOnTyping: true,
        }),
        voiceMemoPillPlugin(),
        nodeLinkClickPlugin(onNodeLinkClick),
        autosavePlugin(saver, () => {
          /* dirty state derived from reducer — nothing to do here */
        }),
        herosEditorTheme,
      ]

      const editorState = EditorState.create({
        doc: node.body ?? '',
        extensions,
      })
      if (cancelled || !parentRef.current) return
      const view = new EditorView({ state: editorState, parent: parentRef.current })
      viewRef.current = view
      // Focus so the user can start typing immediately.
      view.focus()
    }
    void build()
    return () => {
      cancelled = true
    }
  }, [nodeId, onNodeLinkClick])

  // Unmount cleanup.
  useEffect(() => {
    return () => {
      saverRef.current?.flush().catch(() => {})
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [])

  return (
    <div className="editor-root">
      {state.status === 'conflicted' && (
        <ConflictBanner
          onReload={async () => {
            const res = await commands.getNode(nodeId)
            if (res.status !== 'ok' || !res.data) {
              toast.error('Reload failed', { description: res.status === 'error' ? res.error : 'missing node' })
              return
            }
            if (viewRef.current) {
              viewRef.current.dispatch({
                changes: {
                  from: 0,
                  to: viewRef.current.state.doc.length,
                  insert: res.data.body ?? '',
                },
              })
            }
            dispatch({ type: 'RESOLVE_RELOAD', newMtime: res.data.updated_at })
          }}
          onKeepMine={() => {
            dispatch({ type: 'RESOLVE_KEEP' })
            // Trigger immediate save with latest body.
            const body = viewRef.current?.state.doc.toString() ?? ''
            saverRef.current?.schedule(body)
            void saverRef.current?.flush()
          }}
        />
      )}
      <div ref={parentRef} className="editor-cm-host" />
      <SaveFooter status={state.status} savedAtMs={state.savedAtMs} />
    </div>
  )
}

function ConflictBanner(props: { onReload: () => void; onKeepMine: () => void }) {
  return (
    <div className="editor-conflict-banner" role="alert">
      <span className="editor-conflict-banner__icon">⚠</span>
      <span className="editor-conflict-banner__message">
        This file changed on disk since you last opened it.
      </span>
      <button className="editor-conflict-banner__btn" onClick={props.onReload}>
        Reload
      </button>
      <button
        className="editor-conflict-banner__btn editor-conflict-banner__btn--primary"
        onClick={props.onKeepMine}
      >
        Keep mine
      </button>
      <button
        className="editor-conflict-banner__btn"
        disabled
        title="Coming in a later release"
      >
        Open diff
      </button>
    </div>
  )
}

function SaveFooter(props: { status: string; savedAtMs: number | null }) {
  const { status, savedAtMs } = props
  if (status === 'idle') return null
  if (status === 'saving') return <div className="editor-save-footer">Saving…</div>
  if (status === 'saved' && savedAtMs) {
    const t = new Date(savedAtMs)
    const stamp = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return <div className="editor-save-footer editor-save-footer--ok">Saved {stamp}</div>
  }
  if (status === 'error') {
    return (
      <div className="editor-save-footer editor-save-footer--err">
        Save failed — click to retry
      </div>
    )
  }
  return null
}
```

- [ ] **Step 2: Verify typecheck**

```bash
bun run build
```

Expected: build succeeds. If TypeScript complains about any CM6 import,
verify Task 1's `bun add` actually landed those packages.

- [ ] **Step 3: Commit**

```bash
git add src/components/MarkdownEditor.tsx
git commit -m "feat(editor): MarkdownEditor component — CM6 + autosave + conflict banner"
```

---

### Task 11: Notes stylesheet + pill + banner CSS

**Files:**
- Create: `src/styles/notes.css`
- Modify: `src/App.css` (import the new concern file)

- [ ] **Step 1: Create the stylesheet**

Create `src/styles/notes.css`:

```css
/* W2 Notes — Tree, MarkdownEditor, BacklinksPane
   All values via tokens; all classes prefixed per Rule 18.  */

/* ── Editor root ───────────────────────────────────────────────── */
.editor-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.editor-cm-host {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

/* ── Conflict banner (Rule 13) ─────────────────────────────────── */
.editor-conflict-banner {
  display: flex;
  align-items: center;
  gap: var(--space-3, 12px);
  padding: var(--space-3, 12px) var(--space-4, 16px);
  background: color-mix(in srgb, var(--heros-brand) 10%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--heros-brand) 25%, transparent);
  font-size: var(--text-sm, 13px);
  color: rgba(255, 210, 200, 0.9);
}

.editor-conflict-banner__icon {
  font-size: var(--text-base, 15px);
  opacity: 0.8;
}

.editor-conflict-banner__message {
  flex: 1;
}

.editor-conflict-banner__btn {
  padding: var(--space-1, 4px) var(--space-3, 12px);
  border-radius: var(--radius-sm, 6px);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  font-size: var(--text-xs, 11px);
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms ease;
}

.editor-conflict-banner__btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.editor-conflict-banner__btn--primary {
  background: var(--heros-brand);
  border-color: transparent;
  color: #fff;
}

.editor-conflict-banner__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Save footer ───────────────────────────────────────────────── */
.editor-save-footer {
  position: absolute;
  bottom: var(--space-3, 12px);
  right: var(--space-4, 16px);
  font-size: var(--text-xs, 11px);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.35);
  pointer-events: none;
  transition: opacity 200ms ease;
}

.editor-save-footer--ok {
  color: rgba(255, 255, 255, 0.55);
}

.editor-save-footer--err {
  color: var(--heros-brand);
  pointer-events: auto;
  cursor: pointer;
}

/* ── Voice-memo pill (matches AudioView semantics) ─────────────── */
.voice-memo-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2, 8px);
  padding: var(--space-1, 4px) var(--space-3, 12px);
  margin: 0 var(--space-1, 4px);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.85);
  font-size: var(--text-xs, 11px);
  cursor: pointer;
  user-select: none;
  transition: background 120ms ease;
}

.voice-memo-pill:hover {
  background: rgba(255, 255, 255, 0.08);
}

.voice-memo-pill[data-state='playing'] {
  background: var(--heros-brand);
  color: #fff;
  border-color: transparent;
}

.voice-memo-pill[data-state='loading'] {
  opacity: 0.6;
}

.voice-memo-pill[data-state='no-audio'] {
  cursor: not-allowed;
  color: rgba(255, 255, 255, 0.3);
}

.voice-memo-pill[data-state='unavailable'] {
  background: color-mix(in srgb, var(--heros-brand) 10%, transparent);
  color: rgba(255, 180, 160, 0.8);
  border-color: color-mix(in srgb, var(--heros-brand) 25%, transparent);
}

/* ── Tree rows ─────────────────────────────────────────────────── */
.notes-tree-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: var(--space-2, 8px);
  padding: var(--space-3, 12px);
  overflow: hidden;
}

.notes-tree-header {
  display: flex;
  gap: var(--space-2, 8px);
  align-items: center;
  flex-wrap: wrap;
}

.notes-tree-header__actions {
  display: flex;
  gap: var(--space-1, 4px);
}

.notes-tree-header__btn {
  padding: var(--space-1, 4px) var(--space-2, 8px);
  border-radius: var(--radius-sm, 6px);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
  font-size: var(--text-xs, 11px);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1, 4px);
}

.notes-tree-header__btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.notes-tree-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: var(--space-2, 8px);
  padding: var(--space-1, 4px) var(--space-2, 8px);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  user-select: none;
  color: rgba(255, 255, 255, 0.75);
  font-size: var(--text-sm, 13px);
}

.tree-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.tree-row--active {
  background: color-mix(in srgb, var(--heros-brand) 15%, transparent);
  color: #fff;
}

.tree-row__caret {
  display: inline-flex;
  width: var(--space-3, 12px);
  color: rgba(255, 255, 255, 0.35);
  transition: transform 120ms ease;
}

.tree-row__caret--open {
  transform: rotate(90deg);
}

.tree-row__icon {
  width: var(--space-4, 16px);
  text-align: center;
}

.tree-row__label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-row__rename {
  flex: 1;
  background: transparent;
  border: 1px solid var(--heros-brand);
  border-radius: var(--radius-sm, 6px);
  color: #fff;
  padding: 0 var(--space-1, 4px);
  font-size: var(--text-sm, 13px);
  font-family: inherit;
  outline: none;
}

/* ── Backlinks pane ────────────────────────────────────────────── */
.notes-backlinks {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 8px);
  padding: var(--space-4, 16px);
  overflow: auto;
}

.notes-backlinks__header {
  font-size: var(--text-xs, 11px);
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.35);
}

.notes-backlinks__item {
  padding: var(--space-2, 8px) var(--space-3, 12px);
  border-radius: var(--radius-sm, 6px);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  cursor: pointer;
  color: rgba(255, 255, 255, 0.8);
  font-size: var(--text-sm, 13px);
}

.notes-backlinks__item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.notes-backlinks__empty {
  color: rgba(255, 255, 255, 0.4);
  font-size: var(--text-xs, 11px);
  line-height: 1.5;
  padding: var(--space-3, 12px);
}

/* ── NotesView split layout ────────────────────────────────────── */
.notes-split {
  display: grid;
  grid-template-columns: 260px 1fr 300px;
  gap: var(--space-1, 4px);
  height: 100%;
  min-height: 0;
}
```

- [ ] **Step 2: Import the concern file from App.css**

Locate `src/App.css` and add near the other concern-file imports:

```css
@import "./styles/notes.css";
```

(If there's already an `@import` block for other concern files, add this
line alongside them. If not, add it near the top after the `:root` token
declarations.)

- [ ] **Step 3: Rebuild to verify no CSS errors**

```bash
bun run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/styles/notes.css src/App.css
git commit -m "style(notes): W2 editor + tree + banner concern file — tokens only"
```

---

## Part D — Tree component

### Task 12: Tree — initial render + filter

**Files:**
- Create: `src/components/Tree.tsx`

- [ ] **Step 1: Scaffold Tree with root loading, filter, click-to-select**

Create `src/components/Tree.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { HerOSInput } from './HerOS'
import { FileText, FolderPlus, Plus, Search, ChevronRight } from 'lucide-react'
import { commands, type WorkspaceNode } from '../bindings'
import { toast } from 'sonner'

interface TreeProps {
  activeNodeId: string | null
  onSelect: (id: string) => void
  onCreateRoot: () => Promise<void>
  onCreateFolder: () => Promise<void>
  onCreateChild: (parentId: string) => Promise<void>
  refreshToken?: number   // bump to force a re-fetch
}

interface TreeState {
  nodes: Map<string, WorkspaceNode>
  childrenByParent: Map<string, string[]>   // "__root__" | parentId
  expanded: Set<string>
  filter: string
  loading: boolean
  error: string | null
}

const ROOT_KEY = '__root__'

const initialState: TreeState = {
  nodes: new Map(),
  childrenByParent: new Map(),
  expanded: new Set(),
  filter: '',
  loading: true,
  error: null,
}

type Action =
  | { type: 'LOAD_ROOTS'; nodes: WorkspaceNode[] }
  | { type: 'LOAD_CHILDREN'; parentId: string; nodes: WorkspaceNode[] }
  | { type: 'TOGGLE_EXPAND'; id: string }
  | { type: 'SET_FILTER'; value: string }
  | { type: 'SET_ERROR'; message: string }
  | { type: 'REMOVE_NODE'; id: string }
  | { type: 'UPSERT_NODE'; node: WorkspaceNode }

function reducer(state: TreeState, action: Action): TreeState {
  switch (action.type) {
    case 'LOAD_ROOTS': {
      const nodes = new Map(state.nodes)
      const rootIds: string[] = []
      for (const n of action.nodes) {
        nodes.set(n.id, n)
        rootIds.push(n.id)
      }
      const childrenByParent = new Map(state.childrenByParent)
      childrenByParent.set(ROOT_KEY, rootIds)
      return { ...state, nodes, childrenByParent, loading: false, error: null }
    }
    case 'LOAD_CHILDREN': {
      const nodes = new Map(state.nodes)
      const ids: string[] = []
      for (const n of action.nodes) {
        nodes.set(n.id, n)
        ids.push(n.id)
      }
      const childrenByParent = new Map(state.childrenByParent)
      childrenByParent.set(action.parentId, ids)
      return { ...state, nodes, childrenByParent }
    }
    case 'TOGGLE_EXPAND': {
      const expanded = new Set(state.expanded)
      if (expanded.has(action.id)) expanded.delete(action.id)
      else expanded.add(action.id)
      return { ...state, expanded }
    }
    case 'SET_FILTER':
      return { ...state, filter: action.value }
    case 'SET_ERROR':
      return { ...state, loading: false, error: action.message }
    case 'REMOVE_NODE': {
      const nodes = new Map(state.nodes)
      nodes.delete(action.id)
      const childrenByParent = new Map(state.childrenByParent)
      for (const [k, v] of childrenByParent) {
        const filtered = v.filter((x) => x !== action.id)
        if (filtered.length !== v.length) childrenByParent.set(k, filtered)
      }
      return { ...state, nodes, childrenByParent }
    }
    case 'UPSERT_NODE': {
      const nodes = new Map(state.nodes)
      nodes.set(action.node.id, action.node)
      return { ...state, nodes }
    }
    default:
      return state
  }
}

interface FlatRow {
  id: string
  depth: number
  hasChildren: boolean
}

function flattenVisible(state: TreeState): FlatRow[] {
  const rows: FlatRow[] = []
  const q = state.filter.toLowerCase()
  const rootIds = state.childrenByParent.get(ROOT_KEY) ?? []

  const matches = (id: string): boolean => {
    const n = state.nodes.get(id)
    if (!n) return false
    if (!q) return true
    if (n.name.toLowerCase().includes(q)) return true
    // Also show ancestor if any descendant matches (handled by walk).
    return false
  }

  const hasMatchingDescendant = (id: string): boolean => {
    const kids = state.childrenByParent.get(id) ?? []
    for (const kid of kids) {
      if (matches(kid)) return true
      if (hasMatchingDescendant(kid)) return true
    }
    return false
  }

  const walk = (id: string, depth: number) => {
    const n = state.nodes.get(id)
    if (!n) return
    const kids = state.childrenByParent.get(id) ?? []
    const anyChildren = kids.length > 0
    const shouldShow =
      !q || matches(id) || hasMatchingDescendant(id)
    if (!shouldShow) return
    rows.push({ id, depth, hasChildren: anyChildren })
    const isExpanded =
      state.expanded.has(id) || (q.length > 0 && hasMatchingDescendant(id))
    if (isExpanded) {
      for (const kid of kids) walk(kid, depth + 1)
    }
  }

  for (const rid of rootIds) walk(rid, 0)
  return rows
}

export function Tree({
  activeNodeId,
  onSelect,
  onCreateRoot,
  onCreateFolder,
  onCreateChild,
  refreshToken,
}: TreeProps) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const loadRoots = useCallback(async () => {
    const res = await commands.getRootNodes()
    if (res.status === 'ok') {
      dispatch({ type: 'LOAD_ROOTS', nodes: res.data })
    } else {
      dispatch({ type: 'SET_ERROR', message: res.error })
    }
  }, [])

  useEffect(() => {
    void loadRoots()
  }, [loadRoots, refreshToken])

  const handleToggle = useCallback(
    async (id: string) => {
      dispatch({ type: 'TOGGLE_EXPAND', id })
      if (!state.childrenByParent.has(id)) {
        const res = await commands.getNodeChildren(id)
        if (res.status === 'ok') {
          dispatch({ type: 'LOAD_CHILDREN', parentId: id, nodes: res.data })
        } else {
          toast.error('Could not load children', { description: res.error })
        }
      }
    },
    [state.childrenByParent],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      const res = await commands.deleteNode(id)
      if (res.status === 'ok') {
        dispatch({ type: 'REMOVE_NODE', id })
        toast.success('Moved to trash')
      } else {
        toast.error('Delete failed', { description: res.error })
      }
    },
    [],
  )

  const rows = useMemo(() => flattenVisible(state), [state])

  // Keyboard nav: handle at the container level so tree rows don't need tabindex.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!activeNodeId) return
    const idx = rows.findIndex((r) => r.id === activeNodeId)
    if (idx === -1) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = rows[Math.min(idx + 1, rows.length - 1)]
      if (next) onSelect(next.id)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = rows[Math.max(idx - 1, 0)]
      if (next) onSelect(next.id)
    } else if (e.key === 'ArrowRight') {
      const row = rows[idx]
      if (row?.hasChildren && !state.expanded.has(row.id)) {
        e.preventDefault()
        void handleToggle(row.id)
      }
    } else if (e.key === 'ArrowLeft') {
      const row = rows[idx]
      if (row?.hasChildren && state.expanded.has(row.id)) {
        e.preventDefault()
        dispatch({ type: 'TOGGLE_EXPAND', id: row.id })
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      void handleDelete(activeNodeId)
    }
  }

  return (
    <section
      className="heros-glass-card notes-tree-root"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="notes-tree-header">
        <HerOSInput
          icon={<Search size={14} />}
          value={state.filter}
          onChange={(e) =>
            dispatch({ type: 'SET_FILTER', value: e.currentTarget.value })
          }
          placeholder="Filter…"
          style={{ flex: 1, minWidth: 120 }}
        />
        <div className="notes-tree-header__actions">
          <button
            className="notes-tree-header__btn"
            onClick={() => void onCreateRoot()}
            title="New document (⌘N)"
          >
            <Plus size={12} /> Doc
          </button>
          <button
            className="notes-tree-header__btn"
            onClick={() => void onCreateFolder()}
            title="New folder"
          >
            <FolderPlus size={12} /> Folder
          </button>
        </div>
      </div>

      {state.error && (
        <div className="notes-backlinks__empty">{state.error}</div>
      )}

      <div className="notes-tree-list">
        {state.loading && !state.error && (
          <div className="notes-backlinks__empty">Loading…</div>
        )}
        {!state.loading && rows.length === 0 && (
          <div className="notes-backlinks__empty">
            No notes yet. Click &quot;Doc&quot; to create one.
          </div>
        )}
        {rows.map((row) => {
          const n = state.nodes.get(row.id)
          if (!n) return null
          const isActive = row.id === activeNodeId
          const isExpanded = state.expanded.has(row.id)
          return (
            <div
              key={row.id}
              className={`tree-row ${isActive ? 'tree-row--active' : ''}`}
              style={{ paddingLeft: `${8 + row.depth * 16}px` }}
              onClick={() => onSelect(row.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                // Minimal W2 context menu: "New child document"
                if (window.confirm(`Create new child document under "${n.name}"?`)) {
                  void onCreateChild(row.id)
                }
              }}
            >
              {row.hasChildren ? (
                <span
                  className={`tree-row__caret ${isExpanded ? 'tree-row__caret--open' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleToggle(row.id)
                  }}
                >
                  <ChevronRight size={12} />
                </span>
              ) : (
                <span className="tree-row__caret" />
              )}
              <span className="tree-row__icon">{n.icon || <FileText size={12} />}</span>
              <span className="tree-row__label">{n.name}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Verify typecheck**

```bash
bun run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Tree.tsx
git commit -m "feat(tree): initial tree with filter, keyboard nav, context menu, soft-delete"
```

---

### Task 13: Tree filter + flatten pure tests

**Files:**
- Create: `src/components/__tests__/Tree.test.tsx`

- [ ] **Step 1: Extract flatten helpers for test (in-place)**

Check `src/components/Tree.tsx` — the `flattenVisible` function is
declared at module scope. Export it:

```ts
export function flattenVisible(state: TreeState): FlatRow[] {
  ...
}
```

And export the types it needs:

```ts
export type { TreeState, FlatRow }
```

(If `TreeState` and `FlatRow` are declared with `interface`, change to
`export interface`.)

- [ ] **Step 2: Write tests**

Create `src/components/__tests__/Tree.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { flattenVisible } from '../Tree'
import type { WorkspaceNode } from '../../bindings'

function n(id: string, name: string, parent: string | null = null): WorkspaceNode {
  return {
    id, name, parent_id: parent, node_type: 'document', icon: '📄',
    position: 1, created_at: 0, updated_at: 0, deleted_at: null,
    properties: '{}', body: '',
  }
}

function state(roots: string[], children: Record<string, string[]>, nodes: WorkspaceNode[], expanded: string[] = [], filter = '') {
  const nmap = new Map<string, WorkspaceNode>()
  for (const x of nodes) nmap.set(x.id, x)
  const cmap = new Map<string, string[]>()
  cmap.set('__root__', roots)
  for (const k of Object.keys(children)) cmap.set(k, children[k])
  return {
    nodes: nmap,
    childrenByParent: cmap,
    expanded: new Set(expanded),
    filter,
    loading: false,
    error: null,
  }
}

describe('flattenVisible', () => {
  it('returns roots in order when nothing is expanded', () => {
    const s = state(['a', 'b'], {}, [n('a', 'Alpha'), n('b', 'Beta')])
    const rows = flattenVisible(s)
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(rows.every((r) => r.depth === 0)).toBe(true)
  })

  it('shows children when parent is expanded', () => {
    const s = state(
      ['a'],
      { a: ['a1', 'a2'] },
      [n('a', 'Alpha'), n('a1', 'Alpha1', 'a'), n('a2', 'Alpha2', 'a')],
      ['a'],
    )
    const rows = flattenVisible(s)
    expect(rows.map((r) => r.id)).toEqual(['a', 'a1', 'a2'])
    expect(rows[1].depth).toBe(1)
  })

  it('filters by substring case-insensitively', () => {
    const s = state(
      ['a', 'b'],
      {},
      [n('a', 'Alpha'), n('b', 'Beta Gamma')],
      [],
      'gamma',
    )
    const rows = flattenVisible(s)
    expect(rows.map((r) => r.id)).toEqual(['b'])
  })

  it('keeps ancestor visible when descendant matches', () => {
    const s = state(
      ['a'],
      { a: ['a1'] },
      [n('a', 'Outer'), n('a1', 'Target Leaf', 'a')],
      [],
      'target',
    )
    const rows = flattenVisible(s)
    expect(rows.map((r) => r.id)).toEqual(['a', 'a1'])
  })
})
```

- [ ] **Step 3: Run tests**

```bash
bunx vitest run src/components/__tests__/Tree.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/Tree.tsx src/components/__tests__/Tree.test.tsx
git commit -m "test(tree): unit tests for flattenVisible filter + expansion"
```

---

### Task 14: Tree drag-drop with fractional positions

**Files:**
- Modify: `src/components/Tree.tsx`

- [ ] **Step 1: Add @dnd-kit imports and SortableContext**

In `src/components/Tree.tsx`, at the top:

```tsx
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
```

- [ ] **Step 2: Extract row into a SortableRow component**

Still in `Tree.tsx`, replace the inline `rows.map((row) => …)` block
with a `<SortableContext items={rows.map(r => r.id)} strategy={verticalListSortingStrategy}>` wrapper, and move each row's markup into a child component:

```tsx
function SortableRow(props: {
  row: FlatRow
  node: WorkspaceNode
  isActive: boolean
  isExpanded: boolean
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onCreateChild: (id: string) => void
}) {
  const { row, node, isActive, isExpanded, onToggle, onSelect, onCreateChild } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: `${8 + row.depth * 16}px`,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      className={`tree-row ${isActive ? 'tree-row--active' : ''}`}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onSelect(row.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        if (window.confirm(`Create new child document under "${node.name}"?`)) {
          onCreateChild(row.id)
        }
      }}
    >
      {row.hasChildren ? (
        <span
          className={`tree-row__caret ${isExpanded ? 'tree-row__caret--open' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(row.id)
          }}
        >
          <ChevronRight size={12} />
        </span>
      ) : (
        <span className="tree-row__caret" />
      )}
      <span className="tree-row__icon">{node.icon}</span>
      <span className="tree-row__label">{node.name}</span>
    </div>
  )
}
```

- [ ] **Step 3: Wire DnD handlers on the Tree component**

Add to the main `Tree` function body:

```tsx
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [dragId, setDragId] = useState<string | null>(null)

  const handleDragStart = (e: DragStartEvent) => {
    setDragId(String(e.active.id))
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    setDragId(null)
    if (!e.over || e.active.id === e.over.id) return
    const activeId = String(e.active.id)
    const overId = String(e.over.id)
    const visibleRows = flattenVisible(state)
    const activeIdx = visibleRows.findIndex((r) => r.id === activeId)
    const overIdx = visibleRows.findIndex((r) => r.id === overId)
    if (activeIdx === -1 || overIdx === -1) return

    // Target parent: same parent as the over-row (sibling reorder only
    // in W2 — re-parenting via drag deferred to W2.5).
    const overNode = state.nodes.get(overId)
    if (!overNode) return
    const targetParent = overNode.parent_id

    // Compute new position as midpoint of over-row and its neighbour
    // on the appropriate side of the drop.
    const siblings = (state.childrenByParent.get(targetParent ?? ROOT_KEY) ?? [])
      .map((id) => state.nodes.get(id))
      .filter((x): x is WorkspaceNode => !!x)
    const overSibIdx = siblings.findIndex((s) => s.id === overId)
    const droppingBefore = activeIdx > overIdx
    let newPos: number
    if (droppingBefore) {
      const prev = siblings[overSibIdx - 1]
      newPos = prev ? (prev.position + overNode.position) / 2 : overNode.position - 1
    } else {
      const next = siblings[overSibIdx + 1]
      newPos = next ? (overNode.position + next.position) / 2 : overNode.position + 1
    }

    const res = await commands.moveNode(activeId, targetParent, newPos)
    if (res.status !== 'ok') {
      toast.error('Move failed', { description: res.error })
      return
    }
    dispatch({ type: 'UPSERT_NODE', node: res.data })
    // Refresh parent's children list so order persists.
    const refreshRes = await commands.getNodeChildren(targetParent ?? '')
    if (targetParent && refreshRes.status === 'ok') {
      dispatch({ type: 'LOAD_CHILDREN', parentId: targetParent, nodes: refreshRes.data })
    } else {
      void loadRoots()
    }
  }
```

(Add `useState` to the existing React imports at the top.)

- [ ] **Step 4: Wrap the list with DndContext + SortableContext**

Replace the `<div className="notes-tree-list">` block with:

```tsx
<div className="notes-tree-list">
  <DndContext
    sensors={sensors}
    onDragStart={handleDragStart}
    onDragEnd={handleDragEnd}
  >
    <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
      {rows.map((row) => {
        const node = state.nodes.get(row.id)
        if (!node) return null
        return (
          <SortableRow
            key={row.id}
            row={row}
            node={node}
            isActive={row.id === activeNodeId}
            isExpanded={state.expanded.has(row.id)}
            onToggle={(id) => void handleToggle(id)}
            onSelect={onSelect}
            onCreateChild={(id) => void onCreateChild(id)}
          />
        )
      })}
    </SortableContext>
    <DragOverlay>
      {dragId && (() => {
        const n = state.nodes.get(dragId)
        return n ? (
          <div className="tree-row tree-row--active">
            <span className="tree-row__icon">{n.icon}</span>
            <span className="tree-row__label">{n.name}</span>
          </div>
        ) : null
      })()}
    </DragOverlay>
  </DndContext>
</div>
```

- [ ] **Step 5: Verify build**

```bash
bun run build
bunx vitest run src/components/__tests__/Tree.test.tsx
```

Expected: build succeeds; the Tree.test.tsx tests still pass because
they only exercise `flattenVisible`.

- [ ] **Step 6: Commit**

```bash
git add src/components/Tree.tsx
git commit -m "feat(tree): drag-drop reorder via @dnd-kit with midpoint positions"
```

---

## Part E — BacklinksPane + NotesView

### Task 15: BacklinksPane

**Files:**
- Create: `src/components/BacklinksPane.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from 'react'
import { commands, type WorkspaceNode } from '../bindings'

interface BacklinksPaneProps {
  activeNodeId: string | null
  onSelect: (id: string) => void
}

export function BacklinksPane({ activeNodeId, onSelect }: BacklinksPaneProps) {
  const [links, setLinks] = useState<WorkspaceNode[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!activeNodeId) {
      setLinks([])
      return
    }
    let cancelled = false
    setLoading(true)
    void commands.getBacklinks(activeNodeId).then((res) => {
      if (cancelled) return
      if (res.status === 'ok') setLinks(res.data)
      else setLinks([])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [activeNodeId])

  return (
    <section className="heros-glass-card notes-backlinks">
      <div className="notes-backlinks__header">Backlinks</div>
      {!activeNodeId && (
        <div className="notes-backlinks__empty">
          Open a note to see what links to it.
        </div>
      )}
      {activeNodeId && loading && (
        <div className="notes-backlinks__empty">Loading…</div>
      )}
      {activeNodeId && !loading && links.length === 0 && (
        <div className="notes-backlinks__empty">
          No backlinks yet. Link to this doc with <code>[[</code> from
          another note and it&apos;ll appear here.
        </div>
      )}
      {links.map((l) => (
        <div
          key={l.id}
          className="notes-backlinks__item"
          onClick={() => onSelect(l.id)}
        >
          {l.icon} {l.name}
        </div>
      ))}
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/BacklinksPane.tsx
git commit -m "feat(backlinks): BacklinksPane component wired to get_backlinks"
```

---

### Task 16: Rewrite NotesView with three-column layout

**Files:**
- Modify: `src/components/NotesView.tsx`

- [ ] **Step 1: Replace the entire file**

Overwrite `src/components/NotesView.tsx` with:

```tsx
import { useCallback, useState } from 'react'
import { Tree } from './Tree'
import { MarkdownEditor } from './MarkdownEditor'
import { BacklinksPane } from './BacklinksPane'
import { commands } from '../bindings'
import { toast } from 'sonner'

export function NotesView() {
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const bumpRefresh = useCallback(() => setRefreshToken((n) => n + 1), [])

  const handleCreateRoot = useCallback(async () => {
    const res = await commands.createNode(null, 'document', 'Untitled')
    if (res.status !== 'ok') {
      toast.error('Could not create document', { description: res.error })
      return
    }
    setActiveNodeId(res.data.id)
    bumpRefresh()
  }, [bumpRefresh])

  const handleCreateFolder = useCallback(async () => {
    const res = await commands.createNode(null, 'document', 'New Folder')
    if (res.status !== 'ok') {
      toast.error('Could not create folder', { description: res.error })
      return
    }
    // Update icon to 📁 immediately so it reads as a folder.
    await commands.updateNode(
      res.data.id,
      res.data.name,
      '📁',
      res.data.properties,
      res.data.body,
      res.data.updated_at,
    )
    setActiveNodeId(res.data.id)
    bumpRefresh()
  }, [bumpRefresh])

  const handleCreateChild = useCallback(
    async (parentId: string) => {
      const res = await commands.createNode(parentId, 'document', 'Untitled')
      if (res.status !== 'ok') {
        toast.error('Could not create child document', { description: res.error })
        return
      }
      setActiveNodeId(res.data.id)
      bumpRefresh()
    },
    [bumpRefresh],
  )

  return (
    <div className="notes-split">
      <Tree
        activeNodeId={activeNodeId}
        onSelect={setActiveNodeId}
        onCreateRoot={handleCreateRoot}
        onCreateFolder={handleCreateFolder}
        onCreateChild={handleCreateChild}
        refreshToken={refreshToken}
      />
      {activeNodeId ? (
        <section
          className="heros-glass-card"
          style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          <MarkdownEditor
            nodeId={activeNodeId}
            onNodeLinkClick={setActiveNodeId}
          />
        </section>
      ) : (
        <section className="heros-glass-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="notes-backlinks__empty" style={{ textAlign: 'center' }}>
            Select a note or create one with <kbd>⌘N</kbd>.
          </div>
        </section>
      )}
      <BacklinksPane activeNodeId={activeNodeId} onSelect={setActiveNodeId} />
    </div>
  )
}
```

- [ ] **Step 2: Build + vitest**

```bash
bun run build
bunx vitest run
```

- [ ] **Step 3: Commit**

```bash
git add src/components/NotesView.tsx
git commit -m "feat(notes): rewrite NotesView — tree + editor + backlinks three-column"
```

---

## Part F — AppShell keyboard wiring + Tier 2 slash commands

### Task 17: Wire Cmd+N + Cmd+Shift+J in AppShell

**Files:**
- Modify: `src/components/AppShell.tsx`

- [ ] **Step 1: Locate AppShell and find where currentPage lives**

```bash
grep -n "currentPage\|setCurrentPage" src/components/AppShell.tsx | head -20
```

- [ ] **Step 2: Add a keyboard listener**

Near the other `useEffect`s in `AppShell.tsx`, add:

```tsx
import { commands } from '../bindings'
import { toast } from 'sonner'
// ...
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      // Cmd+N → new root doc (only on notes page)
      if (e.key.toLowerCase() === 'n' && !e.shiftKey && currentPage === 'notes') {
        e.preventDefault()
        const res = await commands.createNode(null, 'document', 'Untitled')
        if (res.status === 'ok') {
          // NotesView watches a window-level event for this.
          window.dispatchEvent(new CustomEvent('notes:open', { detail: res.data.id }))
        } else {
          toast.error('Could not create document', { description: res.error })
        }
      }
      // Cmd+Shift+J → today's daily note
      if (e.key.toLowerCase() === 'j' && e.shiftKey) {
        e.preventDefault()
        const iso = new Date().toISOString().slice(0, 10)
        const res = await commands.getOrCreateDailyNote(iso)
        if (res.status === 'ok') {
          setCurrentPage('notes')
          window.dispatchEvent(new CustomEvent('notes:open', { detail: res.data.id }))
        } else {
          toast.error("Couldn't open today's daily note", { description: res.error })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentPage, setCurrentPage])
```

(Import names/paths — adjust based on AppShell's existing imports.)

- [ ] **Step 3: Add the `notes:open` listener in NotesView**

In `src/components/NotesView.tsx`, add:

```tsx
  useEffect(() => {
    const on = (ev: Event) => {
      const id = (ev as CustomEvent).detail
      if (typeof id === 'string') {
        setActiveNodeId(id)
        bumpRefresh()
      }
    }
    window.addEventListener('notes:open', on)
    return () => window.removeEventListener('notes:open', on)
  }, [bumpRefresh])
```

- [ ] **Step 4: Build + verify**

```bash
bun run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/AppShell.tsx src/components/NotesView.tsx
git commit -m "feat(shortcuts): Cmd+N creates new doc, Cmd+Shift+J opens today's daily note"
```

---

### Task 18: Tier 2 slash commands — /today and /link

**Files:**
- Create: `src/editor/commands/today.ts`
- Create: `src/editor/commands/link.ts`
- Modify: `src/editor/slashCommands.ts`

- [ ] **Step 1: Implement /today**

Create `src/editor/commands/today.ts`:

```ts
import type { SlashCommand } from '../slashCommands'
import { commands } from '../../bindings'
import { toast } from 'sonner'

export const todayCommand: SlashCommand = {
  id: 'today',
  label: 'Link to today',
  aliases: ['today', 'daily'],
  description: "Insert a wikilink to today's daily note",
  category: 'handy',
  run: (view, from, to) => {
    // Replace /today with a placeholder while we resolve.
    const placeholder = '[today](node://…)'
    view.dispatch({
      changes: { from, to, insert: placeholder },
      selection: { anchor: from + placeholder.length },
    })
    void (async () => {
      const iso = new Date().toISOString().slice(0, 10)
      const res = await commands.getOrCreateDailyNote(iso)
      if (res.status !== 'ok') {
        toast.error("Couldn't resolve today's daily note", { description: res.error })
        return
      }
      const insert = `[${res.data.name}](node://${res.data.id})`
      // Find and replace the placeholder (it may have moved if user
      // typed more; use a regex search over the doc).
      const doc = view.state.doc.toString()
      const idx = doc.indexOf(placeholder)
      if (idx === -1) return
      view.dispatch({
        changes: { from: idx, to: idx + placeholder.length, insert },
      })
    })()
  },
}
```

- [ ] **Step 2: Implement /link**

Create `src/editor/commands/link.ts`:

```ts
import type { SlashCommand } from '../slashCommands'

export const linkCommand: SlashCommand = {
  id: 'link',
  label: 'Wikilink',
  aliases: ['link', 'wiki'],
  description: 'Start a [[wikilink — autocomplete fills the rest',
  category: 'handy',
  run: (view, from, to) => {
    const insert = '[['
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
    })
  },
}
```

- [ ] **Step 3: Register Tier 2 commands in slashCommands.ts**

In `src/editor/slashCommands.ts`, at the bottom after `tier1SlashCommands`:

```ts
import { todayCommand } from './commands/today'
import { linkCommand } from './commands/link'

/** Commands shipping in W2 — Tier 1 (block primitives) plus the two
 *  Handy-native commands that are trivially cheap. /voice, /database,
 *  /embed stay deferred to W2.5 per PLAN.md. */
export const allSlashCommands: SlashCommand[] = [
  ...tier1SlashCommands,
  linkCommand,
  todayCommand,
]
```

- [ ] **Step 4: Swap MarkdownEditor to use the full catalog**

In `src/components/MarkdownEditor.tsx`, change:

```ts
import { tier1SlashCommands } from '../editor/slashCommands'
```

to:

```ts
import { allSlashCommands } from '../editor/slashCommands'
```

and in the extensions block:

```ts
slashCompletionSource(allSlashCommands),
```

- [ ] **Step 5: Build + vitest**

```bash
bun run build
bunx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add src/editor/commands/ src/editor/slashCommands.ts src/components/MarkdownEditor.tsx
git commit -m "feat(slash): Tier 2 /link + /today commands wired into catalog"
```

---

## Part G — Verification + ship

### Task 19: Run the full test + build matrix

- [ ] **Step 1: Run everything**

```bash
bun run build
cd src-tauri && cargo test --lib && cd ..
bunx vitest run
```

Expected: all three green. Compare Vitest count against the baseline
from Pre-flight — should have grown by ~30 new tests across the 6 new
test files.

If anything fails:
- Typecheck errors → fix the imports / types inline, don't bypass.
- `cargo test` regressions → W2 should not change Rust; investigate
  whether an unrelated commit slipped in.
- Vitest regressions → fix the failing test before moving on.

- [ ] **Step 2: Commit any fix-ups (if needed)**

```bash
git add -u
git commit -m "chore(w2): fix-ups for the full test matrix"
```

(Only if fixes were needed; otherwise skip.)

---

### Task 20: E2E verification via preview tools

- [ ] **Step 1: Start the dev server**

```bash
# In a terminal:
bun run tauri dev
```

(Or use `preview_start` per the preview-tools workflow.)

- [ ] **Step 2: Verify each scenario**

Work through each, using `preview_click`, `preview_type`, `preview_snapshot`:

1. **Navigate to Notes tab.** Tree renders (empty state or existing nodes).
2. **Press Cmd+N.** A new "Untitled" doc appears in the tree and opens in
   the editor. Type a word.
3. **Wait 400ms.** Footer shows "Saving…" then "Saved h:MM".
4. **Switch to a different node, then back.** Typed word persists.
5. **Type `/table` on an empty line.** Completion menu opens. Select
   "Table" → a 2×2 markdown table inserts.
6. **Type `[[` on a new line.** Wikilink menu shows nodes. Select one →
   `[Name](node://<uuid>)` inserts. **Click the rendered link.** The
   tree's active node switches to the linked doc.
7. **Press Cmd+Shift+J.** Today's daily note opens (creates if missing).
8. **Select a tree row, press Delete.** The row disappears; the
   "Moved to trash" toast fires.
9. **Drag a tree row to a different position.** Order updates; reload
   the app to verify persistence.
10. **External edit conflict:** with the app open, edit the underlying
    `.md` file in a text editor and save. Switch back to Handy. Click the
    doc in the tree to trigger a `get_node`. Type something — the
    conflict banner appears. Click "Reload" → external edit wins. Type
    more, trigger conflict again, click "Keep mine" → yours wins.
11. **Voice memo pill:** find (or create via AudioView) a doc with a
    `::voice_memo_recording{path="…"}` directive; open in Notes. The
    pill renders; clicking it plays the audio. Delete the audio file
    externally, re-open; pill shows unavailable state.

- [ ] **Step 3: Take a screenshot for the PR**

```bash
# via preview_screenshot after loading the Notes view with content
```

- [ ] **Step 4: Commit anything that had to be fixed during E2E**

```bash
git add -u
git commit -m "fix(w2): E2E-verification adjustments"
```

(Only if fixes were needed.)

---

### Task 21: Update PLAN.md W2 block to ✅ SHIPPED

**Files:**
- Modify: `PLAN.md`

- [ ] **Step 1: Rewrite the W2 block header**

Find the `### W2 — Workspace tree + CodeMirror 6 editor 🔜 NEXT` section.
Change `🔜 NEXT` to `✅ SHIPPED 2026-04-23`. Immediately after the header,
prepend a one-paragraph shipped summary:

```
✅ SHIPPED 2026-04-23. Commits: <list top commits from git log>.

What landed: Tree (filter, drag-drop via @dnd-kit, keyboard nav,
context menu) + MarkdownEditor (CM6 + GFM, slash + wikilink + voice-
memo pill + node:// link routing, 300ms debounced autosave with
VAULT_CONFLICT banner Reload/Keep-mine) + BacklinksPane (wired to
get_backlinks). NotesView rewritten as a three-column split. Tier 1
slash commands + /link + /today shipped; /voice /database /embed
deferred to W2.5.

Spec: docs/superpowers/specs/2026-04-23-w2-notes-wiring-design.md
Plan: docs/superpowers/plans/2026-04-23-w2-notes-wiring.md
```

Keep the rest of the block (original brief) for historical context,
prefixed with `---\n\n### W2 — original brief (kept for context)`
(same convention W0 and W1 follow).

- [ ] **Step 2: Update the Status tracker at the bottom of PLAN.md**

Find the `| Current phase |` row and change it from "W2 — Workspace tree
+ CodeMirror 6 editor (kickoff next)" to "W3 — Hybrid search (kickoff next)".

Change "Last phase completed" to "W2 — Notes wiring (2026-04-23)".

- [ ] **Step 3: Commit**

```bash
git add PLAN.md
git commit -m "plan(w2): mark W2 SHIPPED — tree + CM6 editor + backlinks + autosave"
```

---

## Summary

| Part | Tasks | Commits | Tests added |
|---|---|---|---|
| A — Foundation | 1-3 | 3 | 0 |
| B — Pure editor pieces | 4-9 | 6 | ~30 |
| C — MarkdownEditor | 10-11 | 2 | 0 |
| D — Tree | 12-14 | 3 | 4 |
| E — BacklinksPane + NotesView | 15-16 | 2 | 0 |
| F — AppShell + Tier 2 slash | 17-18 | 2 | 0 |
| G — Verification + ship | 19-21 | 0-3 | 0 |
| **Total** | **21** | **18-21** | **~34** |

Each task ends in a commit. Budget: **~2-3 working days** for a focused
engineer following TDD. The Part B pure pieces represent the
highest-risk code and are all test-first.
