import type { LucideIcon } from 'lucide-react'
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Minus,
  Code,
  Link as LinkIcon,
  Calendar,
  Image as ImageIcon,
} from 'lucide-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/** Map slash-command id → Lucide icon component. Keep this manual:
 *  it's the source of truth for which icons ship in the bundle and
 *  prevents bundle bloat from importing whole namespaces.
 *  Section-header rows render no icon — the icon cell stays empty. */
const ID_TO_ICON: Record<string, LucideIcon> = {
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  ul: List,
  ol: ListOrdered,
  todo: CheckSquare,
  quote: Quote,
  divider: Minus,
  code: Code,
  link: LinkIcon,
  today: Calendar,
  image: ImageIcon,
}

/** Module-load: render each Lucide icon component once via React's
 *  static markup, parse into an SVG Document, and stash the root.
 *  Per-row consumers call svgForCommandId() which clones the cached
 *  <svg>. Avoids `innerHTML` in the per-row path entirely. */
const ICON_TEMPLATES: Record<string, SVGElement> = {}

;(() => {
  const parser = new DOMParser()
  for (const [id, Icon] of Object.entries(ID_TO_ICON)) {
    const markup = renderToStaticMarkup(
      createElement(Icon, { size: 18, strokeWidth: 2, 'aria-hidden': true }),
    )
    const doc = parser.parseFromString(markup, 'image/svg+xml')
    const svg = doc.documentElement
    // DOMParser returns a parsererror element on malformed markup;
    // Lucide markup is well-formed by definition, but guard anyway.
    if (svg && svg.nodeName.toLowerCase() === 'svg') {
      ICON_TEMPLATES[id] = svg as unknown as SVGElement
    }
  }
})()

/** Returns a fresh, detached SVG element for the given command id, or
 *  null if the id has no icon. Caller appends it directly. */
export function svgForCommandId(id: string): SVGElement | null {
  const tpl = ICON_TEMPLATES[id]
  if (!tpl) return null
  return tpl.cloneNode(true) as SVGElement
}
