import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface FooterSystemStatus {
  notes_db_healthy: boolean;
  notes_db_summary: string;
  notes_db_detail: string | null;
  notes_db_checked_at_ms: number;
  embedding_available: boolean;
  embedding_summary: string | null;
}

const FOOTER_STATUS_POLL_MS = 15_000;

export function useFooterSystemStatus(): FooterSystemStatus | null {
  const [status, setStatus] = useState<FooterSystemStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const next = await invoke<FooterSystemStatus>("get_footer_system_status");
        if (!cancelled) {
          setStatus(next);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load footer system status:", error);
        }
      }
    };

    void fetchStatus();
    const intervalId = window.setInterval(() => {
      void fetchStatus();
    }, FOOTER_STATUS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return status;
}
