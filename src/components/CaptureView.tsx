import React, { useState } from 'react';
import { useVault } from '../contexts/VaultContext';
import { Camera, FileText, Search, Filter, Trash2, ExternalLink, Package, User, Calendar, Image as ImageIcon, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { HerOSInput, HerOSButton } from './HerOS';

interface CaptureProps {
  onNavigate: (page: string) => void;
}

export function CaptureView({ onNavigate }: CaptureProps) {
  const { vaultData } = useVault();
  const [search, setSearch] = useState('');
  
  const evidence = (vaultData?.ebayEvidence || []).filter(e => 
    e.fileName.toLowerCase().includes(search.toLowerCase()) || 
    (e.orderId && e.orderId.toLowerCase().includes(search.toLowerCase())) ||
    (e.notes && e.notes.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="heros-page-container" style={{ padding: 0 }}>
      <header style={{ padding: '40px 40px 24px 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontSize: '32px', fontWeight: 700, color: 'var(--on-surface)', marginBottom: '4px' }}>Evidence Capture</h1>
            <p style={{ color: 'var(--on-surface-variant)', fontSize: '15px' }}>Secure storage for shipping labels, package photos, and delivery proof.</p>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ width: '320px', height: '44px' }}>
              <HerOSInput 
                placeholder="Search orders or files..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                icon={<Search size={18} />}
                style={{ height: '44px' }}
              />
            </div>
            <HerOSButton 
              className="heros-btn-brand" 
              icon={<Camera size={18} />}
              style={{ height: '44px', padding: '0 24px', borderRadius: '12px', fontSize: '14px', fontWeight: 700 }}
            >
              Capture
            </HerOSButton>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 40px 40px 40px' }} className="custom-scrollbar">
        {evidence.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px', color: 'var(--on-surface-variant)' }}>
            <div style={{ width: '100px', height: '100px', borderRadius: '32px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px auto' }}>
              <Camera size={48} style={{ opacity: 0.15 }} />
            </div>
            <h2 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--on-surface)', marginBottom: '8px' }}>No Evidence Found</h2>
            <p style={{ maxWidth: '360px', margin: '0 auto', fontSize: '15px', lineHeight: 1.6 }}>Your encrypted evidence gallery is empty. Captured files attached to orders will appear here automatically.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '5px' }}>
            <AnimatePresence>
              {evidence.map((item, i) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: i * 0.05 }}
                  className="heros-glass-card"
                  style={{
                    padding: 0,
                    display: 'flex',
                    flexDirection: 'column'
                  }}
                >
                  {/* Preview */}
                  <div style={{ height: '180px', background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    {item.mimeType.startsWith('image/') ? (
                      <img src={item.data} alt={item.fileName} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.8 }} />
                    ) : (
                      <FileText size={48} style={{ opacity: 0.15 }} />
                    )}
                    <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', gap: '8px' }}>
                      <button 
                        onClick={() => toast.info('Previewing encrypted media')}
                        style={{ 
                          width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(0,0,0,0.6)', 
                          border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', 
                          alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)' 
                        }}
                      >
                        <ExternalLink size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Info */}
                  <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--on-surface)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.fileName}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--on-surface-variant)', fontWeight: 500 }}>
                        <Calendar size={14} /> {new Date(item.createdAt).toLocaleDateString()}
                      </div>
                    </div>

                    {item.orderId && (
                      <div style={{ padding: '10px 14px', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Package size={14} color="var(--primary)" />
                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--on-surface)' }}>{item.orderId}</span>
                      </div>
                    )}

                    <div style={{ fontSize: '13px', color: 'var(--on-surface-variant)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '40px', lineHeight: 1.6 }}>
                      {item.notes || 'No additional notes captured.'}
                    </div>

                    <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Shield size={12} color="var(--success)" />
                        <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.2)', fontWeight: 800, letterSpacing: '0.1em' }}>
                          SECURED {item.mimeType.split('/')[1]}
                        </span>
                      </div>
                      <button style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', padding: '6px', opacity: 0.6, transition: 'opacity 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.opacity = '1'} onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}>
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
