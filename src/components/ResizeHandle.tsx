import React from 'react';

interface ResizeHandleProps {
  handleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    style: React.CSSProperties;
    'data-resize-handle': boolean;
  };
  onDoubleClick?: () => void;
}

/**
 * A thin, invisible resize handle that shows a subtle line on hover.
 * Double-click resets to default width.
 */
export function ResizeHandle({ handleProps, onDoubleClick }: ResizeHandleProps) {
  return (
    <div
      {...handleProps}
      onDoubleClick={onDoubleClick}
      className="resize-handle"
    >
      <div className="resize-handle-line" />
    </div>
  );
}
