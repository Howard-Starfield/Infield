import React from 'react';
import { Info, Shield, Zap, Globe, Cpu, Lock, Terminal, Database } from 'lucide-react';
import { motion } from 'framer-motion';

export function AboutView() {
  const specs = [
    { label: 'Version', value: 'v2.4.0-stable' },
    { label: 'Build', value: '2026.04.22.01' },
    { label: 'Engine', value: 'Rust / Tauri 2.0' },
    { label: 'LLM', value: 'Claude 3.5 Sonnet' },
    { label: 'Storage', value: 'SQLite / AES-256' }
  ];

  return (
    <div className="heros-page-container" style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto' }}>
      <header style={{ marginBottom: '48px', textAlign: 'center' }}>
        <div style={{ 
          width: 80, height: 80, borderRadius: 24, 
          background: 'linear-gradient(135deg, var(--heros-brand) 0%, #ff8566 100%)',
          margin: '0 auto 24px auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 12px 32px rgba(204, 76, 43, 0.3)'
        }}>
          <Shield size={40} color="#fff" />
        </div>
        <h1 style={{ fontSize: '32px', fontWeight: 800, color: '#fff', marginBottom: '8px' }}>Infield Sovereign</h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '16px' }}>Private Neural Intelligence & Data Sovereignty Engine</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
        
        {/* System Status */}
        <section className="heros-glass-card" style={{ padding: '32px' }}>
          <h2 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Terminal size={18} /> System Specifications
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {specs.map(spec => (
              <div key={spec.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 12 }}>
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>{spec.label}</span>
                <span style={{ fontSize: '13px', color: '#fff', fontWeight: 600, fontFamily: 'monospace' }}>{spec.value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Security / Core */}
        <section className="heros-glass-card" style={{ padding: '32px' }}>
          <h2 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Lock size={18} /> Security Core
          </h2>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, marginBottom: 24 }}>
            Infield utilizes a zero-trust architecture. Your vault is encrypted locally using AES-256-GCM. 
            No unencrypted data ever leaves your machine. 
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ padding: '16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <Zap size={16} color="var(--heros-brand)" style={{ marginBottom: 8 }} />
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#fff' }}>Local Neural</div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>On-device embeddings</div>
            </div>
            <div style={{ padding: '16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <Database size={16} color="var(--heros-brand)" style={{ marginBottom: 8 }} />
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#fff' }}>Offline First</div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>Full capability without web</div>
            </div>
          </div>
        </section>

      </div>

      <footer style={{ marginTop: '48px', textAlign: 'center', display: 'flex', justifyContent: 'center', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>
          <Globe size={14} /> infield.ai
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>
          <Globe size={14} /> github.com/infield
        </div>
      </footer>
    </div>
  );
}
