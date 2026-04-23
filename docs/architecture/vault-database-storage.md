# Vault Database Storage — Format Contract

> **Context**: Stable rule is in [CLAUDE.md → Vault Database Storage](../../CLAUDE.md#vault-database-storage--summary). Migration status is in [PLAN.md → M-vault-rows](../../PLAN.md). This file is the **full format contract** — read it before touching `src-tauri/src/managers/workspace/vault/` or adding a new database layout.

Databases (table / list / board / calendar / chart) are the second-most-touched vault surface after documents. The format they serialize to has a far bigger knock-on effect on every other decision (merge strategy, external-editor compatibility, schema migration, import/export, row-level undo). This file pins the **canonical storage pattern** so future work doesn't drift into worse choices.

## Banned: markdown pipe tables as storage

Markdown pipe tables (`| col | col |` with `---` separators) are **banned as the database storage format**. They work for rendered output inside a note body (e.g. a Dataview-style `TABLE` block produced from a query), but they are the wrong tool for source-of-truth storage. Reasons, non-negotiable:

1. **No schema.** Column type ("Date", "Checkbox", "Multi-Select") is not expressible. A "Checkbox" is just text. A "Multi-Select" has no enum of valid options. Validation must live outside the file, which defeats vault-as-truth.
2. **Order-dependent, not ID-based.** Reorder a column → every view config referencing that column by position breaks. Stable column IDs require metadata markdown tables don't have.
3. **Cell escape hell.** `\|` inside cells, no newlines allowed in a cell, URLs with `|` invalid, RTL chars break alignment, Markdown-in-Markdown (bold, wikilinks) inside a cell can produce ambiguous parses.
4. **Can't hold rich cell types.** Relations, files, formulas, rollups, person — all require structured sub-objects. Cramming JSON inside a cell (`{"id":"opt1"}`) makes the "markdown" unreadable and defeats the point.
5. **Whole-file rewrite per edit.** To update one cell, the entire table body is re-parsed and re-serialized. At 10k rows this is a real perf hit.
6. **Merge conflicts unusable.** Column alignment padding shifts on every column when any row changes, producing diffs that look like every line was rewritten.
7. **"Single file per database" breaks down at scale.** A 500-row database in one file means every git commit touches the whole thing; no per-row history; no cross-row wikilinks to a row's "page" content (which doesn't exist when rows are just table cells).

**AppFlowy, Notion, Obsidian Bases, AFFiNE, Coda — none of them use markdown pipe tables as storage.** Their native formats are all structured. The "shared markdown for all views" intuition is a misreading of what these apps do: the DATA is shared across views, the VIEW CONFIGS are separate files / metadata blocks. "One file for table + board + calendar" is a myth.

## Canonical: row-per-file + parent database.md + view config files

```
databases/
  <database-slug>/
    database.md              ← schema + default view in YAML frontmatter
                               body = optional description + rendered view
    views/
      board.view.json        ← filters, sorts, group-by field, hidden fields
      calendar.view.json     ← date field + any view-specific config
      standup.view.json      ← any user-defined named view
    rows/
      <row-slug-or-uuid>.md  ← one row = one file
      ...
    cards/                   ← OPTIONAL — used when board cards need rich
      <row-id>.md            ← body content distinct from rows/<id>.md
```

**`database.md` frontmatter shape:**

```yaml
---
id: db-9a3f-...              # stable UUID
kind: database
title: Projects
fields:                       # schema — ORDER IS NOT SEMANTIC; id is authoritative
  - id: f_status
    name: Status
    type: single_select
    options:
      - { id: opt_todo,   name: To do,       color: gray }
      - { id: opt_wip,    name: In progress, color: blue }
      - { id: opt_done,   name: Done,        color: green }
  - id: f_owner
    name: Owner
    type: relation
    target_database_id: db-people-...
  - id: f_due
    name: Due
    type: date
    include_time: false
  - id: f_progress
    name: Progress
    type: number
    format: percent
default_view: standup
---

Optional long-form description of the database. Wikilinks work.
```

**Row file shape (one file per row):**

```yaml
---
id: row-7c2e-...             # stable UUID — survives renames, referenced by wikilinks
database_id: db-9a3f-...     # parent database
title: Helix Q3 Retro        # primary field
status: opt_wip              # stored as option ID; title resolved via database.md
owner: [[people/priya]]      # relation = wikilink to another row
due: 2026-04-18              # ISO date
progress: 80                 # numeric
tags: [retro, engineering]   # multi-select / free tags (v2 split)
---

Full markdown body here. This IS the row's "page" when you click to open it.
Wikilinks work. MDX editor works. Backlinks index this file normally.
```

