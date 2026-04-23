import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Square, Play, Pause, Brain, Sparkles, Clock, Volume2, Settings, Download, Trash2, Shield } from 'lucide-react';
import { ScrollShadow } from './ScrollShadow';

export function AudioView() {
  const [isRecording, setIsRecording] = useState(false);
  const [timer, setTimer] = useState(0);
  
  useEffect(() => {
    let interval: number | undefined;
    if (isRecording) {
      interval = window.setInterval(() => {
        setTimer(t => t + 1);
      }, 1000);
    } else {
      setTimer(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const [transcript, setTranscript] = useState([
    { ts: '00:04', speaker: 'System', text: 'Neural Synchronizer active. Buffering audio stream...' },
    { ts: '00:08', speaker: 'Howard', text: 'Okay, I need to document the package condition for Order #1233556.' },
    { ts: '00:12', speaker: 'Howard', text: 'The outer box shows some compression on the left corner, but the tamper-proof seal is fully intact.' },
    { ts: '00:18', speaker: 'Neural Engine', text: 'Pattern detected: Logistic compression evidence noted. Tagging "High Priority Audit".', type: 'ai' },
    { ts: '00:24', speaker: 'Howard', text: 'Great. Let\'s also record the serial number from the inner casing...' },
  ]);

  const scrollRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript]);

  useEffect(() => {
    if (!isRecording) return;

    const mockMessages = [
      "I'm seeing a slight scratch on the secondary lens, but it doesn't seem to affect clarity.",
      "Neural Engine: Surface analysis complete. Scratch depth < 0.2mm. Non-critical.",
      "Updating vault entry with high-resolution diagnostic logs.",
      "Finalizing evidence package for encrypted archival.",
      "Ready for next sync cycle."
    ];

    let messageIndex = 0;
    const interval = window.setInterval(() => {
      if (messageIndex >= mockMessages.length) return;
      
      const isAI = mockMessages[messageIndex].startsWith("Neural Engine:");
      setTranscript(prev => [
        ...prev,
        {
          ts: formatTime(timer + (messageIndex + 1) * 3),
          speaker: isAI ? 'Neural Engine' : 'Howard',
          text: mockMessages[messageIndex].replace("Neural Engine: ", ""),
          type: isAI ? 'ai' : undefined
        } as any
      ]);
      messageIndex++;
    }, 4000);

    return () => clearInterval(interval);
  }, [isRecording]);

  const BARS = 48;
  const [waveHeights, setWaveHeights] = useState<number[]>(Array(BARS).fill(6));
  const [wavePhase, setWavePhase] = useState(0);

  useEffect(() => {
    if (!isRecording) {
      setWaveHeights(Array(BARS).fill(6));
      return;
    }

    const interval = window.setInterval(() => {
      setWavePhase(prev => prev + 0.3);
      setWaveHeights(prev => prev.map((_, i) => {
        const base = Math.sin(i * 0.4 + (wavePhase + 0.3)) * 0.5 + 0.5;
        const noise = Math.random() * 0.6;
        return 6 + Math.max(4, (base * 0.5 + noise * 0.5) * 44);
      }));
    }, 60);

    return () => clearInterval(interval);
  }, [isRecording, wavePhase]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', height: '100%', gap: 5 }}>
      {/* Transcript Column */}
      <section className="heros-glass-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '24px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ 
              width: 12, height: 12, borderRadius: '50%', 
              background: isRecording ? '#ff4b3e' : 'rgba(255,255,255,0.1)',
              boxShadow: isRecording ? '0 0 16px rgba(255,75,62,0.7)' : 'none',
            }} />
            <span style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#fff' }}>
              {isRecording ? 'Neural Intelligence Recording' : 'Intelligence Vault Idle'}
            </span>
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: '24px', fontWeight: 300, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(timer)}
          </div>
        </div>

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <ScrollShadow containerRef={scrollRef} style={{ flex: 1, padding: '32px 32px 140px 32px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: '800px', margin: '0 auto' }}>
              {transcript.map((line, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 20 }}
                >
                  <div style={{ fontFamily: 'monospace', fontSize: '11px', color: 'rgba(255,255,255,0.3)', paddingTop: 4 }}>{line.ts}</div>
                  <div>
                    <div style={{ 
                      fontSize: '10px', fontWeight: 800, letterSpacing: '0.15em', 
                      textTransform: 'uppercase', color: line.type === 'ai' ? 'var(--heros-brand)' : 'rgba(255,255,255,0.4)',
                      marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6
                    }}>
                      {line.type === 'ai' && <Brain size={12} />} {line.speaker}
                    </div>
                    <div style={{ 
                      fontSize: '16px', lineHeight: 1.6, fontWeight: 300,
                      color: line.type === 'ai' ? '#fff' : 'rgba(255,255,255,0.8)',
                      fontStyle: line.type === 'ai' ? 'italic' : 'normal'
                    }}>
                      {line.text}
                    </div>
                  </div>
                </motion.div>
              ))}
              
              {isRecording && (
                <motion.div
                  animate={{ opacity: [0.3, 0.7, 0.3] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 20 }}
                >
                  <div style={{ fontFamily: 'monospace', fontSize: '11px', color: 'rgba(255,255,255,0.3)', paddingTop: 4 }}>{formatTime(timer)}</div>
                  <div style={{ fontSize: '16px', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
                    Processing neural stream...
                  </div>
                </motion.div>
              )}
            </div>
          </ScrollShadow>

          {/* Floating Controls Bar (Centered) */}
          <div style={{ 
            position: 'absolute', 
            bottom: '32px', 
            left: '50%', 
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            zIndex: 10
          }}>
            {/* Wave Visualizer */}
            <div style={{ 
              width: '400px', 
              height: '40px', 
              display: 'flex', 
              alignItems: 'center', 
              gap: 3, 
              justifyContent: 'center',
              padding: '0 20px',
              background: 'rgba(0,0,0,0.2)',
              backdropFilter: 'blur(10px)',
              borderRadius: '20px',
              border: '1px solid rgba(255,255,255,0.05)'
            }}>
              {waveHeights.slice(0, 32).map((h, i) => (
                <div
                  key={i}
                  style={{ 
                    flex: 1, 
                    maxWidth: 3, 
                    height: h * 0.6, 
                    background: isRecording ? 'var(--heros-brand)' : 'rgba(255,255,255,0.1)', 
                    borderRadius: 2,
                    transition: 'height 0.1s ease-out'
                  }}
                />
              ))}
            </div>

            {/* Main Record Button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              <button className="icon-btn" style={{ padding: 12, background: 'rgba(255,255,255,0.03)' }}><Download size={20} /></button>
              
              <button 
                onClick={() => setIsRecording(!isRecording)}
                style={{ 
                  width: 80, height: 80, borderRadius: '50%', 
                  background: isRecording ? 'var(--heros-brand)' : '#fff',
                  color: isRecording ? '#fff' : '#7a2e1a',
                  border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: isRecording ? '0 12px 40px rgba(204, 76, 43, 0.4)' : '0 8px 32px rgba(0,0,0,0.25)', 
                  transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  transform: isRecording ? 'scale(1.1)' : 'scale(1)'
                }}
                className="hover-glow"
              >
                {isRecording ? <Square size={24} fill="currentColor" /> : <Mic size={32} />}
              </button>

              <button className="icon-btn" style={{ padding: 12, background: 'rgba(255,255,255,0.03)' }}><Trash2 size={20} /></button>
            </div>
          </div>
        </div>
      </section>

      {/* Info Column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <section className="heros-glass-card" style={{ padding: '24px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 16 }}>
            Intelligence Summary
          </div>
          <div style={{ padding: '16px', borderRadius: 12, background: 'rgba(204, 76, 43, 0.1)', border: '1px solid rgba(204, 76, 43, 0.2)', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--heros-brand)', fontSize: '12px', fontWeight: 700, marginBottom: 8 }}>
              <Sparkles size={14} /> AI Insight
            </div>
            <p style={{ fontSize: '13px', color: '#fff', lineHeight: 1.6, fontWeight: 400 }}>
              User is documenting a potential dispute case. Logistic anomalies detected in the description of Order #1233556.
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['Logistics', 'Order #1233556', 'Package Condition'].map(tag => (
              <span key={tag} style={{ fontSize: '10px', padding: '4px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>
                {tag}
              </span>
            ))}
          </div>
        </section>

        <section className="heros-glass-card" style={{ padding: '24px', flex: 1 }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 16 }}>
            Device Diagnostics
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
              <span>Microphone:</span>
              <span style={{ color: '#fff' }}>Default Input</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
              <span>Sample Rate:</span>
              <span style={{ color: '#fff' }}>48kHz / 24-bit</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
              <span>Encryption:</span>
              <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4 }}><Shield size={12} /> End-to-End</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
