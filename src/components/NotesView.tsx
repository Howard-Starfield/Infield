import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Folder, File, ChevronRight, Plus, Search, MoreHorizontal, Layout, Columns, 
  Maximize2, Share2, History, Shield, Save, Star, Trash2, Clock, 
  CheckCircle2, MessageSquare, ChevronDown, Pin, ExternalLink, 
  Trash, SideBar
} from 'lucide-react';
import { ScrollShadow } from './ScrollShadow';
import { toast } from 'sonner';
import { ContextMenu } from './ContextMenu';

import { VaultSidebar, NoteNode } from './VaultSidebar';

export function NotesView() {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['ops', 'evidence', 'drafts']));
  const [selectedNote, setSelectedNote] = useState('strategic-ops');
  const [splitPosition, setSplitPosition] = useState(50); // percentage
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Stateful notes tree
  const [notes, setNotes] = useState<NoteNode[]>([
    { id: 'ops', label: 'Operations', type: 'folder', children: [
      { id: 'strategic-ops', label: 'Strategic Ops 2024', type: 'file', pinned: true, title: 'Strategic Operations Roadmap', content: 'The 2024 expansion focuses on deep neural integration with the eBay Message API. We aim to reduce dispute resolution time by 40% through automated evidence synthesis.' },
      { id: 'ebay-policy', label: 'eBay Policy Changes', type: 'file', title: 'eBay Policy Updates Q3', content: 'Recent changes to international shipping regulations require new metadata fields in our vault sync logic.' },
      { id: 'tax-strategy', label: 'Tax Strategy Q4', type: 'file', title: 'Q4 Tax Liability & Strategy', content: 'Preparing for nexus calculations across 14 new states. Automated reporting module is in development.' },
    ]},
    { id: 'evidence', label: 'Evidence Logs', type: 'folder', children: [
      { id: 'case-123', label: 'Case #1233556', type: 'file', date: '2h ago', title: 'Evidence Log: Case #1233556', content: 'Logistic mismatch detected in Brooklyn hub. Customer claims item arrived damaged. Syncing photo_seal_01.jpg.' },
      { id: 'shipping', label: 'Shipping Proofs', type: 'file', date: 'Yesterday', title: 'Shipping Verification Log', content: 'Batch #482 passed neural validation. 98.2% accuracy in label OCR.' },
      { id: 'damages', label: 'Damage Assessments', type: 'file', title: 'Damage Assessment Protocol', content: 'Standardizing damage severity scores (1-10) for faster AI classification.' },
    ]},
    { id: 'neural', label: 'Neural Patterns', type: 'file', pinned: true, title: 'Neural Response Patterns', content: 'Refining the shard cloud visualization to map semantic clusters in the vault.' },
    { id: 'drafts', label: 'Personal Drafts', type: 'folder', children: [
      { id: 'thoughts', label: 'Future Roadmap', type: 'file', title: 'Long-term Roadmap Thoughts', content: 'Exploring the possibility of a direct mobile app bridge for biometric vault access.' },
    ]},
  ]);

  const [sideNotes, setSideNotes] = useState([
    { id: 1, text: 'Remember to verify the AES-256 GCM implementation with the security audit team.', date: 'Today, 10:42 AM' },
    { id: 2, text: 'The mtime buffer should be exactly 1000ms to avoid race conditions in the vault.', date: 'Yesterday' },
    { id: 3, text: 'Check if the eBay API v3 supports parallel batch scanning for multi-account syncing.', date: 'Oct 12' },
  ]);

  const findNoteById = (nodes: NoteNode[], id: string): NoteNode | undefined => {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const found = findNoteById(n.children, id);
        if (found) return found;
      }
    }
    return undefined;
  };

  const currentNoteData = findNoteById(notes, selectedNote);

  const [editorTitle, setEditorTitle] = useState(currentNoteData?.title || '');
  const [editorBody, setEditorBody] = useState(currentNoteData?.content || '');

  useEffect(() => {
    if (currentNoteData) {
      setEditorTitle(currentNoteData.title || '');
      setEditorBody(currentNoteData.content || '');
    }
  }, [selectedNote]);

  const toggleFolder = (id: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddNote = () => {
    const newId = `note-${Date.now()}`;
    const newNote: NoteNode = { id: newId, label: 'Untitled Note', type: 'file', title: 'Untitled Note', content: 'Start typing...' };
    setNotes(prev => [...prev, newNote]);
    setSelectedNote(newId);
    toast.success('New note created');
  };

  const handleAddFolder = () => {
    const newId = `folder-${Date.now()}`;
    const newFolder: NoteNode = { id: newId, label: 'New Folder', type: 'folder', children: [] };
    setNotes(prev => [...prev, newFolder]);
    toast.success('New folder created');
  };

  const handleAddSideNote = () => {
    const text = prompt('Enter side note:');
    if (text) {
      setSideNotes(prev => [{ id: Date.now(), text, date: 'Just now' }, ...prev]);
      toast.success('Side note added');
    }
  };

  const handleOpenInSideNote = (id: string) => {
    const note = findNoteById(notes, id);
    if (note) {
      setSideNotes(prev => [{ 
        id: Date.now(), 
        text: `Pinned reference: ${note.label}\n\n${note.content?.substring(0, 100)}...`, 
        date: 'Reference' 
      }, ...prev]);
      toast.success(`Pinned ${note.label} to side notes`);
    }
  };

  const handleCommit = () => {
    toast.info('Committing changes to encrypted vault...', {
      icon: <ShieldCheck size={16} color="var(--heros-brand)" />,
    });
    setTimeout(() => {
      toast.success('Changes committed successfully (AES-256 GCM)');
    }, 1200);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const editorWidth = rect.width - 240 - 280 - 28; // Sidebar widths + gaps
      const offsetX = e.clientX - rect.left - 240 - 14;
      const percentage = (offsetX / editorWidth) * 100;
      setSplitPosition(Math.max(10, Math.min(100, percentage)));
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div ref={containerRef} style={{ display: 'grid', gridTemplateColumns: '240px 1fr 280px', height: '100%', gap: 5, userSelect: isDragging ? 'none' : 'auto' }}>
      <VaultSidebar 
        notes={notes}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        selectedNote={selectedNote}
        setSelectedNote={setSelectedNote}
        expandedFolders={expandedFolders}
        toggleFolder={toggleFolder}
        onAddNote={handleAddNote}
        onAddFolder={handleAddFolder}
        onOpenInSideNote={handleOpenInSideNote}
      />

      {/* Editor Main Section - Split View */}
      <section className="heros-glass-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <File size={16} color="var(--heros-brand)" />
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>{currentNoteData?.label || 'Untitled'}.md</span>
            {currentNoteData?.pinned && <span style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderRadius: 4, fontWeight: 700 }}>SHARED</span>}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className={`icon-btn ${splitPosition < 100 ? 'active' : ''}`} onClick={() => setSplitPosition(50)} title="Split View"><Columns size={16} /></button>
            <button className={`icon-btn ${splitPosition === 100 ? 'active' : ''}`} onClick={() => setSplitPosition(100)} title="Full Editor"><Maximize2 size={16} /></button>
            <button className="icon-btn"><MoreHorizontal size={16} /></button>
          </div>
        </div>
        
        <div style={{ flex: 1, display: 'flex', position: 'relative', minHeight: 0 }}>
          {/* Left Pane */}
          <div style={{ width: `${splitPosition}%`, height: '100%', overflow: 'auto', padding: '40px', borderRight: splitPosition < 100 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
            <div style={{ maxWidth: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
              <input 
                value={editorTitle}
                onChange={(e) => setEditorTitle(e.target.value)}
                style={{ fontSize: '32px', fontWeight: 300, color: '#fff', outline: 'none', letterSpacing: '-0.02em', background: 'transparent', border: 'none', width: '100%' }}
                placeholder="Note Title"
              />
              <textarea 
                value={editorBody}
                onChange={(e) => setEditorBody(e.target.value)}
                style={{ 
                  fontSize: '15px', lineHeight: 1.8, color: 'rgba(255,255,255,0.7)', outline: 'none', 
                  background: 'transparent', border: 'none', width: '100%', flex: 1, resize: 'none', minHeight: '60vh'
                }} 
                placeholder="Start typing..."
              />
            </div>
          </div>

          {/* Drag Handle */}
          {splitPosition < 100 && (
            <div 
              onMouseDown={handleMouseDown}
              style={{ 
                position: 'absolute', left: `calc(${splitPosition}% - 3px)`, top: 0, bottom: 0, width: 6, 
                cursor: 'col-resize', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              <div style={{ width: 1, height: '100%', background: 'rgba(255,255,255,0.1)' }} />
            </div>
          )}

          {/* Right Pane (Reference) */}
          {splitPosition < 100 && (
            <div style={{ flex: 1, height: '100%', overflow: 'auto', padding: '40px', background: 'rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, opacity: 0.5 }}>
                <Clock size={14} />
                <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>History: Oct 14, 2023</span>
              </div>
              <h2 style={{ fontSize: '24px', fontWeight: 300, color: 'rgba(255,255,255,0.5)', marginBottom: 20 }}>Original Draft (v1)</h2>
              <div style={{ fontSize: '14px', lineHeight: 1.7, color: 'rgba(255,255,255,0.4)' }}>
                Initial thoughts on the {editorTitle || 'integration'}. We need to make sure the vault is encrypted before we store any PII.
                The current system uses AES-128, which should be upgraded to AES-256 for the next major release.
                <br /><br />
                *   Verify API limits
                *   Check sync frequency
                *   Update documentation
              </div>
              <div style={{ marginTop: 40, padding: 20, borderRadius: 16, background: 'rgba(204, 76, 43, 0.05)', border: '1px dashed rgba(204, 76, 43, 0.2)' }}>
                <div style={{ fontSize: '11px', color: 'var(--heros-brand)', fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 }}>Neural Suggestion</div>
                <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
                  "The previous draft mentioned AES-128. Ensure the current AES-256 GCM implementation is correctly referenced in the new roadmap."
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.15)' }}>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', display: 'flex', gap: 16 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><File size={12} /> {editorBody.split(/\s+/).filter(x => x).length} Words</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><History size={12} /> Last sync: Just now</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="icon-btn" style={{ fontSize: '12px', padding: '6px 12px', gap: 6 }} onClick={() => toast.info('History browser opening...')}>
              <History size={14} /> History
            </button>
            <button 
              onClick={handleCommit}
              style={{ background: 'var(--heros-brand)', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 18px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(204, 76, 43, 0.3)' }}>
              <Save size={14} /> Commit Changes
            </button>
          </div>
        </div>
      </section>

      {/* Sidenote / Info Panel - High Readability (Inbox Match) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <section className="heros-glass-card" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--heros-text-dim)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
              Side Notes
            </div>
            <Plus size={14} style={{ color: 'var(--heros-text-dim)', cursor: 'pointer' }} onClick={handleAddSideNote} className="hover-glow" />
          </div>
          <ScrollShadow style={{ maxHeight: '30vh' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sideNotes.map(sn => (
                <motion.div
                  key={sn.id}
                  whileHover={{ scale: 1.01, background: 'rgba(255,255,255,0.06)' }}
                  style={{ 
                    padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.04)', 
                    border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, margin: 0 }}>{sn.text}</p>
                  <div style={{ fontSize: '9px', color: 'var(--heros-text-dim)', marginTop: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{sn.date}</div>
                </motion.div>
              ))}
            </div>
          </ScrollShadow>
        </section>

        <section className="heros-glass-card" style={{ padding: '20px 16px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--heros-text-dim)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 16, padding: '0 4px' }}>
            Contextual Intelligence
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 12 }} className="hover-bg">
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', '--heros-glass-black': 'rgba(10, 11, 15, 0.65)', '--heros-glass-black-deep': 'rgba(5, 5, 8, 0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--success)' }}>
                <CheckCircle2 size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '10px', color: 'var(--heros-text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>Linked Order</div>
                <div style={{ fontSize: '14px', color: '#fff', fontWeight: 600 }}>#1233556-US</div>
              </div>
            </div>
            <div style={{ padding: '8px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 12 }} className="hover-bg">
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(204, 76, 43, 0.1)', border: '1px solid rgba(204, 76, 43, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--heros-brand)' }}>
                <MessageSquare size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '10px', color: 'var(--heros-text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>Merchant Thread</div>
                <div style={{ fontSize: '14px', color: '#fff', fontWeight: 600 }}>smith_v_howard</div>
              </div>
            </div>
          </div>
        </section>

        <section className="heros-glass-card" style={{ padding: '20px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--heros-text-dim)', textTransform: 'uppercase', letterSpacing: '0.15em', padding: '0 4px' }}>
            Security
          </div>
          <div style={{ padding: '16px', borderRadius: 20, background: 'linear-gradient(180deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%)', border: '1px solid rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 20px rgba(16, 185, 129, 0.1)' }}>
              <Shield size={22} color="#10b981" />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>Vault Locked</div>
              <div style={{ fontSize: '11px', color: 'rgba(16, 185, 129, 0.6)', fontFamily: 'monospace' }}>AES-256 GCM</div>
            </div>
          </div>
          <button 
            onClick={() => toast.success('Secure link generated')}
            style={{ 
              width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', 
              color: '#fff', padding: '12px', borderRadius: 12, fontSize: '13px', fontWeight: 600, 
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', 
              gap: 10, transition: 'all 0.2s' 
            }} className="hover-bg">
            <Share2 size={16} /> Secure Share
          </button>
        </section>
      </div>
    </div>
  );
}
