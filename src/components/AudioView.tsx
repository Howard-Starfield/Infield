import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  Mic,
  Square,
  Sparkles,
  Trash2,
  Download,
  Shield,
  Calendar,
  ChevronDown,
  Play,
  Pause,
  AlertTriangle,
  VolumeX,
} from 'lucide-react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { convertFileSrc } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { commands } from '../bindings'
import { ScrollShadow } from './ScrollShadow'

interface BodyUpdatedPayload {
  node_id: string
  body: string
  updated_at: number
}

interface TranscriptionSyncedPayload {
  node_id: string
  source: string
}

interface RecordingErrorPayload {
  error_type: string
  detail: string | null
}

interface VoiceMemoBlock {
  recordedAtMs: number | null
  /** Absolute path to the recorded audio file, or null if no audio was retained. */
  audioPath: string | null
  text: string
  /** Position in the doc — stable across re-parses, used for React keys. */
  index: number
}

const formatTime = (s: number) => {
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/** Format a unix-ms timestamp to a short local time-of-day. */
function formatTimeOfDay(ms: number | null): string {
  if (!ms) return '—'
  const d = new Date(ms)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Format mm:ss / mm:ss for a playback progress clock. */
function formatPlaybackClock(currentSec: number, durationSec: number): string {
  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) return '00:00'
    const m = Math.floor(s / 60)
    const r = Math.floor(s % 60)
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  }
  return `${fmt(currentSec)} / ${fmt(durationSec)}`
}

/** Play / Pause / Loading / Unavailable button for a single voice memo block. */
function PlayButton(props: {
  hasAudio: boolean
  isPlaying: boolean
  isLoading: boolean
  isUnavailable: boolean
  onClick: () => void
}) {
  const { hasAudio, isPlaying, isLoading, isUnavailable, onClick } = props

  // Resolve visual state — order matters: unavailable beats loading beats
  // playing because once we know a file is broken, we shouldn't pretend
  // it's still loading or playable.
  const state: 'no-audio' | 'unavailable' | 'loading' | 'playing' | 'idle' = !hasAudio
    ? 'no-audio'
    : isUnavailable
    ? 'unavailable'
    : isLoading
    ? 'loading'
    : isPlaying
    ? 'playing'
    : 'idle'

  const baseStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid rgba(255,255,255,0.1)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    flexShrink: 0,
  }

  if (state === 'no-audio') {
    return (
      <span
        style={{
          ...baseStyle,
          background: 'rgba(255,255,255,0.02)',
          color: 'rgba(255,255,255,0.18)',
          cursor: 'not-allowed',
        }}
        title="No audio file was retained for this memo."
        aria-label="No audio available"
        role="img"
      >
        <VolumeX size={12} />
      </span>
    )
  }

  if (state === 'unavailable') {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          ...baseStyle,
          background: 'rgba(204,76,43,0.10)',
          color: 'rgba(255,180,160,0.7)',
          borderColor: 'rgba(204,76,43,0.25)',
        }}
        title="Audio file could not be loaded. Click to retry."
        aria-label="Audio unavailable — retry"
      >
        <AlertTriangle size={12} />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...baseStyle,
        background: state === 'playing' ? 'var(--heros-brand)' : 'rgba(255,255,255,0.06)',
        color: state === 'playing' ? '#fff' : 'rgba(255,255,255,0.85)',
        borderColor: state === 'playing' ? 'transparent' : 'rgba(255,255,255,0.12)',
        opacity: state === 'loading' ? 0.6 : 1,
      }}
      title={state === 'playing' ? 'Pause' : state === 'loading' ? 'Loading…' : 'Play'}
      aria-label={state === 'playing' ? 'Pause voice memo' : 'Play voice memo'}
      disabled={state === 'loading'}
    >
      {state === 'playing' ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
    </button>
  )
}

/** Local-date ISO string (YYYY-MM-DD) — matches the Rust voice-memo title format. */
function todayIsoLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

