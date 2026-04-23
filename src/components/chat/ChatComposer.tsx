import { useLayoutEffect, useRef, type Ref } from "react";
import { FileText, Image as ImageIcon, Send, X } from "lucide-react";
import type { TFunction } from "i18next";
import { commands, type ChatImageAttachment, type ProviderStatus } from "@/bindings";
import { ChatPromptMenu } from "./ChatPromptMenu";
import { ChatProviderMenu } from "./ChatProviderMenu";

/** Pending picker row: API payload + display name for chips. */
export type PendingChatImage = ChatImageAttachment & { displayName: string };

/** Pending document: one `<document>...</document>` block ready for `document_context`. */
export type PendingChatDocument = {
  displayName: string;
  documentXml: string;
  truncated: boolean;
};

/** Combined accept list for the chat file picker (images + extractable documents). */
export const CHAT_FILE_INPUT_ACCEPT =
  "image/*,.pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,text/plain,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const COMPOSER_MAX_VH = 40;
const TEXTAREA_MIN_PX = 44;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;

const DOC_EXT = new Set(["pdf", "docx", "doc", "xlsx", "xls", "csv", "txt", "md"]);

function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  if (i < 0) return "";
  return name.slice(i + 1).toLowerCase();
}

/** True when the file should be routed to document extraction (not the image path). */
export function isChatDocumentFile(file: File): boolean {
  if (file.type.startsWith("image/")) return false;
  const ext = fileExtension(file.name || "");
  return DOC_EXT.has(ext);
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/\r?\n/g, " ");
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildDocumentXmlBlock(filename: string, body: string): string {
  return `<document filename="${escapeXmlAttr(filename)}">${escapeXmlText(body)}</document>`;
}

async function fileToBase64Payload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== "string") {
        reject(new Error("read_failed"));
        return;
      }
      const m = r.match(/^data:[^;]+;base64,(.+)$/);
      if (!m) {
        reject(new Error("parse_failed"));
        return;
      }
      resolve(m[1]);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

