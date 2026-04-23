/**
 * Glide DataEditor lazy-loads the overlay editor behind React.lazy + Suspense (fallback: null).
 * Preload via filesystem path so Vite does not require package "exports" entries for internals.
 */
import '../node_modules/@glideapps/glide-data-grid/dist/esm/internal/data-grid-overlay-editor/data-grid-overlay-editor.js'
