import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { commands, type ProviderStatus } from "@/bindings";
import { chatProviderConfigFromStatus } from "@/lib/chatProviderConfig";
import { useChatStore } from "@/stores/chatStore";
import {
  ChatComposer,
  isChatDocumentFile,
  readChatDocumentFileAsPending,
  readImageFileAsPending,
  type PendingChatDocument,
  type PendingChatImage,
} from "./ChatComposer";
import { ChatContextDrawer } from "./ChatContextDrawer";
import { ChatMessageBubble } from "./ChatMessage";
import { WorkspaceDraftPreviewCard } from "./WorkspaceDraftPreviewCard";

export function ChatWindow() {
  const { t } = useTranslation();
  const {
    messages,
    isLoading,
    streamingContent,
    activeSessionId,
    startSession,
    sendMessage,
    pendingWorkspaceDraft,
    pendingWorkspaceDraftError,
    dismissPendingWorkspaceDraft,
  } = useChatStore();
  const [input, setInput] = useState("");
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatImage[]>([]);
  const [pendingDocuments, setPendingDocuments] = useState<PendingChatDocument[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** When true, transcript growth (new messages / streaming) keeps the scroll position pinned to the bottom. */
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatDropShellRef = useRef<HTMLDivElement>(null);
  const [fileDragOverChat, setFileDragOverChat] = useState(false);

  const dataTransferHasFiles = (dt: DataTransfer | null) =>
    Boolean(dt?.types && Array.from(dt.types).includes("Files"));

  const loadProviders = useCallback(async () => {
    const result = await commands.getChatProviders();
    if (result.status === "ok") {
      setProviders(result.data);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
    let unlisten: UnlistenFn | undefined;
    void listen("chat-provider-changed", () => {
      void loadProviders();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [loadProviders]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) {
      void startSession();
    }
  }, [activeSessionId, startSession]);

  const scrollTranscriptToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, []);

  const NEAR_BOTTOM_PX = 120;

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) {
      return;
    }
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = dist < NEAR_BOTTOM_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [activeSessionId]);

  useLayoutEffect(() => {
    if (!stickToBottomRef.current) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      scrollTranscriptToBottom();
    });
    return () => window.cancelAnimationFrame(id);
  }, [messages, streamingContent, isLoading, scrollTranscriptToBottom]);

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && pendingAttachments.length === 0 && pendingDocuments.length === 0) || isLoading) {
      return;
    }

    const toSend = text;
    const att =
      pendingAttachments.length > 0
        ? pendingAttachments.map(({ mime, data_base64 }) => ({ mime, data_base64 }))
        : null;
    const documentContext =
      pendingDocuments.length > 0
        ? pendingDocuments.map((d) => d.documentXml).join("\n\n")
        : null;
    setInput("");
    setPendingAttachments([]);
    setPendingDocuments([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    stickToBottomRef.current = true;
    window.requestAnimationFrame(() => scrollTranscriptToBottom());
    await sendMessage(toSend, att, documentContext);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const activeProviderId = providers.find((p) => p.is_active)?.provider_id ?? "";

  const handleProviderChange = async (nextId: string) => {
    const p = providers.find((x) => x.provider_id === nextId);
    if (!p) {
      return;
    }
    const result = await commands.setChatProvider(chatProviderConfigFromStatus(p));
    if (result.status !== "ok") {
      toast.error(String(result.error));
      return;
    }
    await loadProviders();
  };

  const onPickFiles = async (list: FileList | null) => {
    if (!list?.length) {
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (isChatDocumentFile(file)) {
        try {
          const doc = await readChatDocumentFileAsPending(file);
          setPendingDocuments((prev) => [...prev, doc]);
          if (doc.truncated) {
            toast.message(
              t(
                "chat.attachments.documentTruncated",
                "Document text was truncated for this chat (size limit).",
              ),
            );
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (msg === "unsupported_doc") {
            toast.error(
              t(
                "chat.attachments.unsupportedDoc",
                "That file type is not supported. Use PDF, Word, Excel, CSV, Markdown, or text.",
              ),
            );
          } else if (msg === "doc_too_large") {
            toast.error(t("chat.attachments.docTooLarge", "Document is too large (max 40 MB)."));
          } else {
            toast.error(
              t("chat.attachments.documentExtractFailed", "Could not read that document.") +
                (msg ? ` ${msg}` : ""),
            );
          }
        }
        continue;
      }
      try {
        const att = await readImageFileAsPending(file);
        setPendingAttachments((prev) => [...prev, att]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "not_image") {
          toast.error(t("chat.attachments.notImageOrDoc", "Choose an image or a supported document file."));
        } else if (msg === "too_large") {
          toast.error(t("chat.attachments.tooLarge", "Image is too large (max 5 MB)."));
        } else {
          toast.error(t("chat.attachments.readFailed", "Could not read that file."));
        }
      }
    }
  };

  const onChatShellDragEnter = (e: DragEvent) => {
    if (!dataTransferHasFiles(e.dataTransfer)) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setFileDragOverChat(true);
  };

  const onChatShellDragOver = (e: DragEvent) => {
    if (!dataTransferHasFiles(e.dataTransfer)) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const onChatShellDragLeave = (e: DragEvent) => {
    if (!dataTransferHasFiles(e.dataTransfer)) {
      return;
    }
    const el = chatDropShellRef.current;
    if (!el) {
      setFileDragOverChat(false);
      return;
    }
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) {
      setFileDragOverChat(false);
    }
  };

  const onChatShellDrop = (e: DragEvent) => {
    if (!dataTransferHasFiles(e.dataTransfer)) {
      return;
    }
    e.preventDefault();
    setFileDragOverChat(false);
    const files = e.dataTransfer.files;
    if (files?.length) {
      void onPickFiles(files);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: "transparent" }}>
      <div
        ref={chatDropShellRef}
        className="flex flex-col flex-1 min-h-0 relative"
        onDragEnter={onChatShellDragEnter}
        onDragOver={onChatShellDragOver}
        onDragLeave={onChatShellDragLeave}
        onDrop={onChatShellDrop}
      >
      {fileDragOverChat ? (
        <div
          aria-hidden
          className="absolute inset-0 z-[30] flex items-center justify-center rounded-lg pointer-events-none"
          style={{
            margin: 8,
            border: "2px dashed var(--workspace-accent)",
            background: "var(--workspace-chat-drop-bg)",
            backdropFilter: "blur(6px)",
            boxShadow: "inset 0 0 0 1px var(--workspace-chat-drop-ring)",
          }}
        >
          <div
            className="workspace-eyebrow text-center px-6"
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--workspace-text)",
              maxWidth: 320,
              lineHeight: 1.45,
            }}
          >
            {t("chat.dropFilesHere", "Drop files to attach")}
          </div>
        </div>
      ) : null}
      <div
        style={{
          padding: "18px 28px 14px",
          borderBottom: "1px solid var(--workspace-border)",
          background: "var(--workspace-chat-header-bg)",
          backdropFilter: "blur(14px)",
        }}
      >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
            }}
          >
            <div>
              <div className="workspace-eyebrow" style={{ marginBottom: 8 }}>
                Assistant Workspace
              </div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  fontFamily: "Manrope, sans-serif",
                  color: "var(--workspace-text)",
                  letterSpacing: "-0.03em",
                }}
              >
                {t("chat.title", "AI Chat")}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setContextOpen(true)}
                disabled={!activeSessionId}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--workspace-border)",
                  background: "var(--workspace-panel-muted)",
                  color: "var(--workspace-text)",
                  cursor: activeSessionId ? "pointer" : "not-allowed",
                  opacity: activeSessionId ? 1 : 0.5,
                }}
              >
                <Info size={16} />
                {t("chat.context.open", "Context")}
              </button>
            </div>
          </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--workspace-text-muted)",
            marginTop: 6,
          }}
        >
          {t("chat.empty", "Start a conversation...")}
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto"
        style={{
          padding: "26px 28px 18px",
          background: "var(--workspace-chat-transcript-radial)",
        }}
      >
        <div style={{ maxWidth: 980, margin: "0 auto", minHeight: "100%" }}>
          {messages.length === 0 && !isLoading && !streamingContent ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "100%",
                textAlign: "center",
                padding: "48px 0",
                opacity: 0.64,
              }}
            >
              <div
                style={{
                  width: 54,
                  height: 54,
                  border: "2px solid var(--workspace-accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                  background: "var(--workspace-panel)",
                }}
              >
                <span
                  className="ms"
                  style={{
                    fontSize: 28,
                    color: "var(--workspace-accent)",
                  }}
                >
                  analytics
                </span>
              </div>
              <p
                className="workspace-eyebrow"
                style={{
                  marginBottom: 6,
                  color: "var(--workspace-text-muted)",
                }}
              >
                {t("chat.emptyEyebrow", "New chat")}
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: "var(--workspace-text-muted)",
                }}
              >
                {t("chat.emptyHint", "Type a message below. Use Context to see workspace memories and the system prompt.")}
              </p>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div key={message.id}>
                  <ChatMessageBubble
                    role={message.role as "user" | "assistant"}
                    content={message.content}
                    attachments={message.attachments ?? undefined}
                    document_context={message.document_context ?? undefined}
                  />
                </div>
              ))}
              {isLoading &&
                (streamingContent ? (
                  <div style={{ scrollMarginTop: 12 }}>
                    <ChatMessageBubble role="assistant" content={streamingContent} />
                  </div>
                ) : (
                  <div
                    className="flex justify-start mb-4"
                    style={{ scrollMarginTop: 12 }}
                  >
                    <div
                      className="workspace-chat-card"
                      style={{
                        maxWidth: "84%",
                        background: "var(--workspace-panel)",
                        borderLeft: "4px solid var(--workspace-accent-secondary)",
                        padding: "18px 18px",
                        boxShadow: "var(--workspace-shadow-soft)",
                      }}
                    >
                      <span
                        className="text-sm animate-pulse"
                        style={{ color: "var(--workspace-text-muted)" }}
                      >
                        {t("chat.thinking", "Thinking...")}
                      </span>
                    </div>
                  </div>
                ))}
            </>
          )}
        </div>
      </div>

      <div
        style={{
          padding: "10px 28px 16px",
          borderTop: "1px solid var(--workspace-chat-footer-divider)",
          background: "var(--workspace-chat-footer-bg)",
          backdropFilter: "blur(14px)",
          flexShrink: 0,
          position: "relative",
          zIndex: 4,
        }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto",
            position: "relative",
          }}
        >
          {(pendingWorkspaceDraftError || pendingWorkspaceDraft) && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "100%",
                marginBottom: 10,
                maxHeight: "min(52vh, 420px)",
                overflowY: "auto",
                borderRadius: 16,
                border: "1px solid var(--workspace-border)",
                background: "var(--workspace-panel)",
                boxShadow: "var(--workspace-chat-draft-popup-shadow)",
                padding: pendingWorkspaceDraftError && !pendingWorkspaceDraft ? 12 : 0,
                animation: "handyDraftPopupIn 160ms ease-out",
              }}
            >
              {pendingWorkspaceDraftError && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--workspace-chat-draft-error-text)",
                    background: pendingWorkspaceDraft
                      ? "transparent"
                      : "var(--workspace-chat-draft-error-bg)",
                    borderRadius: pendingWorkspaceDraft ? 0 : 10,
                    padding: pendingWorkspaceDraft ? "0 0 10px 0" : 10,
                    borderBottom: pendingWorkspaceDraft
                      ? "1px solid var(--workspace-chat-subtle-border)"
                      : "none",
                  }}
                >
                  {t("chat.workspace_draft_parse_error", "Could not parse table draft.")}{" "}
                  {pendingWorkspaceDraftError}
                </div>
              )}
              {pendingWorkspaceDraft && (
                <WorkspaceDraftPreviewCard
                  draft={pendingWorkspaceDraft}
                  variant="popup"
                  onDismiss={() => dismissPendingWorkspaceDraft()}
                />
              )}
            </div>
          )}
          <ChatComposer
            input={input}
            setInput={setInput}
            pendingAttachments={pendingAttachments}
            setPendingAttachments={setPendingAttachments}
            pendingDocuments={pendingDocuments}
            setPendingDocuments={setPendingDocuments}
            providers={providers}
            activeProviderId={activeProviderId}
            onProviderChange={handleProviderChange}
            onSend={() => void handleSend()}
            isLoading={isLoading}
            fileInputRef={fileInputRef}
            textareaRef={textareaRef}
            onPickFiles={onPickFiles}
            onApplyPrompt={(text) => {
              setInput((prev) => {
                const p = prev.trim();
                return p.length === 0 ? text : `${prev}\n\n${text}`;
              });
              window.requestAnimationFrame(() => textareaRef.current?.focus());
            }}
            t={t}
          />
        </div>
      </div>
      </div>

      <ChatContextDrawer
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        sessionId={activeSessionId}
        previewQuery={input}
      />
    </div>
  );
}