/** Read a local image file into a pending attachment row (picker label + API fields). */
export function readImageFileAsPending(file: File): Promise<PendingChatImage> {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("not_image"));
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Promise.reject(new Error("too_large"));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== "string") {
        reject(new Error("read_failed"));
        return;
      }
      const m = r.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) {
        reject(new Error("parse_failed"));
        return;
      }
      resolve({
        mime: m[1],
        data_base64: m[2],
        displayName: file.name?.trim() || "Image",
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

/** Read a local document into a pending row (Rust extraction + XML wrapper). */
export async function readChatDocumentFileAsPending(file: File): Promise<PendingChatDocument> {
  const displayName = file.name?.trim() || "document";
  const ext = fileExtension(displayName);
  if (!DOC_EXT.has(ext)) {
    throw new Error("unsupported_doc");
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new Error("doc_too_large");
  }
  const mime =
    file.type && file.type !== "application/octet-stream"
      ? file.type
      : ext === "pdf"
        ? "application/pdf"
        : ext === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : ext === "csv"
            ? "text/csv"
            : "text/plain";
  const data_base64 = await fileToBase64Payload(file);
  const out = await commands.extractChatDocument(data_base64, displayName, mime);
  if (out.error) {
    throw new Error(out.error);
  }
  const documentXml = buildDocumentXmlBlock(out.filename || displayName, out.text);
  return {
    displayName: out.filename || displayName,
    documentXml,
    truncated: out.truncated,
  };
}

function composerMaxHeightPx(): number {
  const h = typeof window !== "undefined" ? window.innerHeight : 800;
  return Math.round((h * COMPOSER_MAX_VH) / 100);
}

type Props = {
  input: string;
  setInput: (v: string) => void;
  pendingAttachments: PendingChatImage[];
  setPendingAttachments: React.Dispatch<React.SetStateAction<PendingChatImage[]>>;
  pendingDocuments: PendingChatDocument[];
  setPendingDocuments: React.Dispatch<React.SetStateAction<PendingChatDocument[]>>;
  providers: ProviderStatus[];
  activeProviderId: string;
  onProviderChange: (nextId: string) => void | Promise<void>;
  onSend: () => void;
  isLoading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onPickFiles: (files: FileList | null) => void;
  /** Insert or append a preset prompt into the composer. */
  onApplyPrompt?: (text: string) => void;
  t: TFunction;
};

export function ChatComposer({
  input,
  setInput,
  pendingAttachments,
  setPendingAttachments,
  pendingDocuments,
  setPendingDocuments,
  providers,
  activeProviderId,
  onProviderChange,
  onSend,
  isLoading,
  fileInputRef,
  textareaRef,
  onPickFiles,
  onApplyPrompt,
  t,
}: Props) {
  const maxHRef = useRef(composerMaxHeightPx());

  useLayoutEffect(() => {
    maxHRef.current = composerMaxHeightPx();
    const el = textareaRef.current;
    if (!el) return;
    const maxPx = maxHRef.current;
    el.style.overflowY = "hidden";
    el.style.height = "0px";
    const scrollH = el.scrollHeight;
    const next = Math.min(Math.max(scrollH, TEXTAREA_MIN_PX), maxPx);
    el.style.height = `${next}px`;
    el.style.overflowY = scrollH >= maxPx ? "auto" : "hidden";
  }, [input, pendingAttachments.length, pendingDocuments.length, textareaRef]);

  useLayoutEffect(() => {
    const onResize = () => {
      maxHRef.current = composerMaxHeightPx();
      const el = textareaRef.current;
      if (!el) return;
      const maxPx = maxHRef.current;
      el.style.height = "auto";
      el.style.height = `${Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_PX), maxPx)}px`;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [textareaRef]);

  const canSend =
    (input.trim().length > 0 ||
      pendingAttachments.length > 0 ||
      pendingDocuments.length > 0) &&
    !isLoading;

  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid var(--workspace-border)",
        background: "var(--workspace-panel-muted)",
        boxShadow: "var(--workspace-shadow-soft)",
        padding: "12px 14px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <input
        ref={fileInputRef as Ref<HTMLInputElement>}
        type="file"
        accept={CHAT_FILE_INPUT_ACCEPT}
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          onPickFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {pendingAttachments.length > 0 || pendingDocuments.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pendingAttachments.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {pendingAttachments.map((a, i) => (
                <div
                  key={`img-${a.displayName}-${i}-${a.mime}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px 6px 8px",
                    borderRadius: 999,
                    border: "1px solid var(--workspace-border)",
                    background: "var(--workspace-panel)",
                    maxWidth: "100%",
                  }}
                >
                  <ImageIcon size={16} style={{ flexShrink: 0, color: "var(--workspace-text-muted)" }} aria-hidden />
                  <span
                    className="text-xs truncate"
                    style={{ color: "var(--workspace-text)", maxWidth: 200 }}
                    title={a.displayName}
                  >
                    {a.displayName}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingAttachments((prev) => prev.filter((_, j) => j !== i))}
                    style={{
                      border: "none",
                      background: "transparent",
                      padding: 2,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      color: "var(--workspace-text-muted)",
                    }}
                    aria-label={t("chat.attachments.remove", "Remove")}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {pendingDocuments.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {pendingDocuments.map((d, i) => (
                <div
                  key={`doc-${d.displayName}-${i}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px 6px 8px",
                    borderRadius: 999,
                    border: "1px solid var(--workspace-border)",
                    background: "var(--workspace-panel)",
                    maxWidth: "100%",
                  }}
                >
                  <FileText size={16} style={{ flexShrink: 0, color: "var(--workspace-text-muted)" }} aria-hidden />
                  <span
                    className="text-xs truncate"
                    style={{ color: "var(--workspace-text)", maxWidth: 220 }}
                    title={d.displayName}
                  >
                    {d.displayName}
                    {d.truncated ? ` · ${t("chat.attachments.truncated", "truncated")}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingDocuments((prev) => prev.filter((_, j) => j !== i))}
                    style={{
                      border: "none",
                      background: "transparent",
                      padding: 2,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      color: "var(--workspace-text-muted)",
                    }}
                    aria-label={t("chat.attachments.remove", "Remove")}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <textarea
        ref={textareaRef as Ref<HTMLTextAreaElement>}
        className="w-full bg-transparent text-sm resize-none outline-none"
        rows={1}
        value={input}
        placeholder={t("chat.placeholder", "Ask anything...")}
        onChange={(e) => setInput(e.target.value)}
        style={{
          color: "var(--workspace-text)",
          fontFamily: "Inter, sans-serif",
          lineHeight: 1.5,
          minHeight: TEXTAREA_MIN_PX,
          maxHeight: `${COMPOSER_MAX_VH}vh`,
          boxSizing: "border-box",
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          paddingTop: 4,
          borderTop: "1px solid var(--workspace-chat-toolbar-divider)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            minWidth: 0,
            flex: "1 1 auto",
          }}
        >
          <ChatProviderMenu
            providers={providers}
            activeProviderId={activeProviderId}
            onProviderChange={onProviderChange}
            t={t}
          />
          {onApplyPrompt ? <ChatPromptMenu onApplyPrompt={onApplyPrompt} t={t} /> : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "1px solid var(--workspace-border)",
              background: "var(--workspace-panel)",
              color: "var(--workspace-text-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
            title={t("chat.attachments.attachFilesTitle", "Attach images or documents")}
          >
            <ImageIcon size={18} />
          </button>

          <button
            type="button"
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "1px solid var(--workspace-border)",
              background: "var(--workspace-panel)",
              color: "var(--workspace-text-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
            title={t("chat.voiceInput", "Voice input")}
          >
            <span className="ms" style={{ fontSize: 18 }}>
              mic
            </span>
          </button>

          <button
            type="button"
            onClick={() => onSend()}
            disabled={!canSend}
            aria-label={t("chat.send", "Send")}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: canSend
                ? "var(--workspace-chat-send-btn-bg)"
                : "var(--workspace-chat-home-send-idle-bg)",
              border: canSend
                ? "1px solid var(--workspace-chat-send-btn-border)"
                : "1px solid transparent",
              color: canSend
                ? "var(--workspace-chat-send-btn-text)"
                : "var(--workspace-text-soft)",
              cursor: canSend ? "pointer" : "not-allowed",
            }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
