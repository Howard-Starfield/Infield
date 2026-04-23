import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Minus, Square, X, Bell, Lock, Unlock, Menu, Search, User, Copy, Layout, Check, ChevronDown, RefreshCw, Activity, Zap, Plus } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { HerOSInput } from './HerOS';
import { useVault } from '../contexts/VaultContext';
import { toast } from 'sonner';
import { useLayout } from '../contexts/LayoutContext';

const AUTO_LOCK_SECONDS = 5 * 60; // 5 minutes

interface TitleBarProps {
  currentPath: string;
}

export function TitleBar({ currentPath }: TitleBarProps) {
  const { vaultData, lock } = useVault();
  const { isLayoutMode, toggleLayoutMode, panelVisibility, togglePanel } = useLayout();
  
  // Compute System Status
  const pendingActionsCount = vaultData?.ebayActionQueue?.filter(a => a.status === 'pending' || a.status === 'processing').length || 0;
  const isSyncing = vaultData?.uiPreferences?.autoSyncEnabled && (Date.now() % 60000 < 5000); // Mock sync activity pulse
  const accountsHealthy = vaultData?.ebayAccounts?.every(a => a.authStatus === 'connected') ?? true;
  
  const [secondsLeft, setSecondsLeft] = useState(AUTO_LOCK_SECONDS);
  const [isFocused, setIsFocused] = useState(true);
  const lastActivityRef = useRef(Date.now());
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowViewMenu(false);
      }
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    if (showViewMenu || showAddMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showViewMenu, showAddMenu]);

  // Ctrl+K to focus search (like VSCode / Discord)
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      const isSearchKey = (e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'f');
      if (isSearchKey) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape') {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
    };
    
    const handleFocus = () => setIsFocused(true);
    const handleBlur = () => setIsFocused(false);

    window.addEventListener('keydown', handleGlobalKeys);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    
    return () => {
      window.removeEventListener('keydown', handleGlobalKeys);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Reset timer on any user interaction
  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setSecondsLeft(AUTO_LOCK_SECONDS);
  }, []);

  useEffect(() => {
    const events = ['mousedown', 'keydown', 'mousemove', 'wheel', 'touchstart'];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, resetTimer));
  }, [resetTimer]);

  // Countdown tick
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastActivityRef.current) / 1000);
      const remaining = Math.max(0, AUTO_LOCK_SECONDS - elapsed);
      setSecondsLeft(remaining);
      if (remaining === 0) {
        toast.warning('Vault auto-locked due to inactivity');
        lock();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lock, toast]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const isUrgent = secondsLeft < 60;

  // Tauri 2: use the imported getCurrentWindow() directly. The
  // previous handlers used `window.__TAURI__` (Tauri 1 global) which
  // is undefined in Tauri 2 unless withGlobalTauri is enabled — so
  // every click was a silent no-op.
  const minimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (err) {
      console.warn('[TitleBar] minimize failed:', err);
    }
  };
  const maximize = async () => {
    try {
      const win = getCurrentWindow();
      if (await win.isMaximized()) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    } catch (err) {
      console.warn('[TitleBar] maximize toggle failed:', err);
    }
  };
  const close = async () => {
    try {
      await getCurrentWindow().close();
    } catch (err) {
      console.warn('[TitleBar] close failed:', err);
    }
  };

  const btnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: 'var(--on-surface-variant)',
    cursor: 'pointer',
    padding: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    transition: 'background 0.2s',
  };

  return (
    <header 
      data-tauri-drag-region
      className={`window-chrome ${!isFocused ? 'unfocused' : ''}`}
      onContextMenu={(e) => e.preventDefault()}
      style={{ 
        height: 48,
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        userSelect: 'none',
        cursor: 'default',
        zIndex: 1000,
      }}
    >
      {/* Left cluster — App Menu & Title */}
      <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 12, flex: 1, height: '100%' }}>
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button 
            style={{ ...btnStyle, background: showViewMenu ? 'rgba(255,255,255,0.05)' : 'none' }} 
            onClick={() => setShowViewMenu(!showViewMenu)}
            title="App menu"
          >
            <Menu size={18} />
          </button>
          
          {showViewMenu && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              width: 220,
              background: 'var(--surface-container-highest)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              padding: 4,
              boxShadow: 'var(--shadow-lg)',
              zIndex: 2000,
              marginTop: 4,
            }}>
              <div style={{ padding: '6px 12px', fontSize: 'var(--text-xs)', color: 'var(--on-surface-variant)', fontWeight: 600 }}>VIEW</div>
              <button 
                onClick={() => { toggleLayoutMode(); setShowViewMenu(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', borderRadius: 4, color: 'var(--on-surface)', cursor: 'pointer', textAlign: 'left', transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Layout size={14} color={isLayoutMode ? 'var(--primary)' : 'currentColor'} />
                <span style={{ flex: 1, fontSize: 'var(--text-sm)' }}>{isLayoutMode ? 'Finish Editing Layout' : 'Edit Layout Mode'}</span>
                {isLayoutMode && <Check size={14} color="var(--primary)" />}
              </button>

              <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '4px 8px' }} />
              <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Show Panels</div>
              
              {(['inbox', 'workspace', 'inspector'] as const).map(id => (
                <button 
                  key={id}
                  onClick={() => togglePanel(id as any)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', borderRadius: 4, color: 'var(--on-surface)', cursor: 'pointer', textAlign: 'left', transition: 'background 0.2s'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {panelVisibility[id] && <Check size={14} color="var(--primary)" />}
                  </div>
                  <span style={{ flex: 1, fontSize: 'var(--text-sm)', textTransform: 'capitalize' }}>{id}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* Three dots logo */}
        <div style={{ display: 'flex', gap: 6, marginRight: 16 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.4)' }} />
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.2)' }} />
        </div>
        
        <span data-tauri-drag-region style={{ fontSize: '11px', fontWeight: 800, color: '#fff', opacity: 0.5, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          INFIELD  <span style={{ margin: '0 8px' }}>·</span>  VAULT - PERSONAL
        </span>
      </div>

      {/* Center — search bar */}
      <div data-tauri-drag-region style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '320px' }}>
          <HerOSInput 
            ref={searchRef}
            placeholder="Search  ⌘K" 
            icon={<Search size={16} />}
            className="heros-search-field"
          />
        </div>
      </div>

      {/* Right cluster */}
      <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', flex: 1, justifyContent: 'flex-end', height: '100%' }}>
        {/* Layout Toggle (Option A) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {isLayoutMode && (
            <div ref={addMenuRef} style={{ position: 'relative' }}>
              <button 
                style={{ ...btnStyle, background: showAddMenu ? 'rgba(255,255,255,0.05)' : 'rgba(204, 76, 43, 0.2)', color: 'var(--heros-brand)' }} 
                onClick={() => setShowAddMenu(!showAddMenu)}
                title="Add panel"
              >
                <Plus size={18} />
              </button>

              {showAddMenu && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, width: 200,
                  background: 'rgba(20, 21, 26, 0.95)', backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
                  padding: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.4)', zIndex: 2000, marginTop: 8
                }}>
                  <div style={{ padding: '4px 12px', fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Add Component</div>
                  {(['inbox', 'workspace', 'inspector'] as const).map(id => {
                    const isVisible = panelVisibility[id];
                    if (isVisible) return null;
                    return (
                      <button 
                        key={id}
                        onClick={() => { togglePanel(id); setShowAddMenu(false); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', 
                          background: 'transparent', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', textAlign: 'left'
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <Plus size={14} color="var(--heros-brand)" />
                        <span style={{ fontSize: 12, textTransform: 'capitalize' }}>{id}</span>
                      </button>
                    );
                  })}
                  {Object.values(panelVisibility).every(v => v) && (
                    <div style={{ padding: '8px 12px', fontSize: 11, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>All panels are visible</div>
                  )}
                </div>
              )}
            </div>
          )}
          
          <button 
            style={{ ...btnStyle, color: isLayoutMode ? 'var(--primary)' : 'var(--on-surface-variant)' }} 
            onClick={toggleLayoutMode}
            title={isLayoutMode ? "Finish Layout" : "Customize Workspace"}
          >
            <Layout size={18} />
          </button>
        </div>

        <button style={btnStyle} title="Notifications"><Bell size={16} /></button>
        
        {/* System Pulse Indicator */}
        <div data-tauri-drag-region style={{ 
          display: 'flex', alignItems: 'center', gap: 16, marginRight: 16, padding: '4px 12px',
          background: 'rgba(255,255,255,0.03)', borderRadius: '100px', border: '1px solid rgba(255,255,255,0.05)'
        }}>
          {/* Heartbeat Pulse */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }} title="Background Worker Status">
            <div className="pulse-dot" style={{ 
              width: 6, height: 6, borderRadius: '50%', 
              background: accountsHealthy ? 'var(--success)' : 'var(--error)',
              boxShadow: accountsHealthy ? '0 0 8px var(--success)' : '0 0 8px var(--error)'
            }} />
            <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--on-surface-variant)', letterSpacing: '0.05em' }}>
              {accountsHealthy ? 'HUB ACTIVE' : 'REAUTH REQ'}
            </span>
          </div>

          {/* Sync Pulse */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: isSyncing ? 1 : 0.4 }} title="eBay Data Sync">
            <RefreshCw size={12} className={isSyncing ? "animate-spin" : ""} color="var(--primary)" />
            <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--on-surface-variant)', letterSpacing: '0.05em' }}>SYNC</span>
          </div>

          {/* Queue Pulse */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={`${pendingActionsCount} Actions Pending`}>
            <Zap size={12} color={pendingActionsCount > 0 ? "var(--warning)" : "var(--on-surface-variant)"} />
            <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--on-surface-variant)', letterSpacing: '0.05em' }}>
              Q: {pendingActionsCount}
            </span>
          </div>
        </div>

        {/* Vault Status Badge */}
        <div data-tauri-drag-region style={{ 
          background: 'rgba(16, 185, 129, 0.1)', 
          color: 'var(--success)', 
          padding: '4px 10px', 
          borderRadius: '100px', 
          fontSize: '11px', 
          fontWeight: 700, 
          display: 'flex', 
          alignItems: 'center', 
          gap: 6,
          marginRight: 12,
          border: '1px solid rgba(16, 185, 129, 0.2)'
        }}>
          <Lock size={10} />
          {timeStr}
        </div>

        {/* Window controls */}
        <div style={{ display: 'flex', height: '100%' }}>
          <button className="win-btn" onClick={minimize}><Minus size={14} /></button>
          <button className="win-btn" onClick={maximize}><Square size={12} /></button>
          <button className="win-btn close" onClick={close}><X size={14} /></button>
        </div>
      </div>
    </header>
  );
}
