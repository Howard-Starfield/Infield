import { useState, useCallback, useEffect, useRef } from 'react';

interface ResizableConfig {
  cssVar: string;
  defaultValue: number;
  minValue: number;
  maxValue: number;
  storageKey: string;
  axis?: 'horizontal' | 'vertical';
  side?: 'left' | 'right' | 'top' | 'bottom';
  onResize?: (newValue: number, delta: number) => void;
}

interface ResizableReturn {
  value: number;
  setValue: (val: number) => void;
  isResizing: boolean;
  handleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    style: React.CSSProperties;
    'data-resize-handle': boolean;
  };
  reset: () => void;
}

export function useResizable(config: ResizableConfig): ResizableReturn {
  const { 
    cssVar, defaultValue, minValue, maxValue, storageKey, 
    axis = 'horizontal',
    side = axis === 'horizontal' ? 'right' : 'bottom',
    onResize
  } = config;

  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= minValue && parsed <= maxValue) return parsed;
      }
    } catch {}
    return defaultValue;
  });

  const [isResizing, setIsResizing] = useState(false);
  const startPos = useRef(0);
  const startValue = useRef(0);

  useEffect(() => {
    document.documentElement.style.setProperty(cssVar, `${value}${axis === 'vertical' && value <= 100 ? '%' : 'px'}`);
  }, [cssVar, value, axis]);

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(value)); } catch {}
  }, [storageKey, value]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    
    setIsResizing(true);
    startPos.current = axis === 'horizontal' ? e.clientX : e.clientY;
    startValue.current = value;
    document.body.classList.add('is-resizing');
  }, [axis, value]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isResizing) return;

    const currentPos = axis === 'horizontal' ? e.clientX : e.clientY;
    let delta = currentPos - startPos.current;
    if (side === 'left' || side === 'top') delta = -delta;

    const newValue = Math.min(maxValue, Math.max(minValue, startValue.current + delta));
    if (newValue !== value) {
      setValue(newValue);
      if (onResize) onResize(newValue, newValue - startValue.current);
    }
  }, [isResizing, axis, side, maxValue, minValue, value, onResize]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isResizing) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setIsResizing(false);
    document.body.classList.remove('is-resizing');
  }, [isResizing]);

  const reset = useCallback(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  const handleStyle: React.CSSProperties = {
    position: 'absolute' as const,
    zIndex: 200,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    touchAction: 'none',
    ...(axis === 'horizontal' ? {
      top: 0, height: '100%', width: 12, [side]: -6, cursor: 'col-resize',
    } : {
      left: 0, width: '100%', height: 12, [side]: -6, cursor: 'row-resize',
    })
  };

  return {
    value,
    setValue,
    isResizing,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      style: handleStyle,
      'data-resize-handle': true,
    },
    reset,
  };
}
