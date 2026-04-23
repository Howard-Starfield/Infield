import { FileText } from "lucide-react";
import type { ChatImageAttachment } from "@/bindings";
import { useTranslation } from "react-i18next";

interface Props {
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: ChatImageAttachment[] | null;
  /** Persisted `<document>...</document>` blocks (filenames shown as chips; body not rendered). */
  document_context?: string | null;
}

function parseDocumentFilenames(documentContext: string): string[] {
  const names: string[] = [];
  const re = /filename="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(documentContext)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/** Strip legacy `<thinking>` / `<think>` blocks from older saved messages. */
function stripLegacyThinkingBlocks(raw: string): string {
  let out = raw.replace(
    /<\s*(?:redacted_thinking|thinking)\b[^>]*>[\s\S]*?<\s*\/\s*(?:redacted_thinking|thinking)\s*>/gi,
    "",
  );
  out = out.replace(/<\s*(?:redacted_thinking|thinking)\b[^>]*>[\s\S]*$/i, "");
  return out;
}

export function ChatMessageBubble({ role, content, attachments, document_context }: Props) {
  const { t } = useTranslation();
  const isUser = role === "user";
  const hasDocs = isUser && Boolean(document_context?.trim());
  const hideImageOnlyPlaceholder =
    isUser &&
    Boolean(attachments?.length) &&
    (!content.trim() || content.trim() === "(image)") &&
    !hasDocs;
  const userText = hideImageOnlyPlaceholder ? "" : content;
  const docNames = hasDocs && document_context ? parseDocumentFilenames(document_context) : [];

  const assistantText = role !== "user" ? stripLegacyThinkingBlocks(content) : content;

  if (isUser) {
    return (
      <div className="flex justify-end items-start gap-4 max-w-4xl ml-auto mb-6">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 8,
          }}
        >
          <div
            style={{
              maxWidth: 560,
              background: "var(--workspace-chat-bubble-user-bg)",
              color: "var(--workspace-chat-bubble-user-text)",
              border: "1px solid var(--workspace-chat-bubble-user-border)",
              padding: "16px 18px",
              boxShadow: "var(--workspace-shadow-soft)",
              fontSize: 14,
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
            }}
          >
            {attachments && attachments.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: userText || docNames.length ? 10 : 0,
                }}
              >
                {attachments.map((a, i) => (
                  <img
                    key={i}
                    src={`data:${a.mime};base64,${a.data_base64}`}
                    alt=""
                    style={{ maxWidth: 200, maxHeight: 160, borderRadius: 8, objectFit: "cover" }}
                  />
                ))}
              </div>
            ) : null}
            {docNames.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginBottom: userText ? 10 : 0,
                }}
              >
                {docNames.map((name, i) => (
                  <span
                    key={`${name}-${i}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "4px 8px",
                      borderRadius: 999,
                      border: "1px solid var(--workspace-chat-doc-chip-border)",
                      background: "var(--workspace-chat-doc-chip-bg)",
                      color: "var(--workspace-text-muted)",
                      maxWidth: 240,
                    }}
                    title={name}
                  >
                    <FileText size={12} aria-hidden />
                    <span className="truncate">{name}</span>
                  </span>
                ))}
              </div>
            ) : null}
            {userText}
          </div>
        </div>
        <div
          style={{
            width: 32,
            height: 32,
            background: "var(--workspace-bg-soft)",
            border: "1px solid var(--workspace-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span className="ms" style={{ fontSize: 16, color: "var(--workspace-accent)" }}>
            person
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start items-start gap-4 max-w-5xl mb-6">
      <div
        style={{
          width: 38,
          height: 38,
          background: "var(--workspace-panel-muted)",
          color: "var(--workspace-text)",
          border: "1px solid var(--workspace-border-strong)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: "var(--workspace-shadow-soft)",
        }}
      >
        <span className="ms" style={{ fontSize: 20 }}>
          smart_toy
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 10,
          width: "100%",
        }}
      >
        <div
          className="workspace-chat-card"
          style={{
            width: "100%",
            background: "var(--workspace-panel)",
            borderLeft: "4px solid var(--workspace-accent-secondary)",
            padding: "20px 22px",
            boxShadow: "var(--workspace-shadow-soft)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 600,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--workspace-text-soft)",
              marginBottom: 12,
            }}
          >
            {t("chat.assistantLabel", "Assistant")}
          </div>
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.8,
              color: "var(--workspace-text)",
              whiteSpace: "pre-wrap",
            }}
          >
            {assistantText}
          </div>
        </div>
        <span
          style={{
            fontSize: 9,
            fontFamily: "Space Grotesk, sans-serif",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: ".12em",
            color: "var(--workspace-text-soft)",
          }}
        >
          Agent-Alpha-01
        </span>
      </div>
    </div>
  );
}
