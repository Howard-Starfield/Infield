export const deriveNoteTitle = (text: string, fallback: string): string => {
  const normalized = text.split(/\s+/).join(" ").trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, 50).trim();
};

/**
 * Returns the markdown string to seed MDXEditor.
 *
 * Legacy notes may still have JSON document-tree blobs in `content` (starts with `[` or `{`);
 * for those, fall back to `plain_text`. The one-shot `migrate_json_notes_to_markdown`
 * command rewrites these on first launch, so this branch exists only to render
 * correctly during the brief window before that migration lands.
 */
export const getInitialMarkdown = (
  content: string,
  plainText: string,
): string => {
  const trimmed = content?.trim() ?? '';
  if (!trimmed || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return plainText?.trim() ?? '';
  }
  return trimmed;
};

/**
 * Strips basic markdown syntax characters to produce a searchable plain-text
 * string stored in the `plain_text` column alongside markdown `content`.
 */
export const extractPlainTextFromMarkdown = (markdown: string): string =>
  markdown
    .replace(/^#{1,6}\s+/gm, '')        // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')    // bold
    .replace(/\*(.+?)\*/g, '$1')        // italic
    .replace(/__(.+?)__/g, '$1')        // bold alt
    .replace(/_(.+?)_/g, '$1')          // italic alt
    .replace(/~~(.+?)~~/g, '$1')        // strikethrough
    .replace(/`{1,3}[^`]*`{1,3}/g, '') // inline code / fenced blocks
    .replace(/^\s*[-*+]\s+/gm, '')      // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, '')      // ordered list markers
    .replace(/^\s*>\s+/gm, '')          // blockquotes
    .replace(/!\[.*?\]\(.*?\)/g, '')    // images
    .replace(/\[(.+?)\]\(.*?\)/g, '$1') // links → label only
    .replace(/\n{3,}/g, '\n\n')         // collapse excess blank lines
    .trim();
