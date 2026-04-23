import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Command, Zap, Shield, Activity, Package, X, ArrowRight, FileText, Database } from 'lucide-react';
import { HerOSInput } from './HerOS';

/**
 * HerOS Spotlight Overlay
 * A high-fidelity command palette for rapid vault operations.
 * Triggered via Ctrl + Space.
 */

interface SpotlightProps {
  isOpen: boolean;
  onClose: () => void;
  onAction: (action: string) => void;
}

export function SpotlightOverlay({ isOpen, onClose, onAction }: SpotlightProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = [
    { id: 'search', label: 'Neural Search', icon: <Search size={16} />, detail: 'Global semantic reach across assets' },
    { id: 'notes', label: 'Create Note', icon: <FileText size={16} />, detail: 'Draft new intelligence in vault' },
    { id: 'databases', label: 'Database View', icon: <Database size={16} />, detail: 'Analyze structured ops data' },
    { id: 'security', label: 'Security Center', icon: <Shield size={16} />, detail: 'Manage encryption & keys' },
    { id: 'activity', label: 'View Activity', icon: <Activity size={16} />, detail: 'Recent tamper-proof logs' },
    { id: 'capture', label: 'Capture Evidence', icon: <Zap size={16} />, detail: 'Secure new package photos' },
    { id: 'orders', label: 'Track Orders', icon: <Package size={16} />, detail: 'Open eBay marketplace dashboard' },
    { id: 'synthesis', label: 'AI Synthesis', icon: <Activity size={16} />, detail: 'Generate insights from vault data' }
  ].filter(s => s.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') setSelectedIndex(prev => (prev + 1) % suggestions.length);
      if (e.key === 'ArrowUp') setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
      if (e.key === 'Enter' && suggestions[selectedIndex]) {
        onAction(suggestions[selectedIndex].id);
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, suggestions]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 20000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(20px)',
          padding: '24px'
        }}>
          {/* Click outside to close */}
          <div style={{ position: 'absolute', inset: 0 }} onClick={onClose} />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -10, transition: { duration: 0.2, ease: "easeIn" } }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="heros-glass-card"
            style={{
              width: '100%', maxWidth: '640px', padding: 0, overflow: 'hidden',
              boxShadow: '0 32px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
              borderRadius: '24px', position: 'relative'
            }}
          >
            {/* Search Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Command size={20} color="var(--heros-brand)" />
                <div style={{ flex: 1 }}>
                  <HerOSInput 
                    ref={inputRef}
                    placeholder="Type a command or search..." 
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    icon={<ArrowRight size={18} />}
                  />
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer' }}>
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Results Area */}
            <div style={{ maxHeight: '400px', overflowY: 'auto', padding: '12px' }} className="custom-scrollbar">
              {suggestions.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.2)' }}>
                  <p style={{ fontSize: '14px' }}>No commands found matching "{query}"</p>
                </div>
              ) : (
                suggestions.map((item, i) => (
                  <div
                    key={item.id}
                    onClick={() => { onAction(item.id); onClose(); }}
                    onMouseEnter={() => setSelectedIndex(i)}
                    style={{
                      padding: '12px 16px', borderRadius: '14px', cursor: 'pointer',
                      background: i === selectedIndex ? 'rgba(255,255,255,0.05)' : 'transparent',
                      border: `1px solid ${i === selectedIndex ? 'rgba(255,255,255,0.05)' : 'transparent'}`,
                      display: 'flex', alignItems: 'center', gap: 16, transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ 
                      width: '36px', height: '36px', borderRadius: '10px', 
                      background: i === selectedIndex ? 'var(--heros-brand)' : 'rgba(255,255,255,0.05)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: i === selectedIndex ? '#fff' : 'rgba(255,255,255,0.4)',
                      transition: 'all 0.2s ease'
                    }}>
                      {item.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: i === selectedIndex ? '#fff' : 'rgba(255,255,255,0.8)' }}>
                        {item.label}
                      </div>
                      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
                        {item.detail}
                      </div>
                    </div>
                    {i === selectedIndex && (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '10px', fontWeight: 800 }}>
                        <span style={{ padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>ENTER</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 24px', background: 'rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '11px', fontWeight: 600 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ padding: '2px 4px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>↑↓</span> Select</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ padding: '2px 4px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>ESC</span> Close</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--heros-brand)', fontSize: '11px', fontWeight: 800, letterSpacing: '0.05em' }}>
                <Zap size={12} /> SPOTLIGHT OS¹
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
