import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Mic, Square, Sparkles, Trash2, Download, Shield } from 'lucide-react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { commands } from '../bindings'
import { ScrollShadow } from './ScrollShadow'

interface Line {
  id: string
  ts: string
  speaker: 'You' | 'System'
  text: string
}

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

const formatTime = (s: number) => {
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/**
 * Pull the latest voice-memo block from a workspace doc body. The Rust side
 * appends `::voice_memo_recording{...}\n<transcript>` per Rule 9; we surface
 * just the transcript text after the most recent directive line.
 */
function extractLatestTranscript(body: string): string {
  const marker = '::voice_memo_recording'
  const idx = body.lastIndexOf(marker)
  if (idx === -1) return ''
  // Skip past the directive line ({...} closing brace + newline).
  const closeIdx = body.indexOf('}', idx)
  if (closeIdx === -1) return ''
  return body.slice(closeIdx + 1).trimStart()
}

export function AudioView() {
  const [isRecording, setIsRecording] = useState(false)
  const [timer, setTimer] = useState(0)
  const [transcript, setTranscript] = useState<Line[]>([])
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [selectedMic, setSelectedMic] = useState<string>('—')
  const scrollRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<number | null>(null)

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

  // Auto-scroll to bottom on new lines.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [transcript])

  // Load selected mic name once.
  useEffect(() => {
    const load = async () => {
      const result = await commands.getSelectedMicrophone()
      if (result.status === 'ok') setSelectedMic(result.data || 'Default')
    }
    void load()
  }, [])

  // Subscribe to Tauri events for the lifetime of the component.
  useEffect(() => {
    const unlisteners: UnlistenFn[] = []

    const setup = async () => {
      unlisteners.push(
        await listen<BodyUpdatedPayload>('workspace-node-body-updated', (event) => {
          const { node_id, body } = event.payload
          if (activeNodeId && node_id !== activeNodeId) return
          if (!activeNodeId) setActiveNodeId(node_id)
          const text = extractLatestTranscript(body)
          if (!text) return
          setTranscript((prev) => {
            // Replace the live partial line if last is partial-from-this-node, else append.
            const next = prev.filter((l) => l.id !== `live-${node_id}`)
            next.push({
              id: `live-${node_id}`,
              ts: startRef.current
                ? formatTime(Math.floor((Date.now() - startRef.current) / 1000))
                : '00:00',
              speaker: 'You',
              text,
            })
            return next
          })
        }),
      )

      unlisteners.push(
        await listen<TranscriptionSyncedPayload>('workspace-transcription-synced', (event) => {
          if (event.payload.source !== 'voice_memo') return
          setActiveNodeId(event.payload.node_id)
          // Lock in the live partial as a final entry by stripping the live- prefix.
          setTranscript((prev) =>
            prev.map((l) =>
              l.id === `live-${event.payload.node_id}`
                ? { ...l, id: `final-${Date.now()}` }
                : l,
            ),
          )
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
  }, [activeNodeId])

  const startRecording = async () => {
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
  }

  const clearTranscript = () => {
    setTranscript([])
    setActiveNodeId(null)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', height: '100%', gap: 5 }}>
      {/* Transcript Column */}
      <section
        className="heros-glass-card"
        style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div
          style={{
            padding: '24px 32px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
              {transcript.length === 0 && !isRecording && (
                <p style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 64 }}>
                  Press the mic button to start recording. Transcripts append to today's
                  Voice Memos doc.
                </p>
              )}
              {transcript.map((line) => (
                <motion.div
                  key={line.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
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
                      {line.speaker}
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
              ))}

              {isRecording && transcript.length === 0 && (
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
