import React, { useState } from 'react';
import AppShell from './components/AppShell';
import { LayoutProvider } from './contexts/LayoutContext';
import { VaultProvider, useVault } from './contexts/VaultContext';
import { Toaster } from 'sonner';
import { celebrationService } from './services/CelebrationService';

import { Lock as LockIcon, Key, ArrowRight, Eye, EyeOff, Fingerprint, Loader } from 'lucide-react';

import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import LoadingScreen from './components/LoadingScreen';
import { HerOSBackground, HerOSPanel, HerOSInput, HerOSButton, HerOSViewport } from './components/HerOS';
import { SettingsView } from './components/SettingsView';
import { SpotlightOverlay } from './components/SpotlightOverlay';
import { CartoonBuddy } from './components/CartoonBuddy';
import { OnboardingOverlay } from './components/OnboardingOverlay';
import { LandingPage as ResumeSite } from './Resume_site/LandingPage';

function AppContent() {
  const [currentPage, setCurrentPage] = useState('inbox');
  const { isLocked, isBooting, unlock, error, vaultData, updateUiPreferences, onboardingStep } = useVault();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isUnlockingLocal, setIsUnlockingLocal] = useState(false);
  const [isSpotlightOpen, setIsSpotlightOpen] = useState(false);

  // Cmd/Ctrl + = / - / 0 → nudge / reset UI scale (5% steps,
  // clamped 0.5–1.5 by VaultContext.applyUiScale). Persists via
  // updateUiPreferences which writes vaultData + localStorage.
  React.useEffect(() => {
    if (!vaultData) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const current = (vaultData.uiPreferences?.uiScale ?? 1.0) as number;
      // `=` and `+` share a key on most US keyboards; accept either.
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        updateUiPreferences({ ...vaultData.uiPreferences, uiScale: Math.min(1.5, current + 0.05) });
      } else if (e.key === '-') {
        e.preventDefault();
        updateUiPreferences({ ...vaultData.uiPreferences, uiScale: Math.max(0.5, current - 0.05) });
      } else if (e.key === '0') {
        e.preventDefault();
        updateUiPreferences({ ...vaultData.uiPreferences, uiScale: 1.0 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [vaultData, updateUiPreferences]);

  // Global Spotlight Keyboard Listener
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const preferredTrigger = vaultData?.uiPreferences?.spotlightTrigger || 'KeyF';
      const isPreferred = e.ctrlKey && e.code === preferredTrigger;
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';

      if (isPreferred || isCmdK) {
        e.preventDefault();
        setIsSpotlightOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    
    // Listen for global shortcut from backend
    let unlisten: any = null;
    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('spotlight-triggered', () => {
          console.log("Spotlight triggered via global shortcut");
          setIsSpotlightOpen(true);
        });
      } catch (err) {
        console.error("Failed to setup spotlight listener", err);
      }
    };
    
    setupListener();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (unlisten) unlisten();
    };
  }, []);

  // Sync HerOS Design Tokens with Vault Preferences
  React.useEffect(() => {
    if (vaultData?.uiPreferences) {
      const prefs = vaultData.uiPreferences;
      const root = document.documentElement;
      
      if (prefs.themeColor) {
        root.style.setProperty('--heros-brand', prefs.themeColor);
        
        // Dynamic RGB for glows/halos
        const hex = prefs.themeColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        root.style.setProperty('--heros-brand-rgb', `${r}, ${g}, ${b}`);

        // Calculate a deep background foundation based on theme if not explicitly provided
        // We want a very dark version of the brand or a deep neutral
        const foundationColor = prefs.themeColor === '#cc4c2b' ? '#14151a' : 
                                prefs.themeColor === '#00d2ff' ? '#0a0c10' :
                                prefs.themeColor === '#10b981' ? '#08100e' :
                                prefs.themeColor === '#8b5cf6' ? '#0f0a1a' : 
                                prefs.themeColor === '#9c36b5' ? '#0a0a0f' : 
                                prefs.themeColor === '#ffffff' ? '#171717' : 
                                prefs.themeColor === '#d35a36' ? '#f1ebe4' : 
                                prefs.themeColor === '#2c3e50' ? '#f5f2ed' : 
                                prefs.themeColor === '#f0d8d0' ? '#1a1b23' : '#14151a';
        
        root.style.setProperty('--heros-bg-foundation', foundationColor);
        root.style.setProperty('--heros-selection', `${prefs.themeColor}99`); 

        // ── Light Mode Logic ───────────────────────────────────────
        const isLight = foundationColor === '#f1ebe4' || foundationColor === '#f5f2ed';
        if (isLight) {
          root.style.setProperty('--heros-text-premium', '#1a1b23');
          root.style.setProperty('--heros-text-muted', 'rgba(0, 0, 0, 0.5)');
          root.style.setProperty('--on-surface', '#1a1b23');
          root.style.setProperty('--on-surface-variant', 'rgba(0, 0, 0, 0.7)');
          root.style.setProperty('--heros-glass-black', 'rgba(255, 255, 255, 0.65)');
          root.style.setProperty('--heros-glass-black-deep', 'rgba(255, 255, 255, 0.9)');
          
          // Adaptive Hover & Interaction Tokens for Zen Mode
          root.style.setProperty('--heros-btn-hover', 'rgba(0, 0, 0, 0.06)');
          root.style.setProperty('--heros-card-hover', 'rgba(0, 0, 0, 0.02)');
          root.style.setProperty('--heros-selection', 'rgba(44, 62, 80, 0.15)'); // Soft Navy selection
          root.style.setProperty('--heros-glass-fill', 'rgba(255, 255, 255, 0.45)');
          root.style.setProperty('--heros-text-shadow', 'none');
          root.style.setProperty('--heros-panel-shadow', '0 10px 40px rgba(0, 0, 0, 0.06)');
        } else {
          root.style.setProperty('--heros-text-premium', '#ffffff');
          root.style.setProperty('--heros-text-muted', 'rgba(255, 255, 255, 0.4)');
          root.style.setProperty('--on-surface', '#e3e1e9');
          root.style.setProperty('--on-surface-variant', '#c7c4d7');
          root.style.setProperty('--heros-glass-black', 'rgba(10, 11, 15, 0.82)');
          root.style.setProperty('--heros-glass-black-deep', 'rgba(5, 5, 8, 0.95)');
          
          // Adaptive Dark Mode Hover Tokens
          root.style.setProperty('--heros-btn-hover', 'rgba(255, 255, 255, 0.1)');
          root.style.setProperty('--heros-card-hover', 'rgba(255, 255, 255, 0.02)');
          root.style.setProperty('--heros-selection', `${prefs.themeColor}99`);
          
          // Restore Obsidian Glass
          const opacityValue = 0.40 + (prefs.glassIntensity / 100) * 0.45;
          root.style.setProperty('--heros-glass-fill', `rgba(10, 11, 15, ${opacityValue.toFixed(2)})`);
          root.style.setProperty('--heros-text-shadow', '0 1px 4px rgba(0, 0, 0, 0.8), 0 2px 10px rgba(0, 0, 0, 0.4)');
          root.style.setProperty('--heros-panel-shadow', '0 16px 48px 0 rgba(0, 0, 0, 0.35)');
        }
      }
      
      if (prefs.glassIntensity !== undefined) {
        // Base alpha is 0.40, goes up to 0.85 for deep obsidian feel
        const opacityValue = 0.40 + (prefs.glassIntensity / 100) * 0.45;
        root.style.setProperty('--heros-glass-fill', `rgba(10, 11, 15, ${opacityValue.toFixed(2)})`);
        // Keep blur consistent for high-fidelity look
        root.style.setProperty('--heros-glass-blur', '40px');
      }
      
      if (prefs.grainIntensity !== undefined) {
        root.style.setProperty('--heros-grain-opacity', (prefs.grainIntensity / 100).toFixed(2));
      }
      
      // Also sync celebration service
      celebrationService.setPreferences(prefs);
    }
  }, [vaultData?.uiPreferences]);

  // Handle background notifications
  React.useEffect(() => {
    let unlisten: (() => void) | null = null;
    
    const setupListener = async () => {
      // Request permission on mount
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }

      unlisten = await listen<{ accountId: string; conversationId: string }>('new-ebay-message', (event) => {
        const { accountId } = event.payload;
        
        // Show native notification
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("New eBay Message", {
            body: `New message received for account ${accountId}.`,
            icon: "/favicon_vault.png" // We can use the artifact image path later
          });
        }
        
        // Also show in-app toast
        toast.info(`New message received for ${accountId}`);
      });
    };

    setupListener();
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Once booting is done, show the window (in case it was hidden)
  React.useEffect(() => {
    if (!isBooting) {
      const showWin = async () => {
        const win = getCurrentWindow();
        await win.show();
        await win.setFocus();
      };
      showWin();
    }
  }, [isBooting]);

  return (
    <HerOSViewport>
      {/* ── Global Cinematic Background Layer ── */}
      <motion.div 
        initial={{ backgroundColor: '#14151a' }}
        animate={{ 
          backgroundColor: 'var(--heros-bg-foundation)',
        }}
        transition={{ duration: 2.0, ease: "easeInOut" }}
        style={{ position: 'absolute', inset: 0, zIndex: 0 }}
      />
      
      <motion.div 
        animate={{ 
          opacity: 1,
          filter: (isBooting || (vaultData?.uiPreferences?.themeColor === '#f0d8d0')) 
            ? 'blur(20px) saturate(0.4) brightness(0.7)' 
            : 'blur(0px) saturate(0.7) brightness(0.85)',
        }}
        className={isLocked && !isBooting ? "login-mode" : ""} 
        transition={{ duration: 1.5 }}
        style={{ 
          position: 'absolute', 
          inset: 0, 
          zIndex: 1,
          pointerEvents: 'none'
        }}
      >
        <HerOSBackground />
        {/* Cinematic Vignette Overlay — Crushes edge brightness for focus */}
        <div style={{ 
          position: 'absolute', 
          inset: 0, 
          background: 'radial-gradient(circle at center, transparent 0%, rgba(0,0,0,0.4) 100%)',
          pointerEvents: 'none'
        }} />
      </motion.div>

      <AnimatePresence>
        {isBooting ? (
          <motion.div
            key="boot"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
            style={{ width: '100vw', height: '100vh', position: 'relative', zIndex: 10 }}
          >
            <LoadingScreen />
          </motion.div>
        ) : isLocked ? (
          <motion.div
            key="lock"
            className="login-mode"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
          >
            
            <div data-tauri-drag-region style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 48, zIndex: 9999, cursor: 'grab' }} />
            
            <main style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: '400px', padding: '0 24px' }}>
              <HerOSPanel>
                
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '40px' }}>
                  <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px', boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}>
                    <LockIcon color="#f0d8d0" size={28} />
                  </div>
                  <h1 style={{ fontSize: '28px', fontWeight: 300, letterSpacing: '0.02em', color: '#fff', marginBottom: '8px', margin: 0 }}>OS<sup style={{ fontSize: '16px' }}>1</sup></h1>
                  <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.4em', textTransform: 'uppercase', color: 'rgba(240, 216, 208, 0.8)', textAlign: 'center', margin: 0 }}>Secure Volume</p>
                </div>

                {error && <div style={{ color: '#fff', fontSize: '13px', textAlign: 'center', marginBottom: '16px', padding: '10px', background: 'rgba(255, 0, 0, 0.2)', border: '1px solid rgba(255,0,0,0.3)', borderRadius: '8px' }}>{error}</div>}

                <form onSubmit={async (e) => { 
                  e.preventDefault(); 
                  setIsUnlockingLocal(true);
                  try {
                    await unlock(password); 
                  } finally {
                    setIsUnlockingLocal(false);
                  }
                }} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  
                  <HerOSInput 
                    type="password"
                    placeholder="Master Password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    icon={<Key color="rgba(240, 216, 208, 0.5)" size={18} />}
                  />

                  <div style={{ display: 'flex', gap: '12px' }}>
                    <HerOSButton 
                      type="submit"
                      loading={isUnlockingLocal}
                      icon={isUnlockingLocal ? <Loader className="spin" size={18} /> : <ArrowRight size={18} />}
                      style={{ flex: 1, padding: '16px', borderRadius: '12px', fontWeight: 600, fontSize: '15px', letterSpacing: '0.05em' }}
                    >
                      Unlock
                    </HerOSButton>
                    <HerOSButton 
                      type="button"
                      title="Use Biometric Unlock"
                      style={{ width: '54px', height: '54px', borderRadius: '12px', padding: 0 }}
                    >
                      <Fingerprint size={20} />
                    </HerOSButton>
                  </div>
                </form>

                <div style={{ marginTop: '36px', display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 500 }}>
                  <a href="#" style={{ color: 'rgba(255, 255, 255, 0.75)', textDecoration: 'none', transition: 'color 0.2s' }}>Forgot Password?</a>
                  <a href="#" style={{ color: 'rgba(255, 255, 255, 0.75)', textDecoration: 'none', transition: 'color 0.2s' }}>Create New Vault</a>
                </div>

              </HerOSPanel>
            </main>
          </motion.div>
        ) : (onboardingStep != null && onboardingStep !== 'done') ? (
          <motion.div
            key="onboarding"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            style={{ position: 'absolute', inset: 0, zIndex: 10 }}
          >
            <OnboardingOverlay />
          </motion.div>
        ) : (
          <motion.div
            key="shell"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            style={{ position: 'relative', zIndex: 10, width: '100%', height: '100%' }}
          >
            <AppShell currentPage={currentPage} onNavigate={setCurrentPage} />
            {isSpotlightOpen && (
              <SpotlightOverlay
                onDismiss={() => setIsSpotlightOpen(false)}
                onOpenPreview={(nodeId) => {
                  setIsSpotlightOpen(false);
                  setCurrentPage('notes');
                  window.dispatchEvent(new CustomEvent('notes:open', { detail: nodeId }));
                }}
                onOpenInNewTab={(nodeId) => {
                  setIsSpotlightOpen(false);
                  setCurrentPage('notes');
                  window.dispatchEvent(new CustomEvent('notes:open-new-tab', { detail: nodeId }));
                }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- RESUME SITE FULL SCREEN OVERLAY --- */}
      <AnimatePresence>
        {currentPage === 'resume' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 100000 }}
          >
            <ResumeSite onBack={() => setCurrentPage('dashboard')} />
          </motion.div>
        )}
      </AnimatePresence>

      <Toaster 
        theme="dark" 
        position={vaultData?.uiPreferences?.toastPosition || "top-right"} 
        richColors 
        closeButton
      />
      <CartoonBuddy />
    </HerOSViewport>
  );
}

export default function App() {
  return (
    <LayoutProvider>
      <VaultProvider>
        <AppContent />
      </VaultProvider>
    </LayoutProvider>
  );
}
