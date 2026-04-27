import { Facet } from '@codemirror/state'

/**
 * Facet supplying the active workspace-node UUID to every CM6 extension
 * mounted in MarkdownEditor. Used by slash commands and other view-level
 * extensions that need to know which node owns the document.
 *
 * MarkdownEditor populates via `nodeIdFacet.of(nodeId)` when it builds the
 * extensions array per node (Task 19).
 */
export const nodeIdFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? '',
})
