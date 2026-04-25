import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Headphones,
  Square,
  Trash2,
  Download,
  Volume2,
  SlidersHorizontal,
  RotateCcw,
  Mic,
  Users,
  Radio,
  FileText,
} from 'lucide-react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { commands, type AppSettings } from '../bindings'
import { ScrollShadow } from './ScrollShadow'

type RecordMode = 'system' | 'interview'

type FeedLine =
  | { kind: 'system'; id: string; ts: string; text: string }
  | { kind: 'you'; id: string; ts: string; text: string }
  | { kind: 'other'; id: string; ts: string; text: string; speaker: string }

interface SystemAudioParagraph {
  timestamp_secs: number
  text: string
}

interface SystemAudioChunkPayload {
  paragraphs: SystemAudioParagraph[]
  rendered_text: string
  accumulated_text: string
  note_id: string
}

interface InterviewChunkPayload {
  paragraphs: Array<{
    speaker: 'You' | 'Other'
    participant: string | null
    text: string
    wall_clock_ms: number
  }>
  workspace_doc_id: string
}

type TuningKey =
  | 'system_audio_max_chunk_secs'
  | 'system_audio_paragraph_silence_secs'
  | 'system_audio_vad_hangover_secs'

type TuningState = Record<TuningKey, number>

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const TUNING_LIMITS: Record<TuningKey, { min: number; max: number; step: number }> = {
  system_audio_max_chunk_secs: { min: 0.5, max: 10, step: 0.1 },
  system_audio_paragraph_silence_secs: { min: 0.5, max: 10, step: 0.1 },
  system_audio_vad_hangover_secs: { min: 0.3, max: 10, step: 0.1 },
}

const FALLBACK_TUNING: TuningState = {
  system_audio_max_chunk_secs: 2,
  system_audio_paragraph_silence_secs: 1.5,
  system_audio_vad_hangover_secs: 0.51,
}

const tuningFromSettings = (settings?: AppSettings | null): TuningState => ({
  system_audio_max_chunk_secs:
    settings?.system_audio_max_chunk_secs ?? FALLBACK_TUNING.system_audio_max_chunk_secs,
  system_audio_paragraph_silence_secs:
    settings?.system_audio_paragraph_silence_secs ??
    FALLBACK_TUNING.system_audio_paragraph_silence_secs,
  system_audio_vad_hangover_secs:
    settings?.system_audio_vad_hangover_secs ?? FALLBACK_TUNING.system_audio_vad_hangover_secs,
})

const clampTuning = (key: TuningKey, value: number) => {
  const limits = TUNING_LIMITS[key]
  const clamped = Math.min(limits.max, Math.max(limits.min, value))
  return Math.round(clamped * 10) / 10
}