function isoToLabel(iso: string): string {
  const today = todayIsoLocal()
  if (iso === today) return `Today · ${iso}`
  // Yesterday detection — local-date subtraction.
  const t = new Date()
  t.setDate(t.getDate() - 1)
  const y = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(
    t.getDate(),
  ).padStart(2, '0')}`
  if (iso === y) return `Yesterday · ${iso}`
  return iso
}

/**
 * Parse every `::voice_memo_recording{...}` block from a workspace doc body.
 *
 * Rust writes each recording as:
 *   ::voice_memo_recording{path="<absolute file path>"}
 *
 *   <transcript text…>
 *
 * (See actions.rs `voice_memo_recording_block` for the canonical writer.)
 *
 * Forward-compat: also accepts the older JSON-style metadata shape so docs
 * written by a future revision keep parsing. Returns blocks in document order
 * so the on-screen list matches the file.
 */
function parseAllVoiceMemoBlocks(body: string): VoiceMemoBlock[] {
  const marker = '::voice_memo_recording'
  const blocks: VoiceMemoBlock[] = []
  let searchFrom = 0
  let blockIndex = 0
  while (true) {
    const idx = body.indexOf(marker, searchFrom)
    if (idx === -1) break
    const closeIdx = body.indexOf('}', idx)
    if (closeIdx === -1) break

    const metaRaw = body.slice(idx + marker.length, closeIdx + 1) // "{...}"
    const inner = metaRaw.slice(1, -1).trim() // strip outer { }

    // Primary format: path="..." — single attribute, double-quoted.
    let audioPath: string | null = null
    const pathMatch = inner.match(/path\s*=\s*"([^"]*)"/)
    if (pathMatch) audioPath = pathMatch[1]

    // Forward-compat: JSON shape with audio_file_path / recorded_at_ms.
    let recordedAtMs: number | null = null
    if (inner.startsWith('"') || inner.startsWith('{') || inner.includes(':')) {
      try {
        const meta = JSON.parse(metaRaw)
        if (audioPath == null && typeof meta?.audio_file_path === 'string') {
          audioPath = meta.audio_file_path
        }
        if (typeof meta?.recorded_at_ms === 'number') {
          recordedAtMs = meta.recorded_at_ms
        }
      } catch {
        /* not valid JSON — already covered by the path="..." extraction above */
      }
    }

    if (audioPath != null && audioPath.trim() === '') audioPath = null

    const nextIdx = body.indexOf(marker, closeIdx + 1)
    const text = (nextIdx === -1
      ? body.slice(closeIdx + 1)
      : body.slice(closeIdx + 1, nextIdx)
    ).trim()
    if (text) {
      blocks.push({ recordedAtMs, audioPath, text, index: blockIndex++ })
    }
    searchFrom = closeIdx + 1
  }
  return blocks
}

/** Find the workspace node id for "Voice Memos — <iso>" (exact-title match). */
async function findVoiceMemosDocId(dateIso: string): Promise<string | null> {
  const title = `Voice Memos — ${dateIso}`
  const result = await commands.searchWorkspaceTitle(title, 5)
  if (result.status !== 'ok') return null
  const exact = result.data.find((r) => r.name === title)
  return exact?.id ?? null
}

/**
 * Batch existence check for absolute file paths.
 *
 * Returns the subset of input paths that actually exist on disk. Runs
 * existence checks in parallel via Promise.all — `exists()` is a single
 * `stat` syscall, microseconds per file, so even 100+ paths complete in a
 * few ms. Falls back to "assume all OK" on plugin failure so a missing
 * permission can't break the page.
 *
 * Per CLAUDE.md Rule 14 (no fs watcher / no aggressive startup scan), this
 * runs only on user-triggered loads (mount, date switch, post-stop refresh)
 * — never on a timer or boot.
 */
async function pathsExist(paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set()
  try {
    const { exists } = await import('@tauri-apps/plugin-fs')
    const results = await Promise.all(
      paths.map(async (p) => ({ p, ok: await exists(p).catch(() => false) })),
    )
    return new Set(results.filter((r) => r.ok).map((r) => r.p))
  } catch {
    // Plugin unavailable — best to assume the files exist; the per-block
    // click-to-play path will still surface real failures via onerror.
    return new Set(paths)
  }
}

/**
 * Resolve a vault-relative path (as stored in `WorkspaceNode.vault_rel_path`)
 * to its absolute on-disk path. Caches the app-data dir lookup so subsequent
 * calls in the same session avoid the Tauri round-trip.
 */
let cachedAppDataDir: string | null = null
async function resolveVaultAbsolutePath(vaultRelPath: string): Promise<string | null> {
  try {
    if (!cachedAppDataDir) {
      const result = await commands.getAppDirPath()
      if (result.status !== 'ok') return null
      cachedAppDataDir = result.data
    }
    // Vault root convention per CLAUDE.md: <app_data>/handy-vault/
    // The relative path uses forward slashes from Rust; normalise the
    // join with whatever the platform separator is by passing the raw
    // string — Tauri's fs plugin accepts both `/` and `\` on Windows.
    const sep = cachedAppDataDir.includes('\\') ? '\\' : '/'
    const root = cachedAppDataDir.endsWith(sep) ? cachedAppDataDir : cachedAppDataDir + sep
    return `${root}handy-vault${sep}${vaultRelPath.replace(/^[/\\]+/, '')}`
  } catch {
    return null
  }
}

/** Find every "Voice Memos — YYYY-MM-DD" doc and return distinct dates, newest first. */
async function listAvailableVoiceMemoDates(): Promise<string[]> {
  const result = await commands.searchWorkspaceTitle('Voice Memos', 365)
  if (result.status !== 'ok') return []
  const dates = new Set<string>()
  for (const r of result.data) {
    const m = r.name.match(/^Voice Memos\s*[—-]\s*(\d{4}-\d{2}-\d{2})/)
    if (m) dates.add(m[1])
  }
  return Array.from(dates).sort().reverse()
}

export function AudioView() {
  const [isRecording, setIsRecording] = useState(false)
  const [timer, setTimer] = useState(0)
  const [selectedMic, setSelectedMic] = useState<string>('—')
  const scrollRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<number | null>(null)

  // History view state.
  const today = useMemo(() => todayIsoLocal(), [])
  const [selectedDate, setSelectedDate] = useState<string>(today)
  const [availableDates, setAvailableDates] = useState<string[]>([today])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<VoiceMemoBlock[]>([])
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [loading, setLoading] = useState(false)
  const [vaultDocMissing, setVaultDocMissing] = useState(false)

  // Playback state — single audio element shared across all blocks; only one
  // memo plays at a time. `playingPath` doubles as the per-row identity
  // (rows compare against this to render Play/Pause). `unavailablePaths`
  // remembers files that already failed to load so we don't keep retrying
  // and don't keep toasting the same error.
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playingPath, setPlayingPath] = useState<string | null>(null)
  const [loadingPath, setLoadingPath] = useState<string | null>(null)
  const [unavailablePaths, setUnavailablePaths] = useState<Set<string>>(() => new Set())
  const [playbackProgress, setPlaybackProgress] = useState<{ pct: number; current: number; duration: number }>({
    pct: 0,
    current: 0,
    duration: 0,
  })

  const isViewingToday = selectedDate === today

  // ── Data loaders ─────────────────────────────────────────────────────────

  const refreshAvailableDates = useCallback(async () => {
    const dates = await listAvailableVoiceMemoDates()
    // Always include today even if no doc yet — keeps "Today" selectable.
    if (!dates.includes(today)) dates.unshift(today)
    setAvailableDates(dates)
  }, [today])

  const loadDateBlocks = useCallback(async (dateIso: string) => {
    setLoading(true)
    setVaultDocMissing(false)
    try {
      const id = await findVoiceMemosDocId(dateIso)
      setSelectedNodeId(id)
      if (!id) {
        setBlocks([])
        return
      }
      const node = await commands.getNode(id)
      if (node.status !== 'ok' || !node.data) {
        setBlocks([])
        return
      }

      const parsed = parseAllVoiceMemoBlocks(node.data.body)
      setBlocks(parsed)

      // Reconciliation pass — runs ONLY on the just-loaded date's blocks.
      // Bounded cost: O(N) where N = blocks for one day (typically <50).
      // Per CLAUDE.md Rule 14, no startup scan — this is the lazy
      // detection point.
      const audioPaths = parsed
        .map((b) => b.audioPath)
        .filter((p): p is string => !!p)
      const vaultPath = node.data.vault_rel_path
        ? await resolveVaultAbsolutePath(node.data.vault_rel_path)
        : null
      const allChecks: string[] = [...audioPaths]
      if (vaultPath) allChecks.push(vaultPath)

      if (allChecks.length > 0) {
        const found = await pathsExist(allChecks)
        // Audio files: mark missing ones as unavailable so the UI shows
        // the AlertTriangle state proactively (before the user clicks).
        setUnavailablePaths((prev) => {
          const next = new Set(prev)
          for (const p of audioPaths) {
            if (!found.has(p)) next.add(p)
          }
          return next
        })
        // Vault doc: if the .md file is gone but DB still has the row,
        // surface it. The transcript shown is the cached body.
        if (vaultPath && !found.has(vaultPath)) {
          setVaultDocMissing(true)
        }
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Lifecycle ────────────────────────────────────────────────────────────

  // Timer.
  useEffect(() => {
    let interval: number | undefined
    if (isRecording) {
      interval = window.setInterval(() => setTimer((t) => t + 1), 1000)
    } else {
      setTimer(0)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isRecording])

  // Auto-scroll to bottom when blocks grow (live append + history load).
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [blocks.length])

  // Selected mic name.
  useEffect(() => {
    const load = async () => {
      const result = await commands.getSelectedMicrophone()
      if (result.status === 'ok') setSelectedMic(result.data || 'Default')
    }
    void load()
  }, [])

  // Initial load: dates + today's blocks.
  useEffect(() => {
    void (async () => {
      await refreshAvailableDates()
      await loadDateBlocks(today)
    })()
  }, [refreshAvailableDates, loadDateBlocks, today])

  // Reload blocks when the user picks a different date.
  useEffect(() => {
    void loadDateBlocks(selectedDate)
  }, [selectedDate, loadDateBlocks])

  // ── Event subscriptions ──────────────────────────────────────────────────

  useEffect(() => {
    const unlisteners: UnlistenFn[] = []

    const setup = async () => {
      // Live partial — re-parse the current doc body whenever Rust pushes
      // an update for the doc we're viewing. The throttling (~1s) is server
      // side, so this is cheap enough to do on every event.
      unlisteners.push(
        await listen<BodyUpdatedPayload>('workspace-node-body-updated', (event) => {
          if (!selectedNodeId || event.payload.node_id !== selectedNodeId) return
          setBlocks(parseAllVoiceMemoBlocks(event.payload.body))
        }),
      )

      // Final transcription synced — if today's doc just got a new memo and
      // we're viewing today, the body-updated event already refreshed the
      // blocks. We use this event mainly to pick up a *new* doc id (first
      // memo of the day creates today's doc) and to refresh the date list.
      unlisteners.push(
        await listen<TranscriptionSyncedPayload>('workspace-transcription-synced', async (event) => {
          if (event.payload.source !== 'voice_memo') return
          if (isViewingToday) {
            // Adopt the doc id if we didn't have one (first memo of the day).
            if (!selectedNodeId) setSelectedNodeId(event.payload.node_id)
            // Refresh blocks from the newly persisted state.
            await loadDateBlocks(today)
          }
          // Refresh date list — today may have just been created.
          await refreshAvailableDates()
        }),
      )

      unlisteners.push(
        await listen<RecordingErrorPayload>('recording-error', (event) => {
          const { error_type, detail } = event.payload
          if (error_type === 'microphone_permission_denied') {
            toast.error('Microphone permission denied', {
              description: 'Open Settings → Privacy to grant microphone access.',
            })
          } else if (error_type === 'no_input_device') {
            toast.error('No microphone detected', {
              description: 'Connect a microphone and try again.',
            })
          } else {
            toast.error('Recording failed', { description: detail ?? error_type })
          }
          setIsRecording(false)
          startRef.current = null
        }),
      )
    }

    void setup()
    return () => {
      for (const u of unlisteners) u()
    }
  }, [selectedNodeId, isViewingToday, today, loadDateBlocks, refreshAvailableDates])

  // ── Recording controls ───────────────────────────────────────────────────

  const startRecording = async () => {
    // Snap the view to today before recording so the new memo lands in the
    // user's current view rather than the historical date they were browsing.
    if (!isViewingToday) setSelectedDate(today)
    const result = await commands.startUiRecording()
    if (result.status !== 'ok') {
      toast.error('Could not start recording', { description: result.error })
      return
    }
    startRef.current = Date.now()
    setIsRecording(true)
  }

  const stopRecording = async () => {
    const result = await commands.stopUiRecording()
    if (result.status !== 'ok') {
      toast.error('Could not stop recording', { description: result.error })
      return
    }
    setIsRecording(false)
    startRef.current = null
    // After stop, refresh from disk so the final block (post-process etc.)
    // is reflected; transcription-synced will also fire and do this, but
    // belt-and-suspenders is cheap.
    if (isViewingToday) {
      await loadDateBlocks(today)
    }
  }

  const clearScreen = () => {
    // On-screen reset only — vault doc untouched. Useful if the user wants
    // to focus on what's incoming next.
    setBlocks([])
  }

  // ── Playback ─────────────────────────────────────────────────────────────

  const stopPlayback = useCallback(() => {
    const a = audioRef.current
    if (a) {
      a.pause()
      // Reset src so the asset URL can be GC'd and a fresh load happens next time.
      a.removeAttribute('src')
      a.load()
    }
    setPlayingPath(null)
    setLoadingPath(null)
    setPlaybackProgress({ pct: 0, current: 0, duration: 0 })
  }, [])

  const togglePlayback = useCallback(
    async (path: string | null) => {
      if (!path) return
      // Same path already playing → pause + stop.
      if (playingPath === path) {
        stopPlayback()
        return
      }
      // Different path → stop current, start new.
      stopPlayback()
      setLoadingPath(path)

      // Lazy-create the singleton audio element so AudioView can mount
      // without paying for an audio element every load.
      if (!audioRef.current) {
        const el = new Audio()
        el.preload = 'auto'
        audioRef.current = el
      }
      const a = audioRef.current

      // Wire one-shot listeners per load. They self-clean on the next
      // setSrc-and-load cycle because we replace src + call load().
      const onLoaded = () => {
        setLoadingPath((cur) => (cur === path ? null : cur))
        setPlayingPath(path)
        // Successful load — clear any stale "unavailable" mark so the
        // button stops showing AlertTriangle. Covers the retry-after-
        // user-restored-file case.
        setUnavailablePaths((prev) => {
          if (!prev.has(path)) return prev
          const next = new Set(prev)
          next.delete(path)
          return next
        })
        void a.play().catch((err) => {
          console.error('[AudioView] play() rejected:', err)
          handleAudioError(path, 'Playback was blocked by the browser.')
        })
      }
      const onTime = () => {
        if (!a.duration || !Number.isFinite(a.duration)) return
        setPlaybackProgress({
          pct: (a.currentTime / a.duration) * 100,
          current: a.currentTime,
          duration: a.duration,
        })
      }
      const onEnd = () => {
        setPlayingPath(null)
        setPlaybackProgress({ pct: 0, current: 0, duration: 0 })
      }
      const onErr = () => {
        handleAudioError(path, 'Audio file is missing or unreadable.')
      }

      a.onloadedmetadata = onLoaded
      a.ontimeupdate = onTime
      a.onended = onEnd
      a.onerror = onErr

      try {
        const url = convertFileSrc(path)
        a.src = url
        a.load()
      } catch (err) {
        console.error('[AudioView] convertFileSrc failed:', err)
        handleAudioError(path, 'Could not resolve the audio path.')
      }
    },
    [playingPath, stopPlayback],
  )

  const handleAudioError = useCallback(
    (path: string, message: string) => {
      setLoadingPath((cur) => (cur === path ? null : cur))
      setPlayingPath((cur) => (cur === path ? null : cur))
      setUnavailablePaths((prev) => {
        if (prev.has(path)) return prev
        const next = new Set(prev)
        next.add(path)
        // Toast only once per path so re-renders don't spam.
        toast.error('Cannot play voice memo', { description: message })
        return next
      })
    },
    [],
  )

  // Cleanup playback when the user navigates away from the page or unmounts.
  useEffect(() => {
    return () => {
      const a = audioRef.current
      if (a) {
        a.pause()
        a.onloadedmetadata = null
        a.ontimeupdate = null
        a.onended = null
        a.onerror = null
        a.removeAttribute('src')
      }
    }
  }, [])

  // Switching dates while audio is playing should stop playback — the audio
  // belongs to a memo on the previous day; continuing it would mislead.
  useEffect(() => {
    stopPlayback()
    setUnavailablePaths(new Set())
    // Only depends on selectedDate; stopPlayback identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate])

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', height: '100%', gap: 5 }}>
      {/* Transcript Column */}
      <section
        className="heros-glass-card"
        style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* Header */}
        <div
          style={{
            padding: '24px 32px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: isRecording ? '#ff4b3e' : 'rgba(255,255,255,0.1)',
                boxShadow: isRecording ? '0 0 16px rgba(255,75,62,0.7)' : 'none',
              }}
            />
            <span
              style={{
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: '#fff',
              }}
            >
              {isRecording ? 'Recording' : 'Idle'}
            </span>

            {/* Date selector */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowDatePicker((v) => !v)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.85)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                title="Choose another day's voice memos"
              >
                <Calendar size={12} />
                {isoToLabel(selectedDate)}
                <ChevronDown size={12} />
              </button>

              {showDatePicker && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    minWidth: 200,
                    maxHeight: 280,
                    overflowY: 'auto',
                    padding: 6,
                    borderRadius: 10,
                    background: 'rgba(20,21,26,0.95)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
                    zIndex: 100,
                  }}
                  onMouseLeave={() => setShowDatePicker(false)}
                >
                  {availableDates.length === 0 && (
                    <div style={{ padding: 10, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                      No voice memos yet.
                    </div>
                  )}
                  {availableDates.map((d) => {
                    const active = d === selectedDate
                    return (
                      <button
                        key={d}
                        onClick={() => {
                          setSelectedDate(d)
                          setShowDatePicker(false)
                        }}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 10px',
                          borderRadius: 6,
                          background: active ? 'rgba(204,76,43,0.15)' : 'transparent',
                          border: 'none',
                          color: active ? '#fff' : 'rgba(255,255,255,0.75)',
                          fontSize: 12,
                          fontWeight: active ? 600 : 500,
                          cursor: 'pointer',
                        }}
                      >
                        {isoToLabel(d)}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              fontFamily: 'monospace',
              fontSize: '24px',
              fontWeight: 300,
              color: '#fff',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatTime(timer)}
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <ScrollShadow containerRef={scrollRef} style={{ flex: 1, padding: '32px 32px 140px 32px' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 24,
                maxWidth: '800px',
                margin: '0 auto',
              }}
            >
              {vaultDocMissing && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: 'rgba(204,76,43,0.10)',
                    border: '1px solid rgba(204,76,43,0.25)',
                    color: 'rgba(255,210,200,0.9)',
                    fontSize: 12,
                    lineHeight: 1.5,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                  }}
                >
                  <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span>
                    The vault file for {isoToLabel(selectedDate)} was deleted from disk. The
                    transcript shown below is the last cached copy from the database.
                    Recording a new memo today will recreate the file.
                  </span>
                </div>
              )}

              {loading && (
                <p style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 64 }}>
                  Loading {isoToLabel(selectedDate)}…
                </p>
              )}

              {!loading && blocks.length === 0 && !isRecording && (
                <p style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 64 }}>
                  {isViewingToday
                    ? "No voice memos yet today. Press the mic button to start."
                    : `No voice memos for ${selectedDate}.`}
                </p>
              )}

              {blocks.map((block) => {
                const isPlaying = block.audioPath != null && playingPath === block.audioPath
                const isLoading = block.audioPath != null && loadingPath === block.audioPath
                const isUnavailable = block.audioPath != null && unavailablePaths.has(block.audioPath)
                const hasAudio = block.audioPath != null
                return (
                  <motion.div
                    key={`${selectedDate}-${block.index}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 20 }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                        paddingTop: 2,
                      }}
                    >
                      <PlayButton
                        hasAudio={hasAudio}
                        isPlaying={isPlaying}
                        isLoading={isLoading}
                        isUnavailable={isUnavailable}
                        onClick={() => void togglePlayback(block.audioPath)}
                      />
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '10px',
                          color: 'rgba(255,255,255,0.3)',
                        }}
                      >
                        {formatTimeOfDay(block.recordedAtMs)}
                      </span>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: '10px',
                          fontWeight: 800,
                          letterSpacing: '0.15em',
                          textTransform: 'uppercase',
                          color: 'rgba(255,255,255,0.4)',
                          marginBottom: 6,
                        }}
                      >
                        You
                      </div>
                      <div
                        style={{
                          fontSize: '16px',
                          lineHeight: 1.6,
                          fontWeight: 300,
                          color: 'rgba(255,255,255,0.85)',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {block.text}
                      </div>
                      {isPlaying && (
                        <div
                          style={{
                            marginTop: 10,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <div
                            style={{
                              flex: 1,
                              height: 3,
                              borderRadius: 2,
                              background: 'rgba(255,255,255,0.08)',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                width: `${playbackProgress.pct}%`,
                                background: 'var(--heros-brand)',
                                transition: 'width 0.15s linear',
                              }}
                            />
                          </div>
                          <span
                            style={{
                              fontFamily: 'monospace',
                              fontSize: 10,
                              color: 'rgba(255,255,255,0.5)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {formatPlaybackClock(playbackProgress.current, playbackProgress.duration)}
                          </span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )
              })}

              {isRecording && (
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
                    Listening…
                  </div>
                </motion.div>
              )}
            </div>
          </ScrollShadow>

          {/* Floating Controls */}
          <div
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
              onClick={() => void (isRecording ? stopRecording() : startRecording())}
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: isRecording ? 'var(--heros-brand)' : '#fff',
                color: isRecording ? '#fff' : '#7a2e1a',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: isRecording
                  ? '0 12px 40px rgba(204, 76, 43, 0.4)'
                  : '0 8px 32px rgba(0,0,0,0.25)',
                transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                transform: isRecording ? 'scale(1.1)' : 'scale(1)',
              }}
              className="hover-glow"
              aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            >
              {isRecording ? <Square size={24} fill="currentColor" /> : <Mic size={32} />}
            </button>

            <button
              className="icon-btn"
              onClick={clearScreen}
              style={{ padding: 12, background: 'rgba(255,255,255,0.03)' }}
              title="Clear visible transcript (does not delete the saved doc)"
            >
              <Trash2 size={20} />
            </button>
          </div>
        </div>
      </section>

      {/* Info Column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <section className="heros-glass-card" style={{ padding: '24px' }}>
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
            AI Insight
          </div>
          <div
            style={{
              padding: '16px',
              borderRadius: 12,
              background: 'rgba(204, 76, 43, 0.08)',
              border: '1px solid rgba(204, 76, 43, 0.18)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--heros-brand)',
                fontSize: '12px',
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              <Sparkles size={14} /> Coming in W6
            </div>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
              Live insights from the model land once AI chat is wired up.
            </p>
          </div>
        </section>

        <section className="heros-glass-card" style={{ padding: '24px', flex: 1 }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: 'rgba(255,255,255,0.5)',
              }}
            >
              <span>Microphone</span>
              <span style={{ color: '#fff' }}>{selectedMic}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: 'rgba(255,255,255,0.5)',
              }}
            >
              <span>Memos visible</span>
              <span style={{ color: '#fff' }}>{blocks.length}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: 'rgba(255,255,255,0.5)',
              }}
            >
              <span>Storage</span>
              <span
                style={{
                  color: 'var(--success, #fff)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Shield size={12} /> Local vault
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
