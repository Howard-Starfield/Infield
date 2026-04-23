import React, { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { Check, Copy, FolderOpen, RotateCcw, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  commands,
  events,
  type HistoryEntry,
  type HistoryUpdatePayload,
} from "@/bindings";
import { useOsType } from "@/hooks/useOsType";
import { formatDateTime } from "@/utils/dateFormat";
import { AudioPlayer } from "../../ui/AudioPlayer";

const PAGE_SIZE = 30;

/* ── Icon button ───────────────────────────────────────────────── */
const IconBtn: React.FC<{
  onClick: () => void;
  title: string;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}> = ({ onClick, title, disabled, active, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 30,
      height: 30,
      border: "none",
      background: "transparent",
      cursor: disabled ? "not-allowed" : "pointer",
      color: active
        ? "var(--workspace-accent)"
        : "var(--workspace-text-soft)",
      opacity: disabled ? 0.35 : 1,
      transition: "color 150ms, opacity 150ms",
    }}
    onMouseEnter={(e) => {
      if (!disabled) (e.currentTarget as HTMLButtonElement).style.color = "var(--workspace-accent)";
    }}
    onMouseLeave={(e) => {
      if (!disabled) (e.currentTarget as HTMLButtonElement).style.color =
        active ? "var(--workspace-accent)" : "var(--workspace-text-soft)";
    }}
  >
    {children}
  </button>
);

/* ── Open folder button ────────────────────────────────────────── */
const OpenFolderBtn: React.FC<{ onClick: () => void; label: string }> = ({ onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 12px",
      border: "1px solid var(--workspace-border-strong)",
      background: "var(--workspace-panel)",
      color: "var(--workspace-text-muted)",
      fontSize: 11,
      fontFamily: "Space Grotesk, sans-serif",
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: ".08em",
      cursor: "pointer",
      transition: "background 150ms, color 150ms",
    }}
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = "var(--workspace-accent-soft)";
      (e.currentTarget as HTMLButtonElement).style.color = "var(--workspace-accent)";
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = "var(--workspace-panel)";
      (e.currentTarget as HTMLButtonElement).style.color = "var(--workspace-text-muted)";
    }}
  >
    <FolderOpen size={13} />
    {label}
  </button>
);

/* ── Single history entry card ─────────────────────────────────── */
interface HistoryEntryProps {
  entry: HistoryEntry;
  onToggleSaved: () => void;
  onCopyText: () => void;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  deleteAudio: (id: number) => Promise<void>;
  retryTranscription: (id: number) => Promise<void>;
}

