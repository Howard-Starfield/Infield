import React, { useState, useMemo } from 'react';
import { X, ChevronRight, MoreHorizontal, Copy, ExternalLink, Mail, RefreshCw, FileText, Loader2, Brain, Sparkles, Zap, MessageSquare, ShieldCheck, Smartphone } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { llmChatNative } from '../tauri-bridge';
import { ContextMenu } from './ContextMenu';
import { toast } from 'sonner';
import { ScrollShadow } from './ScrollShadow';
import { useVault } from '../contexts/VaultContext';
import { MediaDropzone } from './MediaDropzone';
import { DndContext } from '@dnd-kit/core';

import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';

export function InspectorPanel() {
  const { vaultData, storeEvidence } = useVault();
  const [isDragging, setIsDragging] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [buyerSentiment, setBuyerSentiment] = useState<'neutral' | 'positive' | 'urgent' | 'agitated'>('neutral');

  const handleAiSummarize = async () => {
    setIsAiThinking(true);
    setAiSummary(null);
    try {
      const prompt = "Summarize this eBay conversation for a busy seller. Focus on the buyer's main request and any deadline.";
      const result = await llmChatNative(prompt);
      setAiSummary(result.content);
      setBuyerSentiment('urgent');
      toast.success('AI Summary Generated');
    } catch (e: any) {
      toast.error('AI failed to process: ' + e.toString());
    } finally {
      setIsAiThinking(false);
    }
  };

  const currentAccountId = vaultData?.ebayAccounts?.[0]?.accountId || 'unknown';
  const currentOrderId = 'ORDER-1000';

  const evidence = useMemo(() => 
    vaultData?.ebayEvidence?.filter(e => e.accountId === currentAccountId) || [],
    [vaultData, currentAccountId]
  );

  const handleEvidenceDropped = async (files: File[]) => {
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target?.result as string;
        await storeEvidence(
          currentAccountId,
          currentOrderId,
          file.name,
          file.type,
          base64,
          "User uploaded evidence"
        );
        toast.success(`Evidence ${file.name} saved`);
      };
      reader.readAsDataURL(file);
    }
  };

  const trackingContextItems = [
    { label: 'Copy Tracking Number', icon: <Copy size={14} />, onClick: () => { navigator.clipboard.writeText('1233556'); toast.info('Tracking number copied'); } },
    { label: 'Track on Carrier Website', icon: <ExternalLink size={14} />, onClick: () => toast.info('Opening carrier site...') },
  ];

  const buyerContextItems = [
    { label: 'Copy Email', icon: <Copy size={14} />, onClick: () => { navigator.clipboard.writeText('buyerny@eBay.com'); toast.info('Email copied'); } },
    { label: 'Send Email', icon: <Mail size={14} />, onClick: () => toast.info('Opening mail client...') },
    { divider: true, label: '' },
    { label: 'Copy Buyer ID', icon: <Copy size={14} />, onClick: () => { navigator.clipboard.writeText('Smith'); toast.info('Buyer ID copied'); } },
  ];

  const orderContextItems = (orderId: string) => [
    { label: 'Copy Order ID', icon: <Copy size={14} />, onClick: () => { navigator.clipboard.writeText(orderId); toast.info('Order ID copied'); } },
    { label: 'View Order Details', icon: <ExternalLink size={14} />, onClick: () => toast.info('Opening order details...') },
  ];

  return (
    <DndContext 
      onDragStart={() => setIsDragging(true)} 
      onDragEnd={() => setIsDragging(false)}
    >
      <MediaDropzone onFilesDropped={handleEvidenceDropped} isDragging={isDragging}>
        <aside className="inspector-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 0, overflowY: 'hidden' }}>
          <PanelGroup orientation="vertical" id="inspector-layout">
            {/* Header (Aligned with Chat Header) */}
            <Panel 
              defaultSize={8} 
              minSize={4} 
              maxSize={30}
              id="inspector-header"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', height: '100%', overflow: 'hidden' }}>
                <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--on-surface)', textShadow: 'var(--heros-text-shadow)' }}>Inspector</h3>
                <button style={{ background: 'none', border: 'none', color: 'var(--on-surface-variant)', cursor: 'pointer', display: 'flex' }}>
                  <X size={16} />
                </button>
              </div>
            </Panel>

            <PanelResizeHandle className="gutter-splitter-horizontal">
              <div className="gutter-splitter-pill" />
            </PanelResizeHandle>

            <Panel defaultSize={92} minSize={30} id="inspector-content">
              <div style={{ height: '100%', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <ScrollShadow style={{ padding: '0 16px 16px 16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 16 }}>
                    {/* AI Neural Analysis */}
                    <div style={{ 
                      position: 'relative', borderRadius: 20, overflow: 'hidden', padding: '20px',
                      background: 'linear-gradient(135deg, rgba(204, 76, 43, 0.12) 0%, rgba(204, 76, 43, 0.04) 100%)',
                      border: '1px solid rgba(204, 76, 43, 0.2)', marginBottom: 4,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 16px rgba(204, 76, 43, 0.4)' }}>
                            <Brain size={18} />
                          </div>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.1em', textShadow: '0 0 12px rgba(204, 76, 43, 0.5)' }}>Neural Engine</span>
                        </div>
                        {!isAiThinking && (
                          <button 
                            onClick={handleAiSummarize}
                            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: 8, transition: 'all 0.3s ease' }}
                            className="hover-glow"
                          >
                            <Sparkles size={14} /> {aiSummary ? 'Regenerate' : 'Analyze'}
                          </button>
                        )}
                      </div>

                      <AnimatePresence mode="wait">
                        {isAiThinking ? (
                          <motion.div 
                            key="thinking"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            style={{ height: '80px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}
                          >
                            <div style={{ width: '100%', height: '8px', borderRadius: 4, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                              <motion.div 
                                animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                                style={{ width: '40%', height: '100%', background: 'var(--primary)' }} 
                              />
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--primary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.2em' }}>Scanning Patterns...</div>
                          </motion.div>
                        ) : aiSummary ? (
                            <motion.div 
                              key="summary"
                              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                              style={{ fontSize: '14px', color: '#e2e8f0', lineHeight: 1.7, fontWeight: 400 }}
                            >
                            {aiSummary}
                            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                              <div style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', fontSize: '10px', color: 'var(--success)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase' }}>
                                <ShieldCheck size={12} /> Authentic
                              </div>
                              <div style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', fontSize: '10px', color: 'var(--warning)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                <Zap size={12} /> {buyerSentiment}
                              </div>
                            </div>
                          </motion.div>
                        ) : (
                          <motion.div 
                            key="empty"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            style={{ fontSize: '13px', color: 'var(--on-surface-variant)', fontStyle: 'italic', opacity: 0.6, textAlign: 'center', padding: '20px 0' }}
                          >
                            Activate Neural Engine to decrypt buyer intent.
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    
                    {/* Order Status */}
                    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: '16px', border: '1px solid rgba(255,255,255,0.05)', transition: 'transform 0.3s ease' }}>
                      <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--on-surface-variant)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.15em', opacity: 0.7 }}>Order Velocity</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--success)' }}>
                            <Zap size={20} />
                          </div>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>Mark Shipped</div>
                            <div style={{ fontSize: '12px', color: 'var(--on-surface-variant)' }}>Processing Status</div>
                          </div>
                        </div>
                        <ChevronRight size={18} color="var(--on-surface-variant)" />
                      </div>
                    </div>

                    {/* Tracking */}
                    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--on-surface-variant)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.15em', opacity: 0.7 }}>Logistics</div>
                      <ContextMenu items={trackingContextItems}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'context-menu' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                              <Smartphone size={20} />
                            </div>
                            <div>
                              <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>#1233556-US</div>
                              <div style={{ fontSize: '12px', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
                                In Transit
                              </div>
                            </div>
                          </div>
                          <ExternalLink size={18} color="var(--on-surface-variant)" />
                        </div>
                      </ContextMenu>
                    </div>

                    {/* Buyer Identity */}
                    <ContextMenu items={buyerContextItems}>
                      <div style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 100%)', borderRadius: 20, padding: '20px', border: '1px solid rgba(255,255,255,0.08)', cursor: 'context-menu' }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--on-surface-variant)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.15em', opacity: 0.7 }}>Buyer Identity</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--primary-container)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 800 }}>
                            S
                          </div>
                          <div>
                            <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: 2 }}>Smith (New York)</div>
                            <div style={{ fontSize: '13px', color: 'var(--on-surface-variant)' }}>TechDirect Global Account</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)', marginBottom: 16 }}>
                          <div style={{ fontSize: '13px', color: 'var(--on-surface-variant)', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Email:</span>
                            <span style={{ color: '#fff' }}>buyerny@eBay.com</span>
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--on-surface-variant)', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Tier:</span>
                            <span style={{ color: 'var(--warning)', fontWeight: 700 }}>PREMIUM</span>
                          </div>
                        </div>
                        <button style={{ width: '100%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '10px', borderRadius: 10, fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.3s ease' }}>
                          View Digital Footprint
                        </button>
                      </div>
                    </ContextMenu>

                    {/* Evidence Section */}
                    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.15em', opacity: 0.7 }}>Dispute Evidence</div>
                        <RefreshCw size={14} color="var(--on-surface-variant)" style={{ cursor: 'pointer' }} />
                      </div>
                      
                      {evidence.length === 0 ? (
                        <div style={{ padding: '32px 20px', textAlign: 'center', border: '2px dashed rgba(255,255,255,0.05)', borderRadius: 16, color: 'var(--on-surface-variant)', fontSize: '13px', fontStyle: 'italic' }}>
                          Drag & drop proof files here
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {evidence.map(e => (
                            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
                              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(204, 76, 43, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                                <FileText size={18} />
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '13px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>{e.fileName}</div>
                                <div style={{ fontSize: '11px', color: 'var(--on-surface-variant)' }}>{new Date(e.createdAt).toLocaleDateString()}</div>
                              </div>
                              <ExternalLink size={16} color="var(--on-surface-variant)" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Past History */}
                    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.15em', opacity: 0.7 }}>Transaction History</div>
                        <MoreHorizontal size={16} color="var(--on-surface-variant)" />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {[1, 2, 3].map((i) => (
                          <ContextMenu key={i} items={orderContextItems(`ORDER-${i}000`)}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', borderRadius: 12, cursor: 'context-menu', background: 'rgba(255,255,255,0.02)', border: '1px solid transparent', transition: 'all 0.2s ease' }} className="hover-bg">
                              <span style={{ fontSize: '13px', color: '#e2e8f0' }}>Sent #{i} - iPhone 14 Pro</span>
                              <span style={{ fontSize: '13px', color: '#fff', fontWeight: 700 }}>$999.00</span>
                            </div>
                          </ContextMenu>
                        ))}
                      </div>
                    </div>

                    {/* Strategic Notes */}
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--on-surface-variant)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.15em', opacity: 0.7 }}>Strategic Notes</div>
                      <textarea 
                        placeholder="Add internal intelligence..." 
                        style={{ 
                          width: '100%', 
                          background: 'rgba(0,0,0,0.3)', 
                          border: '1px solid rgba(255,255,255,0.05)', 
                          boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.3)',
                          borderRadius: 16, 
                          padding: '16px', 
                          color: '#fff',
                          fontSize: '14px',
                          resize: 'none',
                          height: 120,
                          outline: 'none',
                          lineHeight: 1.6
                        }} 
                      />
                    </div>
                  </div>
                </ScrollShadow>
              </div>
            </Panel>
          </PanelGroup>
        </aside>
      </MediaDropzone>
    </DndContext>
  );
}

