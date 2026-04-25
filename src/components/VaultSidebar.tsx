import React from 'react';
import { 
  Folder, File, ChevronRight, Plus, Search, Star, Trash2, Clock, ChevronDown 
} from 'lucide-react';
import { ScrollShadow } from './ScrollShadow';
import { ContextMenu } from './ContextMenu';

export interface NoteNode {
  id: string;
  label: string;
  type: 'file' | 'folder';
  children?: NoteNode[];
  pinned?: boolean;
  date?: string;
  content?: string;
  title?: string;
}

interface VaultSidebarProps {
  notes: NoteNode[];
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  selectedNote: string;
  setSelectedNote: (id: string) => void;
  expandedFolders: Set<string>;
  toggleFolder: (id: string) => void;
  onAddNote: () => void;
  onAddFolder: () => void;
  onOpenInSideNote: (id: string) => void;
}

export function VaultSidebar({
  notes,
  searchTerm,
  setSearchTerm,
  selectedNote,
  setSelectedNote,
  expandedFolders,
  toggleFolder,
  onAddNote,
  onAddFolder,
  onOpenInSideNote
}: VaultSidebarProps) {

  const getNoteContextItems = (item: NoteNode) => [
    { label: 'Open in Editor', icon: <File size={14} />, onClick: () => setSelectedNote(item.id) },
    { label: 'Open in Side Note', icon: <Plus size={14} />, onClick: () => onOpenInSideNote(item.id) },
    { divider: true, label: '' },
    { label: item.pinned ? 'Unpin Note' : 'Pin Note', icon: <Star size={14} />, onClick: () => {} },
    { label: 'Rename', icon: <File size={14} />, onClick: () => {} },
    { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => {} },
  ];

  const renderTree = (nodes: NoteNode[]) => {
    return nodes
      .filter(n => n.label.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(item => (
        <div key={item.id}>
          <ContextMenu items={item.type === 'file' ? getNoteContextItems(item) : []}>
            <div 
              onClick={() => item.type === 'folder' ? toggleFolder(item.id) : setSelectedNote(item.id)}
              style={{ 
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 10, cursor: 'pointer', 
                color: selectedNote === item.id ? 'var(--heros-brand)' : 'rgba(255,255,255,0.6)', 
                fontSize: '13px',
                background: selectedNote === item.id ? 'rgba(204, 76, 43, 0.12)' : 'transparent',
                transition: 'all 0.15s ease',
                width: 'fit-content',
                minWidth: '120px',
                border: '1px solid transparent'
              }} 
              className="hover-bg"
            >
              {item.type === 'folder' ? (expandedFolders.has(item.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <File size={14} />}
              {item.type === 'folder' ? <Folder size={14} style={{ opacity: 0.5 }} /> : null}
              <span style={{ flex: 1, fontWeight: selectedNote === item.id ? 600 : 400 }}>{item.label}</span>
              {item.pinned && <Star size={10} fill="currentColor" style={{ opacity: 0.5 }} />}
            </div>
          </ContextMenu>
          {item.children && expandedFolders.has(item.id) && (
            <div style={{ marginLeft: 16, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {renderTree(item.children)}
            </div>
          )}
        </div>
      ));
  };

  return (
    <section className="heros-glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Vault Explorer</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="icon-btn-xs" title="New Note" onClick={onAddNote}><Plus size={14} /></button>
          <button className="icon-btn-xs" title="New Folder" onClick={onAddFolder}><Folder size={14} /></button>
        </div>
      </div>
      
      <div style={{ position: 'relative' }}>
        <input 
          placeholder="Search notes..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 10px 8px 32px', fontSize: '12px', color: '#fff', outline: 'none' }}
        />
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.2)' }} />
      </div>

      <ScrollShadow style={{ flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {renderTree(notes)}
        </div>
      </ScrollShadow>

      <div style={{ paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px', fontSize: '12px', color: 'rgba(255,255,255,0.4)', borderRadius: 8, cursor: 'pointer' }} className="hover-bg">
          <Trash2 size={14} /> Trash
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px', fontSize: '12px', color: 'rgba(255,255,255,0.4)', borderRadius: 8, cursor: 'pointer' }} className="hover-bg">
          <Clock size={14} /> Recent Edits
        </div>
      </div>
    </section>
  );
}