**View config file shape (`views/<slug>.view.json`):**

```json
{
  "id": "view-standup-...",
  "database_id": "db-9a3f-...",
  "name": "Standup",
  "layout": "board",
  "filters": [{ "field": "f_status", "op": "neq", "value": "opt_done" }],
  "sorts":   [{ "field": "f_due", "dir": "asc" }],
  "view_options": {
    "fieldVisibility": { "f_progress": false },
    "boardGroupFieldId": "f_status",
    "boardCardFields":   ["f_owner", "f_due"]
  }
}
```

## Why this shape is correct

| Property | Consequence |
|---|---|
| One row = one file | Git diffs are per-row. Merges are clean. Each row has its own history. |
| Body = markdown | Wikilinks work into and out of every row. Row is a first-class page. |
| Frontmatter = YAML | Typed values (numbers, dates, lists, nested maps). Standard Obsidian-compatible format. |
| IDs authoritative, order cosmetic | Column / field reorder doesn't break views or wikilinks. Rename is safe. |
| Views are their own files | 10 views over the same data is 10 tiny JSON files, not 10 copies of the data. Data mutation triggers one fanout. |
| Rich cell types map cleanly | Relations → wikilinks. Files → path strings. Multi-select → YAML list of option IDs. Formulas → computed at read time, never persisted. |
| External editor round-trips | User opens a row in VS Code / Obsidian, edits body or frontmatter, saves → Infield's `window:focus` handler sees mtime change → Rule 13 conflict guard fires if the row is open in Infield. |
| Rename propagation | Wikilinks point to row `id`, not filename. Renaming the slug updates the path; all wikilinks (stored as `node://uuid`) keep working. |
| Per-row undo | Each row file is independent; per-row undo stack is natural. |
| Schema migration | Add a new field in `database.md` → old rows get the default on read. Remove a field → orphan data remains in row frontmatter (can be swept later). |

## Current state vs target (2026-04-21)

The app does **not** yet fully match this shape. Migration is tracked as `M-vault-rows` in [PLAN.md](../../PLAN.md).

| Layout | Today | Target |
|---|---|---|
| Board | `database.md` + `cards/<id>.md` per card | ✅ already close to target; rename `cards/` → `rows/` and add explicit `database.md` frontmatter schema block |
| Table | `database.md` with entire CSV body inline (all rows in one file) | ❌ migrate to `rows/<id>.md` per row |
| Calendar | Single `database.md` per database (calendar view config inside) | ❌ split row data into `rows/`, keep calendar view config as its own `views/calendar.view.json` |
| List | Shares storage with Table | ❌ same migration as Table |
| Chart | Shares storage with the underlying database | — (no storage migration; chart is a view config) |

See `src-tauri/src/managers/workspace/vault/` — `table.rs`, `board.rs`, `calendar.rs`, and import counterparts. Board is the reference implementation to generalize. Treat `M-vault-rows` as a migration that must round-trip every existing vault file (import-legacy path required).

## Wikilinks across databases

- Row body wikilinks stored as `[display title](node://<row-uuid>)` — same as document wikilinks.
- Relation cells stored as `[[databases/<db-slug>/rows/<target-slug>]]` in YAML — resolves to the target row file by path, verified against `database_id` matching the relation's `target_database_id` at read time.
- Wikilinks **into** database cells (table rich-text) remain deferred to v2 (see CLAUDE.md → Deferred).

## What "shared single markdown" actually means

Users will see one URL per database with Table/Board/Calendar tabs. That's a UI rendering, not a storage fact. All four views read the same `rows/*.md` set and apply different view configs. The shared thing is the data, not the file.

If you want a single flat markdown export (e.g., for "Export database as CSV" or a read-only GitHub README-style view), render it on demand from the rows. Never let a rendered export become a second source of truth.

## Enforcement

- Never serialize a database body as a pipe table (`| col |`) for storage. Rendered output inside a note body (user-typed markdown tables as content, or a Dataview-style block) is fine — that's content, not storage.
- Every new database layout must list its storage shape in the table above before implementation starts. Changing storage across layouts = migration + round-trip tests.
- Row files MUST declare `database_id` in frontmatter. Orphan row files (no or invalid `database_id`) are surfaced in a "Vault issues" panel, never silently imported.
- `database.md` `fields:` array IDs are permanent. Adding a field appends; removing a field leaves an orphan key in row frontmatter — rewrite those rows explicitly via a migration, never silently on read.
