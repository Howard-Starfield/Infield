import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Headphones, Square, Sparkles, Trash2, Download, Volume2 } from 'lucide-react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { commands } from '../bindings'
import { ScrollShadow } from './ScrollShadow'

interface Line {
  id: string
  ts: string
  speaker: 'System Audio'
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

const formatTime = (s: number) => {
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/**
 * Mirror of AudioView's transcript extractor — system_audio uses the same
 * `::voice_memo_recording{...}` directive when appending to a workspace doc
 * (per the existing transcription_workspace pipeline; the directive name is
 * shared because the storage shape is identical, only the source tag differs).
 */
function extractLatestTranscript(body: string): string {
  const marker = '::voice_memo_recording'
  const idx = body.lastIndexOf(marker)
  if (idx === -1) return ''
  const closeIdx = body.indexOf('}', idx)
  if (closeIdx === -1) return ''
  return body.slice(closeIdx + 1).trimStart()
}

export function SystemAudioView() {
  const [isCapturing, setIsCapturing] = useState(false)
  const [timer, setTimer] = useState(0)
  const [transcript, setTranscript] = useState<Line[]>([])
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [renderDevice, setRenderDevice] = useState<string>('—')
  const scrollRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<number | null>(null)

  // Poll capturing state on mount (capture persists across React tab changes).
  useEffect(() => {
    const init = async () => {
      const result = await commands.isSystemAudioCapturing()
      if (result.status === 'ok' && result.data) {
        setIsCapturing(true)
        const elapsed = await commands.getSystemAudioCaptureElapsedSecs()
        if (elapsed.status === 'ok' && elapsed.data != null) {
          setTimer(Math.floor(elapsed.data))
          startRef.current = Date.now() - elapsed.data * 1000
        }
      }
    }
    void init()
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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
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
    const unlisteners: UnlistenFn[] = []

    const setup = async () => {
      unlisteners.push(
        await listen<BodyUpdatedPayload>('workspace-node-body-updated', (event) => {
          const { node_id, body } = event.payload
          // Only render when we know this node is our system-audio session.
          if (!activeNodeId || node_id !== activeNodeId) return
          const text = extractLatestTranscript(body)
          if (!text) return
          setTranscript((prev) => {
            const next = prev.filter((l) => l.id !== `live-${node_id}`)
            next.push({
              id: `live-${node_id}`,
              ts: startRef.current
                ? formatTime(Math.floor((Date.now() - startRef.current) / 1000))
                : '00:00',
              speaker: 'System Audio',
              text,
            })
            return next
          })
        }),
      )

      unlisteners.push(
        await listen<TranscriptionSyncedPayload>('workspace-transcription-synced', (event) => {
          // This view only cares about the system_audio source.
          if (event.payload.source !== 'system_audio') return
          setActiveNodeId(event.payload.node_id)
          setTranscript((prev) =>
            prev.map((l) =>
              l.id === `live-${event.payload.node_id}`
                ? { ...l, id: `final-${Date.now()}` }
                : l,
            ),
          )
        }),
      )
    }

    void setup()
    return () => {
      for (const u of unlisteners) u()
    }
  }, [activeNodeId])

  const startCapture = async () => {
    // Clear previous session's transcript so each new capture starts fresh.
    // Stop deliberately leaves the transcript on screen for review (per UX
    // ask): clearing happens here, on Start, only.
    setTranscript([])
    setActiveNodeId(null)

    const result = await commands.startSystemAudioCapture()
    if (result.status !== 'ok') {
      toast.error('Could not start system audio capture', { description: result.error })
      return
    }
    startRef.current = Date.now()
    setIsCapturing(true)
  }

  const stopCapture = async () => {
    const result = await commands.stopSystemAudioCapture()
    if (result.status !== 'ok') {
      toast.error('Could not stop system audio capture', { description: result.error })
      return
    }
    setIsCapturing(false)
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
                background: isCapturing ? '#3eb8ff' : 'rgba(255,255,255,0.1)',
                boxShadow: isCapturing ? '0 0 16px rgba(62,184,255,0.7)' : 'none',
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
              {isCapturing ? 'Capturing system audio' : 'Idle'}
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
              {transcript.length === 0 && !isCapturing && (
                <p style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 64 }}>
                  Press the headphones button to capture system audio. Transcripts append to
                  today's System Audio doc.
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
                        color: 'rgba(62,184,255,0.6)',
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
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: isCapturing ? '#3eb8ff' : '#fff',
                color: isCapturing ? '#fff' : '#1a4f6b',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: isCapturing
                  ? '0 12px 40px rgba(62,184,255,0.4)'
                  : '0 8px 32px rgba(0,0,0,0.25)',
                transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                transform: isCapturing ? 'scale(1.1)' : 'scale(1)',
              }}
              className="hover-glow"
              aria-label={isCapturing ? 'Stop system audio capture' : 'Start system audio capture'}
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
              background: 'rgba(62,184,255,0.08)',
              border: '1px solid rgba(62,184,255,0.18)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: '#3eb8ff',
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
                  color: 'rgba(62,184,255,0.9)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Volume2 size={12} /> WASAPI loopback
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
