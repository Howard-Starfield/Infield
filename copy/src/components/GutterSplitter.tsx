import React, { useCallback, useRef } from 'react';

interface GutterSplitterProps {
  /** Fires continuously while dragging with the delta from drag start */
  onDrag: (delta: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  axis?: 'horizontal' | 'vertical';
}

/**
 * A standalone gutter splitter that lives BETWEEN panels in the flex container.
 * Uses Pointer Capture so the drag follows the cursor anywhere on screen.
 */
export function GutterSplitter({ onDrag, onDragStart, onDragEnd, axis = 'horizontal' }: GutterSplitterProps) {
  const isDragging = useRef(false);
  const startPos = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    startPos.current = axis === 'horizontal' ? e.clientX : e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.classList.add('is-resizing');
    if (onDragStart) onDragStart();
  }, [axis, onDragStart]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const pos = axis === 'horizontal' ? e.clientX : e.clientY;
    const delta = pos - startPos.current;
    onDrag(delta);
  }, [axis, onDrag]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    document.body.classList.remove('is-resizing');
    if (onDragEnd) onDragEnd();
  }, [onDragEnd]);

  const isHorizontal = axis === 'horizontal';

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        flexShrink: 0,
        width: isHorizontal ? 8 : '100%',
        height: isHorizontal ? '100%' : 8,
        cursor: isHorizontal ? 'col-resize' : 'row-resize',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 300,
        touchAction: 'none',
        userSelect: 'none',
        position: 'relative',
        borderRadius: 4,
        transition: 'background 0.15s',
      }}
      className="gutter-splitter"
    >
      {/* The visible "pill" indicator */}
      <div
        className="gutter-splitter-pill"
        style={{
          width: isHorizontal ? 2 : '40%',
          height: isHorizontal ? '40%' : 2,
          borderRadius: 2,
          background: 'transparent',
          transition: 'background 0.15s, transform 0.15s',
        }}
      />
    </div>
  );
}
