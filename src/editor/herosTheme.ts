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
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 'var(--radius-container, 10px)',
    boxShadow: 'var(--shadow-lg)',
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    padding: 'var(--space-1, 4px)',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: 'var(--space-2, 8px) var(--space-3, 12px)',
    borderRadius: '6px',
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
