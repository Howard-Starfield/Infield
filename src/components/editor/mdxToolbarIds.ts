import { z } from "zod";

/** Reorderable rich-text toolbar segments (matches KitchenSinkToolbar fallback order). */
export const MDX_TOOL_IDS = [
  "undoRedo",
  "boldItalicUnderline",
  "codeToggle",
  "highlightToggle",
  "strikeSupSub",
  "listsToggle",
  "blockType",
  "createLink",
  "insertImage",
  "insertTable",
  "insertThematicBreak",
  "insertCodeBlock",
  "insertSandpack",
  "insertAdmonition",
  "insertFrontmatter",
] as const;

export type MdxToolId = (typeof MDX_TOOL_IDS)[number];

export const DEFAULT_MDX_TOOL_ORDER: MdxToolId[] = [...MDX_TOOL_IDS];

const toolIdSchema = z.custom<MdxToolId>(
  (val): val is MdxToolId =>
    typeof val === "string" && (MDX_TOOL_IDS as readonly string[]).includes(val),
);

const persistedSchema = z.object({
  order: z.array(toolIdSchema),
});

/** Heuristic widths (px) for overflow layout — avoids mounting duplicate controls for measurement. */
export const MDX_TOOL_EST_WIDTH: Record<MdxToolId, number> = {
  undoRedo: 68,
  boldItalicUnderline: 112,
  codeToggle: 32,
  highlightToggle: 32,
  strikeSupSub: 92,
  listsToggle: 100,
  blockType: 132,
  createLink: 32,
  insertImage: 32,
  insertTable: 32,
  insertThematicBreak: 32,
  insertCodeBlock: 32,
  insertSandpack: 40,
  insertAdmonition: 40,
  insertFrontmatter: 32,
};

export const MDX_TOOLBAR_SEP_GAP = 6;
export const MDX_TOOLBAR_MORE_RESERVE = 40;
export const MDX_TOOLBAR_CUSTOMIZE_RESERVE = 34;

/**
 * Pinned strip: how many tools stay on the main note toolbar (first N in customize order); rest in More.
 * See CLAUDE.md / AGENTS.md — “Pitfalls — MDX note toolbar (pinned strip)”.
 */
export const MDX_TOOLBAR_PINNED_COUNT = 8;

/**
 * How many tools fit on the main strip at the given width (px), using heuristic
 * segment widths plus customize / optional "More" reserves.
 */
export function computePinnedToolCount(
  availableWidth: number,
  order: readonly MdxToolId[],
): number {
  if (!order.length) return 0
  const PAD = 18
  if (availableWidth <= PAD) return 1
  for (let n = order.length; n >= 1; n--) {
    const visible = order.slice(0, n)
    const hidden = order.slice(n)
    let w = PAD + MDX_TOOLBAR_CUSTOMIZE_RESERVE
    if (hidden.length > 0) w += MDX_TOOLBAR_MORE_RESERVE
    for (let i = 0; i < visible.length; i++) {
      w += MDX_TOOL_EST_WIDTH[visible[i]]
      if (i > 0) w += MDX_TOOLBAR_SEP_GAP
    }
    if (w <= availableWidth) return n
  }
  return 1
}

/** Parse and validate stored order; must be a permutation of all tool ids. */
export function normalizeMdxToolOrder(raw: unknown): MdxToolId[] {
  const base = new Set<MdxToolId>(MDX_TOOL_IDS);
  const parsed = persistedSchema.safeParse(raw);
  if (!parsed.success) return [...DEFAULT_MDX_TOOL_ORDER];
  const order = parsed.data.order;
  if (order.length !== base.size) return [...DEFAULT_MDX_TOOL_ORDER];
  const seen = new Set<MdxToolId>();
  for (const id of order) {
    if (seen.has(id)) return [...DEFAULT_MDX_TOOL_ORDER];
    seen.add(id);
  }
  for (const id of base) {
    if (!seen.has(id)) return [...DEFAULT_MDX_TOOL_ORDER];
  }
  return order;
}
