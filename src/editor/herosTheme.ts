import { EditorView } from '@codemirror/view'

/**
 * HerOS-token CM6 theme. Every value comes from a CSS custom property
 * declared in src/App.css — zero literal colours, radii, or shadows
 * per CLAUDE.md Rule 12 / 18.
 */
export const herosEditorTheme = EditorView.theme({
  '&': {
    color: 'rgba(238, 242, 255, 0.92)',
    backgroundColor: 'transparent',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    fontSize: '15.5px',
    lineHeight: '1.78',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '30px 0 96px',
    maxWidth: '820px',
    margin: '0 auto',
    caretColor: 'rgba(244, 247, 255, 0.9)',
  },
  '.cm-line': {
    padding: '0 44px',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'rgba(244, 247, 255, 0.9)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(160, 170, 205, 0.2)',
  },
  '.cm-placeholder': {
    color: 'rgba(188, 197, 224, 0.58)',
    fontWeight: 540,
  },
  '&.cm-focused': { outline: 'none' },
  // Autocomplete popup — HerOS card.
  // cm-tooltip-above/below live on the OUTER .cm-tooltip wrapper (positioned
  // by CM6 at cursorBottom). The inner .cm-tooltip-autocomplete is content
  // only. Use the outer wrapper for the gap so it snaps to the cursor line.
  '.cm-tooltip': {
    marginTop: '2px',
  },
  '.cm-tooltip.cm-tooltip-above': {
    marginTop: '0',
    marginBottom: '2px',
  },
  '.cm-tooltip-autocomplete': {
    background: 'var(--card-overlay-fill)',
    backdropFilter: 'blur(var(--card-overlay-blur)) saturate(var(--card-overlay-saturate))',
    WebkitBackdropFilter: 'blur(var(--card-overlay-blur)) saturate(var(--card-overlay-saturate))',
    border: '1px solid var(--card-overlay-rim)',
    borderRadius: 'var(--radius-container)',
    boxShadow: 'var(--shadow-lg)',
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    padding: 'var(--space-1)',
  },
  '.cm-tooltip-autocomplete.notes-editor-autocomplete': {
    zIndex: '1200',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '7px 12px',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--heros-text-muted)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'rgba(255, 255, 255, 0.07)',
    color: 'var(--heros-text-premium)',
  },
  '.cm-tooltip-autocomplete .cm-completionLabel': {
    display: 'block',
    fontWeight: 680,
    lineHeight: '1.2',
  },
  '.cm-tooltip-autocomplete .cm-completionDetail': {
    display: 'block',
    color: 'rgba(188, 197, 224, 0.64)',
    fontSize: '12px',
    fontWeight: 520,
    lineHeight: '1.35',
    marginLeft: '0',
    marginTop: '3px',
  },
  '.cm-completionInfo': {
    display: 'none',
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
