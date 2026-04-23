import React, { useState, useEffect, useRef } from 'react';
import { AccountSidebar } from './AccountSidebar';
import { ConversationList } from './ConversationList';
import { ThreadWorkspace } from './ThreadWorkspace';
import { InspectorPanel } from './InspectorPanel';
import { EmptyState } from './EmptyState';
import { Archive, CheckCheck, X, Zap, Settings2, Maximize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ConversationListSkeleton, ThreadWorkspaceSkeleton, InspectorPanelSkeleton } from './Skeleton';
import { useLayout } from '../contexts/LayoutContext';
import { soundService } from '../services/SoundService';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── Sortable Panel Wrapper ──────────────────────────────────────────────────
function SortablePanel({ id, isLayoutMode, togglePanel, children, defaultSize, minSize }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0.3 : 1,
    position: 'relative',
    userSelect: 'none',
    zIndex: isDragging ? 10 : 1,
    height: '100%',
    willChange: 'transform',
  };

  return (
    <Panel 
      id={id} 
      defaultSize={defaultSize} 
      minSize={minSize}
      style={style}
    >
      <div ref={setNodeRef} style={{ height: '100%', width: '100%', position: 'relative' }}>
        {isLayoutMode && (
          <>
            <div 
              {...attributes} 
              {...listeners} 
              style={{ position: 'absolute', inset: 0, zIndex: 100, cursor: isDragging ? 'grabbing' : 'grab', borderRadius: 'var(--radius-lg)' }} 
            />
            <button
              onClick={(e) => { e.stopPropagation(); togglePanel(id); }}
              style={{
                position: 'absolute', top: 8, right: 8, zIndex: 210,
                background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%',
                width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', cursor: 'pointer', fontSize: 14,
              }}
            >×</button>
          </>
        )}
        {children}
      </div>
    </Panel>
  );
}

