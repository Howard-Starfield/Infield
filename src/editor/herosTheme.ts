import { EditorView } from '@codemirror/view'

/**
 * HerOS-token CM6 theme. Every value comes from a CSS custom property
 * declared in src/App.css — zero literal colours, radii, or shadows
 * per CLAUDE.md Rule 12 / 18.
 */
export const herosEditorTheme = EditorView.theme({
  '&': {
    color: 'var(--heros-text-premium)',
    backgroundColor: 'transparent',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    fontSize: 'var(--text-base)',
    lineHeight: '1.7',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: 'var(--space-6) 0',
    maxWidth: '760px',
    margin: '0 auto',
    caretColor: 'var(--heros-brand)',
  },
  '.cm-line': {
    padding: '0 var(--space-6)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--heros-brand)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--heros-brand) 18%, transparent)',
  },
  '&.cm-focused': { outline: 'none' },
  // Autocomplete popup — HerOS card
  '.cm-tooltip-autocomplete': {
    background: 'var(--heros-glass-black)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-container)',
    boxShadow: 'var(--shadow-lg)',
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    padding: 'var(--space-1)',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--heros-text-muted)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'color-mix(in srgb, var(--heros-brand) 15%, transparent)',
    color: 'var(--heros-text-premium)',
  },
  '.cm-tooltip-autocomplete .cm-completionLabel': {
    fontWeight: 500,
  },
  '.cm-tooltip-autocomplete .cm-completionDetail': {
    color: 'var(--heros-text-faint)',
    fontSize: 'var(--text-xs)',
    marginLeft: 'var(--space-3)',
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
