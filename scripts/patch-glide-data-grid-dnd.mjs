/**
 * Idempotent patch for @glideapps/glide-data-grid: disable single-click header / out-of-bounds
 * edge column resize (see data-grid-dnd mousedown). Double-click header edge auto-fit still works
 * in data-editor. Keeps column reorder from non-edge header drags.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const target = path.join(
  root,
  'node_modules',
  '@glideapps',
  'glide-data-grid',
  'src',
  'internal',
  'data-grid-dnd',
  'data-grid-dnd.tsx',
)

const marker = 'Handy patch: no single-click header / out-of-bounds edge resize'

const vanilla = `                if (args.kind === "out-of-bounds" && args.isEdge && canResize) {
                    const bounds = gridRef?.current?.getBounds(columns.length - 1, -1);
                    if (bounds !== undefined) {
                        setResizeColStartX(bounds.x);
                        setResizeCol(columns.length - 1);
                    }
                } else if (args.kind === "header" && col >= lockColumns) {
                    const canvas = canvasRef?.current;
                    if (args.isEdge && canResize && canvas) {
                        setResizeColStartX(args.bounds.x);
                        setResizeCol(col);
                        const rect = canvas.getBoundingClientRect();
                        const scale = rect.width / canvas.offsetWidth;
                        const width = args.bounds.width / scale;
                        onColumnResizeStart?.(columns[col], width, col, width + (columns[col].growOffset ?? 0));
                    } else if (args.kind === "header" && canDragCol) {
                        setDragStartX(args.bounds.x);
                        setDragCol(col);
                    }
                } else if (
`

const patched = `                // ${marker} (setResizeCol).
                // Column width auto-fit still works via double-click in data-editor (normalSizeColumn).
                if (args.kind === "header" && col >= lockColumns) {
                    if (!args.isEdge && canDragCol) {
                        setDragStartX(args.bounds.x);
                        setDragCol(col);
                    }
                } else if (
`

const norm = (t) => t.replace(/\r\n/g, '\n')

try {
  if (!fs.existsSync(target)) {
    process.exit(0)
  }
  let s = fs.readFileSync(target, 'utf8')
  if (s.includes(marker)) {
    process.exit(0)
  }
  const body = norm(s)
  const v = norm(vanilla)
  const p = norm(patched)
  if (!body.includes(v)) {
    process.exit(0)
  }
  s = body.replace(v, p)
  fs.writeFileSync(target, s, 'utf8')
  // eslint-disable-next-line no-console
  console.log('patched @glideapps/glide-data-grid data-grid-dnd (Handy column resize UX)')
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('patch-glide-data-grid-dnd skipped:', e)
}
