import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Sparkles, Trash2, X } from "lucide-react";
import type { TFunction } from "i18next";
import { BUILT_IN_CHAT_PROMPTS } from "@/lib/chatPromptPresets";
import { workspaceModalZ } from "@/lib/workspaceFloatingLayer";

const STORAGE_KEY = "handy.chat.customPrompts";

export type StoredCustomPrompt = {
  id: string;
  title: string;
  body: string;
};

function loadCustomPrompts(): StoredCustomPrompt[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is StoredCustomPrompt =>
          x !== null &&
          typeof x === "object" &&
          typeof (x as StoredCustomPrompt).id === "string" &&
          typeof (x as StoredCustomPrompt).title === "string" &&
          typeof (x as StoredCustomPrompt).body === "string",
      )
      .map((x) => ({
        id: x.id,
        title: x.title.trim() || "Custom",
        body: x.body,
      }));
  } catch {
    return [];
  }
}

function saveCustomPrompts(items: StoredCustomPrompt[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* ignore quota */
  }
}

type Props = {
  onApplyPrompt: (text: string) => void;
  t: TFunction;
  /** Unified pill chrome from composer (height, radius, border). */
  pillStyle?: React.CSSProperties;
};

export function ChatPromptMenu({ onApplyPrompt, t, pillStyle }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<StoredCustomPrompt[]>(() =>
    typeof window !== "undefined" ? loadCustomPrompts() : [],
  );
  const [customForm, setCustomForm] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customBody, setCustomBody] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setCustomForm(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const persistCustom = useCallback((next: StoredCustomPrompt[]) => {
    setCustom(next);
    saveCustomPrompts(next);
  }, []);

  const removeCustom = (id: string) => {
    persistCustom(custom.filter((c) => c.id !== id));
  };

  const saveNewCustom = () => {
    const title = customTitle.trim() || t("chat.prompts.custom.untitled", "Custom prompt");
    const body = customBody.trim();
    if (!body) return;
    const row: StoredCustomPrompt = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}`,
      title,
      body,
    };
    persistCustom([row, ...custom]);
    setCustomTitle("");
    setCustomBody("");
    setCustomForm(false);
  };

  const closeModal = () => {
    setOpen(false);
    setCustomForm(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const applyBuiltIn = (body: string) => {
    onApplyPrompt(body);
    closeModal();
  };

  const applyCustom = (body: string) => {
    onApplyPrompt(body);
    closeModal();
  };

  const pillBase: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 36,
    padding: "0 12px",
    borderRadius: 999,
    border: "1px solid var(--workspace-border)",
    background: "var(--workspace-panel)",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--workspace-text)",
    cursor: "pointer",
    boxShadow: "var(--workspace-shadow-soft)",
    ...pillStyle,
  };

  const modal =
    open &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: Number.parseInt(workspaceModalZ(), 10) || 12030,
          background: "var(--workspace-chat-backdrop)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-prompt-modal-title"
          style={{
            width: "min(560px, 92vw)",
            maxHeight: "min(80vh, 640px)",
            display: "flex",
            flexDirection: "column",
            borderRadius: "var(--workspace-menu-radius)",
            border: "1px solid var(--workspace-border)",
            background: "var(--workspace-panel)",
            boxShadow: "var(--workspace-chat-modal-shadow)",
            overflow: "hidden",
            animation: "handyDraftPopupIn 140ms ease-out",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "12px 16px",
              borderBottom: "1px solid var(--workspace-chat-subtle-border)",
              flexShrink: 0,
            }}
          >
            <span
              id="chat-prompt-modal-title"
              style={{ fontSize: 14, fontWeight: 700, color: "var(--workspace-text)" }}
            >
              {t("chat.prompts.menuTitle", "Suggested prompts")}
            </span>
            <button
              type="button"
              onClick={() => closeModal()}
              style={{
                border: "none",
                background: "transparent",
                padding: 4,
                cursor: "pointer",
                color: "var(--workspace-text-muted)",
                display: "flex",
                alignItems: "center",
              }}
              aria-label={t("chat.prompts.close", "Close")}
            >
              <X size={18} />
            </button>
          </div>
          <div style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "8px 0" }}>
            {BUILT_IN_CHAT_PROMPTS.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyBuiltIn(p.body)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 18px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 13,
                  color: "var(--workspace-text)",
                  borderBottom:
                    i < BUILT_IN_CHAT_PROMPTS.length - 1
                      ? "1px solid var(--workspace-chat-subtle-border-soft)"
                      : undefined,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    "var(--workspace-chat-prompt-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: "var(--workspace-panel-muted)",
                    color: "var(--workspace-text-muted)",
                    fontSize: 11,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ flex: 1, fontWeight: 500 }}>{t(p.titleKey, p.titleDefault)}</span>
              </button>
            ))}
            {custom.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "10px 14px 10px 18px",
                  borderTop: "1px solid var(--workspace-chat-subtle-border-soft)",
                }}
              >
                <button
                  type="button"
                  onClick={() => applyCustom(c.body)}
                  style={{
                    flex: 1,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 13,
                    color: "var(--workspace-text)",
                    padding: "4px 0",
                  }}
                >
                  {c.title}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeCustom(c.id);
                  }}
                  title={t("chat.prompts.deleteCustom", "Remove")}
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: 6,
                    cursor: "pointer",
                    color: "var(--workspace-text-muted)",
                    display: "flex",
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <div
            style={{
              borderTop: "1px solid var(--workspace-chat-subtle-border)",
              padding: 12,
              flexShrink: 0,
              background: "var(--workspace-panel-muted)",
            }}
          >
            {!customForm ? (
              <button
                type="button"
                onClick={() => setCustomForm(true)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px dashed var(--workspace-border)",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "var(--workspace-text)",
                }}
              >
                <Pencil size={16} style={{ opacity: 0.7 }} />
                {t("chat.prompts.custom.add", "Custom prompt…")}
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder={t("chat.prompts.custom.titlePh", "Short label")}
                  style={{
                    fontSize: 12,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--workspace-border)",
                    fontFamily: "inherit",
                  }}
                />
                <textarea
                  value={customBody}
                  onChange={(e) => setCustomBody(e.target.value)}
                  placeholder={t(
                    "chat.prompts.custom.bodyPh",
                    "Full prompt text to insert into the message field…",
                  )}
                  rows={5}
                  style={{
                    fontSize: 12,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--workspace-border)",
                    resize: "vertical",
                    fontFamily: "ui-monospace, monospace",
                    minHeight: 100,
                  }}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomForm(false);
                      setCustomTitle("");
                      setCustomBody("");
                    }}
                    style={{
                      fontSize: 12,
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--workspace-border)",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  >
                    {t("chat.prompts.custom.cancel", "Cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => saveNewCustom()}
                    disabled={!customBody.trim()}
                    style={{
                      fontSize: 12,
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "none",
                      background: customBody.trim()
                        ? "var(--workspace-chat-send-btn-bg)"
                        : "var(--workspace-chat-prompt-save-disabled-bg)",
                      color: customBody.trim()
                        ? "var(--workspace-chat-send-btn-text)"
                        : "var(--workspace-text-soft)",
                      cursor: customBody.trim() ? "pointer" : "default",
                      fontWeight: 600,
                    }}
                  >
                    {t("chat.prompts.custom.save", "Save to list")}
                  </button>
                </div>
              </div>
            )}
          </div>
          <p
            style={{
              margin: 0,
              padding: "8px 16px 12px",
              fontSize: 10,
              color: "var(--workspace-text-muted)",
              lineHeight: 1.4,
            }}
          >
            {t(
              "chat.prompts.mergeHint",
              "Empty field: replaces with prompt. If you already typed text, the prompt is appended below.",
            )}
          </p>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      {modal}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={pillBase}
        title={t("chat.prompts.pillTitle", "Insert a guided prompt")}
      >
        <Sparkles size={14} style={{ color: "var(--workspace-accent)" }} aria-hidden />
        {t("chat.prompts.pill", "Prompts")}
      </button>
    </>
  );
}
