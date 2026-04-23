import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export type TranscriptionStatus = "ready" | "recording" | "transcribing";

export function transcriptionDotColorVar(status: TranscriptionStatus): string {
  if (status === "recording") return "var(--workspace-status-recording)";
  if (status === "transcribing") return "var(--workspace-status-transcribing)";
  return "var(--workspace-status-ready)";
}

/** Single subscription to recording / transcription events (use from one consumer, e.g. BottomBar). */
export function useTranscriptionStatus(): TranscriptionStatus {
  const [status, setStatus] = useState<TranscriptionStatus>("ready");

  useEffect(() => {
    const unlistens = [
      listen("recording-started", () => setStatus("recording")),
      listen("recording-stopped", () => setStatus("transcribing")),
      listen("transcription-complete", () => setStatus("ready")),
    ];
    return () => {
      unlistens.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  return status;
}
