import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import type { TFunction } from "i18next";
import type { ProviderStatus } from "@/bindings";
import { workspaceModalZ } from "@/lib/workspaceFloatingLayer";

function formatServicePillLabel(providerId: string): string {
  const id = providerId.trim();
  if (!id) return "—";
  if (/^[a-z0-9_-]+$/i.test(id)) {
    return id.charAt(0).toUpperCase() + id.slice(1).toLowerCase();
  }
  return id;
}

type Props = {
  providers: ProviderStatus[];
  activeProviderId: string;
  onProviderChange: (nextId: string) => void | Promise<void>;
  t: TFunction;
  pillStyle?: React.CSSProperties;
};

export function ChatProviderMenu({ providers, activeProviderId, onProviderChange, t, pillStyle }: Props) {
  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const active = providers.find((p) => p.provider_id === activeProviderId) ?? providers[0];
  const pillLabel = active ? formatServicePillLabel(active.provider_id) : "—";
  const fullActiveTitle = active ? `${active.provider_id} — ${active.model}` : "";

  const closeModal = () => {
    setOpen(false);
    window.requestAnimationFrame(() => pillRef.current?.focus());
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
    cursor: providers.length === 0 ? "default" : "pointer",
    boxShadow: "var(--workspace-shadow-soft)",
    ...pillStyle,
  };

  const modal =
    open &&
    providers.length > 0 &&
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
          aria-labelledby="chat-provider-modal-title"
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
              id="chat-provider-modal-title"
              style={{ fontSize: 14, fontWeight: 700, color: "var(--workspace-text)" }}
            >
              {t("chat.provider.modalTitle", "Choose AI provider")}
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
            {providers.map((p, i) => {
              const selected = p.provider_id === activeProviderId;
              return (
                <button
                  key={p.provider_id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    void onProviderChange(p.provider_id);
                    closeModal();
                  }}
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
                    fontWeight: selected ? 600 : 400,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    borderBottom:
                      i < providers.length - 1
                        ? "1px solid var(--workspace-chat-subtle-border-soft)"
                        : undefined,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--workspace-chat-prompt-hover)";
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
                      background: selected
                        ? "var(--workspace-accent-soft)"
                        : "var(--workspace-panel-muted)",
                      color: selected ? "var(--workspace-accent)" : "var(--workspace-text-muted)",
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
                  <span style={{ flex: 1, wordBreak: "break-word" }}>
                    {p.provider_id} — {p.model}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      {modal}
      <button
        ref={pillRef}
        type="button"
        disabled={providers.length === 0}
        onClick={() => {
          if (providers.length === 0) return;
          setOpen((o) => !o);
        }}
        style={pillBase}
        title={fullActiveTitle || t("chat.provider.select", "Choose provider")}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span>{pillLabel}</span>
        <ChevronDown size={14} style={{ opacity: 0.65, flexShrink: 0 }} aria-hidden />
      </button>
    </>
  );
}
