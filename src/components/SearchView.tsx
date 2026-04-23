import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Command, ArrowRight, Package, Shield, Activity, FileText, Database, Globe, Filter, Zap, ExternalLink, Copy, Target } from 'lucide-react';
import { HerOSInput } from './HerOS';
import { ScrollShadow } from './ScrollShadow';

export function SearchView() {
  const [query, setQuery] = useState('');
  const [activeScope, setActiveScope] = useState('all');
  
  const scopes = [
    { id: 'all', label: 'Global Search', icon: <Globe size={14} /> },
    { id: 'orders', label: 'Order Intel', icon: <Package size={14} /> },
    { id: 'security', label: 'Vault Assets', icon: <Shield size={14} /> },
    { id: 'activity', label: 'Neural Logs', icon: <Activity size={14} /> },
    { id: 'files', label: 'Evidence Shards', icon: <FileText size={14} /> },
  ];

  const results = [
    { id: 1, type: 'Order', title: 'iPhone 14 Pro Max - 256GB Deep Purple', snippet: 'Tracking confirmed for smith_ny. Delivered to carrier 2 hours ago. Total: $1,249.00', meta: 'eBay Global • 2h ago', score: '98% MATCH' },
    { id: 2, type: 'Evidence', title: 'photo_package_seal_01.jpg', snippet: 'High-res capture of tamper-proof seal. Metadata verified: 40.7128° N, 74.0060° W', meta: 'Vault Storage • 4h ago', score: '85% MATCH' },
    { id: 3, type: 'Log', title: 'Security Audit: Access Granted', snippet: 'Workspace decrypted via biometrics. Session active for user Howard.', meta: 'System Logs • 5h ago', score: '72% MATCH' },
    { id: 4, type: 'Vault', title: 'Encrypted Master Key: 0x82f...a92', snippet: 'Hardware security module (HSM) signature verified. Key rotation pending in 14 days.', meta: 'Security • 1d ago', score: '95% MATCH' },
  ].filter(r => r.title.toLowerCase().includes(query.toLowerCase()) || r.snippet.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="heros-page-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>
      
      {/* Search Hero Header */}
      <section style={{ padding: '60px 40px 40px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, flexShrink: 0 }}>
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ textAlign: 'center' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 12 }}>
            <div style={{ width: 48, height: 2, background: 'linear-gradient(to right, transparent, var(--heros-brand))', opacity: 0.5 }} />
            <span style={{ fontSize: '11px', color: 'var(--heros-brand)', fontWeight: 800, letterSpacing: '0.4em', textTransform: 'uppercase' }}>NEURAL CORE SEARCH</span>
            <div style={{ width: 48, height: 2, background: 'linear-gradient(to left, transparent, var(--heros-brand))', opacity: 0.5 }} />
          </div>
          <h1 style={{ fontSize: '42px', fontWeight: 200, margin: 0, letterSpacing: '-0.04em', color: '#fff' }}>
            Surface <span style={{ color: 'var(--heros-brand)', fontWeight: 400 }}>Intelligence</span>
          </h1>
        </motion.div>

        <div className="heros-search-hero" style={{ position: 'relative' }}>
          <div style={{ 
            position: 'absolute', inset: '-2px', background: 'linear-gradient(135deg, var(--heros-brand), transparent 40%)', 
            borderRadius: '20px', opacity: 0.2, filter: 'blur(8px)', zIndex: -1 
          }} />
          <HerOSInput 
            placeholder="Search across all orders, vault keys, and neural logs..." 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="heros-search-field"
            icon={<Search size={22} color="var(--heros-brand)" />}
          />
          <div style={{ position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 6 }}>
            <span style={{ fontSize: '10px', padding: '4px 8px', background: 'rgba(255,255,255,0.08)', borderRadius: 6, color: 'rgba(255,255,255,0.4)', fontWeight: 700 }}>⌘</span>
            <span style={{ fontSize: '10px', padding: '4px 8px', background: 'rgba(255,255,255,0.08)', borderRadius: 6, color: 'rgba(255,255,255,0.4)', fontWeight: 700 }}>K</span>
          </div>
        </div>
      </section>

      {/* Balanced 3-Column Results Area */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '220px 1fr 220px', 
        gap: '48px', 
        flex: 1, 
        overflow: 'hidden',
        padding: '0 40px'
      }}>
        
        {/* Left Sidebar - Filters & Scopes */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          <div>
            <div style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Filter size={12} /> Filter Scope
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {scopes.map(s => (
                <button 
                  key={s.id} 
                  onClick={() => setActiveScope(s.id)}
                  style={{ 
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12,
                    background: activeScope === s.id ? 'rgba(204, 76, 43, 0.1)' : 'transparent',
                    border: '1px solid',
                    borderColor: activeScope === s.id ? 'rgba(204, 76, 43, 0.2)' : 'transparent',
                    color: activeScope === s.id ? 'var(--heros-brand)' : 'rgba(255,255,255,0.4)', 
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                    textAlign: 'left'
                  }}
                  className="hover-bg"
                >
                  <span style={{ opacity: activeScope === s.id ? 1 : 0.5 }}>{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: '20px', borderRadius: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#fff', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={14} color="var(--heros-brand)" /> Neural Engine
            </div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 }}>
              Latency: 12ms<br/>
              Matches: {results.length}<br/>
              Nodes Active: 4
            </div>
          </div>
        </aside>

        {/* Center Content Area - Intelligence Shards */}
        <main className="custom-scrollbar" style={{ overflowY: 'auto', height: '100%', paddingRight: '12px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '800px', margin: '0 auto', paddingBottom: '100px' }}>
            <AnimatePresence mode="popLayout">
              {results.length === 0 ? (
                <motion.div 
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  style={{ padding: '100px 0', textAlign: 'center', color: 'rgba(255,255,255,0.2)' }}
                >
                  <Search size={64} style={{ marginBottom: 24, opacity: 0.05 }} />
                  <p style={{ fontSize: '16px', fontWeight: 500 }}>No neural matches found for "{query}"</p>
                  <p style={{ fontSize: '13px', opacity: 0.5, marginTop: 8 }}>Try broadening your search scope or keywords.</p>
                </motion.div>
              ) : (
                results.map((r, i) => (
                  <motion.div
                    key={r.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: i * 0.04 }}
                    style={{ 
                      display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 20,
                      padding: '20px', borderRadius: '20px', background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      position: 'relative', overflow: 'hidden'
                    }}
                    className="heros-glass-card hover-glow"
                  >
                    {/* Icon Housing */}
                    <div style={{ 
                      width: 64, height: 64, borderRadius: 16, background: 'rgba(255,255,255,0.03)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                      border: '1px solid rgba(255,255,255,0.05)'
                    }}>
                      {r.type === 'Order' && <Package size={28} style={{ opacity: 0.8 }} />}
                      {r.type === 'Evidence' && <FileText size={28} style={{ opacity: 0.8 }} />}
                      {r.type === 'Log' && <Activity size={28} style={{ opacity: 0.8 }} />}
                      {r.type === 'Vault' && <Shield size={28} style={{ opacity: 0.8 }} />}
                    </div>

                    {/* Content Body */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.6 }}>{r.type}</span>
                        <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.2)' }} />
                        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>{r.meta}</span>
                      </div>
                      <div style={{ fontSize: '17px', fontWeight: 700, color: '#fff', marginBottom: 6, letterSpacing: '-0.01em' }}>{r.title}</div>
                      <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>{r.snippet}</div>
                    </div>

                    {/* Relevance & Actions */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                      <div style={{ 
                        fontSize: '10px', fontWeight: 800, color: 'var(--heros-brand)', fontFamily: 'monospace',
                        padding: '6px 12px', borderRadius: 8, background: 'rgba(204, 76, 43, 0.1)', 
                        border: '1px solid rgba(204, 76, 43, 0.2)', display: 'flex', alignItems: 'center', gap: 6
                      }}>
                        <Target size={10} /> {r.score}
                      </div>
                      
                      <div style={{ display: 'flex', gap: 8 }} className="result-actions">
                        <button style={{ 
                          width: 32, height: 32, borderRadius: 10, background: 'rgba(255,255,255,0.05)', 
                          border: '1px solid rgba(255,255,255,0.1)', color: '#fff', display: 'flex', 
                          alignItems: 'center', justifyContent: 'center', cursor: 'pointer' 
                        }}>
                          <ExternalLink size={14} />
                        </button>
                        <button style={{ 
                          width: 32, height: 32, borderRadius: 10, background: 'rgba(255,255,255,0.05)', 
                          border: '1px solid rgba(255,255,255,0.1)', color: '#fff', display: 'flex', 
                          alignItems: 'center', justifyContent: 'center', cursor: 'pointer' 
                        }}>
                          <Copy size={14} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </main>

        {/* Right Sidebar - Ghost Spacer to balance centering */}
        <aside style={{ width: '220px' }} />
      </div>
    </div>
  );
}