const formatTime = (s: number) => {
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

const SYSTEM_ACCENT = '#3eb8ff'
const SYSTEM_GLOW = 'rgba(62,184,255,0.7)'
const modeAccent = (mode: 'system' | 'interview') =>
  mode === 'interview' ? 'var(--heros-brand)' : SYSTEM_ACCENT
const modeGlow = (mode: 'system' | 'interview') =>
  mode === 'interview' ? 'rgba(255,127,80,0.45)' : SYSTEM_GLOW

function paragraphsToLines(
  note_id: string,
  paragraphs: SystemAudioParagraph[],
): FeedLine[] {
  return paragraphs.map((p, idx) => ({
    kind: 'system' as const,
    id: `${note_id}-${idx}`,
    ts: formatTime(p.timestamp_secs),
    text: p.text,
  }))
}

function interviewPayloadToLines(payload: InterviewChunkPayload): FeedLine[] {
  return payload.paragraphs.map((p, idx) => {
    const ts = formatTime(Math.floor(p.wall_clock_ms / 1000))
    if (p.speaker === 'You') {
      return {
        kind: 'you' as const,
        id: `${payload.workspace_doc_id}-${idx}`,
        ts,
        text: p.text,
      }
    }
    return {
      kind: 'other' as const,
      id: `${payload.workspace_doc_id}-${idx}`,
      ts,
      text: p.text,
      speaker: p.participant ?? 'Other',
    }
  })
}

function SystemAudioTuningSlider({
  label,
  description,
  value,
  defaultValue,
  settingKey,
  isCapturing,
  live,
  accentColor,
  onChange,
}: {
  label: string
  description: string
  value: number
  defaultValue: number
  settingKey: TuningKey
  isCapturing: boolean
  live: boolean
  accentColor: string
  onChange: (key: TuningKey, value: number) => void
}) {
  const limits = TUNING_LIMITS[settingKey]
  const status = live ? 'Live' : isCapturing ? 'Next capture' : 'Next start'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ color: '#fff', fontSize: '12px', fontWeight: 800 }}>{label}</div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '11px', lineHeight: 1.4 }}>
            {description}
          </div>
        </div>
        <div
          style={{
            color: live ? accentColor : 'rgba(255,255,255,0.55)',
            fontSize: '10px',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            whiteSpace: 'nowrap',
          }}
        >
          {status}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          aria-label={label}
          type="range"
          min={limits.min}
          max={limits.max}
          step={limits.step}
          value={value}
          onChange={(event) => onChange(settingKey, Number(event.currentTarget.value))}
          style={{ flex: 1, accentColor }}
        />
        <div
          style={{
            minWidth: 48,
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: '12px',
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value.toFixed(1)}s
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          color: 'rgba(255,255,255,0.32)',
          fontSize: '10px',
        }}
      >
        <span>
          {limits.min.toFixed(1)}-{limits.max.toFixed(0)}s
        </span>
        <span>Default {defaultValue.toFixed(1)}s</span>
      </div>
    </div>
  )
}

