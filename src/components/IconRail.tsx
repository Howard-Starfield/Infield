import React from 'react';
import { LayoutDashboard, Info, Star, Search, Download, Mic, Headphones, FileText, Database, Lock, Settings, Inbox } from 'lucide-react';
import { useVault } from '../contexts/VaultContext';

interface IconRailProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

export function IconRail({ currentPage, onNavigate }: IconRailProps) {
  const { lock } = useVault();
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

  return (
    <nav className="icon-rail">
      {items.map(item => (
        <RailButton 
          key={item.id} 
          icon={item.icon} 
          title={item.title} 
          isActive={currentPage === item.id} 
          onClick={() => onNavigate(item.id)} 
        />
      ))}
      
      <div className="rail-spacer" />
      
      <div className="rail-divider" />
      <RailButton icon={Settings} title="Settings" isActive={currentPage === 'settings'} onClick={() => onNavigate('settings')} />
      <RailButton icon={Lock} title="Lock Vault" isActive={false} onClick={lock} />
    </nav>
  );
}

function RailButton({ icon: Icon, title, isActive, onClick }: { icon: any, title: string, isActive: boolean, onClick: () => void }) {
  return (
    <button onClick={onClick} className={`rail-btn ${isActive ? 'active' : ''}`}>
      <div className="rail-icon-wrapper">
        <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
      </div>
      <span className="rail-label">{title}</span>
    </button>
  );
}
