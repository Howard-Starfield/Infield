import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { commands } from "@/bindings";
import type { AppView } from "@/App";
import type { ImportJobDto, ImportJobState, ImportQueueSnapshot } from "@/bindings";
import { useWorkspaceStore } from "@/stores/workspaceStore";

type FileWithPath = File & { path?: string };

const TERMINAL_STATES: ImportJobState[] = ["done", "error", "cancelled"];

function isProcessingState(s: ImportJobState): boolean {
  return s !== "queued" && !TERMINAL_STATES.includes(s);
}

function canCancelJob(s: ImportJobState): boolean {
  return s === "queued" || isProcessingState(s);
}

function collectPathsFromFileList(files: FileList | File[]): string[] {
  const out: string[] = [];
  const arr = Array.from(files as File[]);
  for (const f of arr) {
    const p = (f as FileWithPath).path?.trim();
    if (p) out.push(p);
  }
  return out;
}

export const ImportTab: React.FC<{ onNavigate: (view: AppView) => void }> = ({ onNavigate }) => {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<ImportJobDto[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigateTo = useWorkspaceStore((s) => s.navigateTo);

  const { activeJobs, completedJobs } = useMemo(() => {
    const active = jobs.filter((j) => !TERMINAL_STATES.includes(j.state));
    const completed = jobs.filter((j) => TERMINAL_STATES.includes(j.state));
    return { activeJobs: active, completedJobs: completed };
  }, [jobs]);

  const refreshQueue = useCallback(async () => {
    const res = await commands.getImportQueue();
    if (res.status === "ok") setJobs(res.data.jobs);
  }, []);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  useEffect(() => {
    const unlisten = listen<ImportQueueSnapshot>("import-queue-updated", (ev) => {
      setJobs(ev.payload.jobs);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const enqueuePaths = async (paths: string[]) => {
    const cleaned = paths.map((p) => p.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    setBusy(true);
    try {
      const res = await commands.enqueueImportPaths(cleaned);
      if (res.status === "error") {
        toast.error(t("import.enqueueFailed"), { description: res.error });
      }
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const fromData = e.dataTransfer.files?.length
      ? collectPathsFromFileList(e.dataTransfer.files)
      : [];
    if (fromData.length > 0) {
      void enqueuePaths(fromData);
      return;
    }
    toast.info(t("import.noPaths"));
  };

  const onPickFiles = async () => {
    const selected = await open({
      multiple: true,
      title: t("import.dialogTitle"),
    });
    if (selected == null) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    void enqueuePaths(paths);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    const paths = collectPathsFromFileList(list);
    if (paths.length > 0) void enqueuePaths(paths);
    e.target.value = "";
  };

  const handleOpenNote = async (id: string) => {
    try {
      await navigateTo(id, { source: "tree" });
      onNavigate({ tab: "notes", nodeId: id });
    } catch (error) {
      toast.error("Failed to open imported document", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleCancel = async (jobId: string) => {
    const res = await commands.cancelImportJob(jobId);
    if (res.status === "error") {
      toast.error(res.error);
    }
  };

  const renderJobRow = (j: ImportJobDto) => (
    <div
      key={j.id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderRadius: 8,
        border: "1px solid var(--workspace-border)",
        background: "rgba(255,255,255,.72)",
        fontSize: 13,
      }}
    >
      {isProcessingState(j.state) && (
        <Loader2
          className="h-4 w-4 shrink-0 animate-spin text-[var(--workspace-accent)]"
          aria-hidden
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            color: "var(--workspace-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {j.file_name}
        </div>
        <div style={{ fontSize: 11, color: "var(--workspace-text-soft)", marginTop: 2 }}>
          {t(`import.kind.${j.kind}`)} · {t(`import.state.${j.state}`)}
          {j.current_step ? ` — ${j.current_step}` : ""}
          {j.message ? ` — ${j.message}` : ""}
        </div>
        {j.segment_count > 0 && isProcessingState(j.state) && (
          <div style={{ fontSize: 10, color: "var(--workspace-text-muted)", marginTop: 4 }}>
            {t("import.progressSegments", { current: j.segment_index, total: j.segment_count })}
          </div>
        )}
        {isProcessingState(j.state) && (
          <div
            style={{
              height: 4,
              borderRadius: 2,
              background: "rgba(0,0,0,.06)",
              marginTop: 8,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.round((j.progress || 0) * 100))}%`,
                height: "100%",
                borderRadius: 2,
                background: "var(--workspace-accent, #b72301)",
                transition: "width 0.25s ease",
              }}
            />
          </div>
        )}
      </div>
      {canCancelJob(j.state) && (
        <button
          type="button"
          className="shrink-0 text-xs font-semibold text-[#8b5a52] underline-offset-2 hover:underline"
          onClick={() => void handleCancel(j.id)}
        >
          {j.state === "queued" ? t("import.cancel") : t("import.activeCancel")}
        </button>
      )}
      {j.state === "done" && j.note_id && (
        <button
          type="button"
          className="shrink-0 rounded-md bg-[var(--workspace-accent-soft)] px-3 py-1.5 text-xs font-bold text-[var(--workspace-accent)]"
          onClick={() => void handleOpenNote(j.note_id!)}
        >
          {t("import.openNote")}
        </button>
      )}
    </div>
  );

  return (
    <div
      className="flex flex-1 min-h-0 flex-col overflow-hidden"
      style={{ background: "var(--workspace-app-bg, #fdf9f3)" }}
    >
      <div className="flex-1 min-h-0 overflow-auto px-6 py-8">
        <h1
          style={{
            fontSize: 22,
            fontFamily: "Manrope, sans-serif",
            fontWeight: 800,
            margin: "0 0 8px",
            color: "var(--workspace-text)",
          }}
        >
          {t("import.title")}
        </h1>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: "var(--workspace-text-muted)", maxWidth: 560 }}>
          {t("import.subtitle")}
        </p>

        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void onPickFiles();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => void onPickFiles()}
          style={{
            border: `2px dashed ${dragOver ? "var(--workspace-accent)" : "rgba(143,112,105,0.35)"}`,
            borderRadius: 12,
            padding: "48px 24px",
            textAlign: "center",
            cursor: busy ? "wait" : "pointer",
            background: dragOver ? "var(--workspace-accent-soft, rgba(183,35,1,.08))" : "rgba(255,255,255,.5)",
            transition: "border-color 150ms, background 150ms",
            maxWidth: 720,
          }}
        >
          <span className="ms" style={{ fontSize: 40, color: "var(--workspace-text-soft)", display: "block", marginBottom: 12 }}>
            upload_file
          </span>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--workspace-text)" }}>{t("import.dropPrompt")}</div>
          <div style={{ fontSize: 12, color: "var(--workspace-text-muted)", marginTop: 8 }}>{t("import.dropHint")}</div>
          <button
            type="button"
            className="mt-4 rounded-md border border-[rgba(143,112,105,0.35)] bg-white px-4 py-2 text-sm font-semibold text-[#3d3d3a]"
            style={{ pointerEvents: "auto" }}
            onClick={(e) => {
              e.stopPropagation();
              void onPickFiles();
            }}
          >
            {t("import.chooseFiles")}
          </button>
          <input
            type="file"
            multiple
            className="hidden"
            accept=".md,.markdown,.mdx,.txt,.pdf,.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.mp4,.mov,.mkv,.avi,.webm,.mpeg,.mpg,.wmv"
            onChange={onInputChange}
          />
        </div>

        {activeJobs.length > 0 && (
          <div style={{ marginTop: 32, maxWidth: 900 }}>
            <h2 style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--workspace-text-muted)", margin: "0 0 12px" }}>
              {t("import.queueHeading")}
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{activeJobs.map(renderJobRow)}</div>
          </div>
        )}

        {completedJobs.length > 0 && (
          <div style={{ marginTop: activeJobs.length ? 24 : 32, maxWidth: 900 }}>
            <h2 style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--workspace-text-muted)", margin: "0 0 12px" }}>
              {t("import.completedHeading", { defaultValue: "Completed" })}
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{completedJobs.map(renderJobRow)}</div>
          </div>
        )}
      </div>
    </div>
  );
};
