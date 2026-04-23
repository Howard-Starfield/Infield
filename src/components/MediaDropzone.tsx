import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Upload, FilePlus, Image as ImageIcon } from 'lucide-react';

interface MediaDropzoneProps {
  onFilesDropped: (files: File[]) => void;
  isDragging: boolean;
  children: React.ReactNode;
}

export function MediaDropzone({ onFilesDropped, isDragging, children }: MediaDropzoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'media-dropzone',
  });

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesDropped(Array.from(e.dataTransfer.files));
      e.dataTransfer.clearData();
    }
  };

  return (
    <div 
      ref={setNodeRef}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{ 
        position: 'relative', 
        height: '100%', 
        width: '100%',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {children}
      
      {/* Overlay for dragging files */}
      {(isOver || isDragging) && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(204, 76, 43, 0.15)',
          backdropFilter: 'blur(4px)',
          border: '2px dashed var(--primary)',
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          pointerEvents: 'none',
          transition: 'all 0.2s ease-out',
          margin: '8px'
        }}>
          <div style={{
            background: 'var(--surface)',
            padding: '24px',
            borderRadius: '50%',
            marginBottom: '16px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Upload size={48} color="var(--primary)" />
          </div>
          <h3 style={{ color: '#fff', fontSize: 'var(--text-xl)', fontWeight: 600, marginBottom: '8px' }}>
            Drop files to attach
          </h3>
          <p style={{ color: 'var(--on-surface-variant)', fontSize: 'var(--text-base)' }}>
            Images and documents supported
          </p>
        </div>
      )}
    </div>
  );
}
