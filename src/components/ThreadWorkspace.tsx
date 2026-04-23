import React, { useState, useMemo } from 'react';
import { HerOSInput } from './HerOS';
import { Send, Image as ImageIcon, Smile, Paperclip, LayoutPanelTop, MoreHorizontal, Smartphone, Copy, Reply, Forward, Flag, Loader2, X, MessageSquare } from 'lucide-react';
import { ContextMenu } from './ContextMenu';
import { toast } from 'sonner';
import { ScrollShadow } from './ScrollShadow';
import { useVault } from '../contexts/VaultContext';
import { celebrationService } from '../services/CelebrationService';
import { soundService } from '../services/SoundService';
import { MediaDropzone } from './MediaDropzone';
import { DndContext, DragStartEvent, DragEndEvent } from '@dnd-kit/core';

import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';

export function ThreadWorkspace({ conversationId }: { conversationId: string }) {
  const { vaultData, queueAction, storeMedia } = useVault();
  const [messageText, setMessageText] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const conversation = useMemo(() => 
    vaultData?.ebayConversations?.find(c => c.conversationId === conversationId),
    [vaultData, conversationId]
  );

  const messages = useMemo(() => 
    vaultData?.ebayMessages?.filter(m => m.conversationId === conversationId) || [],
    [vaultData, conversationId]
  );

  const media = useMemo(() => 
    vaultData?.ebayMedia?.filter(m => m.conversationId === conversationId) || [],
    [vaultData, conversationId]
  );

  const pendingActions = useMemo(() => 
    vaultData?.ebayActionQueue?.filter(a => 
      a.actionType === 'send_message' && 
      a.payload.conversationId === conversationId &&
      (a.status === 'pending' || a.status === 'processing')
    ) || [],
    [vaultData, conversationId]
  );

  const handleMarkShipped = () => {
    soundService.playMoney();
    celebrationService.celebrateOrder(999);
    toast.success('Order marked as shipped!');
  };

  const handleSendMessage = async () => {
    if (!messageText.trim() || !conversation) return;
    
    const text = messageText;
    setMessageText('');
    
    await queueAction(conversation.accountId, 'send_message', {
      conversationId: conversation.conversationId,
      messageBody: text
    });
    
    toast.info('Message queued for sending');
  };

  const handleFilesDropped = async (files: File[]) => {
    if (!conversation) return;
    
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        toast.warning(`File ${file.name} is not an image`);
        continue;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target?.result as string;
        await storeMedia(
          conversation.accountId,
          conversationId,
          file.name,
          file.type,
          base64,
          base64
        );
        toast.success(`Image ${file.name} attached`);
      };
      reader.readAsDataURL(file);
    }
  };

  const msgContextItems = (text: string) => [
    { label: 'Copy Text', icon: <Copy size={14} />, shortcut: 'Ctrl+C', onClick: () => { navigator.clipboard.writeText(text); toast.info('Message copied'); } },
    { label: 'Reply', icon: <Reply size={14} />, shortcut: 'Ctrl+R', onClick: () => toast.info('Reply started') },
    { label: 'Forward', icon: <Forward size={14} />, onClick: () => toast.info('Forward dialog opened') },
    { divider: true, label: '' },
    { label: 'Report Message', icon: <Flag size={14} />, danger: true, onClick: () => toast.warning('Message reported') },
  ];

  if (!conversation) return null;

  return (
    <DndContext 
      onDragStart={() => setIsDragging(true)} 
      onDragEnd={() => setIsDragging(false)}
    >
      <MediaDropzone onFilesDropped={handleFilesDropped} isDragging={isDragging}>
        <section className="thread-workspace" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <PanelGroup orientation="vertical" id="chat-layout">
            {/* Metadata & Actions Area (Aligned with other card headers) */}
            <Panel defaultSize={8} minSize={4} maxSize={30} id="chat-header">
              <div style={{ padding: '0 20px', height: '100%', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', width: '100%' }}>
                  <div style={{ padding: '4px 10px', borderRadius: '100px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Copy size={12} color="var(--on-surface-variant)" />
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--on-surface-variant)', letterSpacing: '0.02em' }}>#{conversation.conversationId}</span>
                  </div>
                  
                  <div style={{ padding: '4px 10px', borderRadius: '100px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--on-surface-variant)' }}>
                      {new Date(conversation.latestMessageAt || conversation.createdDate).toLocaleDateString()}
                    </span>
                  </div>

                  <div style={{ 
                    padding: '4px 12px', borderRadius: '100px', 
                    background: conversation.conversationStatus === 'OPEN' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                    border: `1px solid ${conversation.conversationStatus === 'OPEN' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`,
                    display: 'flex', alignItems: 'center', gap: 6
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: conversation.conversationStatus === 'OPEN' ? 'var(--success)' : 'var(--warning)' }} />
                    <span style={{ fontSize: '11px', fontWeight: 700, color: conversation.conversationStatus === 'OPEN' ? 'var(--success)' : 'var(--warning)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                      {conversation.conversationStatus}
                    </span>
                  </div>

                  <div style={{ flex: 1 }} />
                  
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button 
                      onClick={handleMarkShipped}
                      style={{ background: 'var(--primary)', color: 'var(--on-primary)', border: 'none', padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Confirm Shipment
                    </button>
                  </div>
                </div>
              </div>
            </Panel>

            <PanelResizeHandle className="gutter-splitter-horizontal">
              <div className="gutter-splitter-pill" />
            </PanelResizeHandle>

            <Panel defaultSize={92} minSize={40} id="chat-content">
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                {/* Messages Area */}
                <ScrollShadow>
                  <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {messages.map((msg: any) => {
                      const isMe = msg.senderUsername !== conversation.latestSenderUsername;
                      return (
                        <ContextMenu key={msg.messageId} items={msgContextItems(msg.messageText)}>
                          <div style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                            <div 
                              className={`heros-glass-bubble ${isMe ? 'heros-glass-bubble-me' : ''}`}
                              style={{ 
                                borderRadius: isMe ? '12px 12px 4px 12px' : '12px 12px 12px 4px', 
                                maxWidth: '450px', 
                              }}
                            >
                              <p style={{ margin: 0, lineHeight: 1.6 }}>{msg.messageText}</p>
                            </div>
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--on-surface-variant)', marginTop: 4, marginLeft: isMe ? 0 : 4, marginRight: isMe ? 4 : 0 }}>
                              {new Date(msg.createdDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </ContextMenu>
                      );
                    })}

                    {/* Media Gallery */}
                    {media.length > 0 && (
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', 
                        gap: 12, 
                        padding: '16px', 
                        background: 'rgba(255,255,255,0.02)', 
                        borderRadius: '12px',
                        border: '1px solid rgba(255,255,255,0.05)'
                      }}>
                        {media.map((item: any) => (
                          <div key={item.id} style={{ position: 'relative', aspectRatio: '1/1', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <img src={item.data} alt={item.fileName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            <div style={{ 
                              position: 'absolute', bottom: 0, left: 0, right: 0, 
                              background: 'rgba(0,0,0,0.6)', padding: '4px 8px', 
                              fontSize: '10px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' 
                            }}>
                              {item.fileName}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Pending Messages */}
                    {pendingActions.map((action: any) => (
                      <div key={action.id} style={{ alignSelf: 'flex-end', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <div 
                          className="heros-glass-bubble heros-glass-bubble-me"
                          style={{ 
                            borderRadius: '12px 12px 4px 12px', 
                            maxWidth: '450px',
                            display: 'flex',
                            gap: 10,
                            alignItems: 'center',
                            opacity: 0.8
                          }}
                        >
                          <p style={{ margin: 0 }}>{action.payload.messageBody}</p>
                          <Loader2 size={14} className="animate-spin" style={{ color: 'var(--primary)' }} />
                        </div>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--on-surface-variant)', marginTop: 4, marginRight: 4 }}>
                          Sending...
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollShadow>

                {/* Composer Area */}
                <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <HerOSInput 
                        placeholder="Enter your message..." 
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                        icon={<MessageSquare size={18} />}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 16, color: 'var(--on-surface-variant)', marginLeft: 4 }}>
                        <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                          <input 
                            type="file" 
                            multiple 
                            accept="image/*" 
                            style={{ display: 'none' }} 
                            onChange={(e) => e.target.files && handleFilesDropped(Array.from(e.target.files))}
                          />
                          <ImageIcon size={18} />
                        </label>
                        <Smile size={18} style={{ cursor: 'pointer' }} />
                        <Paperclip size={18} style={{ cursor: 'pointer' }} />
                    </div>
                    <button 
                      onClick={handleSendMessage}
                      style={{ background: 'transparent', border: 'none', color: messageText.trim() ? 'var(--heros-brand)' : 'var(--on-surface-variant)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.3s ease' }}
                    >
                      <Send size={24} />
                    </button>
                  </div>
                </div>
              </div>
            </Panel>
          </PanelGroup>
        </section>
      </MediaDropzone>
    </DndContext>
  );
}
