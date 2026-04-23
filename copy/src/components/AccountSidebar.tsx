import React, { useState } from 'react';
import { MoreHorizontal, Mail, Package, CornerUpLeft } from 'lucide-react';
import { useVault } from '../contexts/VaultContext';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableAccountItem } from './SortableAccountItem';

import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';

const initialQueues = [
  { id: 'inbox', label: 'Inbox', count: 15, icon: Mail },
  { id: 'unshipped', label: 'Unshipped', count: 3, icon: Package },
  { id: 'returns', label: 'Returns', count: 1, icon: CornerUpLeft },
];

export function AccountSidebar() {
  const { vaultData } = useVault();
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  
  // Derived accounts list from vault
  const accounts = vaultData?.ebayAccounts || [];
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    // In a real app, we'd save the account order to the vault
    const { active, over } = event;
    if (over && active.id !== over.id) {
       console.log("Reordering accounts:", active.id, over.id);
    }
  };

  return (
    <PanelGroup orientation="vertical" id="sidebar-layout">
      {/* Sidebar Header Section - Aligned with Chat Header */}
      <Panel 
        defaultSize={8} 
        minSize={4} 
        maxSize={30}
        id="sidebar-header" 
      >
        <div style={{ padding: '8px 16px', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' }}>
          <h4 style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.12em', textShadow: 'var(--heros-text-shadow)' }}>
            Accounts
          </h4>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} title="Sync Active" />
          </div>
        </div>
      </Panel>

      <PanelResizeHandle className="gutter-splitter-horizontal">
        <div className="gutter-splitter-pill" />
      </PanelResizeHandle>

      <Panel defaultSize={67} minSize={30} id="sidebar-accounts">
        <div className="account-list" style={{ padding: '8px', height: '100%', overflowY: 'auto', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          {accounts.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--on-surface-variant)', fontSize: 'var(--text-sm)' }}>
              No accounts connected.
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={accounts.map(a => a.accountId)}
                strategy={verticalListSortingStrategy}
              >
                {accounts.map(account => {
                  const syncState = vaultData?.ebaySyncStates?.find(s => s.accountId === account.accountId);
                  const unreadCount = vaultData?.ebayConversations?.filter(c => c.accountId === account.accountId).reduce((sum, c) => sum + c.unreadCount, 0) || 0;
                  
                  return (
                    <SortableAccountItem
                      key={account.accountId}
                      queue={{
                        id: account.accountId,
                        label: account.accountLabel || account.accountId,
                        count: unreadCount,
                        icon: Mail
                      }}
                      isActive={activeAccountId === account.accountId}
                      onClick={() => setActiveAccountId(account.accountId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setActiveAccountId(account.accountId);
                        }
                      }}
                    />
                  );
                })}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </Panel>

      <PanelResizeHandle className="gutter-splitter-horizontal">
        <div className="gutter-splitter-pill" />
      </PanelResizeHandle>

      {/* Folders Section */}
      <Panel defaultSize={25} minSize={15} id="sidebar-folders">
        <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
           <h4 style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.12em' }}>Filters</h4>
           <div style={{ flex: 1, overflowY: 'auto' }}>
             {initialQueues.map(q => (
               <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 8px', borderRadius: '6px', cursor: 'pointer', color: 'var(--on-surface-variant)' }}>
                 <q.icon size={14} />
                 <span style={{ fontSize: 'var(--text-sm)' }}>{q.label}</span>
               </div>
             ))}
           </div>
        </div>
      </Panel>
    </PanelGroup>
  );
}
