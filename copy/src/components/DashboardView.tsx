import React, { useState } from 'react';
import { 
  Plus, Paperclip, Mic, Send, ChevronLeft, ChevronRight, 
  FileText, Database, User, MoreHorizontal, Info, Star, LayoutDashboard
} from 'lucide-react';
import { motion } from 'framer-motion';
import { ScrollShadow } from './ScrollShadow';

interface DashboardProps {
  onNavigate: (page: string) => void;
}

export function DashboardView({ onNavigate }: DashboardProps) {
  const [isDualView, setIsDualView] = useState(false);
  
  // Mock Messages
  const messages = [
    { 
      role: 'user', 
      content: 'What was the conclusion I wrote up on the Helix rollout last quarter? Pull anything from retro notes and the engineering DB.',
      sender: 'AR'
    },
    { 
      role: 'assistant', 
      content: 'Your Helix Q3 retro landed on three decisions: (1) freeze schema changes for 6 weeks while telemetry stabilizes, (2) move release gates behind canary.pct ≥ 25, and (3) redirect the platform team\'s next two sprints to customer-reported latency.',
      sources: [
        { label: 'Q3 Retro · doc', icon: <FileText size={12} /> },
        { label: 'Engineering / Releases · row #248', icon: <Database size={12} /> },
        { label: '1.1 · Maya · Oct 12', icon: <User size={12} /> }
      ]
    }
  ];

  const ChatWindow = ({ index }: { index: number }) => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', borderLeft: index > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
      {/* Message Thread */}
      <ScrollShadow style={{ flex: 1, padding: '32px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {messages.map((msg, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              style={{ 
                display: 'flex', 
                gap: 16, 
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                alignItems: 'flex-start'
              }}
            >
              {/* Avatar */}
              <div style={{ 
                width: 32, height: 32, borderRadius: '50%', 
                background: msg.role === 'user' ? 'rgba(204, 76, 43, 0.4)' : 'rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: 800, color: '#fff', flexShrink: 0,
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                {msg.sender || 'AI'}
              </div>

              {/* Bubble */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: '85%' }}>
                <div style={{ 
                  padding: '16px 20px', 
                  borderRadius: 20,
                  fontSize: '14px',
                  lineHeight: 1.6,
                  background: msg.role === 'user' ? 'rgba(204, 76, 43, 0.25)' : 'rgba(255,255,255,0.06)',
                  color: 'rgba(255,255,255,0.9)',
                  border: msg.role === 'user' ? '1px solid rgba(204, 76, 43, 0.3)' : '1px solid rgba(255,255,255,0.05)',
                }}>
                  {msg.content}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </ScrollShadow>

      {/* Input Area (Refined) */}
      <footer style={{ padding: '0 24px 24px 24px' }}>
        <div style={{ 
          background: 'rgba(0,0,0,0.2)', 
          border: '1px solid rgba(255,255,255,0.08)', 
          borderRadius: 24, 
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input 
              placeholder={index === 0 ? "Ask anything — the vault is in scope..." : "Start a parallel thread..."}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: '15px', padding: '8px 4px' }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="icon-btn" style={{ padding: 8 }}><Paperclip size={20} style={{ opacity: 0.5 }} /></button>
              <button className="icon-btn" style={{ padding: 8 }}><Mic size={20} style={{ opacity: 0.5 }} /></button>
              <button className="heros-btn-brand" style={{ width: 40, height: 40, borderRadius: 12, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Send size={18} />
              </button>
            </div>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(204, 76, 43, 0.15)', border: '1px solid rgba(204, 76, 43, 0.3)', color: '#fff', fontSize: '11px', fontWeight: 600 }}>@ Whole vault</div>
              <div style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontSize: '11px', fontWeight: 600 }}>#retro</div>
              <div style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontSize: '11px', fontWeight: 600 }}>+ scope</div>
            </div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>
              ⌘ enter send
            </div>
          </div>
        </div>
      </footer>
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '5px', height: '100%', padding: '0 5px 5px 0' }}>
      
      {/* --- MAIN CHAT AREA --- */}
      <section className="heros-glass-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'rgba(0,0,0,0.1)' }}>
        
        {/* Chat Header */}
        <header style={{ padding: '24px 32px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg, #fff 0%, #eee 100%)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }} />
            <div>
              <h1 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: '#fff' }}>Infield</h1>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', gap: 8 }}>
                Indexed 1,204 notes · 18 databases · {isDualView ? 'Dual View Active' : 'claude-3.5-sonnet'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: 20, fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.6)' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} /> Vault unlocked
            </div>
            <button 
              className={isDualView ? "heros-btn" : "heros-btn-brand"} 
              style={{ padding: '8px 16px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', fontWeight: 700 }}
              onClick={() => setIsDualView(!isDualView)}
            >
              {isDualView ? <MoreHorizontal size={16} /> : <Plus size={16} />} 
              {isDualView ? 'Single View' : 'New Thread'}
            </button>
          </div>
        </header>

        {/* Parallel Chat Windows */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: isDualView ? '1fr 1fr' : '1fr', overflow: 'hidden' }}>
          <ChatWindow index={0} />
          {isDualView && <ChatWindow index={1} />}
        </div>
      </section>

      {/* --- RIGHT SIDEBAR --- */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: '5px', overflow: 'hidden' }}>
        
        {/* Calendar Card */}
        <section className="heros-glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Today · Mon, Apr 20</span>
            <div style={{ display: 'flex', gap: 12 }}>
              <ChevronLeft size={14} style={{ opacity: 0.5 }} />
              <ChevronRight size={14} style={{ opacity: 0.5 }} />
            </div>
          </div>

          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#fff', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              April 2026
              <span style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(204, 76, 43, 0.2)', color: 'var(--heros-brand)', fontSize: '10px', fontWeight: 800 }}>Today</span>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, textAlign: 'center' }}>
              {['S','M','T','W','T','F','S'].map(d => <div key={d} style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.2)', paddingBottom: 8 }}>{d}</div>)}
              {[29,30,31,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,1,2].map((d, i) => (
                <div key={i} style={{ 
                  fontSize: '12px', fontWeight: d === 20 ? 800 : 500, color: d === 20 ? '#000' : 'rgba(255,255,255,0.4)',
                  width: 32, height: 32, borderRadius: '50%', margin: '0 auto',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: d === 20 ? '#fff' : 'transparent',
                  position: 'relative'
                }}>
                  {d}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { time: '09:30', title: 'Helix weekly — bugfix triage' },
              { time: '11:00', title: '1:1 with Rei — recording' },
              { time: '15:00', title: 'Focus: Q2 roadmap writeup' }
            ].map((ev, i) => (
              <div key={i} style={{ padding: '12px 16px', borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 16 }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', opacity: 0.8 }}>{ev.time}</span>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>{ev.title}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Activity Heatmap Card */}
        <section className="heros-glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Activity · Last 14 days</span>
            <div style={{ padding: '4px 8px', borderRadius: 6, background: 'rgba(204, 76, 43, 0.1)', color: 'var(--heros-brand)', fontSize: '10px', fontWeight: 800 }}>9d streak</div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Array.from({ length: 28 }).map((_, i) => (
              <div key={i} style={{ 
                width: 18, height: 18, borderRadius: 4, 
                background: [2, 5, 8, 12, 18, 22, 25, 27].includes(i) ? 'rgba(204, 76, 43, 0.8)' : 'rgba(255,255,255,0.05)',
              }} />
            ))}
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 8 }}>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>127</div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>Edits</div>
            </div>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>14</div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>Created</div>
            </div>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>3.7h</div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>Focus</div>
            </div>
          </div>
        </section>

        {/* Recents Card */}
        <section className="heros-glass-card" style={{ padding: '16px 24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Recents</span>
            <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--heros-brand)', cursor: 'pointer' }}>See all</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              { label: 'Strategic Ops 2024', sub: '2h ago' },
              { label: 'Helix Q3 Retro', sub: '4h ago' },
              { label: 'Engineering DB', sub: 'Yesterday' }
            ].map((item, i) => (
              <div key={i} style={{ padding: '8px 12px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }} className="hover-bg">
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FileText size={14} style={{ opacity: 0.5 }} />
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{item.label}</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>{item.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

      </aside>
    </div>
  );
}
