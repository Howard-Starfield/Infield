import React, { useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  onClick?: () => void;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  children: ReactNode;
}

interface MenuPosition {
  x: number;
  y: number;
}

export function ContextMenu({ items, children }: ContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ x: 0, y: 0 });
  const [activeIndex, setActiveIndex] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Calculate position, ensuring menu stays within viewport
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - (items.length * 36 + 16));

    setPosition({ x, y });
    setActiveIndex(-1);
    setVisible(true);
  }, [items.length]);

  const closeMenu = useCallback(() => {
    setVisible(false);
    setActiveIndex(-1);
  }, []);

  // Close on click outside or scroll
  useEffect(() => {
    if (!visible) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const handleScroll = () => closeMenu();
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('keydown', handleEscape);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [visible, closeMenu]);

  // Keyboard navigation
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const actionableItems = items.filter(item => !item.divider && !item.disabled);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(prev => {
          let next = prev + 1;
          while (next < items.length && (items[next].divider || items[next].disabled)) next++;
          return next < items.length ? next : prev;
        });
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(prev => {
          let next = prev - 1;
          while (next >= 0 && (items[next].divider || items[next].disabled)) next--;
          return next >= 0 ? next : prev;
        });
      }
      if (e.key === 'Tab') {
        e.preventDefault(); // For now, keep it simple: don't let tab leave the menu
        // In a real app we'd cycle through items, but arrow keys are preferred for context menus.
      }
      if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault();
        const item = items[activeIndex];
        if (item && !item.disabled && !item.divider && item.onClick) {
          item.onClick();
          closeMenu();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, activeIndex, items, closeMenu]);

  return (
    <>
      <div onContextMenu={handleContextMenu} style={{ display: 'contents' }}>
        {children}
      </div>

      {visible && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: position.y,
            left: position.x,
            minWidth: 200,
            background: 'var(--surface-container-highest)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 'var(--radius-container)',
            boxShadow: 'var(--shadow-xl)',
            backdropFilter: 'blur(24px)',
            padding: '4px 0',
            zIndex: 20000,
            animation: 'contextMenuIn 0.12s var(--ease-out)',
            willChange: 'transform, opacity',
            backfaceVisibility: 'hidden',
          }}
        >
          {items.map((item, index) => {
            if (item.divider) {
              return (
                <div
                  key={`divider-${index}`}
                  style={{
                    height: 1,
                    background: 'rgba(255, 255, 255, 0.06)',
                    margin: '4px 8px',
                  }}
                />
              );
            }

            return (
              <button
                key={index}
                disabled={item.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  if (item.onClick) item.onClick();
                  closeMenu();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  padding: '8px 12px',
                  background: activeIndex === index ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
                  border: 'none',
                  borderRadius: 0,
                  color: item.danger
                    ? 'var(--error)'
                    : item.disabled
                    ? 'var(--outline-variant)'
                    : 'var(--on-surface)',
                  fontSize: 'var(--text-base)',
                  fontWeight: 400,
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  opacity: item.disabled ? 0.5 : 1,
                  transition: 'background var(--duration-fast) var(--ease-out)',
                }}
              >
                {item.icon && (
                  <span style={{ display: 'flex', alignItems: 'center', color: 'var(--on-surface-variant)', width: 16 }}>
                    {item.icon}
                  </span>
                )}
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.shortcut && (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--on-surface-variant)', fontWeight: 500 }}>
                    {item.shortcut}
                  </span>
                )}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
