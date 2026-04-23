import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import {
  ClosedCaption,
  Copy,
  FileText,
  Headphones,
  Mic,
  Settings2,
  Square,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { useWorkspaceAppearanceStore } from "@/stores/workspaceAppearanceStore";

interface SystemAudioParagraph {
  timestamp_secs: number;
  text: string;
}

interface SystemAudioChunkPayload {
  paragraphs: SystemAudioParagraph[];
  rendered_text: string;
  accumulated_text: string;
  note_id: string;
}

type CaptureState = "idle" | "recording" | "ready" | "unsupported";

const LEVEL_BUCKETS = 16;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function signalTheme({
  bg,
  panel,
  pane,
  text,
  textMuted,
  textSoft,
  accent,
  accentSecondary,
  border,
  panelBlur,
  panelRadius,
  shadowDepth,
}: {
  bg: string;
  panel: string;
  pane: string;
  text: string;
  textMuted: string;
  textSoft: string;
  accent: string;
  accentSecondary: string;
  border: string;
  panelBlur: number;
  panelRadius: number;
  shadowDepth: number;
}): CSSProperties & { [key: `--${string}`]: string | number } {
  const d = clamp(shadowDepth, 0, 1);
  const shadowBase = 0.08 + d * 0.34;
  const shadowSoft = 0.05 + d * 0.18;
  const scrollbarW = clamp(Math.round(panelRadius * 0.38), 8, 14);
  const scrollbarR = clamp(Math.round(panelRadius * 0.5), 8, 18);
  return {
    "--sa-bg": bg,
    "--sa-surface": `${panel}c2`,
    "--sa-surface-strong": `${pane}e6`,
    "--sa-border": `color-mix(in srgb, ${border} 30%, transparent)`,
    "--sa-border-strong": `color-mix(in srgb, ${border} 48%, transparent)`,
    "--sa-ring": `color-mix(in srgb, ${text} 8%, transparent)`,
    "--sa-text": text,
    "--sa-text-muted": textMuted,
    "--sa-text-soft": textSoft,
    "--sa-signal": accent,
    "--sa-success": "#4ade80",
    "--sa-info": accentSecondary,
    /** Translucent fills derived from foreground — works in light and dark themes */
    "--sa-chrome-fill": `color-mix(in srgb, ${text} 7%, transparent)`,
    "--sa-chrome-fill-soft": `color-mix(in srgb, ${text} 5%, transparent)`,
    "--sa-chrome-inset": `inset 0 0 0 1px color-mix(in srgb, ${text} 8%, transparent)`,
    "--sa-shadow": `0 24px 80px rgba(0,0,0,${shadowBase})`,
    "--sa-shadow-soft": `0 14px 40px rgba(0,0,0,${shadowSoft})`,
    "--sa-blur": `${panelBlur}px`,
    "--sa-radius": `${panelRadius}px`,
    /** Themed scrollbar (Live Transcript) — tracks workspace appearance panel radius + text */
    "--sa-scrollbar-width": `${scrollbarW}px`,
    "--sa-scrollbar-thumb-radius": `${scrollbarR}px`,
    "--sa-scrollbar-thumb": `color-mix(in srgb, ${text} 30%, transparent)`,
    "--sa-scrollbar-thumb-hover": `color-mix(in srgb, ${text} 18%, transparent)`,
    "--sa-scrollbar-track": "transparent",
  };
}

function formatTimestamp(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Accent wash — follows `applyWorkspaceAppearanceToDocument` shell glow vars on :root. */
function SessionAccentGlow() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        background: `
          radial-gradient(circle at 88% 18%, var(--workspace-shell-glow-right), transparent 38%),
          radial-gradient(ellipse 120% 85% at 50% 42%, var(--workspace-shell-glow-top), transparent 62%),
          radial-gradient(ellipse 100% 55% at 50% 100%, var(--workspace-shell-glow-bottom), transparent 52%),
          var(--sa-bg)
        `,
      }}
    />
  );
}

function SignalPanel({
  children,
  strong = false,
  style,
}: {
  children: React.ReactNode;
  strong?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        border: strong
          ? "1px solid var(--sa-border-strong)"
          : "1px solid var(--sa-border)",
        background: strong ? "var(--sa-surface-strong)" : "var(--sa-surface)",
        backdropFilter: "blur(var(--sa-blur))",
        borderRadius: "var(--sa-radius)",
        boxShadow: strong ? "var(--sa-shadow)" : "var(--sa-shadow-soft)",
        ...style,
      }}
    >
      <div
        style={{
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          boxShadow: "inset 0 0 0 1px var(--sa-ring)",
        }}
      />
      {children}
    </div>
  );
}

