import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { LayoutDashboard, Info, Star, Search, Download, Mic, Headphones, FileText, Database, Lock, Settings, Inbox } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useVault } from '../contexts/VaultContext';

interface IconRailProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

export function IconRail({ currentPage, onNavigate }: IconRailProps) {
  const { lock } = useVault();
  const railRef = useRef<HTMLElement | null>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState({ top: 0, visible: false });

  const items = [
    { id: 'dashboard', icon: LayoutDashboard, title: 'Home' },
    { id: 'search', icon: Search, title: 'Neural Search' },
    { id: 'import', icon: Download, title: 'Import' },
    { id: 'audio', icon: Mic, title: 'Audio Intelligence' },
    { id: 'system-audio', icon: Headphones, title: 'System Audio Capture' },
    { id: 'notes', icon: FileText, title: 'Persistent Notes' },
    { id: 'databases', icon: Database, title: 'Databases' },
    { id: 'inbox', icon: Inbox, title: 'Inbox' },
    { id: 'activity', icon: Star, title: 'Favorites' },
    { id: 'about', icon: Info, title: 'About' },
  ];

  const setButtonRef = useCallback(
    (id: string) => (node: HTMLButtonElement | null) => {
      if (node) {
        buttonRefs.current.set(id, node);
      } else {
        buttonRefs.current.delete(id);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    const rail = railRef.current;
    const activeButton = buttonRefs.current.get(currentPage);

    if (!rail || !activeButton) {
      setIndicator((current) => ({ ...current, visible: false }));
      return;
    }

    let frame = 0;

    const updateIndicator = () => {
      const railRect = rail.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();
      const top = buttonRect.top - railRect.top + buttonRect.height / 2 - 9;
      setIndicator({ top, visible: true });
    };

    frame = window.requestAnimationFrame(updateIndicator);

    const resizeObserver = new ResizeObserver(updateIndicator);
    resizeObserver.observe(rail);
    resizeObserver.observe(activeButton);
    window.addEventListener('resize', updateIndicator);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateIndicator);
    };
  }, [currentPage]);

  const railStyle = {
    '--rail-indicator-y': `${indicator.top}px`,
  } as React.CSSProperties & { '--rail-indicator-y': string };

  return (
    <nav ref={railRef} className="icon-rail" style={railStyle}>
      <span className={`rail-active-indicator ${indicator.visible ? 'visible' : ''}`} aria-hidden="true" />
      {items.map(item => (
        <RailButton 
          key={item.id} 
          ref={setButtonRef(item.id)}
          icon={item.icon} 
          title={item.title} 
          isActive={currentPage === item.id} 
          onClick={() => onNavigate(item.id)} 
        />
      ))}
      
      <div className="rail-spacer" />
      
      <div className="rail-divider" />
      <RailButton ref={setButtonRef('settings')} icon={Settings} title="Settings" isActive={currentPage === 'settings'} onClick={() => onNavigate('settings')} />
      <RailButton icon={Lock} title="Lock Vault" isActive={false} onClick={lock} />
    </nav>
  );
}

const RailButton = React.forwardRef<HTMLButtonElement, { icon: LucideIcon, title: string, isActive: boolean, onClick: () => void }>(
  function RailButton({ icon: Icon, title, isActive, onClick }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        className={`rail-btn ${isActive ? 'active' : ''}`}
        aria-current={isActive ? 'page' : undefined}
      >
        <div className="rail-icon-wrapper">
          <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
        </div>
        <span className="rail-label">{title}</span>
      </button>
    );
  },
);
