import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Command, ArrowRight, Package, Shield, Activity, FileText, Database, Globe } from 'lucide-react';
import { HerOSInput } from './HerOS';
import { ScrollShadow } from './ScrollShadow';

export function SearchView() {
  const [query, setQuery] = useState('');
  
  const scopes = [
    { id: 'all', label: 'All Assets', icon: <Globe size={14} /> },
    { id: 'orders', label: 'Orders', icon: <Package size={14} /> },
    { id: 'security', label: 'Vault', icon: <Shield size={14} /> },
    { id: 'activity', label: 'Logs', icon: <Activity size={14} /> },
    { id: 'files', label: 'Evidence', icon: <FileText size={14} /> },
  ];

  const results = [
    { id: 1, type: 'Order', title: 'iPhone 14 Pro Max - 256GB Deep Purple', snippet: 'Tracking confirmed for smith_ny. Delivered to carrier 2 hours ago. Total: $1,249.00', meta: 'eBay Global • 2h ago', score: '0.98 MATCH' },
    { id: 2, type: 'Evidence', title: 'photo_package_seal_01.jpg', snippet: 'High-res capture of tamper-proof seal. Metadata verified: 40.7128° N, 74.0060° W', meta: 'Vault Storage • 4h ago', score: '0.85 MATCH' },
    { id: 3, type: 'Log', title: 'Security Audit: Access Granted', snippet: 'Workspace decrypted via biometrics. Session active for user Howard.', meta: 'System Logs • 5h ago', score: '0.72 MATCH' },
  ].filter(r => r.title.toLowerCase().includes(query.toLowerCase()) || r.snippet.toLowerCase().includes(query.toLowerCase()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 5 }}>
      {/* Search Hero Section - Integrated, no card */}
      <section style={{ padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ textAlign: 'center' }}
        >
          <h1 style={{ fontSize: '28px', fontWeight: 200, margin: 0, letterSpacing: '-0.025em', color: '#fff' }}>
            Neural Search <span style={{ color: 'var(--heros-brand)', fontWeight: 400 }}>Engine</span>
          </h1>
          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            SURFACE PATTERNS ACROSS YOUR GLOBAL CRYPTO-VAULT
          </p>
        </motion.div>

        <div style={{ width: '100%', maxWidth: '600px', position: 'relative' }}>
          <HerOSInput 
            placeholder="Type a command, order ID, or evidence hash..." 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ fontSize: '15px', padding: '12px 16px' }}
            icon={<ArrowRight size={18} />}
          />
          <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 4 }}>
            <span style={{ fontSize: '9px', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: 4, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>CTRL</span>
            <span style={{ fontSize: '9px', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: 4, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>K</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'center' }}>
          {scopes.map(s => (
            <button key={s.id} style={{ 
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 12,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s'
            }} className="hover-bg">
              {s.icon} {s.label}
            </button>
          ))}
        </div>
      </section>

      {/* Results Section */}
      <section className="heros-glass-card" style={{ flex: 1, minHeight: 0, padding: '24px 32px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 16 }}>
          Semantic Matches ({results.length})
        </div>
        
        <ScrollShadow style={{ flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {results.length === 0 ? (
              <div style={{ padding: '60px', textAlign: 'center', color: 'rgba(255,255,255,0.2)' }}>
                <Search size={48} style={{ marginBottom: 16, opacity: 0.1 }} />
                <p>No intelligence found for "{query}"</p>
              </div>
            ) : (
              results.map((r, i) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  style={{ 
                    display: 'grid', gridTemplateColumns: '44px 1fr auto', gap: 12,
                    padding: '10px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    width: 'fit-content',
                    minWidth: '400px'
                  }}
                  className="hover-bg"
                >
                  <div style={{ 
                    width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.05)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff'
                  }}>
                    {r.type === 'Order' && <Package size={20} />}
                    {r.type === 'Evidence' && <FileText size={20} />}
                    {r.type === 'Log' && <Activity size={20} />}
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: 4 }}>{r.title}</div>
                    <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', lineHeight: 1.5, marginBottom: 8 }}>{r.snippet}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontWeight: 600, textTransform: 'uppercase' }}>
                      {r.meta}
                    </div>
                  </div>
                  <div style={{ 
                    fontSize: '10px', fontWeight: 800, color: 'var(--heros-brand)', fontFamily: 'monospace',
                    padding: '4px 8px', borderRadius: 6, background: 'rgba(204, 76, 43, 0.1)', height: 'fit-content'
                  }}>
                    {r.score}
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </ScrollShadow>
      </section>
    </div>
  );
}
