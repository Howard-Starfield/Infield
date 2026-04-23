---
description: Handy app — workspace feature, Tauri, and project conventions (read CLAUDE.md).
globs:
  - src/components/workspace/**/*
  - src/stores/workspaceStore.ts
  - src-tauri/src/commands/workspace_nodes.rs
  - src-tauri/src/managers/workspace/**/*
---

# Handy / workspace

Before substantive edits under `src/components/workspace/` or workspace Tauri code:

1. Read **AGENTS.md** at the repository root for the full implementation guide (build rules, architecture, deferred scope).
2. Read **CLAUDE.md** at the repository root (full file).
3. For feature scope and guardrails, also read **PLAN.md** (same directory).

User-owned specs under `.cursor/plans/` are optional context — do not edit them unless the user asks.

## Quick constraints

- Navigate via `workspaceStore.navigateTo` / `goBack` — do not use `window.history` for workspace navigation unless a documented exception (see CLAUDE.md).
- Prefer **inline styles + `var(--workspace-*)`** in `workspace/`; avoid adding new Tailwind there when editing (some files still have legacy Tailwind — do not spread the pattern).
- Use **granular** `useWorkspaceStore(selector)` selectors, not `useWorkspaceStore()` without a selector.
- After changes: `bun run build` (TypeScript + Vite). For Rust: `cd src-tauri && cargo check`.