// ── Custom Resize Handle ────────────────────────────────────────────────────
function ResizeHandle() {
  return (
    <PanelResizeHandle className="gutter-splitter" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="gutter-splitter-pill" />
    </PanelResizeHandle>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export function InboxView() {
  const { panelOrder, setPanelOrder, isLayoutMode, panelVisibility, togglePanel } = useLayout();
  const [hasConversations, setHasConversations] = useState(true); 
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleBulkArchive = () => {
    toast.success(`Archived ${selectedIds.size} conversations`);
    setSelectedIds(new Set());
  };

  const handleBulkRead = () => {
    toast.success(`Marked ${selectedIds.size} conversations as read`);
    setSelectedIds(new Set());
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
      soundService.playNotification();
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // ── Dnd-Kit State & Sensors ──────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 3 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = panelOrder.indexOf(active.id as any);
      const newIndex = panelOrder.indexOf(over.id as any);
      setPanelOrder(arrayMove(panelOrder, oldIndex, newIndex));
    }
  };

  // ── Content Renderers ────────────────────────────────────────────────────
  const { toggleLayoutMode } = useLayout();

  const renderPanelHeader = (id: string) => {
    const titles: Record<string, string> = {
      inbox: 'Inbox',
      workspace: 'Thread Workspace',
      inspector: 'Inspector'
    };
    
    return (
      <div style={{ 
        padding: '12px 16px', 
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'transparent'
      }}>
        <span style={{ 
          fontSize: '10px', 
          fontWeight: 700, 
          textTransform: 'uppercase', 
          letterSpacing: '0.12em', 
          color: 'var(--heros-text-dim)' 
        }}>
          {titles[id]}
        </span>
      </div>
    );
  };

  const renderPanelContent = (id: string) => {
    let content = null;
    if (id === 'inbox') content = (
      <PanelGroup orientation="horizontal" id="inbox-inner" style={{ display: 'flex', height: '100%', width: '100%', gap: 5 }}>
        {/* eBay Accounts sub-panel */}
        <Panel defaultSize={38} minSize={20} id="inbox-accounts">
          <div style={{ height: '100%', width: '100%', overflow: 'hidden', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
            <AccountSidebar />
          </div>
        </Panel>

        {/* Inner drag handle */}
        <PanelResizeHandle className="gutter-splitter" style={{ width: '4px', flexShrink: 0, cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="gutter-splitter-pill" style={{ height: '40px', width: '2px', borderRadius: '2px' }} />
        </PanelResizeHandle>

        {/* Conversation List sub-panel */}
        <Panel defaultSize={62} minSize={30} id="inbox-conversations">
          <div style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
            {isLoading ? (
              <ConversationListSkeleton />
            ) : (
              <ConversationList 
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                onSelect={(id) => setSelectedConversationId(id)}
                onDeselect={() => setSelectedConversationId(null)} 
              />
            )}
          </div>
        </Panel>
      </PanelGroup>
    )

    else if (id === 'workspace') content = (
      <div style={{ flex: 1, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {isLoading ? (
          <ThreadWorkspaceSkeleton />
        ) : selectedConversationId ? (
          <ThreadWorkspace conversationId={selectedConversationId} />
        ) : (
          <EmptyState variant={hasConversations ? "no-selection" : "empty-inbox"} />
        )}
      </div>
    );
    else if (id === 'inspector') content = (
      <div style={{ height: '100%', width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {isLoading ? <InspectorPanelSkeleton /> : <InspectorPanel />}
      </div>
    );

    return (
      <div className="heros-glass-card" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {isLayoutMode && renderPanelHeader(id)}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {content}
        </div>
      </div>
    );
  };

  const visibleOrder = panelOrder.filter(id => panelVisibility[id as any]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={visibleOrder} strategy={horizontalListSortingStrategy}>
        <div style={{ display: 'flex', flex: 1, height: '100%', width: '100%' }}>
          <PanelGroup 
            orientation="horizontal" 
            id="inbox-layout-v1"
            style={{ display: 'flex', flex: 1, gap: 5 }}
          >
            {visibleOrder.map((id, i) => (
              <React.Fragment key={id}>
                <SortablePanel 
                  id={id} 
                  isLayoutMode={isLayoutMode} 
                  togglePanel={togglePanel}
                  defaultSize={id === 'inbox' ? 45 : (id === 'workspace' ? 35 : 20)}
                  minSize={id === 'inbox' ? 25 : (id === 'workspace' ? 20 : 10)}
                >
                  {renderPanelContent(id)}
                </SortablePanel>
                
                {i < visibleOrder.length - 1 && isLayoutMode && (
                  <ResizeHandle />
                )}
              </React.Fragment>
            ))}
          </PanelGroup>
        </div>
      </SortableContext>
      
      <DragOverlay>
        {activeId ? (
          <div style={{
            width: 300,
            height: '100%',
            pointerEvents: 'none',
            opacity: 0.92,
            transform: 'scale(1.02)',
            boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--primary)',
            background: 'var(--surface)',
            overflow: 'hidden',
            position: 'relative'
          }}>
            <div style={{ height: '100%', width: '100%', opacity: 0.6 }}>
               {renderPanelContent(activeId)}
            </div>
            <div style={{ 
              position: 'absolute', top: 12, left: 12, 
              background: 'rgba(204, 76, 43, 0.2)', padding: '6px 10px', borderRadius: 6, 
              fontSize: 10, fontWeight: 800, color: 'var(--primary)',
              backdropFilter: 'blur(8px)', border: '1px solid rgba(204, 76, 43, 0.3)',
              zIndex: 1000, letterSpacing: '0.12em'
            }}>
              REORDERING: {activeId.toUpperCase()}
            </div>
          </div>
        ) : null}
      </DragOverlay>

      {/* Floating Bulk Action Bar (The Blade) */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            style={{ 
              position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(26, 27, 33, 0.85)', backdropFilter: 'blur(16px)',
              border: '1px solid var(--primary)', borderRadius: '100px',
              padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 24,
              boxShadow: '0 24px 48px rgba(0,0,0,0.5)', zIndex: 1000
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 24, borderRight: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                <Zap size={14} />
              </div>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--on-surface)' }}>
                {selectedIds.size} Selected
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button 
                onClick={handleBulkRead}
                style={{ 
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--on-surface)',
                  padding: '8px 16px', borderRadius: '100px', fontSize: 'var(--text-sm)', fontWeight: 600, 
                  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'
                }}
              >
                <CheckCheck size={16} /> Mark as Read
              </button>
              <button 
                onClick={handleBulkArchive}
                style={{ 
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--on-surface)',
                  padding: '8px 16px', borderRadius: '100px', fontSize: 'var(--text-sm)', fontWeight: 600, 
                  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'
                }}
              >
                <Archive size={16} /> Archive Selected
              </button>
              <button 
                onClick={() => setSelectedIds(new Set())}
                style={{ 
                  background: 'none', border: 'none', color: 'var(--on-surface-variant)',
                  padding: '8px', cursor: 'pointer'
                }}
              >
                <X size={18} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </DndContext>
  );
}
