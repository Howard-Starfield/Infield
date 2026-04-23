import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type ChatPromptPreview } from "@/bindings";

type Props = {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  /** Text used to embed session-memory preview (composer draft). */
  previewQuery: string;
};

export function ChatContextDrawer({ open, onClose, sessionId, previewQuery }: Props) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<ChatPromptPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !sessionId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const q = previewQuery.trim() || "context";
    void commands.previewChatPromptContext(sessionId, q).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.status === "ok") {
        setPreview(res.data);
      } else {
        setError(String(res.error));
        setPreview(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, previewQuery]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: "var(--workspace-chat-backdrop)" }}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby="chat-context-title"
        className="h-full max-w-lg w-full min-w-[min(100%,360px)] overflow-y-auto shadow-2xl"
        style={{
          background: "var(--workspace-panel)",
          borderLeft: "1px solid var(--workspace-border)",
          padding: "20px 22px 28px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 id="chat-context-title" className="text-base font-semibold" style={{ color: "var(--workspace-text)" }}>
            {t("chat.context.title", "Prompt context")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm"
            style={{
              border: "1px solid var(--workspace-border)",
              background: "var(--workspace-panel-muted)",
              borderRadius: 8,
              padding: "6px 12px",
              cursor: "pointer",
              color: "var(--workspace-text)",
            }}
          >
            {t("common.close", "Close")}
          </button>
        </div>

        <p className="text-xs mb-4" style={{ color: "var(--workspace-text-muted)", lineHeight: 1.5 }}>
          {t(
            "chat.context.intro",
            "What the next assistant reply is influenced by. Workspace memories come from the app database (not arbitrary folders).",
          )}
        </p>

        {loading && (
          <p className="text-sm" style={{ color: "var(--workspace-text-muted)" }}>
            {t("chat.context.loading", "Loading…")}
          </p>
        )}
        {error && (
          <p className="text-sm" style={{ color: "var(--workspace-chat-error)" }}>
            {error}
          </p>
        )}

        {preview && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--workspace-text-soft)" }}>
                {t("chat.context.model", "Model")}
              </h3>
              <p className="text-sm" style={{ color: "var(--workspace-text)" }}>
                <strong>{preview.active_provider_id}</strong> · {preview.resolved_model}
              </p>
              {preview.base_url ? (
                <p className="text-xs mt-1 break-all" style={{ color: "var(--workspace-text-muted)" }}>
                  {preview.base_url}
                </p>
              ) : null}
            </section>

            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--workspace-text-soft)" }}>
                {t("chat.context.systemPrompt", "Rendered system prompt")}
              </h3>
              <pre
                className="text-xs whitespace-pre-wrap rounded-lg p-3 max-h-64 overflow-y-auto"
                style={{
                  background: "var(--workspace-bg-soft)",
                  border: "1px solid var(--workspace-border)",
                  color: "var(--workspace-text)",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {preview.system_prompt_rendered}
              </pre>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  style={{
                    fontSize: 12,
                    border: "none",
                    background: "transparent",
                    color: "var(--workspace-accent)",
                    cursor: "pointer",
                    textDecoration: "underline",
                    textAlign: "left",
                  }}
                  onClick={() => void navigator.clipboard.writeText(preview.system_prompt_rendered)}
                >
                  {t("chat.context.copySystem", "Copy system prompt")}
                </button>
                <button
                  type="button"
                  style={{
                    fontSize: 12,
                    border: "none",
                    background: "transparent",
                    color: "var(--workspace-accent)",
                    cursor: "pointer",
                    textDecoration: "underline",
                    textAlign: "left",
                  }}
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("handy-open-settings", { detail: { section: "llmProviders" } }),
                    );
                    onClose();
                  }}
                >
                  {t(
                    "chat.context.editTemplateInSettings",
                    "Edit system prompt template in Settings…",
                  )}
                </button>
              </div>
            </section>

            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--workspace-text-soft)" }}>
                {t("chat.context.workspaceMemories", "Workspace memories")}
              </h3>
              {preview.workspace_memories.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--workspace-text-muted)" }}>
                  {t("chat.context.noMemories", "None retrieved for this chat.")}
                </p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                  {preview.workspace_memories.map((m) => (
                    <li
                      key={m.id}
                      className="text-sm rounded-lg p-3"
                      style={{
                        background: "var(--workspace-bg-soft)",
                        border: "1px solid var(--workspace-border)",
                        color: "var(--workspace-text)",
                      }}
                    >
                      <div className="text-xs font-semibold mb-1" style={{ color: "var(--workspace-accent-secondary)" }}>
                        {m.category} · {m.source}
                      </div>
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--workspace-text-soft)" }}>
                {t("chat.context.sessionMemory", "Session semantic memory")}
              </h3>
              <p className="text-xs mb-2" style={{ color: "var(--workspace-text-muted)" }}>
                {preview.session_rag_used_in_send
                  ? t("chat.context.sessionUsed", "Included when sending messages.")
                  : t(
                      "chat.context.sessionNotUsed",
                      "Shown for transparency only — not merged into the live request yet.",
                    )}
              </p>
              {preview.session_relevant_memories.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--workspace-text-muted)" }}>
                  {t("chat.context.noSessionChunks", "No matching session chunks (or embeddings unavailable).")}
                </p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                  {preview.session_relevant_memories.map((c) => (
                    <li
                      key={c.id}
                      className="text-xs rounded-lg p-2 whitespace-pre-wrap"
                      style={{
                        background: "var(--workspace-bg-soft)",
                        border: "1px solid var(--workspace-border)",
                        color: "var(--workspace-text)",
                      }}
                    >
                      <span style={{ color: "var(--workspace-text-muted)" }}>d={c.distance.toFixed(4)}</span>
                      <br />
                      {c.content}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="text-xs" style={{ color: "var(--workspace-text-muted)", lineHeight: 1.55 }}>
              {t(
                "chat.context.folderNote",
                "A user-chosen “memory folder” with automatic ingestion is not implemented; memories are stored in the app database.",
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
