import React, { useRef, useState, useEffect, useCallback } from 'react';

interface ScrollShadowProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  shadowColor?: string; // Allow overriding the shadow color (e.g. var(--surface-container-high))
  containerRef?: React.RefObject<HTMLDivElement>; // Support external ref for virtualization
}

/**
 * Wraps a scrollable container and shows fade shadows at the top/bottom
 * edges when content is scrolled (like VSCode's editor panels).
 */
export function ScrollShadow({ children, style, className, shadowColor = 'var(--surface)', containerRef }: ScrollShadowProps) {
  const localRef = useRef<HTMLDivElement>(null);
  const scrollRef = containerRef || localRef;
  const [showTop, setShowTop] = useState(false);
  const [showBottom, setShowBottom] = useState(false);

  const updateShadows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    
    const { scrollTop, scrollHeight, clientHeight } = el;
    
    // Using a 2px threshold to prevent flickering on sub-pixel scroll positions
    setShowTop(scrollTop > 2);
    // If scrollHeight is effectively equal to clientHeight, showBottom should be false
    setShowBottom(scrollHeight > clientHeight && scrollTop < scrollHeight - clientHeight - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    updateShadows();
    el.addEventListener('scroll', updateShadows, { passive: true });
    
    // ResizeObserver covers container size changes
    const resizeObserver = new ResizeObserver(updateShadows);
    resizeObserver.observe(el);

    // MutationObserver covers content changes (e.g. items added/removed)
    const mutationObserver = new MutationObserver(updateShadows);
    mutationObserver.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      el.removeEventListener('scroll', updateShadows);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [updateShadows, children]); // Re-run if children change significantly

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', ...style }} className={className}>
      {/* Scrollable container */}
      <div
        ref={scrollRef}
        className="scroll-shadow-content"
        style={{
          flex: 1,
          overflowY: 'auto',
          position: 'relative',
          scrollbarGutter: 'stable',
        }}
      >
        {children}
      </div>
    </div>
  );
}
