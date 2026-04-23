import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Upload, Database, FileText, CheckCircle2, Clock, 
  AlertCircle, ShoppingCart, MessageSquare, Image,
  Plus, FolderOpen, MoreHorizontal, Link2, Globe,
  BookOpen, Ghost
} from 'lucide-react';
import { ScrollShadow } from './ScrollShadow';

export function ImportView() {
  const [isDragging, setIsDragging] = useState(false);

  const processingBatches = [
    {
      id: 'batch-1',
      name: 'Helix Research (auto-grouped)',
      items: [
        { id: 'p1', type: 'pdf', name: 'distributed-systems-2025.pdf', size: '18 MB', progress: 62, status: 'Embedding chunks 412 / 680' },
        { id: 'p2', type: 'audio', name: '1:1 · Rei · Apr 19.m4a', size: '42 min', progress: 71, status: 'Transcribing (whisper-large)' },
        { id: 'p3', type: 'csv', name: 'helix-incidents.csv', size: '214 rows', progress: 22, status: 'Normalizing schema → Databases/Incidents' }
      ]
    }
  ];

  const completedGroups = [
    {
      id: 'group-1',
      name: 'Readwise · highlights',
      count: '341 items',
      icon: <BookOpen size={12} />,
      items: [
        { id: 'c1', name: 'The Design of Everyday Things — highlights', meta: '128 notes · tagged #design, #systems' },
        { id: 'c2', name: 'Stripe Press · Working in Public', meta: '93 notes · linked to Projects/Community' }
      ]
    },
    {
      id: 'group-2',
      name: 'Obsidian · vault "work"',
      count: '471 items',
      icon: <Database size={12} />,
      items: [
        { id: 'c3', name: 'work/', meta: '471 markdown files · 38 backlinks resolved' }
      ]
    }
  ];

  const sourceChips = [
    { name: 'Notion', icon: <Database size={13} /> },
    { name: 'Obsidian', icon: <Plus size={13} /> },
    { name: 'Readwise', icon: <BookOpen size={13} /> },
    { name: 'Bear', icon: <Ghost size={13} /> },
    { name: 'Apple Notes', icon: <FileText size={13} /> },
    { name: 'Browser', icon: <Globe size={13} /> }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 5 }}>
      {/* Header */}
      <div className="page-head" style={{ padding: '2px 4px 0', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '30px', fontWeight: 300, letterSpacing: '-0.02em', margin: 0, color: 'var(--heros-text-premium)' }}>Import</h1>
          <div style={{ fontSize: '12px', color: 'var(--heros-text-dim)', marginTop: 4, letterSpacing: '0.02em' }}>
            Bring external knowledge in. Everything is indexed and embedded locally.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="heros-btn" style={{ padding: '6px 14px', borderRadius: 10, fontSize: '12px' }}>
            <FolderOpen size={13} /> Imports folder
          </button>
          <button className="heros-btn heros-btn-brand" style={{ padding: '6px 14px', borderRadius: 10, fontSize: '12px' }}>
            <Plus size={13} /> New import
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, minHeight: 0 }}>
        {/* Left Column: Dropzone & Sources */}
        <section className="heros-glass-card" style={{ padding: '28px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div 
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); }}
            style={{ 
              flex: 1, minHeight: 180, borderRadius: 18, background: 'rgba(0,0,0,0.18)',
              border: `2px dashed ${isDragging ? 'var(--heros-brand)' : 'rgba(253,249,243,0.2)'}`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: 32, transition: 'all 0.25s', cursor: 'pointer'
            }}
          >
            <motion.div
              animate={{ y: isDragging ? -10 : 0 }}
              style={{ color: isDragging ? 'var(--heros-brand)' : 'rgba(253,249,243,0.3)' }}
            >
              <Upload size={42} strokeWidth={1.2} />
            </motion.div>
            <h3 style={{ fontSize: '16px', fontWeight: 500, margin: '8px 0 0' }}>Drop files here</h3>
            <p style={{ fontSize: '12px', color: 'var(--heros-text-dim)', margin: 0 }}>
              PDFs, markdown, epub, audio, CSV, Notion/Obsidian exports — up to 2 GB per batch
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="eyebrow" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.28em', textTransform: 'uppercase', color: 'var(--heros-text-dim)' }}>
              Or connect a source
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {sourceChips.map((chip) => (
                <button 
                  key={chip.name}
                  className="heros-btn"
                  style={{ 
                    padding: '6px 12px', borderRadius: 20, fontSize: '11px', gap: 6,
                    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)'
                  }}
                >
                  {chip.icon} {chip.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Right Column: Ingestion Lists */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minHeight: 0 }}>
          
          {/* Processing Panel */}
          <section className="heros-glass-card" style={{ flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '13px', fontWeight: 600 }}>
                <Clock size={15} color="rgba(255,255,255,0.4)" />
                Processing
                <span style={{ padding: '3px 9px', fontSize: '10px', background: 'rgba(255,255,255,0.06)', borderRadius: 14, color: 'var(--heros-text-dim)' }}>3 active</span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--heros-text-dim)', fontFamily: 'monospace' }}>74 MB / 142 MB</span>
            </div>

            <ScrollShadow style={{ flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {processingBatches.map(batch => (
                  <div key={batch.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--heros-text-dim)', padding: '4px 4px 6px' }}>
                      <Link2 size={12} /> {batch.name}
                    </div>
                    {batch.items.map((item, i) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="import-row-hover"
                        style={{ 
                          display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 12, alignItems: 'center',
                          padding: '10px 12px', borderRadius: 12, background: 'rgba(0,0,0,0.14)',
                          border: '1px solid rgba(255,255,255,0.04)', transition: 'all 0.2s'
                        }}
                      >
                        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {item.type === 'pdf' && <FileText size={14} />}
                          {item.type === 'audio' && <MessageSquare size={14} />}
                          {item.type === 'csv' && <Database size={14} />}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '12.5px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                          <div style={{ fontSize: '10.5px', color: 'var(--heros-text-dim)', marginTop: 1, fontFamily: 'monospace' }}>{item.size} · {item.status}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 80, height: 4, background: 'rgba(0,0,0,0.28)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${item.progress}%` }}
                              className="shimmer-bar"
                              style={{ height: '100%', background: 'linear-gradient(90deg, #f0d8d0, #fff)', borderRadius: 2, boxShadow: '0 0 8px rgba(253,249,243,0.5)', position: 'relative', overflow: 'hidden' }}
                            />
                          </div>
                          <div style={{ fontSize: '10px', fontWeight: 700, padding: '4px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.08)', color: 'var(--heros-text-dim)', fontFamily: 'monospace' }}>{item.progress}%</div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                ))}
              </div>
            </ScrollShadow>
          </section>

          {/* Completed Panel */}
          <section className="heros-glass-card" style={{ flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '13px', fontWeight: 600 }}>
                <CheckCircle2 size={15} color="#9cf0c9" />
                Completed
                <span style={{ padding: '3px 9px', fontSize: '10px', background: 'rgba(255,255,255,0.06)', borderRadius: 14, color: 'var(--heros-text-dim)' }}>today</span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--heros-text-dim)', fontFamily: 'monospace' }}>6 imports · 812 items</span>
            </div>

            <ScrollShadow style={{ flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {completedGroups.map(group => (
                  <div key={group.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--heros-text-dim)', padding: '4px 4px 6px' }}>
                      {group.icon} {group.name} ({group.count})
                    </div>
                    {group.items.map(item => (
                      <div 
                        key={item.id}
                        className="import-row-hover"
                        style={{ 
                          display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 12, alignItems: 'center',
                          padding: '10px 12px', borderRadius: 12, background: 'rgba(0,0,0,0.14)',
                          border: '1px solid rgba(255,255,255,0.04)', opacity: 0.72, transition: 'all 0.2s'
                        }}
                      >
                        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <FileText size={14} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '12.5px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                          <div style={{ fontSize: '10.5px', color: 'var(--heros-text-dim)', marginTop: 1, fontFamily: 'monospace' }}>{item.meta}</div>
                        </div>
                        <div style={{ fontSize: '10px', fontWeight: 700, padding: '4px 8px', borderRadius: 8, background: 'rgba(16,185,129,0.18)', color: '#9cf0c9', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Done</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </ScrollShadow>
          </section>

        </div>
      </div>
    </div>
  );
}