function StatusBadge({ state }: { state: CaptureState }) {
  const badge =
    state === "recording"
      ? {
          label: "Recording",
          bg: "color-mix(in srgb, var(--sa-signal) 18%, transparent)",
          color: "var(--sa-text)",
          dot: "var(--sa-signal)",
          glow: "0 0 14px color-mix(in srgb, var(--sa-signal) 50%, transparent)",
        }
      : state === "ready"
        ? {
            label: "Ready",
            bg: "color-mix(in srgb, var(--sa-success) 14%, transparent)",
            color: "var(--sa-text-muted)",
            dot: "var(--sa-success)",
            glow: "0 0 12px color-mix(in srgb, var(--sa-success) 40%, transparent)",
          }
        : state === "unsupported"
          ? {
              label: "Unsupported",
              bg: "var(--sa-chrome-fill-soft)",
              color: "var(--sa-text-soft)",
              dot: "color-mix(in srgb, var(--sa-text) 35%, transparent)",
              glow: "none",
            }
          : {
              label: "Idle",
              bg: "color-mix(in srgb, var(--sa-info) 12%, transparent)",
              color: "var(--sa-text-muted)",
              dot: "var(--sa-info)",
              glow: "0 0 14px color-mix(in srgb, var(--sa-info) 35%, transparent)",
            };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 999,
        border: "1px solid var(--sa-border)",
        background: badge.bg,
        color: badge.color,
        fontSize: 12,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: badge.dot,
          boxShadow: badge.glow,
        }}
      />
      {badge.label}
    </div>
  );
}

function AudioLevelBars({
  levels,
  isRecording,
}: {
  levels: number[];
  isRecording: boolean;
}) {
  const svgSize = 86;
  const cx = svgSize / 2;
  const cy = svgSize / 2;
  const innerR = 15;
  const maxBarLen = 28;
  const barCount = 64;
  const avgLevel = levels.length > 0 ? levels.reduce((a, b) => a + b, 0) / levels.length : 0;

  const bars = Array.from({ length: barCount }, (_, i) => {
    const angleFrac = i / barCount;
    const angle = angleFrac * Math.PI * 2 - Math.PI / 2;
    const bucketIdx = Math.min(levels.length - 1, Math.floor(angleFrac * levels.length));
    const level = clamp(levels[bucketIdx] ?? 0, 0, 1);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const x1 = cx + cosA * innerR;
    const y1 = cy + sinA * innerR;
    const barLen = 3.5 + level * maxBarLen;
    const x2 = cx + cosA * (innerR + barLen);
    const y2 = cy + sinA * (innerR + barLen);
    const opacity = isRecording ? 0.3 + level * 0.7 : 0.08 + level * 0.15;

    return { x1, y1, x2, y2, opacity, level, angle };
  });

  // Rings: thin outline circles that breathe with average level
  const outerRingR = innerR + maxBarLen + 4;
  const ringR = innerR + (avgLevel * maxBarLen) / 2 + 3;
  const ringOpacity = isRecording ? 0.15 + avgLevel * 0.35 : 0.06 + avgLevel * 0.1;

  return (
    <div style={{ position: "relative", width: svgSize, height: svgSize }}>
      <svg
        width={svgSize}
        height={svgSize}
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        <defs>
          <filter id="orb-blur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <filter id="orb-core" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
          <radialGradient id="orb-center" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--sa-signal)" stopOpacity={0.88} />
            <stop offset="60%" stopColor="var(--sa-signal)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="var(--sa-signal)" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="orb-outer" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--sa-signal)" stopOpacity={0} />
            <stop offset="70%" stopColor="var(--sa-signal)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--sa-signal)" stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* Outer ambient orb — breathes with avg level */}
        <circle
          cx={cx}
          cy={cy}
          r={outerRingR + avgLevel * 10}
          fill="url(#orb-outer)"
          opacity={ringOpacity}
          filter="url(#orb-blur)"
        />

        {/* Solid guide ring */}
        <circle
          cx={cx}
          cy={cy}
          r={ringR}
          fill="none"
          stroke="var(--sa-signal)"
          strokeOpacity={0.22}
          strokeWidth={1.5}
          strokeDasharray="3 5"
          opacity={ringOpacity * 0.6}
        />

        {/* Bar bloom — thick blurred copy behind each bar */}
        {bars.map((bar, i) => (
          <line
            key={`bloom-${i}`}
            x1={bar.x1}
            y1={bar.y1}
            x2={bar.x2}
            y2={bar.y2}
            stroke="var(--sa-signal)"
            strokeOpacity={0.35 * bar.opacity * 0.5}
            strokeWidth={6.5}
            strokeLinecap="round"
            filter="url(#orb-blur)"
          />
        ))}

        {/* Main bars */}
        {bars.map((bar, i) => (
          <line
            key={`bar-${i}`}
            x1={bar.x1}
            y1={bar.y1}
            x2={bar.x2}
            y2={bar.y2}
            stroke="var(--sa-signal)"
            strokeOpacity={bar.opacity}
            strokeWidth={1.6}
            strokeLinecap="round"
            style={{ transition: "opacity 160ms ease-out" }}
          />
        ))}

        {/* Centre glow orb — SMIL scale (reliable in Tauri/WebView; CSS keyframes on SVG often don’t run) */}
        <g transform={`translate(${cx} ${cy})`}>
          <g key={isRecording ? "pulse-rec" : "pulse-idle"}>
            <animateTransform
              attributeName="transform"
              type="scale"
              values="1;1.34;1"
              keyTimes="0;0.5;1"
              dur={isRecording ? "1.7s" : "2.5s"}
              repeatCount="indefinite"
              calcMode="spline"
              keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
            />
            <circle
              cx={0}
              cy={0}
              r={innerR}
              fill="url(#orb-center)"
              opacity={isRecording ? 0.85 : 0.2}
              filter="url(#orb-core)"
              style={{ transition: "opacity 200ms ease-out" }}
            />
          </g>
        </g>

        {/* Centre bright dot */}
        <circle
          cx={cx}
          cy={cy}
          r={3}
          fill="var(--sa-signal)"
          opacity={isRecording ? 0.95 : 0.35}
          style={{
            filter: isRecording ? "drop-shadow(0 0 6px color-mix(in srgb, var(--sa-signal) 55%, transparent))" : undefined,
            transition: "opacity 200ms ease-out",
          }}
        />
      </svg>
    </div>
  );
}