const HistoryEntryCard: React.FC<HistoryEntryProps> = ({
  entry, onToggleSaved, onCopyText, getAudioUrl, deleteAudio, retryTranscription,
}) => {
  const { t, i18n } = useTranslation();
  const [showCopied, setShowCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const hasTranscription = entry.transcription_text.trim().length > 0;
  const formattedDate = formatDateTime(String(entry.timestamp), i18n.language);

  const handleLoadAudio = useCallback(() => getAudioUrl(entry.file_name), [getAudioUrl, entry.file_name]);

  const handleCopyText = () => {
    if (!hasTranscription) return;
    onCopyText();
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const handleDeleteEntry = async () => {
    try { await deleteAudio(entry.id); }
    catch { toast.error(t("settings.history.deleteError")); }
  };

  const handleRetranscribe = async () => {
    try { setRetrying(true); await retryTranscription(entry.id); }
    catch { toast.error(t("settings.history.retranscribeError")); }
    finally { setRetrying(false); }
  };

  return (
    <div
      style={{
        background: "var(--workspace-panel)",
        border: "1px solid var(--workspace-border)",
        borderLeft: entry.saved
          ? "3px solid var(--workspace-accent-secondary)"
          : "3px solid var(--workspace-border)",
        boxShadow: "var(--workspace-shadow-soft)",
        padding: "16px 18px 14px",
        marginBottom: 10,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        animation: "workspace-chat-rise 180ms ease both",
      }}
    >
      {/* Header row: date + action buttons */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontSize: 10,
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".1em",
              color: "var(--workspace-accent-secondary)",
            }}
          >
            {formattedDate}
          </span>
          {entry.saved && (
            <span
              style={{
                fontSize: 9,
                fontFamily: "Space Grotesk, sans-serif",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".1em",
                padding: "2px 6px",
                background: "rgba(0,107,88,.10)",
                color: "var(--workspace-accent-secondary)",
              }}
            >
              Saved
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconBtn onClick={handleCopyText} disabled={!hasTranscription || retrying} title={t("settings.history.copyToClipboard")}>
            {showCopied ? <Check size={14} /> : <Copy size={14} />}
          </IconBtn>
          <IconBtn onClick={onToggleSaved} disabled={retrying} active={entry.saved} title={entry.saved ? t("settings.history.unsave") : t("settings.history.save")}>
            <Star size={14} fill={entry.saved ? "currentColor" : "none"} />
          </IconBtn>
          <IconBtn onClick={handleRetranscribe} disabled={retrying} title={t("settings.history.retranscribe")}>
            <RotateCcw size={14} style={retrying ? { animation: "spin 1s linear infinite reverse" } : undefined} />
          </IconBtn>
          <IconBtn onClick={handleDeleteEntry} disabled={retrying} title={t("settings.history.delete")}>
            <Trash2 size={14} />
          </IconBtn>
        </div>
      </div>

      {/* Transcription text */}
      <p
        style={{
          margin: 0,
          fontSize: 13,
          fontFamily: "Inter, sans-serif",
          lineHeight: 1.75,
          fontStyle: "italic",
          color: retrying
            ? "var(--workspace-text-soft)"
            : hasTranscription
              ? "var(--workspace-text)"
              : "var(--workspace-text-soft)",
          userSelect: hasTranscription && !retrying ? "text" : "none",
          cursor: hasTranscription && !retrying ? "text" : "default",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          animation: retrying ? "transcribe-pulse 3s ease-in-out infinite" : undefined,
        }}
      >
        {retrying && (
          <style>{`
            @keyframes transcribe-pulse {
              0%, 100% { opacity: .45; }
              50%       { opacity: 1; }
            }
          `}</style>
        )}
        {retrying
          ? t("settings.history.transcribing")
          : hasTranscription
            ? entry.transcription_text
            : t("settings.history.transcriptionFailed")}
      </p>

      {/* Audio player */}
      <div
        style={{
          paddingTop: 8,
          borderTop: "1px solid var(--workspace-border)",
        }}
      >
        <AudioPlayer onLoadRequest={handleLoadAudio} className="w-full" />
      </div>
    </div>
  );
};

/* ── Main HistorySettings component ────────────────────────────── */
export const HistorySettings: React.FC = () => {
  const { t } = useTranslation();
  const osType = useOsType();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef<HistoryEntry[]>([]);
  const loadingRef = useRef(false);

  useEffect(() => { entriesRef.current = entries; }, [entries]);

  const loadPage = useCallback(async (cursor?: number) => {
    const isFirstPage = cursor === undefined;
    if (!isFirstPage && loadingRef.current) return;
    loadingRef.current = true;
    if (isFirstPage) setLoading(true);
    try {
      const result = await commands.getHistoryEntries(cursor ?? null, PAGE_SIZE);
      if (result.status === "ok") {
        const { entries: newEntries, has_more } = result.data;
        setEntries((prev) => isFirstPage ? newEntries : [...prev, ...newEntries]);
        setHasMore(has_more);
      }
    } catch (error) {
      console.error("Failed to load history entries:", error);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => { loadPage(); }, [loadPage]);

  // Infinite scroll
  useEffect(() => {
    if (loading) return;
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (obs) => {
        if (obs[0].isIntersecting) {
          const last = entriesRef.current[entriesRef.current.length - 1];
          if (last) loadPage(last.id);
        }
      },
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, hasMore, loadPage]);

  // Live updates from transcription pipeline
  useEffect(() => {
    const unlisten = events.historyUpdatePayload.listen((event) => {
      const payload: HistoryUpdatePayload = event.payload;
      if (payload.action === "added") setEntries((prev) => [payload.entry, ...prev]);
      else if (payload.action === "updated") setEntries((prev) => prev.map((e) => e.id === payload.entry.id ? payload.entry : e));
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const toggleSaved = async (id: number) => {
    setEntries((prev) => prev.map((e) => e.id === id ? { ...e, saved: !e.saved } : e));
    try {
      const result = await commands.toggleHistoryEntrySaved(id);
      if (result.status !== "ok") setEntries((prev) => prev.map((e) => e.id === id ? { ...e, saved: !e.saved } : e));
    } catch {
      setEntries((prev) => prev.map((e) => e.id === id ? { ...e, saved: !e.saved } : e));
    }
  };

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* silent */ }
  };

  const getAudioUrl = useCallback(async (fileName: string) => {
    try {
      const result = await commands.getAudioFilePath(fileName);
      if (result.status === "ok") {
        if (osType === "linux") {
          const fileData = await readFile(result.data);
          return URL.createObjectURL(new Blob([fileData], { type: "audio/wav" }));
        }
        return convertFileSrc(result.data, "asset");
      }
      return null;
    } catch { return null; }
  }, [osType]);

  const deleteAudioEntry = async (id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      const result = await commands.deleteHistoryEntry(id);
      if (result.status !== "ok") loadPage();
    } catch { loadPage(); }
  };

  const retryHistoryEntry = async (id: number) => {
    const result = await commands.retryHistoryEntryTranscription(id);
    if (result.status !== "ok") throw new Error(String(result.error));
  };

  const openRecordingsFolder = async () => {
    try { await commands.openRecordingsFolder(); } catch (e) { console.error(e); }
  };

  /* ── Render ── */
  return (
    <div style={{ width: "100%" }}>
      {/* Toolbar row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".14em",
              color: "var(--workspace-text-soft)",
              marginBottom: 2,
            }}
          >
            {entries.length > 0 ? `${entries.length} recording${entries.length !== 1 ? "s" : ""}` : ""}
          </div>
        </div>
        <OpenFolderBtn onClick={openRecordingsFolder} label={t("settings.history.openFolder")} />
      </div>

      {/* Content */}
      {loading ? (
        <div
          style={{
            padding: "48px 0",
            textAlign: "center",
            color: "var(--workspace-text-soft)",
            fontSize: 13,
            fontFamily: "Inter, sans-serif",
          }}
        >
          {t("settings.history.loading")}
        </div>
      ) : entries.length === 0 ? (
        <div
          style={{
            padding: "64px 0",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              border: "1px solid var(--workspace-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--workspace-text-soft)",
            }}
          >
            <span className="ms" style={{ fontSize: 24 }}>mic_off</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--workspace-text-muted)", fontFamily: "Inter, sans-serif" }}>
            {t("settings.history.empty")}
          </div>
        </div>
      ) : (
        <>
          {entries.map((entry) => (
            <HistoryEntryCard
              key={entry.id}
              entry={entry}
              onToggleSaved={() => toggleSaved(entry.id)}
              onCopyText={() => copyToClipboard(entry.transcription_text)}
              getAudioUrl={getAudioUrl}
              deleteAudio={deleteAudioEntry}
              retryTranscription={retryHistoryEntry}
            />
          ))}
          <div ref={sentinelRef} style={{ height: 4 }} />
        </>
      )}
    </div>
  );
};
