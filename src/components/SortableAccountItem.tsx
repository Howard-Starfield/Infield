import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SortableAccountItemProps {
  queue: {
    id: string;
    label: string;
    count: number;
    icon: any;
  };
  isActive: boolean;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function SortableAccountItem({ queue, isActive, onClick, onKeyDown }: SortableAccountItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: queue.id });

  const containerStyle = {
    transform: CSS.Translate.toString(transform ? { ...transform, x: 0 } : null),
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : 0,
    willChange: 'transform',
    background: isActive ? 'rgba(204, 76, 43, 0.15)' : undefined,
    color: isActive ? '#ffffff' : undefined,
    minWidth: '180px'
  };

  return (
    <div
      ref={setNodeRef}
      style={containerStyle}
      className={`account-badge ${isActive ? 'active' : ''}`}
      {...attributes}
      {...listeners}
      onClick={onClick}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
        <queue.icon size={16} color={isActive ? 'var(--primary)' : 'currentColor'} style={{ flexShrink: 0 }} />
        <span style={{ 
          fontSize: 'var(--text-base)', 
          fontWeight: isActive ? 600 : 500,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1
        }}>
          {queue.label}
        </span>
      </div>
      <div style={{
        background: isActive ? 'rgba(255,255,255,0.2)' : 'var(--surface-container-high)',
        color: isActive ? '#ffffff' : 'var(--on-surface)',
        fontSize: 'var(--text-xs)', fontWeight: 600, padding: '2px 8px', borderRadius: '12px'
      }}>
        {queue.count}
      </div>
    </div>
  );
}
