/**
 * Step 5 — Models download. Fetches the available-models registry,
 * filters to Whisper variants for the segmented control, always pairs
 * with `bge-small-en-v1.5` (required).
 *
 * PLAN correction surfaced mid-execution (2026-04-22): the PLAN.md
 * blueprint listed `Tiny / Base / Small / Medium` as Whisper options,
 * but the live `ModelInfo` registry exposes `small / medium / turbo /
 * large` (no tiny / base). The segmented control follows the actual
 * registry via `getAvailableModels()` + `engine_type === "Whisper"`
 * filter rather than hardcoding, so this stays correct when the
 * registry evolves. Default selection honours `is_recommended`.
 *
 * Failure policy (D14): 3-attempt exponential backoff (2s → 8s → 32s)
 * per model, then a soft-skip CTA surfaces "Skip and set up later in
 * Settings → Models". Semantic search + transcription gracefully
 * degrade; FTS-only remains functional.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { commands, type ModelInfo } from "@/bindings";
import type { StepProps } from "./OnboardingShell";

const BGE_MODEL_ID = "bge-small-en-v1.5";
const RETRY_DELAYS_MS = [2_000, 8_000, 32_000];

interface DownloadProgress {
  model_id: string;
  downloaded: number;
  total: number;
  percentage: number;
}

type ModelOutcome = "pending" | "downloading" | "done" | "failed";

interface PerModelState {
  id: string;
  name: string;
  sizeMb: number;
  pct: number;
  outcome: ModelOutcome;
  attempts: number;
}

function formatMb(mb: number): string {
  if (mb < 1000) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function OnboardingStepModels({ advance, isSubmitting, error }: StepProps) {
  const [whisperOptions, setWhisperOptions] = useState<ModelInfo[]>([]);
  const [bge, setBge] = useState<ModelInfo | null>(null);
  const [whisperChoice, setWhisperChoice] = useState<string | null>(null);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [downloadState, setDownloadState] = useState<Record<string, PerModelState>>({});
  const [running, setRunning] = useState(false);
  const [finalError, setFinalError] = useState<string | null>(null);

  // Keep a ref so the event listener (installed once) always reads the
  // latest map without stale-closure bugs.
  const stateRef = useRef(downloadState);
  stateRef.current = downloadState;

  // ── Registry fetch ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void commands
      .getAvailableModels()
      .then((res) => {
        if (cancelled) return;
        if (res.status !== "ok") {
          console.warn("[onboarding.models] getAvailableModels failed:", res.error);
          setFinalError(
            "Couldn't load the model registry. You can set this up later in Settings → Models.",
          );
          setRegistryLoading(false);
          return;
        }
        const whisper = res.data.filter(
          (m) => m.engine_type === "Whisper" && m.category === "Transcription",
        );
        const embedding =
          res.data.find((m) => m.id === BGE_MODEL_ID) ?? null;

        setWhisperOptions(whisper);
        setBge(embedding);

        // Default — the recommended Whisper, or the first entry.
        const recommended = whisper.find((m) => m.is_recommended);
        setWhisperChoice(recommended?.id ?? whisper[0]?.id ?? null);

        setRegistryLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[onboarding.models] registry fetch threw:", err);
        setFinalError(
          "Couldn't load the model registry. You can set this up later in Settings → Models.",
        );
        setRegistryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Progress event subscription ───────────────────────────────────
  // Installed once; lives for the full step duration. The ref pattern
  // above keeps state reads fresh without a dep-induced re-subscription.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<DownloadProgress>("model-download-progress", (event) => {
      const p = event.payload;
      setDownloadState((prev) => {
        const current = prev[p.model_id];
        if (!current) return prev;
        return {
          ...prev,
          [p.model_id]: {
            ...current,
            pct: Math.max(current.pct, p.percentage),
            outcome: p.percentage >= 100 ? "done" : "downloading",
          },
        };
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // ── Combined progress (byte-weighted) ─────────────────────────────
  const combinedPct = useMemo(() => {
    const entries = Object.values(downloadState);
    if (entries.length === 0) return 0;
    const totalMb = entries.reduce((sum, m) => sum + m.sizeMb, 0);
    if (totalMb === 0) return 0;
    const weighted = entries.reduce(
      (sum, m) => sum + (m.sizeMb * m.pct) / 100,
      0,
    );
    return Math.min(100, Math.round((weighted / totalMb) * 100));
  }, [downloadState]);

  // ── Download orchestration ────────────────────────────────────────
  const downloadOne = useCallback(async (model: ModelInfo): Promise<boolean> => {
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
      setDownloadState((prev) => ({
        ...prev,
        [model.id]: {
          ...(prev[model.id] ?? {
            id: model.id,
            name: model.name,
            sizeMb: model.size_mb,
            pct: 0,
            outcome: "pending",
            attempts: 0,
          }),
          outcome: "downloading",
          attempts: attempt + 1,
        },
      }));

      try {
        const res = await commands.downloadModel(model.id);
        if (res.status === "ok") {
          setDownloadState((prev) => ({
            ...prev,
            [model.id]: {
              ...(prev[model.id] ?? {
                id: model.id,
                name: model.name,
                sizeMb: model.size_mb,
                pct: 100,
                outcome: "done",
                attempts: attempt + 1,
              }),
              pct: 100,
              outcome: "done",
            },
          }));
          return true;
        }
        console.warn(
          `[onboarding.models] ${model.id} attempt ${attempt + 1} failed: ${res.error}`,
        );
      } catch (err) {
        console.warn(
          `[onboarding.models] ${model.id} attempt ${attempt + 1} threw:`,
          err,
        );
      }

      const nextDelay = RETRY_DELAYS_MS[attempt];
      if (nextDelay !== undefined) {
        await sleep(nextDelay);
      }
    }

    setDownloadState((prev) => ({
      ...prev,
      [model.id]: {
        ...(prev[model.id] ?? {
          id: model.id,
          name: model.name,
          sizeMb: model.size_mb,
          pct: 0,
          outcome: "failed",
          attempts: RETRY_DELAYS_MS.length + 1,
        }),
        outcome: "failed",
      },
    }));
    return false;
  }, []);

  const handleStart = useCallback(async () => {
    if (!bge || !whisperChoice) return;
    const whisper = whisperOptions.find((m) => m.id === whisperChoice);
    if (!whisper) return;

    setRunning(true);
    setFinalError(null);

    // Seed state so the progress bar renders immediately.
    setDownloadState({
      [whisper.id]: {
        id: whisper.id,
        name: whisper.name,
        sizeMb: whisper.size_mb,
        pct: 0,
        outcome: "pending",
        attempts: 0,
      },
      [bge.id]: {
        id: bge.id,
        name: bge.name,
        sizeMb: bge.size_mb,
        pct: 0,
        outcome: "pending",
        attempts: 0,
      },
    });

    const [whisperOk, bgeOk] = await Promise.all([
      downloadOne(whisper),
      downloadOne(bge),
    ]);

    setRunning(false);

    const succeeded: string[] = [];
    if (whisperOk) succeeded.push(whisper.id);
    if (bgeOk) succeeded.push(bge.id);

    if (whisperOk && bgeOk) {
      await advance({ models_downloaded: succeeded });
      return;
    }

    // Partial / total failure — don't advance automatically. User can
    // retry (click Start again — the `downloadModel` call is idempotent
    // once the file has been cleared) or skip.
    setFinalError(
      "Some downloads didn't finish. You can retry, or skip and set these up later in Settings → Models.",
    );
  }, [bge, whisperChoice, whisperOptions, downloadOne, advance]);

  const handleSkip = useCallback(() => {
    // Record whatever did finish so the user doesn't re-download it
    // later — the settings surface can show partial completion.
    const succeeded = Object.values(stateRef.current)
      .filter((m) => m.outcome === "done")
      .map((m) => m.id);
    void advance({ models_downloaded: succeeded });
  }, [advance]);

  // ── Render ────────────────────────────────────────────────────────
  const busy = running || isSubmitting;

  if (registryLoading) {
    return (
      <section className="onboarding-panel" aria-label="Models">
        <p className="onboarding-eyebrow">Step 5 of 6</p>
        <h1 className="onboarding-title">Preparing…</h1>
        <p className="onboarding-body">Loading the model registry.</p>
      </section>
    );
  }

  if (whisperOptions.length === 0 || !bge) {
    return (
      <section className="onboarding-panel" aria-label="Models">
        <p className="onboarding-eyebrow">Step 5 of 6</p>
        <h1 className="onboarding-title">Model registry unavailable</h1>
        <p className="onboarding-body">
          We couldn't find the model registry on this system. You can finish
          setup and install models later from Settings → Models.
        </p>
        {finalError && <div className="onboarding-error">{finalError}</div>}
        <div className="onboarding-actions">
          <button
            type="button"
            className="onboarding-cta onboarding-cta--secondary"
            onClick={handleSkip}
            disabled={busy}
          >
            Skip
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="onboarding-panel" aria-label="Download models">
      <p className="onboarding-eyebrow">Step 5 of 6</p>
      <h1 className="onboarding-title">Download models</h1>
      <p className="onboarding-body">
        Infield runs everything locally. Pick a Whisper size for
        transcription — we'll also grab the required semantic search model
        ({formatMb(bge.size_mb)}).
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "calc(8px * var(--ui-scale, 1))" }}>
        <div
          role="radiogroup"
          aria-label="Whisper size"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "calc(8px * var(--ui-scale, 1))",
          }}
        >
          {whisperOptions.map((m) => {
            const active = m.id === whisperChoice;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={active}
                className="onboarding-preset-card"
                data-active={active}
                onClick={() => setWhisperChoice(m.id)}
                disabled={busy}
                style={{ flex: "1 1 auto", minWidth: "calc(120px * var(--ui-scale, 1))" }}
              >
                <span className="onboarding-preset-name">{m.name}</span>
                <span style={{ fontSize: "calc(12px * var(--ui-scale, 1))", opacity: 0.7 }}>
                  {formatMb(m.size_mb)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {Object.values(downloadState).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "calc(10px * var(--ui-scale, 1))" }}>
          <div className="onboarding-progress-track">
            <div
              className="onboarding-progress-fill"
              style={{ width: `${combinedPct}%` }}
              aria-label={`Combined download progress: ${combinedPct}%`}
            />
          </div>
          {Object.values(downloadState).map((m) => (
            <div className="onboarding-progress-row" key={m.id}>
              <span>{m.name}</span>
              <span>
                {m.outcome === "done"
                  ? "Done"
                  : m.outcome === "failed"
                    ? `Failed (${m.attempts} attempts)`
                    : `${m.pct}%`}
              </span>
            </div>
          ))}
        </div>
      )}

      {(error || finalError) && (
        <div className="onboarding-error">{error ?? finalError}</div>
      )}

      <div className="onboarding-actions">
        <button
          type="button"
          className="onboarding-cta"
          onClick={() => void handleStart()}
          disabled={busy || !whisperChoice}
        >
          {busy ? "Downloading…" : finalError ? "Retry" : "Start download"}
        </button>
        <button
          type="button"
          className="onboarding-cta onboarding-cta--secondary"
          onClick={handleSkip}
          disabled={busy}
        >
          Skip
        </button>
      </div>
    </section>
  );
}
