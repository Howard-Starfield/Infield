import React from "react";
import { useTranslation } from "react-i18next";
import {
  transcriptionDotColorVar,
  useTranscriptionStatus,
} from "@/hooks/useTranscriptionStatus";
import { useFooterSystemStatus } from "@/hooks/useFooterSystemStatus";

interface BottomBarProps {
  notesCount: number;
  /** Active provider display name - populated in Phase 6B */
  activeProvider?: string;
}

type FooterBadgeTone = "healthy" | "warning";

interface FooterStatusBadgeProps {
  label: string;
  title?: string;
  tone: FooterBadgeTone;
  icon: "database" | "embedding";
}

const badgeToneStyles: Record<FooterBadgeTone, React.CSSProperties> = {
  healthy: {
    color: "var(--workspace-text)",
    background:
      "color-mix(in srgb, var(--workspace-status-ready) 18%, transparent)",
    border:
      "1px solid color-mix(in srgb, var(--workspace-status-ready) 36%, var(--workspace-border))",
  },
  warning: {
    color: "var(--workspace-text)",
    background:
      "color-mix(in srgb, var(--workspace-status-recording) 14%, transparent)",
    border:
      "1px solid color-mix(in srgb, var(--workspace-status-recording) 34%, var(--workspace-border))",
  },
};

const StatusGlyph: React.FC<{
  icon: "database" | "embedding";
  tone: FooterBadgeTone;
}> = ({ icon, tone }) => {
  const stroke =
    tone === "healthy"
      ? "var(--workspace-status-ready)"
      : "var(--workspace-status-recording)";

  if (icon === "database") {
    return (
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        style={{ width: 12, height: 12, display: "block", flexShrink: 0 }}
      >
        <ellipse
          cx="12"
          cy="6"
          rx="6.5"
          ry="3"
          fill="none"
          stroke={stroke}
          strokeWidth="1.7"
        />
        <path
          d="M5.5 6v8c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3V6"
          fill="none"
          stroke={stroke}
          strokeWidth="1.7"
        />
        <path
          d="M5.5 10c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3"
          fill="none"
          stroke={stroke}
          strokeWidth="1.7"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      style={{ width: 12, height: 12, display: "block", flexShrink: 0 }}
    >
      <circle
        cx="7"
        cy="12"
        r="2.1"
        fill="none"
        stroke={stroke}
        strokeWidth="1.7"
      />
      <circle
        cx="16.5"
        cy="7"
        r="2.1"
        fill="none"
        stroke={stroke}
        strokeWidth="1.7"
      />
      <circle
        cx="16.5"
        cy="17"
        r="2.1"
        fill="none"
        stroke={stroke}
        strokeWidth="1.7"
      />
      <path
        d="M8.9 10.8l5.4-2.7M8.9 13.2l5.4 2.7"
        fill="none"
        stroke={stroke}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
};

const FooterStatusBadge: React.FC<FooterStatusBadgeProps> = ({
  label,
  title,
  tone,
  icon,
}) => (
  <span
    title={title}
    style={{
      ...badgeToneStyles[tone],
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      minHeight: 20,
      padding: "0 8px",
      borderRadius: 999,
      fontSize: 10.5,
      fontWeight: 600,
      letterSpacing: "0.02em",
      whiteSpace: "nowrap",
    }}
  >
    <StatusGlyph icon={icon} tone={tone} />
    <span>{label}</span>
  </span>
);

export const BottomBar: React.FC<BottomBarProps> = ({
  notesCount,
  activeProvider,
}) => {
  const { t } = useTranslation();
  const status = useTranscriptionStatus();
  const footerStatus = useFooterSystemStatus();

  const dotColorVar = transcriptionDotColorVar(status);

  const statusLabel =
    status === "recording"
      ? t("bottomBar.recording")
      : status === "transcribing"
        ? t("bottomBar.transcribing")
        : t("bottomBar.ready");

  return (
    <div
      style={{
        height: 34,
        background: "var(--workspace-bottom-bar-bg)",
        borderTop: "1px solid var(--workspace-border)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        flexShrink: 0,
        fontSize: 11,
        color: "var(--workspace-text-muted)",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          className="animate-pulse-dot"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dotColorVar,
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span>{statusLabel}</span>
      </div>

      <div style={{ flex: 1, textAlign: "center" }}>
        {activeProvider && (
          <span style={{ color: "var(--workspace-accent)" }}>
            {activeProvider}
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span>{t("bottomBar.notesIndexed", { count: notesCount })}</span>
        {footerStatus && (
          <>
            <span>·</span>
            <FooterStatusBadge
              icon="database"
              tone={footerStatus.notes_db_healthy ? "healthy" : "warning"}
              label={footerStatus.notes_db_healthy ? "Notes DB" : "Notes DB issue"}
              title={
                footerStatus.notes_db_detail
                  ? `${footerStatus.notes_db_summary}: ${footerStatus.notes_db_detail}`
                  : footerStatus.notes_db_summary
              }
            />
            {!footerStatus.embedding_available && (
              <FooterStatusBadge
                icon="embedding"
                tone="warning"
                label="Embeddings offline"
                title={
                  footerStatus.embedding_summary ??
                  "Embeddings are unavailable right now."
                }
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};
