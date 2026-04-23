import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MicrophoneIcon,
  TranscriptionIcon,
  CancelIcon,
} from "../components/icons";
import { Volume2 } from "lucide-react";
import "./RecordingOverlay.css";
import { commands } from "@/bindings";
import i18n, { syncLanguageFromSettings } from "@/i18n";
import { getLanguageDirection } from "@/lib/utils/rtl";

type OverlayState = "recording" | "transcribing" | "processing" | "loopback_recording";

const LEVEL_BUCKETS = 16;
/** Discrete bars, tallest at center — matches reference HUD silhouette. */
const SYMMETRIC_BAR_COUNT = 13;
const BAR_HEIGHT_MIN = 3;
const BAR_HEIGHT_MAX = 18;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Single loudness scalar from FFT buckets (mic) or flat RMS bins (loopback). */
function deriveEnergy(levels: number[]): number {
  if (!levels.length) return 0;
  let sum = 0;
  let peak = 0;
  for (const v of levels) {
    const x = clamp(v, 0, 1);
    sum += x;
    if (x > peak) peak = x;
  }
  const mean = sum / levels.length;
  return clamp(0.28 * mean + 0.72 * peak, 0, 1);
}

/**
 * Smooth bell from center (1) to edges (~0) — diamond / leaf silhouette.
 * Index 0..n-1, peak at middle.
 */
function centerEnvelope(i: number, n: number): number {
  const mid = (n - 1) / 2;
  const edgeDist = mid < 1e-6 ? 0 : Math.abs(i - mid) / mid;
  const w = Math.max(0, Math.cos((edgeDist * Math.PI) / 2));
  return Math.pow(w, 1.15);
}

function OverlaySymmetricBars({
  levels,
  active,
}: {
  levels: number[];
  active: boolean;
}) {
  const energy = useMemo(() => deriveEnergy(levels), [levels]);

  const heights = useMemo(() => {
    const drive = active ? energy : energy * 0.4;
    return Array.from({ length: SYMMETRIC_BAR_COUNT }, (_, i) => {
      const env = centerEnvelope(i, SYMMETRIC_BAR_COUNT);
      const h = BAR_HEIGHT_MIN + env * drive * (BAR_HEIGHT_MAX - BAR_HEIGHT_MIN);
      return clamp(h, BAR_HEIGHT_MIN, BAR_HEIGHT_MAX);
    });
  }, [energy, active]);

  return (
    <div className="overlay-symmetric-bars" aria-hidden>
      {heights.map((h, i) => (
        <div
          key={i}
          className="overlay-symmetric-bars__bar"
          style={{ height: `${h}px` }}
        />
      ))}
    </div>
  );
}

function SpeechFlowLabel({ text }: { text: string }) {
  return (
    <div className="speech-flow" title={text}>
      <span className="speech-flow__text">{text}</span>
      <span className="speech-flow__line" aria-hidden />
    </div>
  );
}

const RecordingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [state, setState] = useState<OverlayState>("recording");
  const [levels, setLevels] = useState<number[]>(Array(LEVEL_BUCKETS).fill(0));
  const smoothedLevelsRef = useRef<number[]>(Array(LEVEL_BUCKETS).fill(0));
  const direction = getLanguageDirection(i18n.language);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const unlistenShow = await listen("show-overlay", async (event) => {
        await syncLanguageFromSettings();
        const overlayState = event.payload as OverlayState;
        setState(overlayState);
        setIsVisible(true);
      });

      const unlistenHide = await listen("hide-overlay", () => {
        setIsVisible(false);
      });

      const handleLevels = (newLevels: number[]) => {
        const smoothed = smoothedLevelsRef.current.map((prev, i) => {
          const target = newLevels[i] ?? newLevels[0] ?? 0;
          return prev * 0.72 + target * 0.28;
        });
        smoothedLevelsRef.current = smoothed;
        setLevels([...smoothed]);
      };

      const unlistenLevel = await listen<number[]>("mic-level", (event) => {
        handleLevels(event.payload as number[]);
      });

      const unlistenLoopbackLevel = await listen<number[]>("loopback-level", (event) => {
        handleLevels(event.payload as number[]);
      });

      const nextCleanup = () => {
        unlistenShow();
        unlistenHide();
        unlistenLevel();
        unlistenLoopbackLevel();
      };

      if (disposed) {
        nextCleanup();
        return;
      }

      cleanup = nextCleanup;
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  const isMeterActive = state === "recording" || state === "loopback_recording";
  const showStatusLayer = state === "transcribing" || state === "processing";

  const getIcon = () => {
    if (state === "loopback_recording") {
      return <Volume2 size={10} strokeWidth={2} aria-hidden />;
    }
    if (state === "recording") {
      return <MicrophoneIcon width={11} height={11} color="currentColor" />;
    }
    return <TranscriptionIcon width={11} height={11} color="currentColor" />;
  };

  const captureVariant = state === "loopback_recording" ? "system" : "mic";

  const onOverlayPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest?.(".cancel-button")) return;
    void getCurrentWindow().startDragging();
  }, []);

  return (
    <div dir={direction} className="overlay-shell">
      <div
        className={`recording-overlay ${isVisible ? "fade-in" : ""}`}
        data-capture={captureVariant}
        onPointerDown={onOverlayPointerDown}
      >
        <div className="overlay-hub">{getIcon()}</div>

        <div className="overlay-middle">
          <div
            className={`overlay-stack-layer overlay-meter-layer${isMeterActive && isVisible ? " is-visible" : ""}`}
          >
            <OverlaySymmetricBars levels={levels} active={isVisible} />
          </div>
          <div
            className={`overlay-stack-layer overlay-status-layer${showStatusLayer && isVisible ? " is-visible" : ""}`}
          >
            {state === "transcribing" && (
              <SpeechFlowLabel text={t("overlay.transcribing")} />
            )}
            {state === "processing" && (
              <SpeechFlowLabel text={t("overlay.processing")} />
            )}
          </div>
        </div>

        <div className="overlay-right">
          {state === "recording" && (
            <div
              className="cancel-button"
              onClick={() => {
                commands.cancelOperation();
              }}
            >
              <CancelIcon width={10} height={10} color="currentColor" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RecordingOverlay;