function TuningSlider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  suffix: string;
  onChange: (next: number) => void;
}) {
  const decimals = step >= 0.1 ? 1 : 2;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          fontSize: 12,
          color: "var(--sa-text-muted)",
        }}
      >
        <span>{label}</span>
        <span
          style={{
            color: "var(--sa-text)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {value.toFixed(decimals)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        onInput={(e) => onChange(Number(e.currentTarget.value))}
        style={{
          width: "100%",
          accentColor: "var(--sa-signal)",
          opacity: disabled ? 0.45 : 1,
        }}
      />
    </div>
  );
}

const TRANSCRIPT_NEAR_BOTTOM_PX = 120;

function TranscriptPane({
  paragraphs,
  transcriptPresent,
  isRecording,
}: {
  paragraphs: SystemAudioParagraph[];
  transcriptPresent: boolean;
  isRecording: boolean;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** When true, new paragraphs keep the view pinned to the bottom (see ChatWindow). */
  const stickToBottomRef = useRef(true);
  const prevRecordingRef = useRef(isRecording);

  const scrollTranscriptToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (isRecording && !prevRecordingRef.current) {
      stickToBottomRef.current = true;
    }
    prevRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) {
      return;
    }
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = dist < TRANSCRIPT_NEAR_BOTTOM_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    if (!stickToBottomRef.current) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      scrollTranscriptToBottom();
    });
    return () => window.cancelAnimationFrame(id);
  }, [paragraphs, transcriptPresent, scrollTranscriptToBottom]);

  return (
    <SignalPanel
      strong
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        width: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--sa-text) 3%, transparent), transparent 24%, transparent 82%, color-mix(in srgb, var(--sa-text) 2.5%, transparent))",
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          width: "100%",
        }}
      >
        <div
          style={{
            flexShrink: 0,
            padding: "13px 15px",
            borderBottom: "1px solid var(--sa-border)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: ".18em",
              color: "var(--sa-text-soft)",
            }}
          >
            <ClosedCaption
              size={17}
              strokeWidth={2}
              aria-hidden
              style={{ flexShrink: 0, color: "var(--sa-text-soft)", opacity: 0.92 }}
            />
            Live Transcript
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: "var(--sa-text-muted)" }}>
            Timestamped paragraphs from the live stream; copy uses the same markdown as your note.
          </div>
        </div>

        <div
          ref={scrollContainerRef}
          className="sa-transcript-scroll"
          style={{
            flex: "1 1 auto",
            minHeight: 120,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "15px",
            fontSize: 14,
            lineHeight: 1.75,
            color: "var(--sa-text-muted)",
            scrollbarGutter: "stable",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
              boxSizing: "border-box",
            }}
          >
            <div style={{ width: "100%" }}>
              {!transcriptPresent ? (
                <p style={{ margin: 0, fontStyle: "italic", color: "var(--sa-text-soft)" }}>
                  Waiting for input...
                </p>
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  {paragraphs.map((p, index) => (
                    <p
                      key={`${p.timestamp_secs}-${index}-${p.text.slice(0, 24)}`}
                      style={{ margin: 0 }}
                    >
                      <span
                        style={{
                          marginRight: 10,
                          display: "inline-block",
                          padding: "3px 7px",
                          borderRadius: 8,
                          background: "var(--sa-chrome-fill)",
                          boxShadow: "var(--sa-chrome-inset)",
                          fontSize: 11,
                          fontVariantNumeric: "tabular-nums",
                          color: "var(--sa-text-soft)",
                        }}
                      >
                        [{formatTimestamp(p.timestamp_secs)}]
                      </span>
                      {p.text}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            flexShrink: 0,
            padding: "10px 15px",
            borderTop: "1px solid var(--sa-border)",
            fontSize: 12,
            color: "var(--sa-text-soft)",
          }}
        >
          Paragraph breaks follow wall-clock gaps between chunks (tunable below). Short fragments merge into the previous block.
        </div>
      </div>
    </SignalPanel>
  );
}

function ControlButton({
  children,
  active = false,
  success = false,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  success?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        borderRadius: 18,
        padding: "10px 16px",
        border: "1px solid var(--sa-border)",
        background: disabled
          ? "var(--sa-chrome-fill-soft)"
          : success
            ? "color-mix(in srgb, var(--sa-success) 14%, transparent)"
            : active
              ? "color-mix(in srgb, var(--sa-signal) 18%, transparent)"
              : "var(--sa-chrome-fill)",
        color: disabled
          ? "var(--sa-text-soft)"
          : success
            ? "color-mix(in srgb, var(--sa-success) 88%, var(--sa-text))"
            : "var(--sa-text)",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "transform 120ms ease, background 120ms ease",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

export function SystemAudioSession() {
  const { t } = useTranslation();
  const appearance = useWorkspaceAppearanceStore((state) => state.resolved);
  const isWindows = platform() === "windows";
  const [isRecording, setIsRecording] = useState(false);
  const [paragraphs, setParagraphs] = useState<SystemAudioParagraph[]>([]);
  const [copyMarkdown, setCopyMarkdown] = useState("");
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>(Array(LEVEL_BUCKETS).fill(0));
  const smoothedLevelsRef = useRef<number[]>(Array(LEVEL_BUCKETS).fill(0));
  const { settings, updateSetting } = useSettings();

  const maxChunkSecs = settings?.system_audio_max_chunk_secs ?? 2.0;
  const paragraphSilenceSecs = settings?.system_audio_paragraph_silence_secs ?? 1.5;
  const vadHangoverSecs = settings?.system_audio_vad_hangover_secs ?? 0.51;
  const disabled = !isWindows;
  const transcriptPresent =
    paragraphs.length > 0 && paragraphs.some((p) => p.text.trim().length > 0);
  const captureState: CaptureState = disabled
    ? "unsupported"
    : isRecording
      ? "recording"
        : transcriptPresent
          ? "ready"
          : "idle";
  /** Loopback runs in the backend while this view can unmount on tab change — re-sync from Rust on mount. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await commands.isSystemAudioCapturing();
      if (cancelled) return;
      if (res.status === "ok" && res.data) {
        setIsRecording(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const themeVars = useMemo(
    () =>
      signalTheme({
        bg: appearance.colors.bg,
        panel: appearance.colors.panel,
        pane: appearance.colors.pane,
        text: appearance.colors.text,
        textMuted: appearance.colors.textMuted,
        textSoft: appearance.colors.textSoft,
        accent: appearance.colors.accent,
        accentSecondary: appearance.colors.accentSecondary,
        border: appearance.colors.border,
        panelBlur: appearance.panelBlur,
        panelRadius: appearance.panelRadius,
        shadowDepth: appearance.shadowDepth,
      }),
    [appearance],
  );

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const unlistenChunk = await listen<SystemAudioChunkPayload>(
        "system-audio-chunk",
        (event) => {
          setIsRecording(true);
          setParagraphs(event.payload.paragraphs);
          setCopyMarkdown(event.payload.accumulated_text);
          setCurrentNoteId(event.payload.note_id);
        },
      );
      const unlistenStop = await listen("system-audio-stop", () => {
        setIsRecording(false);
      });
      const unlistenLoopbackLevel = await listen<number[]>(
        "loopback-level",
        (event) => {
          const nextLevels = event.payload as number[];
          const smoothed = smoothedLevelsRef.current.map((previous, index) => {
            const target = nextLevels[index] ?? nextLevels[0] ?? 0;
            return previous * 0.78 + target * 0.22;
          });
          smoothedLevelsRef.current = smoothed;
          setLevels(smoothed);
        },
      );

      const nextCleanup = () => {
        unlistenChunk();
        unlistenStop();
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

  const handleToggle = async () => {
    if (isRecording) {
      await commands.stopSystemAudioCapture();
      setIsRecording(false);
      smoothedLevelsRef.current = Array(LEVEL_BUCKETS).fill(0);
      setLevels(Array(LEVEL_BUCKETS).fill(0));
      return;
    }

    await commands.startSystemAudioCapture();
    setIsRecording(true);
    setParagraphs([]);
    setCopyMarkdown("");
    setCurrentNoteId(null);
    smoothedLevelsRef.current = Array(LEVEL_BUCKETS).fill(0);
    setLevels(Array(LEVEL_BUCKETS).fill(0));
  };

  const handleOpenNote = async () => {
    if (!currentNoteId) return;
    window.dispatchEvent(new CustomEvent("open-note", { detail: currentNoteId }));
  };

  const handleCopyText = () => {
    if (copyMarkdown.trim()) {
      void navigator.clipboard.writeText(copyMarkdown);
    }
  };

  const handleOpenGeneralSettings = () => {
    window.dispatchEvent(
      new CustomEvent("handy-open-settings", { detail: { section: "general" } }),
    );
  };

  const [tuneRoutingOpen, setTuneRoutingOpen] = useState(false);
  const tuneRoutingPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) setTuneRoutingOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!tuneRoutingOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = tuneRoutingPopoverRef.current;
      if (root && !root.contains(e.target as Node)) {
        setTuneRoutingOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [tuneRoutingOpen]);

  useEffect(() => {
    if (!tuneRoutingOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTuneRoutingOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tuneRoutingOpen]);

  return (
    <div
      style={{
        ...themeVars,
        position: "relative",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--sa-bg)",
        color: "var(--sa-text)",
      }}
    >
      <SessionAccentGlow />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          width: "100%",
          maxWidth: "min(960px, 100%)",
          margin: "0 auto",
          minHeight: 0,
          padding: "clamp(16px, 3vw, 24px)",
          boxSizing: "border-box",
          gap: 16,
        }}
      >
        <header style={{ position: "relative", zIndex: 20, flexShrink: 0 }}>
          <SignalPanel
            strong
            style={{
              padding: "14px 16px",
              position: "relative",
              /* Dropdown extends below this card; default SignalPanel overflow:hidden would clip it. */
              overflow: "visible",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Headphones size={20} color="var(--sa-text)" />
                <span style={{ fontSize: 20, fontWeight: 700, color: "var(--sa-text)" }}>
                  {t("systemAudio.title")}
                </span>
              </div>
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  transform: "translateX(-50%)",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <AudioLevelBars levels={levels} isRecording={isRecording} />
              </div>
              <div
                ref={tuneRoutingPopoverRef}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  position: "relative",
                  zIndex: 2,
                }}
              >
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-expanded={tuneRoutingOpen}
                    aria-haspopup="dialog"
                    onClick={() => {
                      if (!disabled) setTuneRoutingOpen((open) => !open);
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 999,
                      padding: "8px 14px",
                      border: "1px solid var(--sa-border)",
                      background: tuneRoutingOpen
                        ? "color-mix(in srgb, var(--sa-signal) 14%, transparent)"
                        : "var(--sa-chrome-fill)",
                      color: disabled ? "var(--sa-text-soft)" : "var(--sa-text)",
                      cursor: disabled ? "not-allowed" : "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    <Settings2 size={16} />
                    {t("systemAudio.tuneRouting")}
                  </button>
                  {tuneRoutingOpen && !disabled ? (
                    <div
                      role="dialog"
                      aria-label={t("systemAudio.tuneRouting")}
                      style={{
                        position: "absolute",
                        top: "calc(100% + 10px)",
                        right: 0,
                        width: "min(340px, calc(100vw - 48px))",
                        padding: "16px 18px",
                        borderRadius: "var(--sa-radius)",
                        border: "1px solid var(--sa-border-strong)",
                        background: "var(--sa-surface-strong)",
                        backdropFilter: "blur(var(--sa-blur))",
                        boxShadow: "var(--sa-shadow)",
                        display: "grid",
                        gap: 16,
                        zIndex: 50,
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          lineHeight: 1.55,
                          color: "var(--sa-text-muted)",
                        }}
                      >
                        {t("systemAudio.tuneRoutingHint")}
                      </p>
                      <TuningSlider
                        label={t("systemAudio.maxChunkDuration")}
                        value={maxChunkSecs}
                        min={0.5}
                        max={4}
                        step={0.1}
                        disabled={disabled}
                        suffix={t("systemAudio.maxChunkDurationSuffix")}
                        onChange={(next) =>
                          void updateSetting("system_audio_max_chunk_secs", next)
                        }
                      />
                      <TuningSlider
                        label={t("systemAudio.paragraphSilenceGap")}
                        value={paragraphSilenceSecs}
                        min={0.5}
                        max={4}
                        step={0.1}
                        disabled={disabled}
                        suffix={t("systemAudio.maxChunkDurationSuffix")}
                        onChange={(next) =>
                          void updateSetting("system_audio_paragraph_silence_secs", next)
                        }
                      />
                      <TuningSlider
                        label={t("systemAudio.vadHangover")}
                        value={vadHangoverSecs}
                        min={0.3}
                        max={1.5}
                        step={0.01}
                        disabled={disabled}
                        suffix={t("systemAudio.maxChunkDurationSuffix")}
                        onChange={(next) =>
                          void updateSetting("system_audio_vad_hangover_secs", next)
                        }
                      />
                      <button
                        type="button"
                        onClick={() => {
                          handleOpenGeneralSettings();
                          setTuneRoutingOpen(false);
                        }}
                        style={{
                          marginTop: 4,
                          justifySelf: "start",
                          padding: 0,
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--sa-signal)",
                          textDecoration: "underline",
                          textUnderlineOffset: 3,
                        }}
                      >
                        {t("systemAudio.openGeneralSettings")}
                      </button>
                    </div>
                  ) : null}
                </div>
                <StatusBadge state={captureState} />
              </div>
            </div>
          </SignalPanel>
        </header>

        <main
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            position: "relative",
            zIndex: 0,
          }}
        >
          <TranscriptPane
            paragraphs={paragraphs}
            transcriptPresent={transcriptPresent}
            isRecording={isRecording}
          />
        </main>

        <footer style={{ flexShrink: 0 }}>
          <SignalPanel style={{ padding: "14px 16px", boxSizing: "border-box" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
              }}
            >
              <ControlButton
                active={isRecording}
                disabled={disabled}
                onClick={() => {
                  void handleToggle();
                }}
              >
                {isRecording ? <Square size={16} /> : <Mic size={16} />}
                {isRecording ? "Stop Capture" : "Start Capture"}
              </ControlButton>

              <ControlButton disabled={!transcriptPresent} onClick={handleCopyText}>
                <Copy size={16} />
                {t("systemAudio.copyText")}
              </ControlButton>

              <ControlButton
                success
                disabled={!currentNoteId}
                onClick={() => {
                  void handleOpenNote();
                }}
              >
                <FileText size={16} />
                {t("systemAudio.openNote")}
              </ControlButton>
            </div>
          </SignalPanel>
        </footer>
      </div>
    </div>
  );
}

