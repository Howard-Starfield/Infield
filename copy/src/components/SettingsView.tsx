import React, { useState, useEffect } from 'react';
import { HerOSInput } from './HerOS';
import { useStorageConfig } from '../hooks/useStorageConfig';
import { FolderOpen, Monitor, Volume2, Bell, Sparkles, Sliders, Zap, PartyPopper, MessageSquare, Globe, Shield, RefreshCw, Key, Brain, Cpu, Database } from 'lucide-react';
import { soundService } from '../services/SoundService';
import { useVault } from '../contexts/VaultContext';
import { UiPreferences } from '../types';
import { EbayConnectModal } from './EbayConnectModal';
import { toast } from 'sonner';
import { saveEbayOAuthAppSettingsNative, syncAllEbayDataNative, getLlmConfigNative, saveLlmConfigNative, LlmConfig } from '../tauri-bridge';

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
    animationIntensity: 'high'
  };

  const handleUpdateUiPref = (key: keyof UiPreferences, value: any) => {
    const newPrefs = { ...prefs, [key]: value };
    updateUiPreferences(newPrefs);
  };

  return (
    <div className="heros-page-container" style={{ position: 'relative', zIndex: 5, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ marginBottom: '24px', flexShrink: 0 }}>
        <h1 style={{ fontSize: '32px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>System Preferences</h1>
        <p style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '15px' }}>Configure your Sovereign Vault experience and neural intelligence.</p>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '8px' }} className="custom-scrollbar">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: '900px', paddingBottom: '100px' }}>
          
          {/* eBay Accounts & Connectivity */}
          <section className="heros-glass-card" style={{ padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Globe size={20} color="var(--heros-brand)" />
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Marketplace Connectivity</h3>
              </div>
              <button 
                className="heros-btn-brand"
                onClick={() => setIsConnectModalOpen(true)}
                style={{ padding: '10px 20px', fontSize: '13px' }}
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
                        style={{ padding: '8px 16px', fontSize: '13px' }}
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
          <section className="heros-glass-card" style={{ padding: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <Database size={20} color="var(--heros-brand)" />
              <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Vault Storage</h3>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>Storage Path</div>
                <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{storagePath || 'No directory selected'}</div>
              </div>
              <button className="heros-btn" onClick={selectDirectory}>
                <FolderOpen size={16} /> Change Directory
              </button>
            </div>
          </section>

          {/* Precision Controls & Shortcuts */}
          <section className="heros-glass-card" style={{ padding: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px' }}>
              <Command size={20} color="var(--heros-brand)" />
              <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Precision Controls</h3>
            </div>

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

          {/* Visual & Atmospheric Presets */}
          <section className="heros-glass-card" style={{ padding: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px' }}>
              <Monitor size={20} color="var(--heros-brand)" />
              <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Atmosphere & Visuals</h3>
            </div>

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
          </section>

          {/* Neural AI Configuration */}
          <section className="heros-glass-card" style={{ padding: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px' }}>
              <Brain size={20} color="var(--heros-brand)" />
              <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Neural Configuration</h3>
            </div>

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
        </div>
      </div>

      <EbayConnectModal 
        isOpen={isConnectModalOpen} 
        onClose={() => setIsConnectModalOpen(false)} 
      />
    </div>
  );
}

