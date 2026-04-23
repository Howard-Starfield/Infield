import React, { useState, useEffect } from 'react';
import { HerOSInput } from './HerOS';
import { useStorageConfig } from '../hooks/useStorageConfig';
import { FolderOpen, Monitor, Volume2, Bell, Sparkles, Sliders, Zap, PartyPopper, MessageSquare, Globe, Shield, RefreshCw, Key, Brain, Cpu, Database, Command, Settings, Palette, Info, Layout } from 'lucide-react';
import { soundService } from '../services/SoundService';
import { useVault } from '../contexts/VaultContext';
import { UiPreferences } from '../types';
import { EbayConnectModal } from './EbayConnectModal';
import { toast } from 'sonner';
import { saveEbayOAuthAppSettingsNative, syncAllEbayDataNative, getLlmConfigNative, saveLlmConfigNative, LlmConfig } from '../tauri-bridge';
import { THEME_PRESETS, getThemeById } from '../services/ThemeService';

export function SettingsView() {
  const { storagePath, isLoading, selectDirectory } = useStorageConfig();
  const { vaultData, updateUiPreferences } = useVault();
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  
  // AI Config State
  const [llmConfig, setLlmConfig] = useState<LlmConfig | null>(null);
  const [isSavingLlm, setIsSavingLlm] = useState(false);

  // UI Scaling state
  const [uiScale, setUiScale] = useState(() => {
    const saved = localStorage.getItem('ui-scale');
    return saved ? parseFloat(saved) : 1.0;
  });

  // Sound settings
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('vault-volume');
    return saved ? parseFloat(saved) : 0.5;
  });
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('vault-sound-enabled');
    return saved === null ? true : saved === 'true';
  });

  // Load LLM Config on mount
  useEffect(() => {
    getLlmConfigNative().then(config => {
      if (config) setLlmConfig(config);
    });
  }, []);

  const handleSaveLlm = async (updates: Partial<LlmConfig>) => {
    if (!llmConfig) return;
    const newConfig = { ...llmConfig, ...updates };
    setLlmConfig(newConfig);
    setIsSavingLlm(true);
    try {
      await saveLlmConfigNative(newConfig);
      toast.success('AI configuration updated');
    } catch (e: any) {
      toast.error(`Failed to save AI config: ${e.toString()}`);
    } finally {
      setIsSavingLlm(false);
    }
  };

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', uiScale.toString());
    localStorage.setItem('ui-scale', uiScale.toString());
    window.dispatchEvent(new Event('storage'));
  }, [uiScale]);

  const applyThemePreset = async (presetId: string) => {
    const preset = getThemeById(presetId);
    await updateUiPreferences({
      ...prefs,
      themeColor: preset.brand,
      bgColorA: preset.bgA,
      bgColorB: preset.bgB,
      bgColorC: preset.bgC,
    });
    toast.success(`Applied ${preset.name} theme`);
  };

  useEffect(() => {
    localStorage.setItem('vault-volume', volume.toString());
  }, [volume]);

  useEffect(() => {
    localStorage.setItem('vault-sound-enabled', soundEnabled.toString());
  }, [soundEnabled]);
  
  if (!vaultData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--on-surface-variant)' }}>
        <div style={{ textAlign: 'center' }}>
          <RefreshCw className="spin" size={32} style={{ marginBottom: 16, opacity: 0.5 }} />
          <p style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Accessing Secure Volume...</p>
        </div>
      </div>
    );
  }

  const prefs = vaultData.uiPreferences || {
    themeColor: '#cc4c2b',
    glassIntensity: 60,
    grainIntensity: 50,
    autoSyncEnabled: true,
    syncInterval: 15,
    animationIntensity: 'high',
    bgSpeed: 50,
    bgColorA: '#2a145c',
    bgColorB: '#b5369c',
    bgColorC: '#1a8bb5',
    spotlightTrigger: 'KeyF',
    uiScale: 1.0
  };

  const handleUpdateUiPref = (key: keyof UiPreferences, value: any) => {
    const newPrefs = { ...prefs, [key]: value };
    updateUiPreferences(newPrefs);
  };

  const sections = [
    { id: 'general', label: 'General', icon: <Settings size={16} /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
    { id: 'marketplace', label: 'Connectivity', icon: <Globe size={16} /> },
    { id: 'storage', label: 'Storage', icon: <Database size={16} /> },
    { id: 'controls', label: 'Precision', icon: <Command size={16} /> },
    { id: 'theme', label: 'Atmosphere', icon: <Sparkles size={16} /> },
    { id: 'model', label: 'Neural Model', icon: <Cpu size={16} /> },
    { id: 'prompts', label: 'AI Prompts', icon: <MessageSquare size={16} /> },
    { id: 'advance', label: 'Advanced', icon: <Shield size={16} /> },
    { id: 'about', label: 'About Vault', icon: <Info size={16} /> },
  ];

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="heros-page-container" style={{ position: 'relative', zIndex: 5, height: '100%', display: 'flex', flexDirection: 'column', maxWidth: '1200px', margin: '0 auto', padding: '40px' }}>
      <header style={{ marginBottom: '48px', textAlign: 'center', flexShrink: 0 }}>
        <div style={{ 
          width: 64, height: 64, borderRadius: 20, 
          background: 'linear-gradient(135deg, var(--heros-brand) 0%, #ff8566 100%)',
          margin: '0 auto 24px auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 12px 32px rgba(204, 76, 43, 0.2)'
        }}>
          <Sliders size={32} color="#fff" />
        </div>
        <h1 style={{ fontSize: '32px', fontWeight: 800, color: '#fff', marginBottom: '8px' }}>System Preferences</h1>
        <p style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '16px' }}>Configure your Sovereign Vault experience and neural intelligence.</p>
      </header>

      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '200px 1fr 200px', 
        gap: '64px', 
        flex: 1, 
        overflow: 'hidden',
        width: '100%'
      }}>
        {/* Sticky Sidebar Navigation */}
        <aside style={{ width: '200px', position: 'sticky', top: 0, height: 'fit-content' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {sections.map(section => (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                className="heros-btn"
                style={{ 
                  justifyContent: 'flex-start', 
                  width: '100%', 
                  padding: '10px 14px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderRadius: '12px'
                }}
              >
                <span style={{ color: 'var(--heros-brand)', opacity: 0.8, display: 'flex' }}>{section.icon}</span>
                <span style={{ marginLeft: '10px' }}>{section.label}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Scrollable Content Area */}
        <main className="custom-scrollbar" style={{ overflowY: 'auto', height: '100%', paddingRight: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', width: '100%', maxWidth: '800px', margin: '0 auto', paddingBottom: '120px' }}>
            
            {/* General System */}
            <section id="general" className="heros-glass-card" style={{ padding: '32px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Settings size={18} /> General System
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>Launch on Startup</div>
                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>Automatically open Sovereign Vault when logging in.</div>
                  </div>
                  <div style={{ width: 44, height: 22, background: 'rgba(255,255,255,0.1)', borderRadius: 11, position: 'relative', cursor: 'pointer' }}>
                    <div style={{ width: 18, height: 18, background: 'var(--heros-brand)', borderRadius: '50%', position: 'absolute', right: 2, top: 2 }} />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>System Sounds</div>
                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>Enable auditory feedback for notifications and actions.</div>
                  </div>
                  <div 
                    onClick={() => setSoundEnabled(!soundEnabled)}
                    style={{ width: 44, height: 22, background: soundEnabled ? 'var(--heros-brand)' : 'rgba(255,255,255,0.1)', borderRadius: 11, position: 'relative', cursor: 'pointer', transition: 'all 0.3s ease' }}
                  >
                    <div style={{ width: 18, height: 18, background: '#fff', borderRadius: '50%', position: 'absolute', left: soundEnabled ? 24 : 2, top: 2, transition: 'all 0.3s ease' }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Master Volume</span>
                    <span style={{ fontSize: '14px', color: 'var(--heros-brand)', fontWeight: 800 }}>{Math.round(volume * 100)}%</span>
                  </div>
                  <input 
                    type="range" min="0" max="1" step="0.01"
                    value={volume} 
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--heros-brand)', cursor: 'pointer' }}
                  />
                </div>
              </div>
            </section>

            {/* Appearance Placeholder */}
            <section id="appearance" className="heros-glass-card" style={{ padding: '32px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Palette size={18} /> Visual Interface
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>Interface Scaling</div>
                    <span style={{ fontSize: '14px', color: 'var(--heros-brand)', fontWeight: 800 }}>{uiScale.toFixed(2)}x</span>
                  </div>
                  <input 
                    type="range" min="0.8" max="1.4" step="0.05"
                    value={uiScale} 
                    onChange={(e) => setUiScale(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--heros-brand)', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>COMPACT</span>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>STANDARD</span>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>COMFORTABLE</span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>Hardware Acceleration</div>
                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>Use GPU for smoother animations and waves.</div>
                  </div>
                  <div style={{ width: 44, height: 22, background: 'var(--heros-brand)', borderRadius: 11, position: 'relative', cursor: 'pointer' }}>
                    <div style={{ width: 18, height: 18, background: '#fff', borderRadius: '50%', position: 'absolute', right: 2, top: 2 }} />
                  </div>
                </div>
              </div>
            </section>
            
            {/* eBay Accounts & Connectivity */}
            <section id="marketplace" className="heros-glass-card" style={{ padding: '32px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <h3 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Globe size={18} /> Marketplace Connectivity
                </h3>
                <button 
                  className="heros-btn"
                  onClick={() => setIsConnectModalOpen(true)}
                  style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 600, borderRadius: '12px' }}
                >
                  Link eBay Account
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(!vaultData?.ebayAccounts || vaultData.ebayAccounts.length === 0) ? (
                  <div style={{ 
                    padding: '32px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', 
                    background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: '1px dashed rgba(255,255,255,0.1)' 
                  }}>
                    No marketplace accounts connected.
                  </div>
                ) : (
                  vaultData.ebayAccounts.map(account => (
                    <div key={account.accountId} style={{ 
                      padding: '20px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', 
                      border: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <div style={{ 
                          width: 48, height: 48, borderRadius: '14px', background: 'var(--heros-brand)', 
                          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '18px' 
                        }}>
                          {(account.accountLabel || account.accountId).charAt(0)}
                        </div>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>{account.accountLabel || account.accountId}</div>
                          <div style={{ fontSize: '12px', color: account.authStatus === 'connected' ? '#4ade80' : '#f87171', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: account.authStatus === 'connected' ? '#4ade80' : '#f87171', boxShadow: `0 0 10px ${account.authStatus === 'connected' ? '#4ade8044' : '#f8717144'}` }} />
                            <span style={{ letterSpacing: '0.08em' }}>{account.authStatus === 'connected' ? 'SECURELY CONNECTED' : 'RE-AUTHENTICATION REQUIRED'}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 12 }}>
                        <button 
                          className="heros-btn"
                          onClick={async () => {
                            try {
                              toast.info(`Synchronizing ${account.accountLabel || account.accountId}...`);
                              await syncAllEbayDataNative(vaultData!, account.accountId);
                              toast.success(`Sync complete for ${account.accountLabel || account.accountId}`);
                            } catch (e: any) {
                              toast.error(`Sync failed: ${e.toString()}`);
                            }
                          }}
                          style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 600, borderRadius: '12px' }}
                        >
                          <RefreshCw size={14} /> Sync
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Storage Configuration */}
            <section id="storage" className="heros-glass-card" style={{ padding: '32px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Database size={18} /> Vault Storage
              </h3>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>Storage Path</div>
                  <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{storagePath || 'No directory selected'}</div>
                </div>
                <button 
                  className="heros-btn" 
                  onClick={selectDirectory}
                  style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 600, borderRadius: '12px' }}
                >
                  <FolderOpen size={16} /> Change Directory
                </button>
              </div>
            </section>

            {/* Precision Controls & Shortcuts */}
            <section id="controls" className="heros-glass-card" style={{ padding: '32px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Command size={18} /> Precision Controls
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '32px' }}>
                <div>
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>Spotlight Trigger</div>
                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>Primary shortcut for the command palette</div>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button 
                      onClick={() => handleUpdateUiPref('spotlightTrigger', 'KeyF')}
                      style={{ 
                        flex: 1, padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)',
                        background: prefs.spotlightTrigger === 'KeyF' ? 'rgba(204, 76, 43, 0.15)' : 'rgba(0,0,0,0.2)',
                        color: prefs.spotlightTrigger === 'KeyF' ? 'var(--heros-brand)' : 'rgba(255,255,255,0.5)',
                        fontSize: '13px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.3s ease'
                      }}
                    >
                      Ctrl + F
                    </button>
                    <button 
                      onClick={() => handleUpdateUiPref('spotlightTrigger', 'Space')}
                      style={{ 
                        flex: 1, padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)',
                        background: prefs.spotlightTrigger === 'Space' ? 'rgba(204, 76, 43, 0.15)' : 'rgba(0,0,0,0.2)',
                        color: prefs.spotlightTrigger === 'Space' ? 'var(--heros-brand)' : 'rgba(255,255,255,0.5)',
                        fontSize: '13px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.3s ease'
                      }}
                    >
                      Ctrl + Space
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Unified Theme & Atmosphere */}
            <section id="theme" className="heros-glass-card" style={{ padding: '32px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Sparkles size={18} /> Unified Theme & Atmosphere
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
                
                {/* Atmosphere Presets Subsection */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
                    <Layout size={16} color="var(--heros-brand)" />
                    <h4 style={{ fontSize: '15px', fontWeight: 600, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Atmosphere Presets</h4>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                    {THEME_PRESETS.map(preset => {
                      const isActive = prefs.themeColor === preset.brand;
                      return (
                        <button
                          key={preset.id}
                          onClick={() => applyThemePreset(preset.id)}
                          className="heros-glass-card"
                          style={{
                            padding: '16px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '12px',
                            cursor: 'pointer',
                            background: isActive ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.2)',
                            borderColor: isActive ? preset.brand : 'rgba(255,255,255,0.05)',
                            transition: 'all 0.3s ease',
                            borderWidth: isActive ? '2px' : '1px',
                          }}
                        >
                          <div style={{ 
                            width: '100%', height: '60px', borderRadius: '8px',
                            background: `linear-gradient(135deg, ${preset.bgA}, ${preset.bgB}, ${preset.bgC})`,
                            boxShadow: isActive ? `0 0 20px ${preset.brand}44` : 'none'
                          }} />
                          <span style={{ 
                            fontSize: '12px', fontWeight: 700, 
                            color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
                            textTransform: 'uppercase', letterSpacing: '0.05em'
                          }}>
                            {preset.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }} />

                {/* UI Scale — coordinated app-wide pixel multiplier (zoom + token).
                    Range 0.5–1.5; preset rail jumps to common sizes. Cmd/Ctrl + = / - / 0
                    nudges by 5% / resets. Persists via localStorage on every change
                    (VaultContext.applyUiScale). */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>UI Scale</span>
                    <span style={{ fontSize: '14px', color: 'var(--heros-brand)', fontWeight: 800 }}>
                      {Math.round(((prefs.uiScale ?? 1.0) as number) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range" min="0.5" max="1.5" step="0.05"
                    value={(prefs.uiScale ?? 1.0) as number}
                    onChange={(e) => handleUpdateUiPref('uiScale', parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--heros-brand)', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                    {[
                      { label: 'Compact', value: 0.85 },
                      { label: 'Default', value: 1.0 },
                      { label: 'Large', value: 1.15 },
                    ].map((p) => {
                      const active = Math.abs(((prefs.uiScale ?? 1.0) as number) - p.value) < 0.001
                      return (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => handleUpdateUiPref('uiScale', p.value)}
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            fontWeight: 600,
                            letterSpacing: '0.04em',
                            borderRadius: '8px',
                            border: '1px solid rgba(255,255,255,0.1)',
                            background: active ? 'color-mix(in srgb, var(--heros-brand) 20%, transparent)' : 'rgba(255,255,255,0.04)',
                            color: active ? '#fff' : 'rgba(255,255,255,0.6)',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                          }}
                        >
                          {p.label} · {Math.round(p.value * 100)}%
                        </button>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '12px', marginBottom: 0 }}>
                    Below 100%: text shrinks, window stays — more content fits. Above 100%:
                    text grows, window grows proportionally to prevent clipping.
                    Cmd/Ctrl + = / - / 0 to nudge or reset.
                  </p>
                </div>

                <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }} />

                {/* Glass & Grain Subsection */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '32px' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Glass Intensity</span>
                      <span style={{ fontSize: '14px', color: 'var(--heros-brand)', fontWeight: 800 }}>{prefs.glassIntensity}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="100" 
                      value={prefs.glassIntensity} 
                      onChange={(e) => handleUpdateUiPref('glassIntensity', parseInt(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--heros-brand)', cursor: 'pointer' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Film Grain Strength</span>
                      <span style={{ fontSize: '14px', color: 'var(--heros-brand)', fontWeight: 800 }}>{prefs.grainIntensity}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="100" 
                      value={prefs.grainIntensity} 
                      onChange={(e) => handleUpdateUiPref('grainIntensity', parseInt(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--heros-brand)', cursor: 'pointer' }}
                    />
                  </div>
                </div>

                {/* Background Subsection */}
                <div style={{ paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
                    <Zap size={16} color="var(--heros-brand)" />
                    <h4 style={{ fontSize: '15px', fontWeight: 600, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Kinetic Background</h4>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Wave Motion Speed</span>
                        <span style={{ fontSize: '14px', color: 'var(--heros-brand)', fontWeight: 800 }}>{prefs.bgSpeed}%</span>
                      </div>
                      <input 
                        type="range" min="0" max="200" 
                        value={prefs.bgSpeed} 
                        onChange={(e) => handleUpdateUiPref('bgSpeed', parseInt(e.target.value))}
                        style={{ width: '100%', accentColor: 'var(--heros-brand)', cursor: 'pointer' }}
                      />
                    </div>

                    <div>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.7)', display: 'block', marginBottom: '16px' }}>Neural Color Palette</span>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>Color A</span>
                          <input 
                            type="color" 
                            value={prefs.bgColorA || '#2a145c'} 
                            onChange={(e) => handleUpdateUiPref('bgColorA', e.target.value)}
                            style={{ width: '100%', height: '40px', border: 'none', borderRadius: '8px', background: 'transparent', cursor: 'pointer' }}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>Color B</span>
                          <input 
                            type="color" 
                            value={prefs.bgColorB || '#b5369c'} 
                            onChange={(e) => handleUpdateUiPref('bgColorB', e.target.value)}
                            style={{ width: '100%', height: '40px', border: 'none', borderRadius: '8px', background: 'transparent', cursor: 'pointer' }}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>Color C</span>
                          <input 
                            type="color" 
                            value={prefs.bgColorC || '#1a8bb5'} 
                            onChange={(e) => handleUpdateUiPref('bgColorC', e.target.value)}
                            style={{ width: '100%', height: '40px', border: 'none', borderRadius: '8px', background: 'transparent', cursor: 'pointer' }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Neural AI Configuration */}
            <section id="neural" className="heros-glass-card" style={{ padding: '32px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Brain size={18} /> Neural Configuration
              </h3>

              {llmConfig && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.12em', display: 'block', marginBottom: '12px' }}>
                      OpenAI API Endpoint
                    </label>
                    <HerOSInput 
                      value={llmConfig.openai_api_url}
                      onChange={(e) => setLlmConfig({...llmConfig, openai_api_url: e.target.value})}
                      onBlur={() => handleSaveLlm({ openai_api_url: llmConfig.openai_api_url })}
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.12em', display: 'block', marginBottom: '12px' }}>
                      Secret Intelligence Key
                    </label>
                    <HerOSInput 
                      type="password"
                      value={llmConfig.openai_api_key}
                      onChange={(e) => setLlmConfig({...llmConfig, openai_api_key: e.target.value})}
                      onBlur={() => handleSaveLlm({ openai_api_key: llmConfig.openai_api_key })}
                      placeholder="sk-..."
                      icon={<Key size={18} color="rgba(255,255,255,0.2)" />}
                    />
                  </div>
                </div>
              )}
            </section>

            {/* Model Placeholder */}
            <section id="model" className="heros-glass-card" style={{ padding: '32px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Cpu size={18} /> Neural Model
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>Temperature</span>
                      <span style={{ fontSize: '13px', color: 'var(--heros-brand)', fontWeight: 800 }}>0.7</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.1" value="0.7" style={{ width: '100%', accentColor: 'var(--heros-brand)' }} readOnly />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>Context Limit</span>
                      <span style={{ fontSize: '13px', color: 'var(--heros-brand)', fontWeight: 800 }}>128K</span>
                    </div>
                    <input type="range" min="8" max="200" step="8" value="128" style={{ width: '100%', accentColor: 'var(--heros-brand)' }} readOnly />
                  </div>
                </div>

                <div style={{ padding: '20px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: 8 }}>Active Shard: Claude-3.5-Sonnet</div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>Engine is currently running on localized cloud hybrid.</div>
                </div>
              </div>
            </section>

            {/* Prompts Placeholder */}
            <section id="prompts" className="heros-glass-card" style={{ padding: '32px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <MessageSquare size={18} /> AI System Prompts
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', display: 'block', marginBottom: 12 }}>Primary Directive</label>
                  <textarea 
                    placeholder="You are a helpful assistant..."
                    style={{ 
                      width: '100%', height: '120px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', 
                      borderRadius: 12, padding: 16, color: '#fff', fontSize: '14px', resize: 'none', fontFamily: 'inherit'
                    }}
                    defaultValue="You are the Infield AI, a hyper-efficient data sovereignty engine. Assist the user with marketplace management while maintaining absolute privacy protocols."
                  />
                </div>
              </div>
            </section>

            {/* Advance Placeholder */}
            <section id="advance" className="heros-glass-card" style={{ padding: '32px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Shield size={18} /> Advanced Protocols
              </h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <button className="heros-btn" style={{ justifyContent: 'center', border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)', padding: '12px 20px', fontSize: '13px', fontWeight: 600, borderRadius: '12px' }}>
                  <Database size={16} /> Vacuum Database
                </button>
                <button className="heros-btn" style={{ justifyContent: 'center', border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)', padding: '12px 20px', fontSize: '13px', fontWeight: 600, borderRadius: '12px' }}>
                  <RefreshCw size={16} /> Purge Sync Cache
                </button>
                <button className="heros-btn" style={{ justifyContent: 'center', border: '1px solid rgba(239, 68, 68, 0.1)', color: '#f87171', gridColumn: 'span 2', padding: '12px 20px', fontSize: '13px', fontWeight: 600, borderRadius: '12px' }}>
                  Destroy Local Vault Instance
                </button>
              </div>
            </section>

            {/* About Placeholder */}
            <section id="about" className="heros-glass-card" style={{ padding: '32px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Info size={18} /> About Sovereign Vault
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { label: 'Version', value: 'v2.4.0-stable' },
                  { label: 'Core Engine', value: 'Tauri / Rust' },
                  { label: 'Encryption', value: 'AES-256-GCM' },
                  { label: 'Build Number', value: '2026.0423.A1' }
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.3)' }}>{item.label}</span>
                    <span style={{ fontSize: '13px', color: '#fff', fontWeight: 600 }}>{item.value}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>
        {/* Ghost Spacer to balance the grid and keep center content truly centered */}
        <div style={{ width: '200px', flexShrink: 0 }} />
      </div>

      <EbayConnectModal 
        isOpen={isConnectModalOpen} 
        onClose={() => setIsConnectModalOpen(false)} 
      />
    </div>
  );
}

