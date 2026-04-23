import { describe, expect, it } from "vitest";
import type { EbaySyncStateRecord } from "./types";
import { inboxIndexStatusMessage, threadPageStatusMessage } from "./ebay-sync";

function baseSync(overrides: Partial<EbaySyncStateRecord>): EbaySyncStateRecord {
  return {
    accountId: "a1",
    conversationType: "MEMBER_TO_MEMBER",
    lastConversationOffset: 0,
    lastConversationLimit: 50,
    lastConversationNextOffset: 50,
    lastConversationHasMorePages: false,
    lastConversationPageFetchedAt: null,
    lastConversationIdImported: null,
    lastThreadSyncConversationId: null,
    lastThreadOffset: 0,
    lastThreadLimit: 50,
    lastThreadNextOffset: 0,
    lastThreadHasMorePages: false,
    lastThreadFetchedAt: null,
    lastImportedConversationCount: 0,
    lastImportedMessageCount: 0,
    lastError: null,
    ...overrides
  };
}

describe("inboxIndexStatusMessage", () => {
  it("returns not imported when no fetch timestamp", () => {
    expect(inboxIndexStatusMessage(undefined)).toBe("Inbox has not been imported yet");
    expect(inboxIndexStatusMessage(baseSync({}))).toBe("Inbox has not been imported yet");
  });

  it("mentions next offset when more pages", () => {
    const s = baseSync({
      lastConversationHasMorePages: true,
      lastConversationNextOffset: 120,
      lastConversationPageFetchedAt: "2021-01-01T00:00:00.000Z"
    });
    expect(inboxIndexStatusMessage(s)).toContain("120");
  });

  it("returns caught up when fetched and no more pages", () => {
    const s = baseSync({
      lastConversationHasMorePages: false,
      lastConversationPageFetchedAt: "2021-01-01T00:00:00.000Z"
    });
    expect(inboxIndexStatusMessage(s)).toBe("Inbox index is caught up to the latest imported page");
  });
});

describe("threadPageStatusMessage", () => {
  const convId = "c99";

  it("returns not imported when thread not synced for conversation", () => {
    const s = baseSync({ lastThreadSyncConversationId: "other" });
    expect(threadPageStatusMessage(s, convId)).toBe(
      "Thread has not been imported for this conversation yet"
    );
  });

  it("returns caught up when synced and no more pages", () => {
    const s = baseSync({
      lastThreadSyncConversationId: convId,
      lastThreadHasMorePages: false
    });
    expect(threadPageStatusMessage(s, convId)).toBe("Thread cache is caught up to the latest imported page");
  });

  it("mentions thread offset when more pages", () => {
    const s = baseSync({
      lastThreadSyncConversationId: convId,
      lastThreadHasMorePages: true,
      lastThreadNextOffset: 80
    });
    expect(threadPageStatusMessage(s, convId)).toContain("80");
  });
});