export function SystemAudioView() {
  const [isCapturing, setIsCapturing] = useState(false)
  const [timer, setTimer] = useState(0)
  const [transcript, setTranscript] = useState<FeedLine[]>([])
  const [renderDevice, setRenderDevice] = useState<string>('—')
  const [tuning, setTuning] = useState<TuningState>(FALLBACK_TUNING)
  const [defaultTuning, setDefaultTuning] = useState<TuningState>(FALLBACK_TUNING)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [mode, setMode] = useState<RecordMode>('system')
  const [participantName, setParticipantName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [streamUnavailable, setStreamUnavailable] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<number | null>(null)
  const settingsLoadedRef = useRef(false)
  const dirtyKeysRef = useRef<Set<TuningKey>>(new Set())
  const debounceRef = useRef<number | undefined>(undefined)
  const latestTuningRef = useRef<TuningState>(FALLBACK_TUNING)

  const persistTuning = async (keys: TuningKey[], values: TuningState) => {
    if (keys.length === 0) return

    setSaveState('saving')
    const uniqueKeys = [...new Set(keys)]
    const results = await Promise.all(
      uniqueKeys.map((key) => {
        const value = clampTuning(key, values[key])
        if (key === 'system_audio_max_chunk_secs') {
          return commands.changeSystemAudioMaxChunkSecsSetting(value)
        }
        if (key === 'system_audio_paragraph_silence_secs') {
          return commands.changeSystemAudioParagraphSilenceSecsSetting(value)
        }
        return commands.changeSystemAudioVadHangoverSecsSetting(value)
      }),
    )

    const failed = results.find((result) => result.status !== 'ok')
    if (failed?.status === 'error') {
      setSaveState('error')
      toast.error('Could not save system audio tuning', { description: failed.error })
      return
    }

    setSaveState('saved')
    window.setTimeout(() => setSaveState('idle'), 1200)
  }

  const flushPendingTuning = async () => {
    if (debounceRef.current !== undefined) {
      clearTimeout(debounceRef.current)
      debounceRef.current = undefined
    }
    const keys = [...dirtyKeysRef.current]
    dirtyKeysRef.current.clear()
    await persistTuning(keys, latestTuningRef.current)
  }

  const scheduleTuningSave = (key: TuningKey, next: TuningState) => {
    dirtyKeysRef.current.add(key)
    latestTuningRef.current = next

    if (debounceRef.current !== undefined) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = window.setTimeout(() => {
      const keys = [...dirtyKeysRef.current]
      dirtyKeysRef.current.clear()
      debounceRef.current = undefined
      void persistTuning(keys, latestTuningRef.current)
    }, 300)
  }

  const updateTuning = (key: TuningKey, value: number) => {
    if (!settingsLoadedRef.current) return

    const safeValue = clampTuning(key, value)
    const next = { ...latestTuningRef.current, [key]: safeValue }
    latestTuningRef.current = next
    setTuning(next)
    scheduleTuningSave(key, next)
  }

  const resetTuning = () => {
    latestTuningRef.current = defaultTuning
    setTuning(defaultTuning)
    dirtyKeysRef.current = new Set([
      'system_audio_max_chunk_secs',
      'system_audio_paragraph_silence_secs',
      'system_audio_vad_hangover_secs',
    ])
    void flushPendingTuning()
  }

  // Poll capturing state on mount (capture persists across React tab changes).
  useEffect(() => {
    const init = async () => {
      const sys = await commands.isSystemAudioCapturing()
      if (sys.status === 'ok' && sys.data) {
        setMode('system')
        setIsCapturing(true)
        const elapsed = await commands.getSystemAudioCaptureElapsedSecs()
        if (elapsed.status === 'ok' && elapsed.data != null) {
          setTimer(Math.floor(elapsed.data))
          startRef.current = Date.now() - elapsed.data * 1000
        }
        return
      }
      const iv = await commands.isInterviewSessionActive()
      if (iv.status === 'ok' && iv.data) {
        setMode('interview')
        setIsCapturing(true)
        startRef.current = Date.now()
      }
    }
    void init()
  }, [])

  useEffect(() => {
    const load = async () => {
      const [settings, defaults] = await Promise.all([
        commands.getAppSettings(),
        commands.getDefaultSettings(),
      ])

      if (defaults.status === 'ok') {
        setDefaultTuning(tuningFromSettings(defaults.data))
      }
      if (settings.status === 'ok') {
        const next = tuningFromSettings(settings.data)
        latestTuningRef.current = next
        setTuning(next)
        settingsLoadedRef.current = true
      } else {
        settingsLoadedRef.current = true
        toast.error('Could not load system audio tuning', { description: settings.error })
      }
    }

    void load()

    return () => {
      if (debounceRef.current !== undefined) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  // Local timer (avoids round-tripping to Rust every second).
  useEffect(() => {
    let interval: number | undefined
    if (isCapturing) {
      interval = window.setInterval(() => setTimer((t) => t + 1), 1000)
    } else {
      setTimer(0)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isCapturing])

  useEffect(() => {
    if (!scrollRef.current) return
    const el = scrollRef.current
    const frame = requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [transcript])

  // Display the default render device name. Full device list lands when
  // get_render_devices grows beyond the MVP single-entry surface.
  useEffect(() => {
    const load = async () => {
      const result = await commands.getRenderDevices()
      if (result.status === 'ok' && result.data.length > 0) {
        setRenderDevice(result.data[0].name)
      }
    }
    void load()
  }, [])

  useEffect(() => {
    let unlistenSys: UnlistenFn | undefined
    let unlistenInterview: UnlistenFn | undefined
    let cancelled = false

    const setup = async () => {
      const us = await listen<SystemAudioChunkPayload>('system-audio-chunk', (event) => {
        if (mode !== 'system') return
        const { paragraphs, note_id } = event.payload
        setTranscript(paragraphsToLines(note_id, paragraphs))
      })
      const ui = await listen<InterviewChunkPayload>('interview-chunk', (event) => {
        if (mode !== 'interview') return
        setTranscript(interviewPayloadToLines(event.payload))
      })
      if (cancelled) {
        us()
        ui()
        return
      }
      unlistenSys = us
      unlistenInterview = ui
    }

    void setup()
    return () => {
      cancelled = true
      unlistenSys?.()
      unlistenInterview?.()
    }
  }, [mode])

  const startCapture = async () => {
    if (isTransitioning) return
    setIsTransitioning(true)

    if (mode === 'interview') {
      const name = participantName.trim()
      if (!name) {
        setNameError('Participant name is required')
        setIsTransitioning(false)
        return
      }
      if (name.toLowerCase() === 'you') {
        setNameError("Participant name cannot be 'You'")
        setIsTransitioning(false)
        return
      }
    }

    await flushPendingTuning()
    setTranscript([])

    try {
      if (mode === 'system') {
        const result = await commands.startSystemAudioCapture()
        if (result.status !== 'ok') {
          toast.error('Could not start system audio capture', { description: result.error })
          setStreamUnavailable(true)
          return
        }
      } else {
        const result = await commands.startInterviewSession(participantName.trim())
        if (result.status !== 'ok') {
          toast.error('Could not start interview', { description: result.error })
          setStreamUnavailable(true)
          return
        }
      }
      startRef.current = Date.now()
      setIsCapturing(true)
      setStreamUnavailable(false)
    } finally {
      setIsTransitioning(false)
    }
  }

  const stopCapture = async () => {
    if (isTransitioning) return
    setIsTransitioning(true)
    try {
      const result =
        mode === 'system'
          ? await commands.stopSystemAudioCapture()
          : await commands.stopInterviewSession()
      if (result.status !== 'ok') {
        toast.error('Could not stop capture', { description: result.error })
        return
      }
      setIsCapturing(false)
      startRef.current = null
    } finally {
      setIsTransitioning(false)
    }
  }

  const clearTranscript = () => {
    setTranscript([])
  }

  const saveLabel =
    saveState === 'saving'
      ? 'Saving...'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'error'
          ? 'Save failed'
          : isCapturing
            ? 'Live session'
            : 'Ready'

  const headline =
    mode === 'interview'
      ? { kicker: 'Interview', title: 'Record a', highlight: 'conversation', subtitle: 'Mic + system audio captured together. Speakers separated, merged by timestamp, saved under Interviews/.' }
      : { kicker: 'System Audio', title: 'Capture what you', highlight: 'hear', subtitle: "Transcribe anything playing through your speakers — podcasts, calls, videos. Paragraphs append to today's System Audio doc." }
  const headlineAccent = modeAccent(mode)
  const isInterview = mode === 'interview'
  const participantLabel = participantName.trim() || 'Guest'
  const methodLabel = isInterview ? 'Mic + loopback' : 'WASAPI loopback'
  const destinationLabel = isInterview ? 'Interviews/' : "Today's System Audio"
  const emptyTitle = isInterview ? 'Ready for a two-speaker transcript' : 'Ready to capture system audio'
  const emptyDescription = isInterview
    ? 'Name the other speaker, start the session, and the feed will interleave you and them by timestamp.'
    : "Start capture and live paragraphs will appear here while the saved note updates in today's System Audio doc."

  return (
    <div
      className={`system-audio-page system-audio-page--${mode} ${isCapturing ? 'is-live' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      {/* Page header — always visible, mode-adaptive */}
      <section
        className="system-audio-hero"
        style={{
          padding: '24px 40px 14px 40px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          flexShrink: 0,
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ textAlign: 'center' }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 2,
                  background: `linear-gradient(to right, transparent, ${headlineAccent})`,
                  opacity: 0.5,
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: headlineAccent,
                  fontWeight: 800,
                  letterSpacing: '0.4em',
                  textTransform: 'uppercase',
                }}
              >
                {headline.kicker}
              </span>
              <div
                style={{
                  width: 40,
                  height: 2,
                  background: `linear-gradient(to left, transparent, ${headlineAccent})`,
                  opacity: 0.5,
                }}
              />
            </div>
            <h1
              style={{
                fontSize: 34,
                fontWeight: 200,
                margin: 0,
                letterSpacing: '-0.03em',
                color: '#fff',
              }}
            >
              {headline.title}{' '}
              <span style={{ color: headlineAccent, fontWeight: 400 }}>{headline.highlight}</span>
            </h1>
            <p
              style={{
                marginTop: 10,
                fontSize: 13,
                color: 'rgba(255,255,255,0.45)',
                maxWidth: 560,
                lineHeight: 1.6,
              }}
            >
              {headline.subtitle}
            </p>
          </motion.div>
        </AnimatePresence>
      </section>

      {/* Segmented control + name input — fade out when recording */}
      <AnimatePresence initial={false}>
        {!isCapturing && (
          <motion.section
            key="mode-controls"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden', flexShrink: 0 }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 14,
                padding: '0 40px 14px 40px',
              }}
            >
              <div
                role="tablist"
                aria-label="Recording mode"
                style={{
                  display: 'inline-flex',
                  padding: 4,
                  gap: 4,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 'var(--segmented-radius, 999px)',
                }}
              >
                {(['system', 'interview'] as const).map((m) => {
                  const active = mode === m
                  const accent = m === 'interview' ? 'var(--heros-brand)' : '#3eb8ff'
                  return (
                    <button
                      key={m}
                      role="tab"
                      aria-selected={active}
                      disabled={isTransitioning}
                      onClick={() => {
                        if (isTransitioning) return
                        setMode(m)
                        setNameError(null)
                      }}
                      style={{
                        padding: '8px 18px',
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: '0.2em',
                        textTransform: 'uppercase',
                        background: active ? accent : 'transparent',
                        color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                        border: 'none',
                        borderRadius: 'var(--segmented-radius, 999px)',
                        cursor: isTransitioning ? 'not-allowed' : 'pointer',
                        opacity: isTransitioning ? 0.5 : 1,
                        fontFamily: 'inherit',
                        transition: 'background 180ms ease, color 180ms ease',
                      }}
                    >
                      {m === 'system' ? 'System audio' : 'Interview'}
                    </button>
                  )
                })}
              </div>

              {mode === 'interview' && (
                <div
                  style={{
                    width: '100%',
                    maxWidth: 520,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: '0.2em',
                      textTransform: 'uppercase',
                      color: 'rgba(255,255,255,0.4)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Speaker
                  </span>
                  <input
                    placeholder="Participant name (e.g. Alice)"
                    value={participantName}
                    onChange={(e) => {
                      setParticipantName(e.currentTarget.value)
                      setNameError(null)
                    }}
                    disabled={isCapturing || isTransitioning}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      fontSize: 13,
                      background: 'rgba(255,255,255,0.04)',
                      border: `1px solid ${nameError ? '#ff7a7a' : 'rgba(255,255,255,0.08)'}`,
                      borderRadius: 8,
                      color: '#fff',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                  {nameError && (
                    <span style={{ color: '#ff7a7a', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {nameError}
                    </span>
                  )}
                </div>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Main grid: glass transcript card + info column */}
      <div
        className="system-audio-workbench"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(560px, 980px) minmax(280px, 340px)',
          justifyContent: 'center',
          flex: 1,
          minHeight: 0,
          gap: 16,
          padding: '0 18px 18px 18px',
        }}
      >
        {/* Transcript Column */}
        <section
          className="heros-glass-card system-audio-transcript"
          style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          {/* Simplified status row: dot + label + timer */}
          <div
            className="system-audio-status-row"
            style={{
              padding: '20px 32px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: isCapturing ? modeAccent(mode) : 'rgba(255,255,255,0.15)',
                  boxShadow: isCapturing ? `0 0 14px ${modeGlow(mode)}` : 'none',
                  transition: 'background 200ms ease, box-shadow 200ms ease',
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: isCapturing ? '#fff' : 'rgba(255,255,255,0.55)',
                }}
              >
                {isCapturing
                  ? mode === 'interview'
                    ? `Interview — You · ${participantName.trim() || 'Guest'}`
                    : 'Capturing system audio'
                  : 'Ready'}
              </span>
            </div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 24,
                fontWeight: 300,
                color: '#fff',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatTime(timer)}
            </div>
          </div>

        <div
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <ScrollShadow containerRef={scrollRef} style={{ flex: 1, padding: '36px 44px 150px 44px' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 24,
                maxWidth: '760px',
                margin: '0 auto',
              }}
            >
              {transcript.length === 0 && !isCapturing && mode === 'system' && (
                <div className="system-audio-empty">
                  <div className="system-audio-empty__orb">
                    <Radio size={24} />
                  </div>
                  <div className="system-audio-empty__title">{emptyTitle}</div>
                  <p>{emptyDescription}</p>
                </div>
              )}

              {transcript.length === 0 && !isCapturing && mode === 'interview' && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 24,
                    marginTop: 48,
                    opacity: 0.5,
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                  aria-hidden="true"
                >
                  <div className="system-audio-empty system-audio-empty--compact">
                    <div className="system-audio-empty__orb">
                      <Users size={24} />
                    </div>
                    <div className="system-audio-empty__title">{emptyTitle}</div>
                    <p>{emptyDescription}</p>
                  </div>

                  {/* Example bubbles — typographic preview of the merged feed */}
                  {[
                    { kind: 'you' as const, ts: '00:00:03', text: "So what's your take on the roadmap?" },
                    {
                      kind: 'other' as const,
                      ts: '00:00:07',
                      speaker: participantName.trim() || 'Alice',
                      text: "I think the merge step is what makes the transcript usable — otherwise you're just reading two columns.",
                    },
                  ].map((line, i) => {
                    const accent = line.kind === 'you' ? '#3eb8ff' : 'var(--heros-brand)'
                    const label = line.kind === 'you' ? 'You' : line.speaker
                    return (
                      <div
                        key={i}
                        style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 20 }}
                      >
                        <div
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            color: 'rgba(255,255,255,0.25)',
                            paddingTop: 4,
                          }}
                        >
                          {line.ts}
                        </div>
                        <div
                          style={{
                            borderLeft: `2px solid ${accent}`,
                            paddingLeft: 12,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: '0.15em',
                              textTransform: 'uppercase',
                              color: accent,
                              marginBottom: 6,
                            }}
                          >
                            {label}
                          </div>
                          <div
                            style={{
                              fontSize: 15,
                              lineHeight: 1.6,
                              fontWeight: 300,
                              color: 'rgba(255,255,255,0.6)',
                              fontStyle: 'italic',
                            }}
                          >
                            {line.text}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {transcript.map((line) => {
                const accentColor =
                  line.kind === 'you'
                    ? '#3eb8ff'
                    : line.kind === 'other'
                      ? 'var(--heros-brand)'
                      : 'rgba(62,184,255,0.6)'
                const speakerLabel =
                  line.kind === 'you'
                    ? 'You'
                    : line.kind === 'other'
                      ? line.speaker
                      : 'System Audio'
                const hasAccent = line.kind !== 'system'
                return (
                  <motion.div
                    className={`system-audio-line system-audio-line--${line.kind}`}
                    key={line.id}
                    layout="position"
                    initial={{ opacity: 0, y: 6, filter: 'blur(6px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    transition={{
                      opacity: { duration: 0.42, ease: [0.16, 1, 0.3, 1] },
                      y: { duration: 0.46, ease: [0.16, 1, 0.3, 1] },
                      filter: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
                      layout: { duration: 0.42, ease: [0.16, 1, 0.3, 1] },
                    }}
                    style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 20 }}
                  >
                    <div
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '11px',
                        color: 'rgba(255,255,255,0.3)',
                        paddingTop: 4,
                      }}
                    >
                      {line.ts}
                    </div>
                    <div
                      style={{
                        borderLeft: hasAccent ? `2px solid ${accentColor}` : 'none',
                        paddingLeft: hasAccent ? 12 : 0,
                      }}
                    >
                      <div
                        style={{
                          fontSize: '10px',
                          fontWeight: 800,
                          letterSpacing: '0.15em',
                          textTransform: 'uppercase',
                          color: accentColor,
                          marginBottom: 6,
                        }}
                      >
                        {speakerLabel}
                      </div>
                      <div
                        style={{
                          fontSize: '16px',
                          lineHeight: 1.6,
                          fontWeight: 300,
                          color: 'rgba(255,255,255,0.85)',
                        }}
                      >
                        {line.text}
                      </div>
                    </div>
                  </motion.div>
                )
              })}

              {isCapturing && transcript.length === 0 && (
                <motion.div
                  animate={{ opacity: [0.3, 0.7, 0.3] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 20 }}
                >
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      color: 'rgba(255,255,255,0.3)',
                      paddingTop: 4,
                    }}
                  >
                    {formatTime(timer)}
                  </div>
                  <div
                    style={{
                      fontSize: '16px',
                      color: 'rgba(255,255,255,0.3)',
                      fontStyle: 'italic',
                    }}
                  >
                    Listening to system output…
                  </div>
                </motion.div>
              )}
            </div>
          </ScrollShadow>

          {/* Floating Controls */}
          <div
            className="system-audio-control-dock"
            style={{
              position: 'absolute',
              bottom: '32px',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              zIndex: 10,
            }}
          >
            <button
              className="icon-btn"
              style={{
                padding: 12,
                background: 'rgba(255,255,255,0.03)',
                opacity: 0.5,
                cursor: 'not-allowed',
              }}
              disabled
              title="Export — coming in W6"
            >
              <Download size={20} />
            </button>

            <button
              onClick={() => void (isCapturing ? stopCapture() : startCapture())}
              disabled={isTransitioning || streamUnavailable}
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: isCapturing ? modeAccent(mode) : '#fff',
                color: isCapturing ? '#fff' : mode === 'interview' ? '#6b2f1a' : '#1a4f6b',
                border: isCapturing
                  ? 'none'
                  : `3px solid ${mode === 'interview' ? 'rgba(255,127,80,0.7)' : 'rgba(62,184,255,0.65)'}`,
                cursor: isTransitioning || streamUnavailable ? 'not-allowed' : 'pointer',
                opacity: isTransitioning || streamUnavailable ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: isCapturing
                  ? `0 12px 40px ${modeGlow(mode)}`
                  : `0 0 0 6px ${mode === 'interview' ? 'rgba(255,127,80,0.08)' : 'rgba(62,184,255,0.08)'}, 0 0 32px ${mode === 'interview' ? 'rgba(255,127,80,0.25)' : 'rgba(62,184,255,0.25)'}, 0 8px 32px rgba(0,0,0,0.25)`,
                transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                transform: isCapturing ? 'scale(1.1)' : 'scale(1)',
              }}
              className="hover-glow"
              aria-label={
                isCapturing
                  ? mode === 'interview'
                    ? 'Stop interview session'
                    : 'Stop system audio capture'
                  : mode === 'interview'
                    ? 'Start interview session'
                    : 'Start system audio capture'
              }
            >
              {isCapturing ? <Square size={24} fill="currentColor" /> : <Headphones size={32} />}
            </button>

            <button
              className="icon-btn"
              onClick={clearTranscript}
              style={{ padding: 12, background: 'rgba(255,255,255,0.03)' }}
              title="Clear visible transcript (does not delete the saved doc)"
            >
              <Trash2 size={20} />
            </button>
          </div>
        </div>
      </section>

      {/* Info Column */}
      <aside className="system-audio-side" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <section className="heros-glass-card system-audio-side-card system-audio-mode-card" style={{ padding: '22px' }}>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 800,
              color: 'rgba(255,255,255,0.3)',
              textTransform: 'uppercase',
              letterSpacing: '0.2em',
              marginBottom: 16,
            }}
          >
            Session
          </div>
          <div
            style={{
              padding: '16px',
              borderRadius: 12,
              background:
                mode === 'interview' ? 'rgba(255,127,80,0.08)' : 'rgba(62,184,255,0.08)',
              border: `1px solid ${
                mode === 'interview' ? 'rgba(255,127,80,0.22)' : 'rgba(62,184,255,0.18)'
              }`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: modeAccent(mode),
                fontSize: '12px',
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              {isInterview ? <Users size={14} /> : <Headphones size={14} />}
              {isInterview ? 'Interview mode' : 'System audio mode'}
            </div>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
              {headline.subtitle}
            </p>
            <div className="system-audio-session-grid">
              <div>
                <span>Status</span>
                <strong>{isCapturing ? 'Live' : 'Ready'}</strong>
              </div>
              <div>
                <span>Elapsed</span>
                <strong>{formatTime(timer)}</strong>
              </div>
              <div>
                <span>Lines</span>
                <strong>{transcript.length}</strong>
              </div>
              <div>
                <span>Saved to</span>
                <strong>{destinationLabel}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="heros-glass-card system-audio-side-card" style={{ padding: '22px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '10px',
                fontWeight: 800,
                color: 'rgba(255,255,255,0.3)',
                textTransform: 'uppercase',
                letterSpacing: '0.2em',
              }}
            >
              <SlidersHorizontal size={14} /> Tuning
            </div>
            <div
              style={{
                color:
                  saveState === 'error'
                    ? '#ff7a7a'
                    : mode === 'interview'
                      ? 'rgba(255,127,80,0.9)'
                      : 'rgba(62,184,255,0.8)',
                fontSize: '10px',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
              }}
            >
              {saveLabel}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <SystemAudioTuningSlider
              label="Max chunk"
              description="Force transcribe long speech before VAD sees a pause."
              settingKey="system_audio_max_chunk_secs"
              value={tuning.system_audio_max_chunk_secs}
              defaultValue={defaultTuning.system_audio_max_chunk_secs}
              isCapturing={isCapturing}
              live={false}
              accentColor={mode === 'interview' ? '#ff7f50' : '#3eb8ff'}
              onChange={updateTuning}
            />
            <SystemAudioTuningSlider
              label="VAD hangover"
              description="Trailing silence before a spoken segment is cut."
              settingKey="system_audio_vad_hangover_secs"
              value={tuning.system_audio_vad_hangover_secs}
              defaultValue={defaultTuning.system_audio_vad_hangover_secs}
              isCapturing={isCapturing}
              live={false}
              accentColor={mode === 'interview' ? '#ff7f50' : '#3eb8ff'}
              onChange={updateTuning}
            />
            <SystemAudioTuningSlider
              label="Paragraph gap"
              description="Silence between chunks that starts a new timestamp."
              settingKey="system_audio_paragraph_silence_secs"
              value={tuning.system_audio_paragraph_silence_secs}
              defaultValue={defaultTuning.system_audio_paragraph_silence_secs}
              isCapturing={isCapturing}
              live
              accentColor={mode === 'interview' ? '#ff7f50' : '#3eb8ff'}
              onChange={updateTuning}
            />
          </div>

          <div
            style={{
              marginTop: 18,
              paddingTop: 16,
              borderTop: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <p style={{ margin: 0, color: 'rgba(255,255,255,0.42)', fontSize: '11px', lineHeight: 1.45 }}>
              Paragraph gap updates immediately. Max chunk and VAD hangover apply to the next
              capture to avoid mutating the audio thread mid-stream.
            </p>
            <button
              className="icon-btn"
              onClick={resetTuning}
              title="Reset system audio tuning to defaults"
              style={{ padding: 10, background: 'rgba(255,255,255,0.03)', flexShrink: 0 }}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </section>

        <section className="heros-glass-card system-audio-side-card system-audio-device-card" style={{ padding: '22px', flex: 1 }}>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 800,
              color: 'rgba(255,255,255,0.3)',
              textTransform: 'uppercase',
              letterSpacing: '0.2em',
              marginBottom: 16,
            }}
          >
            Device
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: 'rgba(255,255,255,0.5)',
              }}
            >
              <span>Render output</span>
              <span style={{ color: '#fff' }}>{renderDevice}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: 'rgba(255,255,255,0.5)',
              }}
            >
              <span>Method</span>
              <span
                style={{
                  color: mode === 'interview' ? 'rgba(255,127,80,0.95)' : 'rgba(62,184,255,0.9)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Volume2 size={12} /> {methodLabel}
              </span>
            </div>
            {isInterview && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                  color: 'rgba(255,255,255,0.5)',
                }}
              >
                <span>Speaker</span>
                <span style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Mic size={12} /> {participantLabel}
                </span>
              </div>
            )}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: 'rgba(255,255,255,0.5)',
              }}
            >
              <span>Destination</span>
              <span style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
                <FileText size={12} /> {destinationLabel}
              </span>
            </div>
          </div>
        </section>
      </aside>
    </div>
    </div>
  )
}
