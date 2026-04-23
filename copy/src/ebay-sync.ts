/**
 * eBay inbox sync copy and small helpers (plain text for UI).
 * Import/index/thread paging is implemented in Rust; this module stays UI-adjacent and testable.
 */
import type { EbaySyncStateRecord } from "./types";

/** Account rail: conversation index import / pagination status. */
export function inboxIndexStatusMessage(sync: EbaySyncStateRecord | undefined): string {
  if (sync?.lastConversationHasMorePages) {
    return `Next inbox page ready at offset ${sync.lastConversationNextOffset}`;
  }
  if (sync?.lastConversationPageFetchedAt) {
    return "Inbox index is caught up to the latest imported page";
  }
  return "Inbox has not been imported yet";
}

/** Thread header: message thread page fetch status for the open conversation. */
export function threadPageStatusMessage(
  sync: EbaySyncStateRecord | undefined,
  conversationId: string
): string {
  if (sync?.lastThreadSyncConversationId === conversationId) {
    return sync.lastThreadHasMorePages
      ? `More thread pages available at offset ${sync.lastThreadNextOffset}`
      : "Thread cache is caught up to the latest imported page";
  }
  return "Thread has not been imported for this conversation yet";
}
