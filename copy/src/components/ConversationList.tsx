import React, { useRef, useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, ArrowUpDown, MoreHorizontal, CheckCheck, Copy, BellOff, Trash2, Archive, Pin, Square, CheckSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ContextMenu } from './ContextMenu';
import { toast } from 'sonner';
import { ScrollShadow } from './ScrollShadow';
import { EmptyState } from './EmptyState';
import { useVault } from '../contexts/VaultContext';
// Generating mock conversations matching the image
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';

export function ConversationList({ onSelect, onDeselect, selectedIds = new Set(), onSelectionChange }: { 
  onSelect?: (id: string) => void, 
  onDeselect?: () => void,
  selectedIds?: Set<string>,
  onSelectionChange?: (ids: Set<string>) => void
}) {
  const { vaultData } = useVault();
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const conversations = vaultData?.ebayConversations || [];
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [showGlow, setShowGlow] = useState<number | null>(null);
  const glowTimeout = useRef<any>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  const toggleSelection = (id: string, index: number, event?: React.MouseEvent) => {
    const newSelected = new Set(selectedIds);
    if (event?.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      for (let i = start; i <= end; i++) {
        newSelected.add(conversations[i].conversationId);
      }
    } else {
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
    }
    if (onSelectionChange) onSelectionChange(newSelected);
    setLastSelectedIndex(index);
    if (onSelect && newSelected.size === 1) {
      onSelect(Array.from(newSelected)[0]);
    }
  };

  const parentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rowVirtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
  }, [selectedIndex]);

  const [uiScale, setUiScale] = useState(() => {
    const saved = localStorage.getItem('ui-scale');
    return saved ? parseFloat(saved) : 1.0;
  });

  useEffect(() => {
    const handleStorage = () => {
      const saved = localStorage.getItem('ui-scale');
      if (saved) setUiScale(parseFloat(saved));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100 * uiScale,
  });

  const getContextItems = (conv: typeof conversations[0]) => [
    { label: 'Mark as Read', icon: <CheckCheck size={14} />, shortcut: 'Ctrl+R', onClick: () => toast.success(`Marked "${conv.buyerName}" as read`) },
    { label: 'Pin Conversation', icon: <Pin size={14} />, onClick: () => toast.info(`Pinned "${conv.buyerName}"`) },
    { label: 'Copy Buyer Name', icon: <Copy size={14} />, shortcut: 'Ctrl+C', onClick: () => { navigator.clipboard.writeText(conv.buyerName); toast.info('Copied to clipboard'); } },
    { label: 'Archive', icon: <Archive size={14} />, onClick: () => toast.info(`Archived conversation`) },
    { divider: true, label: '' },
    { label: 'Mute Notifications', icon: <BellOff size={14} />, onClick: () => toast.warning(`Muted "${conv.buyerName}"`) },
    { label: 'Delete Conversation', icon: <Trash2 size={14} />, danger: true, onClick: () => toast.error(`Deleted conversation with "${conv.buyerName}"`) },
    { divider: true, label: '' },
    { label: 'Deselect (Test Empty State)', icon: <Archive size={14} />, onClick: () => { if (onDeselect) onDeselect(); toast.info('Selection cleared to show Empty State'); } },
  ];

  return (
    <PanelGroup orientation="vertical" id="thread-layout">
      {/* Header & Search Section - Aligned with Chat Header */}
      <Panel 
        defaultSize={8} 
        minSize={4} 
        maxSize={30}
        id="thread-header"
      >
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', justifyContent: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', flexShrink: 0, gap: 12 }}>
            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--on-surface)', letterSpacing: '0.02em', textShadow: 'var(--heros-text-shadow)', whiteSpace: 'nowrap' }}>Thread</h3>
            
            {/* Inline Search */}
            <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: 10, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                <Search size={12} color="var(--on-surface-variant)" />
              </div>
              <input 
                type="text" 
                placeholder="Search messages..." 
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const firstRow = parentRef.current?.querySelector('[tabindex="0"]') as HTMLElement;
                    firstRow?.focus();
                    setSelectedIndex(0);
                  }
                }}
                style={{ 
                  width: '100%', height: '32px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', 
                  borderRadius: '6px', padding: '0 12px 0 30px', color: 'var(--on-surface)', fontSize: '13px', outline: 'none',
                  boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.2)'
                }} 
              />
            </div>

            <div style={{ display: 'flex', gap: 8, color: 'var(--on-surface-variant)', flexShrink: 0 }}>
              <ArrowUpDown size={16} style={{ cursor: 'pointer' }} />
              <MoreHorizontal size={16} style={{ cursor: 'pointer' }} />
            </div>
          </div>
        </div>
      </Panel>

      <PanelResizeHandle className="gutter-splitter-horizontal">
        <div className="gutter-splitter-pill" />
      </PanelResizeHandle>

      {/* Virtual List Section */}
      <Panel defaultSize={92} minSize={40} id="thread-list">
        <div style={{ flex: 1, height: '100%', position: 'relative', minHeight: 0, borderTop: '1px solid rgba(255,255,255,0.04)' }} ref={parentRef} className="custom-scrollbar">
          {conversations.length === 0 ? (
            <div style={{ padding: 20, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState variant="empty-inbox" compact />
            </div>
          ) : (
            <div style={{ padding: '0 8px' }}>
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const conv = conversations[virtualRow.index];
                  return (
                    <ContextMenu key={virtualRow.key} items={getContextItems(conv)}>
                      <div
                        onMouseEnter={() => setHoveredIndex(virtualRow.index)}
                        onMouseLeave={() => setHoveredIndex(null)}
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey) {
                            toggleSelection(conv.conversationId, virtualRow.index, e);
                          } else {
                            setSelectedIndex(virtualRow.index);
                            if (onSelect) onSelect(conv.conversationId);
                          }
                        }}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                          display: 'flex', gap: 10, padding: '8px 12px',
                          borderRadius: '12px',
                          marginBottom: '6px',
                          background: hoveredIndex === virtualRow.index 
                            ? 'rgba(255, 255, 255, 0.06)' 
                            : selectedIds.has(conv.conversationId) 
                              ? 'rgba(204, 76, 43, 0.12)' 
                              : virtualRow.index === selectedIndex 
                                ? 'rgba(204, 76, 43, 0.18)' 
                                : 'transparent',
                          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                          outline: 'none',
                          overflow: 'hidden',
                        }}
                      >
                        <div 
                          onClick={(e) => { e.stopPropagation(); toggleSelection(conv.conversationId, virtualRow.index, e); }}
                          style={{
                            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                            color: selectedIds.has(conv.conversationId) ? 'var(--primary)' : 'var(--on-surface-variant)',
                            opacity: (hoveredIndex === virtualRow.index || selectedIds.has(conv.conversationId)) ? 1 : 0,
                            transition: 'opacity 0.2s', zIndex: 10
                          }}
                        >
                          {selectedIds.has(conv.conversationId) ? <CheckSquare size={18} /> : <Square size={18} />}
                        </div>

                        <div style={{ display: 'flex', gap: 12 }}>
                          <div style={{ position: 'relative' }}>
                            <div style={{ width: 40, height: 40, borderRadius: '12px', background: 'var(--surface-container-highest)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', fontWeight: 700, fontSize: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                              {(conv.latestSenderUsername || 'U').charAt(0)}
                            </div>
                            {conv.unreadCount > 0 && (
                              <div style={{ position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: '50%', background: 'var(--primary)', border: '2px solid var(--surface)' }} />
                            )}
                          </div>
                          
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: '#ffffff', textShadow: 'var(--heros-text-shadow)' }}>{conv.latestSenderUsername || 'Buyer'}</span>
                                <span style={{ fontSize: '11px', color: 'var(--on-surface-variant)', fontWeight: 500, letterSpacing: '0.04em' }}>{conv.conversationTitle || 'General Inquiry'}</span>
                              </div>
                              <span style={{ fontSize: '10px', color: 'var(--on-surface-variant)', opacity: 0.6 }}>
                                {new Date(conv.latestMessageAt || conv.createdDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            
                            <div style={{ fontSize: '13px', color: 'var(--on-surface-variant)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.6, opacity: 0.8 }}>
                              {conv.latestMessagePreview || 'No message preview available.'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </ContextMenu>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Panel>
    </PanelGroup>
  );
}
